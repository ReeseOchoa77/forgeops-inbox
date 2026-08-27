import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { AttachmentStorage } from "../../infrastructure/storage/attachment-storage.js";

/** Graph sendMail/reply fileAttachment contentBytes limit (Microsoft). */
export const OUTLOOK_SIMPLE_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

export const OUTBOUND_BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".scr",
  ".msi",
  ".com",
  ".vbs",
  ".js",
  ".ps1",
  ".sh",
  ".pif",
  ".ws",
  ".wsf",
]);

export type OutboundAttachment = {
  filename: string;
  mimeType: string;
  data: Buffer;
  source: "UPLOAD" | "EXISTING_EMAIL_ATTACHMENT";
  emailAttachmentId?: string;
};

export function sanitizeOutboundFilename(filename: string): string {
  let sanitized = filename
    .replace(/\0/g, "")
    .replace(/\.\./g, "_")
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._\-() ]/g, "_")
    .replace(/_{2,}/g, "_")
    .trim();
  if (!sanitized || sanitized === "." || sanitized === ".." || /^_+$/.test(sanitized)) {
    sanitized = "attachment";
  }
  return sanitized.slice(0, 200);
}

export function getOutboundExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return "";
  return filename.slice(dot).toLowerCase();
}

export function validateOutboundUpload(input: {
  filename: string;
  sizeBytes: number;
  maxBytes: number;
}): { ok: true; filename: string } | { ok: false; message: string } {
  const filename = sanitizeOutboundFilename(input.filename);
  const ext = getOutboundExtension(filename);
  if (OUTBOUND_BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, message: `File type ${ext || "(none)"} is not allowed` };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, message: "Empty attachment" };
  }
  if (input.sizeBytes > input.maxBytes) {
    return {
      ok: false,
      message: `Attachment "${filename}" exceeds maximum size of ${Math.round(input.maxBytes / (1024 * 1024))} MB`,
    };
  }
  return { ok: true, filename };
}

function localStorageRoot(): string {
  return (
    process.env.ATTACHMENT_STORAGE_PATH?.trim() ||
    resolve(process.cwd(), "data", "attachments")
  );
}

export async function readStoredAttachmentBytes(input: {
  storage: AttachmentStorage;
  storageKey: string;
}): Promise<Buffer> {
  if (input.storage.configured) {
    const obj = await input.storage.getObject(input.storageKey);
    return obj.data;
  }

  const fullPath = join(localStorageRoot(), input.storageKey);
  if (existsSync(fullPath)) {
    return readFileSync(fullPath);
  }

  // Legacy layout fallback (email-attachment download path)
  const keyParts = input.storageKey.split("/");
  const dir = resolve(localStorageRoot(), ...keyParts.slice(0, 2));
  if (!existsSync(dir)) {
    throw new Error("Attachment file not found in storage");
  }
  const { readdirSync } = await import("node:fs");
  const entries = readdirSync(dir);
  const match = entries.find((f) => input.storageKey.endsWith(f));
  if (!match) throw new Error("Attachment file not found in storage");
  return readFileSync(join(dir, match));
}

export async function resolveExistingOutboundAttachments(input: {
  prisma: PrismaClient;
  storage: AttachmentStorage;
  workspaceId: string;
  inboxConnectionId: string;
  originalMessageId: string;
  attachmentIds: string[];
}): Promise<OutboundAttachment[]> {
  if (input.attachmentIds.length === 0) return [];

  const uniqueIds = [...new Set(input.attachmentIds)];
  const rows = await input.prisma.emailAttachment.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: { in: uniqueIds },
      isInline: false,
      uploadStatus: "UPLOADED",
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      emailMessageId: true,
      emailMessage: {
        select: {
          id: true,
          inboxConnectionId: true,
          workspaceId: true,
        },
      },
    },
  });

  if (rows.length !== uniqueIds.length) {
    throw Object.assign(
      new Error("One or more attachments were not found or are not available"),
      { statusCode: 404 }
    );
  }

  const original = await input.prisma.emailMessage.findFirst({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      OR: [
        { id: input.originalMessageId },
        { gmailMessageId: input.originalMessageId },
      ],
    },
    select: { id: true, threadId: true },
  });
  if (!original) {
    throw Object.assign(new Error("Original message not found"), {
      statusCode: 404,
    });
  }

  // Allow attachments from the same thread (forward of latest may reference sibling msgs)
  const threadMessageIds = new Set(
    (
      await input.prisma.emailMessage.findMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          threadId: original.threadId,
        },
        select: { id: true },
      })
    ).map((m) => m.id)
  );

  const out: OutboundAttachment[] = [];
  for (const row of rows) {
    if (row.emailMessage.workspaceId !== input.workspaceId) {
      throw Object.assign(new Error("Attachment access denied"), {
        statusCode: 403,
      });
    }
    if (row.emailMessage.inboxConnectionId !== input.inboxConnectionId) {
      throw Object.assign(new Error("Attachment mailbox mismatch"), {
        statusCode: 403,
      });
    }
    if (!threadMessageIds.has(row.emailMessageId)) {
      throw Object.assign(
        new Error("Attachment does not belong to this conversation"),
        { statusCode: 403 }
      );
    }
    if (!row.storageKey) {
      throw Object.assign(
        new Error(`Attachment "${row.filename}" is missing from storage`),
        { statusCode: 409 }
      );
    }
    const data = await readStoredAttachmentBytes({
      storage: input.storage,
      storageKey: row.storageKey,
    });
    out.push({
      filename: sanitizeOutboundFilename(row.filename),
      mimeType: row.mimeType || "application/octet-stream",
      data,
      source: "EXISTING_EMAIL_ATTACHMENT",
      emailAttachmentId: row.id,
    });
  }
  return out;
}

