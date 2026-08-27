import { google } from "googleapis";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { assertUserMaySendAsConnection } from "../../../application/services/sendable-mailbox.js";
import { getSessionFromRequest } from "../authentication.js";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1)
});

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1),
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

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Graph REST message IDs go stale (folder moves) and n8n may store ImmutableIds.
 * Resolve a live /me message id before /reply. Never logs tokens.
 */
export async function resolveOutlookGraphMessageId(input: {
  accessToken: string;
  storedMessageId: string;
  internetMessageId: string | null;
  conversationId: string | null;
  sentAt: Date | null;
}): Promise<{ id: string; resolvedVia: string; useImmutableIdPrefer: boolean }> {
  const getMessage = async (messageId: string, immutable: boolean) => {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=id`,
      {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          ...(immutable ? { Prefer: 'IdType="ImmutableId"' } : {}),
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? messageId;
  };

  const restId = await getMessage(input.storedMessageId, false);
  if (restId) {
    return {
      id: restId,
      resolvedVia: "stored_rest_id",
      useImmutableIdPrefer: false,
    };
  }

  const immutableId = await getMessage(input.storedMessageId, true);
  if (immutableId) {
    return {
      id: immutableId,
      resolvedVia: "stored_immutable_id",
      useImmutableIdPrefer: true,
    };
  }

  if (input.internetMessageId) {
    const imidCandidates = [input.internetMessageId];
    if (
      input.internetMessageId.startsWith("<") &&
      input.internetMessageId.endsWith(">")
    ) {
      imidCandidates.push(input.internetMessageId.slice(1, -1));
    } else {
      imidCandidates.push(`<${input.internetMessageId}>`);
    }

    for (const imid of imidCandidates) {
      const filter = `internetMessageId eq '${escapeODataString(imid)}'`;
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`,
        { headers: { Authorization: `Bearer ${input.accessToken}` } }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { value?: Array<{ id: string }> };
      const id = data.value?.[0]?.id;
      if (id) {
        return {
          id,
          resolvedVia: "internet_message_id",
          useImmutableIdPrefer: false,
        };
      }
    }
  }

  if (input.conversationId) {
    const filter = `conversationId eq '${escapeODataString(input.conversationId)}'`;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$select=id,sentDateTime&$top=50&$orderby=sentDateTime desc`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        value?: Array<{ id: string; sentDateTime?: string }>;
      };
      const messages = data.value ?? [];

      if (input.sentAt && messages.length > 0) {
        const targetMs = input.sentAt.getTime();
        let best: { id: string; delta: number } | null = null;
        for (const message of messages) {
          if (!message.sentDateTime) continue;
          const delta = Math.abs(
            new Date(message.sentDateTime).getTime() - targetMs
          );
          if (!best || delta < best.delta) {
            best = { id: message.id, delta };
          }
        }
        if (best && best.delta <= 60_000) {
          return {
            id: best.id,
            resolvedVia: "conversation_sent_at",
            useImmutableIdPrefer: false,
          };
        }
      }

      if (messages.length === 1 && messages[0]) {
        return {
          id: messages[0].id,
          resolvedVia: "conversation_single",
          useImmutableIdPrefer: false,
        };
      }
    }
  }

  throw new Error(
    "Outlook message not found in mailbox for reply. It may have been deleted or moved; sync the mailbox and try again."
  );
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
  internetMessageId: string | null;
  conversationId: string | null;
  sentAt: Date | null;
  isReply: boolean;
  attachments: ParsedAttachment[];
  onReplyResolved?: (info: {
    resolvedVia: string;
    useImmutableIdPrefer: boolean;
  }) => void;
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

  // Use /reply (Mail.Send) — not createReply/PATCH/send (Mail.ReadWrite).
  // Compose already works with sendMail under Mail.Send only.
  if (input.isReply && input.replyToMessageId) {
    const resolved = await resolveOutlookGraphMessageId({
      accessToken: tokens.access_token,
      storedMessageId: input.replyToMessageId,
      internetMessageId: input.internetMessageId,
      conversationId: input.conversationId,
      sentAt: input.sentAt,
    });
    input.onReplyResolved?.({
      resolvedVia: resolved.resolvedVia,
      useImmutableIdPrefer: resolved.useImmutableIdPrefer,
    });

    const replyRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(resolved.id)}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json",
          ...(resolved.useImmutableIdPrefer
            ? { Prefer: 'IdType="ImmutableId"' }
            : {}),
        },
        // Graph forbids both comment and message.body — use body only.
        body: JSON.stringify({
          message: {
            body: { contentType, content: input.body },
            toRecipients: input.to.map((e) => ({
              emailAddress: { address: e }
            })),
            ccRecipients: input.cc.map((e) => ({
              emailAddress: { address: e }
            })),
            bccRecipients: input.bcc.map((e) => ({
              emailAddress: { address: e }
            })),
            ...(graphAttachments.length > 0
              ? { attachments: graphAttachments }
              : {})
          }
        })
      }
    );

    if (!replyRes.ok) {
      const err = await replyRes.text();
      throw new Error(`Outlook reply failed: ${replyRes.status} ${err}`);
    }

    return { providerMessageId: "replied" };
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
  app.get(
    "/api/v1/workspaces/:workspaceId/sendable-mailboxes",
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      const connections = await app.services.prisma.inboxConnection.findMany({
        where: { workspaceId: params.workspaceId },
        select: {
          id: true,
          email: true,
          displayName: true,
          provider: true,
          status: true,
          grantedScopes: true,
          encryptedRefreshToken: true,
        },
        orderBy: { email: "asc" },
      });

      const mailboxes = connections
        .filter((c) =>
          assertUserMaySendAsConnection({
            workspaceRole: membership.role,
            connection: {
              email: c.email,
              provider: c.provider,
              status: c.status,
              hasRefreshToken: Boolean(c.encryptedRefreshToken),
              grantedScopes: c.grantedScopes,
            },
          }).ok
        )
        .map((c) => ({
          id: c.id,
          email: c.email,
          displayName: c.displayName,
          provider: c.provider.toLowerCase(),
        }));

      return reply.send({ mailboxes });
    }
  );

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
          grantedScopes: true,
          encryptedRefreshToken: true
        }
      });

      if (!connection) return reply.code(404).send({ message: "Connection not found" });

      const sendAuth = assertUserMaySendAsConnection({
        workspaceRole: membership.role,
        connection: {
          email: connection.email,
          provider: connection.provider,
          status: connection.status,
          hasRefreshToken: Boolean(connection.encryptedRefreshToken),
          grantedScopes: connection.grantedScopes,
        },
      });
      if (!sendAuth.ok) {
        return reply.code(sendAuth.statusCode).send({
          message: sendAuth.message,
          code: sendAuth.code,
        });
      }

      if (!connection.encryptedRefreshToken) {
        return reply.code(409).send({
          message: "Mailbox authorization required before sending.",
          code: "MAILBOX_AUTH_REQUIRED",
        });
      }

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

      let originalMessage: {
        id: string;
        gmailMessageId: string;
        gmailThreadId: string;
        providerMessageId: string | null;
        internetMessageId: string | null;
        sentAt: Date | null;
        subject: string | null;
      } | null = null;
      if (body.action !== "new" && body.originalMessageId) {
        originalMessage = await app.services.prisma.emailMessage.findFirst({
          where: {
            workspaceId: params.workspaceId,
            inboxConnectionId: params.connectionId,
            OR: [{ id: body.originalMessageId }, { gmailMessageId: body.originalMessageId }]
          },
          select: {
            id: true,
            gmailMessageId: true,
            gmailThreadId: true,
            providerMessageId: true,
            internetMessageId: true,
            sentAt: true,
            subject: true,
          }
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
            replyToMessageId:
              body.action === "reply" && originalMessage
                ? (originalMessage.providerMessageId ??
                    originalMessage.gmailMessageId)
                : null,
            internetMessageId: originalMessage?.internetMessageId ?? null,
            conversationId: originalMessage?.gmailThreadId ?? null,
            sentAt: originalMessage?.sentAt ?? null,
            isReply: body.action === "reply",
            attachments,
            onReplyResolved: (info) => {
              request.log.info({
                event: "outlook_reply_message_resolved",
                resolvedVia: info.resolvedVia,
                useImmutableIdPrefer: info.useImmutableIdPrefer,
                hasInternetMessageId: Boolean(
                  originalMessage?.internetMessageId
                ),
                hasConversationId: Boolean(originalMessage?.gmailThreadId),
                connectionId: params.connectionId,
                workspaceId: params.workspaceId,
                emailMessageId: originalMessage?.id ?? null,
              });
            },
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
            from: connection.email,
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
