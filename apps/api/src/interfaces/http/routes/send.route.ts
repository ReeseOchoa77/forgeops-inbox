import { google } from "googleapis";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1)
});

const sendBodySchema = z.object({
  action: z.enum(["reply", "forward", "new"]),
  originalMessageId: z.string().min(1).optional(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional().default([]),
  bcc: z.array(z.string().email()).optional().default([]),
  subject: z.string().min(1),
  body: z.string().min(1),
  bodyFormat: z.enum(["text", "html"]).optional().default("text")
});

interface ParsedAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

function buildMimeBoundary(): string {
  return `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function buildMultipartMime(input: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string | null;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
  attachments: ParsedAttachment[];
}): string {
  const boundary = buildMimeBoundary();
  const hasAttachments = input.attachments.length > 0;
  const useHtml = !!input.bodyHtml;

  const lines: string[] = [];
  lines.push(`From: ${input.from}`);
  lines.push(`To: ${input.to.join(", ")}`);
  if (input.cc.length > 0) lines.push(`Cc: ${input.cc.join(", ")}`);
  if (input.bcc.length > 0) lines.push(`Bcc: ${input.bcc.join(", ")}`);
  lines.push(`Subject: ${input.subject}`);
  lines.push("MIME-Version: 1.0");
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) lines.push(`References: ${input.references}`);

  if (!hasAttachments) {
    lines.push(`Content-Type: ${useHtml ? "text/html" : "text/plain"}; charset="UTF-8"`);
    lines.push("");
    lines.push(useHtml ? input.bodyHtml! : input.bodyText);
  } else {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${useHtml ? "text/html" : "text/plain"}; charset="UTF-8"`);
    lines.push("");
    lines.push(useHtml ? input.bodyHtml! : input.bodyText);

    for (const att of input.attachments) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      lines.push("");
      const b64 = att.data.toString("base64");
      for (let i = 0; i < b64.length; i += 76) {
        lines.push(b64.slice(i, i + 76));
      }
    }
    lines.push(`--${boundary}--`);
  }

  return lines.join("\r\n");
}

function toBase64Url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendViaGmail(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  bodyFormat: "text" | "html";
  threadId: string | null;
  inReplyTo: string | null;
  attachments: ParsedAttachment[];
}): Promise<{ providerMessageId: string }> {
  const client = new google.auth.OAuth2(input.clientId, input.clientSecret, input.redirectUri);
  client.setCredentials({ refresh_token: input.refreshToken });
  await client.getAccessToken();

  const gmail = google.gmail({ version: "v1", auth: client });
  const raw = toBase64Url(buildMultipartMime({
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    bodyHtml: input.bodyFormat === "html" ? input.body : null,
    bodyText: input.body,
    inReplyTo: input.inReplyTo,
    references: input.inReplyTo,
    attachments: input.attachments
  }));

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(input.threadId ? { threadId: input.threadId } : {})
    }
  });

  return { providerMessageId: result.data.id ?? "unknown" };
}