export async function persistOutboundSentAttachments(input: {
  prisma: PrismaClient;
  storage: AttachmentStorage;
  workspaceId: string;
  inboxConnectionId: string;
  connectionEmail: string;
  action: "new" | "reply" | "forward";
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  bodyFormat: "text" | "html";
  providerMessageId: string;
  originalThreadId: string | null;
  originalGmailThreadId: string | null;
  attachments: OutboundAttachment[];
}): Promise<{ emailMessageId: string } | null> {
  if (input.attachments.length === 0) {
    // Still persist a lightweight sent row without attachments when possible
  }

  const now = new Date();
  const localMessageId = `forgeops-sent-${randomBytes(12).toString("hex")}`;
  const threadProviderId =
    input.originalGmailThreadId ??
    (input.action === "new" ? localMessageId : localMessageId);

  const thread =
    input.originalThreadId
      ? await input.prisma.emailThread.findFirst({
          where: {
            id: input.originalThreadId,
            workspaceId: input.workspaceId,
            inboxConnectionId: input.inboxConnectionId,
          },
          select: { id: true, gmailThreadId: true },
        })
      : null;

  const ensuredThread =
    thread ??
    (await input.prisma.emailThread.create({
      data: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        gmailThreadId: threadProviderId,
        providerThreadId: threadProviderId,
        subject: input.subject,
        snippet: input.body.slice(0, 200),
        lastMessageAt: now,
        messageCount: 0,
      },
      select: { id: true, gmailThreadId: true },
    }));

  const message = await input.prisma.emailMessage.create({
    data: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      threadId: ensuredThread.id,
      gmailMessageId: localMessageId,
      gmailThreadId: ensuredThread.gmailThreadId,
      providerMessageId:
        input.providerMessageId === "sent" ||
        input.providerMessageId === "replied"
          ? localMessageId
          : input.providerMessageId,
      providerThreadId: ensuredThread.gmailThreadId,
      subject: input.subject,
      senderEmail: input.connectionEmail,
      senderName: null,
      toAddresses: input.to.map((email) => ({ email, name: null })),
      ccAddresses: input.cc.map((email) => ({ email, name: null })),
      bccAddresses: input.bcc.map((email) => ({ email, name: null })),
      snippet: input.body.replace(/<[^>]+>/g, " ").slice(0, 240),
      bodyText: input.bodyFormat === "text" ? input.body : null,
      bodyHtml: input.bodyFormat === "html" ? input.body : null,
      hasAttachments: input.attachments.length > 0,
      isRead: true,
      mailboxCategory: "BUSINESS",
      sentAt: now,
      receivedAt: now,
      itemStatus: "NEW",
      attachmentMetadata: input.attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.data.length,
        inline: false,
      })),
    },
    select: { id: true },
  });

  await input.prisma.emailThread.update({
    where: { id: ensuredThread.id },
    data: {
      lastMessageAt: now,
      messageCount: { increment: 1 },
      snippet: input.body.replace(/<[^>]+>/g, " ").slice(0, 200),
    },
  });

  for (const att of input.attachments) {
    const attachmentId = randomBytes(12).toString("hex");
    const sanitized = sanitizeOutboundFilename(att.filename);
    const storageKey = `attachments/${input.workspaceId}/${message.id}/${attachmentId}/${sanitized}`;
    const checksum = createHash("sha256").update(att.data).digest("hex");

    try {
      if (input.storage.configured) {
        await input.storage.upload(
          storageKey,
          att.data,
          att.mimeType || "application/octet-stream"
        );
      } else {
        const fullPath = join(localStorageRoot(), storageKey);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, att.data);
      }

      await input.prisma.emailAttachment.create({
        data: {
          id: attachmentId,
          workspaceId: input.workspaceId,
          emailMessageId: message.id,
          filename: att.filename,
          sanitizedFilename: sanitized,
          mimeType: att.mimeType || "application/octet-stream",
          sizeBytes: att.data.length,
          storageKey,
          checksum,
          isInline: false,
          uploadStatus: "UPLOADED",
          providerAttachmentId: att.emailAttachmentId
            ? `outbound-from:${att.emailAttachmentId}`
            : `outbound:${attachmentId}`,
        },
      });
    } catch {
      await input.prisma.emailAttachment.create({
        data: {
          id: attachmentId,
          workspaceId: input.workspaceId,
          emailMessageId: message.id,
          filename: att.filename,
          sanitizedFilename: sanitized,
          mimeType: att.mimeType || "application/octet-stream",
          sizeBytes: att.data.length,
          checksum,
          isInline: false,
          uploadStatus: "FAILED",
          errorMessage: "Failed to store outbound attachment copy",
          providerAttachmentId: `outbound-failed:${attachmentId}`,
        },
      });
    }
  }

  return { emailMessageId: message.id };
}
