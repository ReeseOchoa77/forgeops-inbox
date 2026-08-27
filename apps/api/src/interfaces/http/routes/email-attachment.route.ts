import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createHash } from "node:crypto";

import { getSessionFromRequest } from "../authentication.js";
import { verifyN8nApiKey } from "../n8n-auth.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".scr", ".msi", ".com",
  ".vbs", ".js", ".ps1", ".sh", ".pif", ".ws", ".wsf",
]);

const SAFE_INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const uploadParamsSchema = z.object({
  workspaceId: z.string().min(1),
  emailId: z.string().min(1),
});

const listParamsSchema = z.object({
  workspaceId: z.string().min(1),
  emailId: z.string().min(1),
});

const downloadParamsSchema = z.object({
  workspaceId: z.string().min(1),
  attachmentId: z.string().min(1),
});

const downloadQuerySchema = z.object({
  inline: z.enum(["true", "false"]).optional().transform(v => v === "true"),
});

export const registerEmailAttachmentRoutes = async (
  app: FastifyInstance
): Promise<void> => {

  // ── UPLOAD ────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/workspaces/:workspaceId/emails/:emailId/attachments",
    async (request, reply) => {
      const params = uploadParamsSchema.parse(request.params);
      const env = app.services.env;
      const maxSize = env.ATTACHMENT_MAX_SIZE_BYTES;

      // Dual auth: session or API key
      let authenticatedUserId: string | null = null;
      const authHeader = request.headers.authorization;

      if (authHeader?.startsWith("Bearer ")) {
        const isN8n = verifyN8nApiKey(request, reply, env.N8N_INTEGRATION_API_KEY, env.N8N_INTEGRATION_ENABLED);
        if (!isN8n) return;
      } else {
        const session = await getSessionFromRequest(request);
        if (!session) return reply.code(401).send({ message: "Authentication required" });
        const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
        if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
        authenticatedUserId = session.userId;
      }

      // Validate email belongs to workspace
      const message = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          OR: [{ id: params.emailId }, { gmailMessageId: params.emailId }],
        },
        select: { id: true, workspaceId: true },
      });

      if (!message) return reply.code(404).send({ message: "Email not found in workspace" });

      if (message.workspaceId !== params.workspaceId) {
        return reply.code(403).send({ message: "Cross-workspace access denied" });
      }

      // Parse multipart
      const parts = request.parts();
      let provider: string | null = null;
      let providerAttachmentId: string | null = null;
      let filenameField: string | null = null;
      let mimeTypeField: string | null = null;
      let sizeBytesField: number | null = null;
      let isInline = false;
      let contentId: string | null = null;
      let fileBuffer: Buffer | null = null;
      let fileMimeType: string | null = null;
      let fileFilename: string | null = null;

      for await (const part of parts) {
        if (part.type === "field") {
          const val = part.value as string;
          switch (part.fieldname) {
            case "provider": provider = val; break;
            case "providerAttachmentId": providerAttachmentId = val; break;
            case "filename": filenameField = val; break;
            case "mimeType": mimeTypeField = val; break;
            case "sizeBytes": sizeBytesField = parseInt(val, 10) || null; break;
            case "isInline": isInline = val === "true"; break;
            case "contentId": contentId = val || null; break;
          }
          continue;
        }

        if (part.type === "file" && part.fieldname === "file") {
          fileBuffer = await part.toBuffer();
          fileMimeType = part.mimetype ?? null;
          fileFilename = part.filename ?? null;
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({ message: "No file provided" });
      }

      // Resolve filename and mime
      const filename = filenameField ?? fileFilename ?? "attachment";
      const mimeType = mimeTypeField ?? fileMimeType ?? "application/octet-stream";
      const sizeBytes = fileBuffer.length;
      const normalizedFilename = sanitizeFilename(filename);
      const ext = getExtension(filename);

      // Size check
      if (sizeBytes > maxSize) {
        return reply.code(413).send({
          message: `File exceeds maximum size of ${formatBytes(maxSize)}`,
          sizeBytes,
          maxSizeBytes: maxSize,
        });
      }

      // Blocked extension check
      if (BLOCKED_EXTENSIONS.has(ext)) {
        return reply.code(400).send({
          message: `File type ${ext} is not allowed`,
          filename,
        });
      }

      // Idempotency: check for existing by providerAttachmentId
      if (providerAttachmentId) {
        const existing = await app.services.prisma.emailAttachment.findFirst({
          where: {
            workspaceId: params.workspaceId,
            emailMessageId: message.id,
            providerAttachmentId,
          },
          select: {
            id: true, filename: true, mimeType: true, sizeBytes: true,
          },
        });

        if (existing) {
          return reply.code(200).send({
            status: "unchanged",
            attachmentId: existing.id,
            emailId: message.id,
            filename: existing.filename,
            mimeType: existing.mimeType,
            sizeBytes: existing.sizeBytes,
          });
        }
      }

      // Compute checksum
      const checksumSha256 = createHash("sha256").update(fileBuffer).digest("hex");

      // Build storage key
      const attachmentId = generateCuid();
      const storageKey = `attachments/${params.workspaceId}/${message.id}/${attachmentId}/${normalizedFilename}`;

      // Resolve provider enum
      const providerEnum = provider?.toUpperCase() === "OUTLOOK" ? "OUTLOOK" as const
        : provider?.toUpperCase() === "GMAIL" ? "GMAIL" as const
        : null;

      // Upload to S3
      const storage = app.services.attachmentStorage;
      if (!storage.configured) {
        // Fall back to database record only with PENDING status
        try {
          const attachment = await app.services.prisma.emailAttachment.create({
            data: {
              id: attachmentId,
              workspaceId: params.workspaceId,
              emailMessageId: message.id,
              provider: providerEnum,
              providerAttachmentId,
              filename,
              sanitizedFilename: normalizedFilename,
              mimeType,
              sizeBytes,
              storageKey: null,
              checksum: checksumSha256,
              isInline,
              contentId,
              uploadStatus: "FAILED",
              errorMessage: "S3 storage not configured",
            },
          });

          return reply.code(201).send({
            status: "failed",
            attachmentId: attachment.id,
            emailId: message.id,
            filename,
            mimeType,
            sizeBytes,
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return reply.code(200).send({
              status: "unchanged",
              attachmentId: "",
              emailId: message.id,
              filename,
              mimeType,
              sizeBytes,
            });
          }
          throw e;
        }
      }

      try {
        await storage.upload(storageKey, fileBuffer, mimeType);

        const attachment = await app.services.prisma.emailAttachment.create({
          data: {
            id: attachmentId,
            workspaceId: params.workspaceId,
            emailMessageId: message.id,
            provider: providerEnum,
            providerAttachmentId,
            filename,
            sanitizedFilename: normalizedFilename,
            mimeType,
            sizeBytes,
            storageKey,
            checksum: checksumSha256,
            isInline,
            contentId,
            uploadStatus: "UPLOADED",
          },
        });

        return reply.code(201).send({
          status: "created",
          attachmentId: attachment.id,
          emailId: message.id,
          filename,
          mimeType,
          sizeBytes,
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return reply.code(200).send({
            status: "unchanged",
            attachmentId: "",
            emailId: message.id,
            filename,
            mimeType,
            sizeBytes,
          });
        }

        const errMsg = e instanceof Error ? e.message : "Upload failed";
        app.log.error({ event: "attachment_upload_failed", error: errMsg });

        await app.services.prisma.emailAttachment.create({
          data: {
            workspaceId: params.workspaceId,
            emailMessageId: message.id,
            provider: providerEnum,
            providerAttachmentId,
            filename,
            sanitizedFilename: normalizedFilename,
            mimeType,
            sizeBytes,
            checksum: checksumSha256,
            isInline,
            contentId,
            uploadStatus: "FAILED",
            errorMessage: errMsg,
          },
        }).catch(() => {});

        return reply.code(201).send({
          status: "failed",
          attachmentId: "",
          emailId: message.id,
          filename,
          mimeType,
          sizeBytes,
        });
      }
    }
  );

  // Legacy upload endpoint (backwards-compatible)
  app.post(
    "/api/v1/workspaces/:workspaceId/messages/:messageId/attachments",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        messageId: z.string().min(1),
      }).parse(request.params);

      // Rewrite params and forward to the canonical endpoint handler
      (request.params as Record<string, string>).emailId = params.messageId;
      return app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${params.workspaceId}/emails/${params.messageId}/attachments`,
        headers: request.headers as Record<string, string>,
        payload: request.body as string,
      }).then(res => reply.code(res.statusCode).send(res.json()));
    }
  );

  // ── LIST ATTACHMENTS ──────────────────────────────────────────────────
  app.get(
    "/api/v1/workspaces/:workspaceId/emails/:emailId/attachments",
    async (request, reply) => {
      const params = listParamsSchema.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      const message = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          OR: [{ id: params.emailId }, { gmailMessageId: params.emailId }],
        },
        select: { id: true },
      });

      if (!message) return reply.code(404).send({ message: "Email not found" });

      const attachments = await app.services.prisma.emailAttachment.findMany({
        where: { workspaceId: params.workspaceId, emailMessageId: message.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          isInline: true,
          contentId: true,
          uploadStatus: true,
          emailMessageId: true,
          createdAt: true,
        },
      });

      return reply.send({
        attachments: attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          isInline: a.isInline,
          contentId: a.contentId,
          uploadStatus: a.uploadStatus,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    }
  );

  // Legacy list endpoint
  app.get(
    "/api/v1/workspaces/:workspaceId/messages/:messageId/stored-attachments",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        messageId: z.string().min(1),
      }).parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      const attachments = await app.services.prisma.emailAttachment.findMany({
        where: { workspaceId: params.workspaceId, emailMessageId: params.messageId, isInline: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, filename: true, sanitizedFilename: true, mimeType: true,
          sizeBytes: true, uploadStatus: true, isInline: true, createdAt: true,
        },
      });

      return reply.send({ attachments });
    }
  );

  // ── DOWNLOAD ──────────────────────────────────────────────────────────
  app.get(
    "/api/v1/workspaces/:workspaceId/attachments/:attachmentId/download",
    async (request, reply) => {
      const params = downloadParamsSchema.parse(request.params);
      const query = downloadQuerySchema.parse(request.query);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      const attachment = await app.services.prisma.emailAttachment.findFirst({
        where: {
          id: params.attachmentId,
          workspaceId: params.workspaceId,
          uploadStatus: "UPLOADED",
        },
        select: {
          storageKey: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
        },
      });

      if (!attachment?.storageKey) {
        return reply.code(404).send({ message: "Attachment not found or not uploaded" });
      }

      const storage = app.services.attachmentStorage;

      if (storage.configured) {
        // Use signed URL redirect
        const disposition = query.inline && SAFE_INLINE_TYPES.has(attachment.mimeType)
          ? "inline" : "attachment";

        try {
          const signedUrl = await storage.getSignedDownloadUrl(
            attachment.storageKey,
            attachment.filename,
            attachment.mimeType,
            900
          );

          return reply
            .header("Content-Disposition", `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`)
            .code(302)
            .redirect(signedUrl);
        } catch (e) {
          app.log.error({
            event: "attachment_download_signed_url_failed",
            error: e instanceof Error ? e.message : "unknown",
          });
          return reply.code(502).send({ message: "Failed to generate download URL" });
        }
      }

      // Fallback: try local filesystem (backwards compatibility)
      try {
        const { existsSync, readFileSync, readdirSync } = await import("node:fs");
        const { resolve, join } = await import("node:path");

        const storagePath = process.env.ATTACHMENT_STORAGE_PATH
          ?? resolve(process.cwd(), "data", "attachments");
        const keyParts = attachment.storageKey.split("/");
        const dir = resolve(storagePath, ...keyParts.slice(0, 2));

        if (!existsSync(dir)) {
          return reply.code(404).send({ message: "File not found on storage" });
        }

        const entries = readdirSync(dir);
        const match = entries.find((f: string) => attachment.storageKey?.endsWith(f));
        if (!match) {
          return reply.code(404).send({ message: "File not found on storage" });
        }

        const data = readFileSync(join(dir, match));
        const disposition = query.inline && SAFE_INLINE_TYPES.has(attachment.mimeType)
          ? "inline" : "attachment";

        return reply
          .header("Content-Type", attachment.mimeType)
          .header("Content-Disposition", `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`)
          .header("Content-Length", data.length)
          .send(data);
      } catch {
        return reply.code(500).send({ message: "Failed to read attachment" });
      }
    }
  );

  // ── RETRY ─────────────────────────────────────────────────────────────
  app.patch(
    "/api/v1/workspaces/:workspaceId/attachments/:attachmentId/retry",
    async (request, reply) => {
      const params = downloadParamsSchema.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
        return reply.code(403).send({ message: "Admin permission required" });
      }

      await app.services.prisma.emailAttachment.update({
        where: { id: params.attachmentId },
        data: { uploadStatus: "PENDING", errorMessage: null },
      });

      return reply.send({ status: "reset_to_pending" });
    }
  );
};

function generateCuid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  const counter = (Math.floor(Math.random() * 0xffffff)).toString(36);
  return `c${timestamp}${random}${counter}`;
}
