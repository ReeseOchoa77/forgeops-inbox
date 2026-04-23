import { google } from "googleapis";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
  messageId: z.string().min(1),
  attachmentId: z.string().min(1)
});

async function fetchGmailAttachment(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  gmailMessageId: string;
  attachmentId: string;
}): Promise<{ data: Buffer; }> {
  const client = new google.auth.OAuth2(input.clientId, input.clientSecret, input.redirectUri);
  client.setCredentials({ refresh_token: input.refreshToken });
  await client.getAccessToken();

  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: input.gmailMessageId,
    id: input.attachmentId
  });

  const base64 = (res.data.data ?? "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return { data: Buffer.from(base64, "base64") };
}

async function fetchOutlookAttachment(input: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  refreshToken: string;
  outlookMessageId: string;
  attachmentId: string;
}): Promise<{ data: Buffer }> {
  const tokenUrl = `https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`;
  const tokenBody = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
    scope: "https://graph.microsoft.com/Mail.Read offline_access"
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString()
  });

  if (!tokenRes.ok) throw new Error(`Outlook token refresh failed: ${tokenRes.status}`);
  const tokens = await tokenRes.json() as { access_token: string };

  const attRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${input.outlookMessageId}/attachments/${input.attachmentId}/$value`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );

  if (!attRes.ok) throw new Error(`Outlook attachment fetch failed: ${attRes.status}`);
  const arrayBuf = await attRes.arrayBuffer();
  return { data: Buffer.from(arrayBuf) };
}

export const registerAttachmentRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/messages/:messageId/attachments/:attachmentId/download",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const session = await getSessionFromRequest(request);

      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );

      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: { id: params.connectionId, workspaceId: params.workspaceId },
        select: { id: true, provider: true, status: true, encryptedRefreshToken: true }
      });

      if (!connection) return reply.code(404).send({ message: "Connection not found" });
      if (!connection.encryptedRefreshToken) return reply.code(409).send({ message: "No refresh token" });

      const message = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }]
        },
        select: { id: true, gmailMessageId: true, attachmentMetadata: true }
      });

      if (!message) return reply.code(404).send({ message: "Message not found" });

      const attachments = (message.attachmentMetadata as Array<{
        attachmentId: string | null;
        filename: string | null;
        mimeType: string | null;
      }>) ?? [];
      const attachment = attachments.find(a => a.attachmentId === params.attachmentId);
      const filename = attachment?.filename ?? "attachment";
      const mimeType = attachment?.mimeType ?? "application/octet-stream";

      const refreshToken = app.services.tokenCipher.decrypt(connection.encryptedRefreshToken);

      try {
        let result: { data: Buffer };

        if (connection.provider === "GMAIL") {
          const env = app.services.env;
          if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_INBOX_REDIRECT_URI) {
            return reply.code(503).send({ message: "Google OAuth not configured" });
          }
          result = await fetchGmailAttachment({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_INBOX_REDIRECT_URI,
            refreshToken,
            gmailMessageId: message.gmailMessageId,
            attachmentId: params.attachmentId
          });
        } else if (connection.provider === "OUTLOOK") {
          const env = app.services.env;
          if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET) {
            return reply.code(503).send({ message: "Outlook OAuth not configured" });
          }
          result = await fetchOutlookAttachment({
            clientId: env.OUTLOOK_CLIENT_ID,
            clientSecret: env.OUTLOOK_CLIENT_SECRET,
            tenantId: env.OUTLOOK_TENANT_ID,
            refreshToken,
            outlookMessageId: message.gmailMessageId,
            attachmentId: params.attachmentId
          });
        } else {
          return reply.code(400).send({ message: "Unsupported provider" });
        }

        return reply
          .header("Content-Type", mimeType)
          .header("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`)
          .header("Content-Length", result.data.length)
          .send(result.data);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Download failed";
        app.log.error({ event: "attachment_download_failed", error: errMsg });
        return reply.code(502).send({ message: `Attachment download failed: ${errMsg}` });
      }
    }
  );
};