async function sendViaOutlook(input: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  refreshToken: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  bodyFormat: "text" | "html";
  replyToMessageId: string | null;
  isReply: boolean;
  attachments: ParsedAttachment[];
}): Promise<{ providerMessageId: string }> {
  const tokenUrl = `https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`;
  const tokenBody = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
    scope: "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access"
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString()
  });

  if (!tokenRes.ok) throw new Error(`Outlook token refresh failed: ${tokenRes.status}`);
  const tokens = await tokenRes.json() as { access_token: string };

  const contentType = input.bodyFormat === "html" ? "HTML" : "Text";
  const graphAttachments = input.attachments.map(att => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: att.filename,
    contentType: att.mimeType,
    contentBytes: att.data.toString("base64")
  }));

  if (input.isReply && input.replyToMessageId) {
    const createRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${input.replyToMessageId}/createReply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Outlook createReply failed: ${createRes.status} ${err}`);
    }

    const draft = await createRes.json() as { id: string };
    const draftId = draft.id;

    const patchRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draftId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          body: { contentType, content: input.body },
          toRecipients: input.to.map(e => ({ emailAddress: { address: e } })),
          ccRecipients: input.cc.map(e => ({ emailAddress: { address: e } })),
          ...(graphAttachments.length > 0 ? { attachments: graphAttachments } : {})
        })
      }
    );

    if (!patchRes.ok) {
      const err = await patchRes.text();
      throw new Error(`Outlook patch draft failed: ${patchRes.status} ${err}`);
    }

    const sendRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draftId}/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      }
    );

    if (!sendRes.ok) {
      const err = await sendRes.text();
      throw new Error(`Outlook send reply failed: ${sendRes.status} ${err}`);
    }

    return { providerMessageId: draftId };
  }

  const sendRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType, content: input.body },
        toRecipients: input.to.map(e => ({ emailAddress: { address: e } })),
        ccRecipients: input.cc.map(e => ({ emailAddress: { address: e } })),
        bccRecipients: input.bcc.map(e => ({ emailAddress: { address: e } })),
        ...(graphAttachments.length > 0 ? { attachments: graphAttachments } : {})
      }
    })
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`Outlook send failed: ${sendRes.status} ${err}`);
  }

  return { providerMessageId: "sent" };
}

export const registerSendRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/send",
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
        select: {
          id: true,
          provider: true,
          email: true,
          status: true,
          encryptedRefreshToken: true
        }
      });

      if (!connection) return reply.code(404).send({ message: "Connection not found" });
      if (connection.status !== "ACTIVE") return reply.code(409).send({ message: "Connection is not active" });
      if (!connection.encryptedRefreshToken) return reply.code(409).send({ message: "No refresh token available" });

      let body: z.infer<typeof sendBodySchema>;
      const attachments: ParsedAttachment[] = [];

      const contentType = request.headers["content-type"] ?? "";
      if (contentType.includes("multipart/form-data")) {
        const parts = request.parts();
        const fields: Record<string, string> = {};
        for await (const part of parts) {
          if (part.type === "file") {
            const buf = await part.toBuffer();
            attachments.push({
              filename: part.filename ?? "attachment",
              mimeType: part.mimetype ?? "application/octet-stream",
              data: buf
            });
          } else {
            fields[part.fieldname] = part.value as string;
          }
        }
        body = sendBodySchema.parse({
          ...fields,
          to: fields.to ? JSON.parse(fields.to) : [],
          cc: fields.cc ? JSON.parse(fields.cc) : [],
          bcc: fields.bcc ? JSON.parse(fields.bcc) : []
        });
      } else {
        body = sendBodySchema.parse(request.body);
      }

      let originalMessage: { id: string; gmailMessageId: string; gmailThreadId: string; subject: string | null } | null = null;
      if (body.action !== "new" && body.originalMessageId) {
        originalMessage = await app.services.prisma.emailMessage.findFirst({
          where: {
            workspaceId: params.workspaceId,
            inboxConnectionId: params.connectionId,
            OR: [{ id: body.originalMessageId }, { gmailMessageId: body.originalMessageId }]
          },
          select: { id: true, gmailMessageId: true, gmailThreadId: true, subject: true }
        });

        if (!originalMessage) return reply.code(404).send({ message: "Original message not found" });
      }

      const refreshToken = app.services.tokenCipher.decrypt(connection.encryptedRefreshToken);

      try {
        let result: { providerMessageId: string };

        if (connection.provider === "GMAIL") {
          const env = app.services.env;
          if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_INBOX_REDIRECT_URI) {
            return reply.code(503).send({ message: "Google OAuth not configured for sending" });
          }

          result = await sendViaGmail({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_INBOX_REDIRECT_URI,
            refreshToken,
            from: connection.email,
            to: body.to,
            cc: body.cc,
            bcc: body.bcc,
            subject: body.subject,
            body: body.body,
            bodyFormat: body.bodyFormat,
            threadId: body.action === "reply" && originalMessage ? originalMessage.gmailThreadId : null,
            inReplyTo: body.action === "reply" && originalMessage ? `<${originalMessage.gmailMessageId}>` : null,
            attachments
          });
        } else if (connection.provider === "OUTLOOK") {
          const env = app.services.env;
          if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET) {
            return reply.code(503).send({ message: "Outlook OAuth not configured for sending" });
          }

          result = await sendViaOutlook({
            clientId: env.OUTLOOK_CLIENT_ID,
            clientSecret: env.OUTLOOK_CLIENT_SECRET,
            tenantId: env.OUTLOOK_TENANT_ID,
            refreshToken,
            to: body.to,
            cc: body.cc,
            bcc: body.bcc,
            subject: body.subject,
            body: body.body,
            bodyFormat: body.bodyFormat,
            replyToMessageId: body.action === "reply" && originalMessage ? originalMessage.gmailMessageId : null,
            isReply: body.action === "reply",
            attachments
          });
        } else {
          return reply.code(400).send({ message: "Unsupported provider for sending" });
        }

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          actorUserId: session.userId,
          entityType: "EMAIL_MESSAGE",
          entityId: originalMessage?.id ?? "new",
          action: `email_message.${body.action}_sent`,
          metadata: {
            to: body.to,
            cc: body.cc,
            subject: body.subject,
            provider: connection.provider,
            providerMessageId: result.providerMessageId,
            attachmentCount: attachments.length,
            bodyFormat: body.bodyFormat
          },
          request
        });

        return reply.send({
          status: "sent",
          action: body.action,
          providerMessageId: result.providerMessageId
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Send failed";
        app.log.error({ event: "send_failed", error: message });

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          actorUserId: session.userId,
          entityType: "EMAIL_MESSAGE",
          entityId: originalMessage?.id ?? "new",
          action: `email_message.${body.action}_failed`,
          metadata: { error: message },
          request
        });

        return reply.code(500).send({ message: `Failed to send: ${message}` });
      }
    }
  );
};
