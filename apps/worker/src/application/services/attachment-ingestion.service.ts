import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  extractHtmlCids,
  findMissingContentIds,
  shouldInspectAttachments,
  TokenCipher,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
} from "@forgeops/shared";

import type { OutlookClient } from "../../infrastructure/providers/outlook/outlook-client.js";
import type { AttachmentStorage } from "../../infrastructure/storage/attachment-storage.js";

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".scr", ".msi", ".com",
  ".vbs", ".js", ".ps1", ".sh", ".pif", ".ws", ".wsf",
]);

function sanitizeFilename(filename: string): string {
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

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return "";
  return filename.slice(dotIndex).toLowerCase();
}

function generateId(): string {
  return `c${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}

function isFileAttachment(odataType: string | null | undefined): boolean {
  if (!odataType) return true; // Graph often omits type on list; attempt download
  return odataType.toLowerCase().includes("fileattachment");
}

export class AttachmentIngestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokenCipher: TokenCipher,
    private readonly outlookClient: OutlookClient,
    private readonly storage: AttachmentStorage,
    private readonly maxSizeBytes: number
  ) {}

  async process(payload: AttachmentIngestJobPayload): Promise<AttachmentIngestResult> {
    const base = {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      emailMessageId: payload.emailMessageId,
      listedCount: 0,
      uploadedCount: 0,
      skippedExistingCount: 0,
      failedCount: 0,
      missingContentIds: [] as string[],
    };

    const connection = await this.prisma.inboxConnection.findFirst({
      where: {
        id: payload.inboxConnectionId,
        workspaceId: payload.workspaceId,
      },
      select: {
        id: true,
        provider: true,
        status: true,
        encryptedRefreshToken: true,
        encryptedAccessToken: true,
        accessTokenExpiresAt: true,
      },
    });

    if (!connection) {
      return {
        ...base,
        status: "skipped_unsupported_provider",
        errorMessage: "InboxConnection not found",
      };
    }

    if (connection.provider !== "OUTLOOK") {
      return { ...base, status: "skipped_unsupported_provider" };
    }

    if (!connection.encryptedRefreshToken) {
      console.info("attachment-ingest-skipped-no-token", {
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
        emailMessageId: payload.emailMessageId,
        reason: "mailbox_not_oauth_connected",
      });
      return {
        ...base,
        status: "skipped_no_token",
        errorMessage: "Mailbox is not OAuth-connected (no refresh token)",
      };
    }

    const message = await this.prisma.emailMessage.findFirst({
      where: {
        id: payload.emailMessageId,
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
      },
      select: {
        id: true,
        gmailMessageId: true,
        providerMessageId: true,
        hasAttachments: true,
        bodyHtml: true,
      },
    });

    if (!message) {
      return {
        ...base,
        status: "skipped_unsupported_provider",
        errorMessage: "EmailMessage not found",
      };
    }

    if (
      !shouldInspectAttachments({
        hasAttachments: message.hasAttachments,
        bodyHtml: message.bodyHtml,
      })
    ) {
      return { ...base, status: "skipped_no_inspect" };
    }

    if (!this.storage.configured) {
      throw new Error("S3 storage is not configured for attachment ingestion");
    }

    if (!this.outlookClient.isConfigured()) {
      throw new Error("Outlook client is not configured for attachment ingestion");
    }

    const refreshToken = this.tokenCipher.decrypt(connection.encryptedRefreshToken);
    const tokenResult = await this.outlookClient.acquireAccessToken(refreshToken);

    if (tokenResult.refreshedRefreshToken) {
      await this.prisma.inboxConnection.update({
        where: { id: connection.id },
        data: {
          encryptedRefreshToken: this.tokenCipher.encrypt(tokenResult.refreshedRefreshToken),
          encryptedAccessToken: this.tokenCipher.encrypt(tokenResult.accessToken),
          accessTokenExpiresAt: tokenResult.expiresAt,
        },
      });
    } else if (tokenResult.accessToken) {
      await this.prisma.inboxConnection.update({
        where: { id: connection.id },
        data: {
          encryptedAccessToken: this.tokenCipher.encrypt(tokenResult.accessToken),
          accessTokenExpiresAt: tokenResult.expiresAt,
        },
      });
    }

    const providerMessageId =
      payload.providerMessageId ||
      message.providerMessageId ||
      message.gmailMessageId;

    const listResult = await this.outlookClient.listAttachments(
      tokenResult.accessToken,
      providerMessageId
    );

    if (!listResult.ok) {
      console.error("attachment-ingest-list-failed", {
        workspaceId: payload.workspaceId,
        emailMessageId: payload.emailMessageId,
        providerMessageId,
        status: listResult.status,
        error: listResult.error,
      });
      // Throw so BullMQ retries — do not treat as empty
      throw new Error(listResult.error);
    }

    const htmlCids = extractHtmlCids(message.bodyHtml);
    const missingContentIds = findMissingContentIds(
      htmlCids,
      listResult.attachments.map((a) => a.contentId)
    );
    if (missingContentIds.length > 0) {
      console.warn("attachment-ingest-missing-cids", {
        workspaceId: payload.workspaceId,
        emailMessageId: payload.emailMessageId,
        providerMessageId,
        missingContentIds,
        // Hook point for a future MIME-part fallback — do not fabricate frontend images.
        mimeFallback: "not_implemented",
      });
    }

    if (listResult.attachments.length === 0) {
      return {
        ...base,
        status: "listed_empty",
        listedCount: 0,
        missingContentIds,
      };
    }

    let uploadedCount = 0;
    let skippedExistingCount = 0;
    let failedCount = 0;

    // Sequential processing — avoid Graph MailboxConcurrency limit
    for (const att of listResult.attachments) {
      if (!att.attachmentId) {
        failedCount += 1;
        continue;
      }

      if (!isFileAttachment(att.odataType)) {
        console.info("attachment-ingest-skip-non-file", {
          emailMessageId: payload.emailMessageId,
          providerAttachmentId: att.attachmentId,
          odataType: att.odataType,
        });
        continue;
      }

      const outcome = await this.ingestOneAttachment({
        workspaceId: payload.workspaceId,
        emailMessageId: payload.emailMessageId,
        providerMessageId,
        accessToken: tokenResult.accessToken,
        att,
      });

      if (outcome === "uploaded") uploadedCount += 1;
      else if (outcome === "skipped") skippedExistingCount += 1;
      else failedCount += 1;
    }

    // Refresh JSON metadata on the message for UI fallbacks
    await this.prisma.emailMessage.update({
      where: { id: payload.emailMessageId },
      data: {
        hasAttachments: true,
        attachmentMetadata: listResult.attachments.map((a) => ({
          attachmentId: a.attachmentId,
          contentId: a.contentId,
          filename: a.filename,
          inline: a.inline,
          mimeType: a.mimeType,
          partId: null,
          size: a.size,
        })),
      },
    });

    return {
      ...base,
      status: failedCount > 0 ? "completed_with_failures" : "completed",
      listedCount: listResult.attachments.length,
      uploadedCount,
      skippedExistingCount,
      failedCount,
      missingContentIds,
    };
  }

  private async ingestOneAttachment(input: {
    workspaceId: string;
    emailMessageId: string;
    providerMessageId: string;
    accessToken: string;
    att: {
      attachmentId: string | null;
      contentId: string | null;
      filename: string | null;
      inline: boolean;
      mimeType: string | null;
      size: number | null;
    };
  }): Promise<"uploaded" | "skipped" | "failed"> {
    const providerAttachmentId = input.att.attachmentId!;
    const filename = input.att.filename?.trim() || "attachment";
    const mimeType = input.att.mimeType || "application/octet-stream";
    const ext = getExtension(filename);

    const existing = await this.prisma.emailAttachment.findFirst({
      where: {
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        providerAttachmentId,
      },
    });

    if (BLOCKED_EXTENSIONS.has(ext)) {
      await this.upsertFailedAttachment({
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        providerAttachmentId,
        filename,
        mimeType,
        sizeBytes: input.att.size ?? 0,
        isInline: input.att.inline,
        contentId: input.att.contentId,
        errorMessage: `File type ${ext} is not allowed`,
        uploadStatus: "REJECTED",
        ...(existing?.id ? { existingId: existing.id } : {}),
      });
      return "failed";
    }

    // Retry-safe: skip re-download when already uploaded and object still exists
    if (
      existing?.uploadStatus === "UPLOADED" &&
      existing.storageKey
    ) {
      const stillThere = await this.storage.exists(existing.storageKey).catch(() => false);
      if (stillThere) {
        // Refresh metadata that frontend CID rewrite needs
        if (
          existing.contentId !== input.att.contentId ||
          existing.isInline !== input.att.inline ||
          existing.mimeType !== mimeType
        ) {
          await this.prisma.emailAttachment.update({
            where: { id: existing.id },
            data: {
              contentId: input.att.contentId,
              isInline: input.att.inline,
              mimeType,
              filename,
              sanitizedFilename: sanitizeFilename(filename),
            },
          });
        }
        return "skipped";
      }
    }

    const download = await this.outlookClient.downloadAttachment(
      input.accessToken,
      input.providerMessageId,
      providerAttachmentId
    );

    if (!download.ok) {
      console.error("attachment-ingest-download-failed", {
        emailMessageId: input.emailMessageId,
        providerMessageId: input.providerMessageId,
        providerAttachmentId,
        filename,
        status: download.status,
        error: download.error,
      });
      await this.upsertFailedAttachment({
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        providerAttachmentId,
        filename,
        mimeType,
        sizeBytes: input.att.size ?? 0,
        isInline: input.att.inline,
        contentId: input.att.contentId,
        errorMessage: download.error.slice(0, 1000),
        uploadStatus: "FAILED",
        ...(existing?.id ? { existingId: existing.id } : {}),
      });
      return "failed";
    }

    const sizeBytes = download.data.length;
    if (sizeBytes > this.maxSizeBytes) {
      await this.upsertFailedAttachment({
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        providerAttachmentId,
        filename,
        mimeType,
        sizeBytes,
        isInline: input.att.inline,
        contentId: input.att.contentId,
        errorMessage: `File exceeds maximum size of ${this.maxSizeBytes} bytes`,
        uploadStatus: "REJECTED",
        ...(existing?.id ? { existingId: existing.id } : {}),
      });
      return "failed";
    }

    const attachmentId = existing?.id ?? generateId();
    const sanitized = sanitizeFilename(filename);
    const storageKey =
      existing?.storageKey ??
      `attachments/${input.workspaceId}/${input.emailMessageId}/${attachmentId}/${sanitized}`;
    const checksum = createHash("sha256").update(download.data).digest("hex");
    const finalMime = download.contentType || mimeType;

    try {
      await this.storage.upload(storageKey, download.data, finalMime);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "S3 upload failed";
      await this.upsertFailedAttachment({
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        providerAttachmentId,
        filename,
        mimeType: finalMime,
        sizeBytes,
        isInline: input.att.inline,
        contentId: input.att.contentId,
        errorMessage: errMsg.slice(0, 1000),
        uploadStatus: "FAILED",
        ...(existing?.id ? { existingId: existing.id } : {}),
      });
      return "failed";
    }

    if (existing) {
      await this.prisma.emailAttachment.update({
        where: { id: existing.id },
        data: {
          filename,
          sanitizedFilename: sanitized,
          mimeType: finalMime,
          sizeBytes,
          storageKey,
          checksum,
          isInline: input.att.inline,
          contentId: input.att.contentId,
          uploadStatus: "UPLOADED",
          errorMessage: null,
          provider: "OUTLOOK",
        },
      });
    } else {
      try {
        await this.prisma.emailAttachment.create({
          data: {
            id: attachmentId,
            workspaceId: input.workspaceId,
            emailMessageId: input.emailMessageId,
            provider: "OUTLOOK",
            providerAttachmentId,
            filename,
            sanitizedFilename: sanitized,
            mimeType: finalMime,
            sizeBytes,
            storageKey,
            checksum,
            isInline: input.att.inline,
            contentId: input.att.contentId,
            uploadStatus: "UPLOADED",
          },
        });
      } catch (e) {
        // Race with n8n upload or concurrent job — re-check unique
        const raced = await this.prisma.emailAttachment.findFirst({
          where: {
            workspaceId: input.workspaceId,
            emailMessageId: input.emailMessageId,
            providerAttachmentId,
          },
        });
        if (raced) {
          await this.prisma.emailAttachment.update({
            where: { id: raced.id },
            data: {
              storageKey,
              checksum,
              uploadStatus: "UPLOADED",
              errorMessage: null,
              contentId: input.att.contentId,
              isInline: input.att.inline,
              mimeType: finalMime,
              sizeBytes,
            },
          });
        } else {
          throw e;
        }
      }
    }

    return "uploaded";
  }

  private async upsertFailedAttachment(input: {
    workspaceId: string;
    emailMessageId: string;
    providerAttachmentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    isInline: boolean;
    contentId: string | null;
    errorMessage: string;
    uploadStatus: "FAILED" | "REJECTED";
    existingId?: string;
  }): Promise<void> {
    const data = {
      filename: input.filename,
      sanitizedFilename: sanitizeFilename(input.filename),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      isInline: input.isInline,
      contentId: input.contentId,
      uploadStatus: input.uploadStatus,
      errorMessage: input.errorMessage,
      provider: "OUTLOOK" as const,
      providerAttachmentId: input.providerAttachmentId,
    };

    if (input.existingId) {
      await this.prisma.emailAttachment.update({
        where: { id: input.existingId },
        data,
      });
      return;
    }

    const existing = await this.prisma.emailAttachment.findFirst({
      where: {
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        providerAttachmentId: input.providerAttachmentId,
      },
    });

    if (existing) {
      await this.prisma.emailAttachment.update({
        where: { id: existing.id },
        data,
      });
      return;
    }

    await this.prisma.emailAttachment.create({
      data: {
        id: generateId(),
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        storageKey: null,
        ...data,
      },
    });
  }
}
