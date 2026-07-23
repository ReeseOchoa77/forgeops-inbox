import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import { getSessionFromRequest } from "../authentication.js";
import { verifyN8nApiKey } from "../n8n-auth.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".js", ".vbs", ".ws", ".wsf", ".msi"]);

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(0, 200);
}

function getStoragePath(): string {
  const dir = process.env.ATTACHMENT_STORAGE_PATH ?? resolve(process.cwd(), "data", "attachments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export const registerEmailAttachmentRoutes = async (app: FastifyInstance): Promise<void> => {

  app.post("/api/v1/workspaces/:workspaceId/messages/:messageId/attachments", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), messageId: z.string().min(1) }).parse(request.params);
    const env = app.services.env;

    const isN8n = env.N8N_INTEGRATION_ENABLED && env.N8N_INTEGRATION_API_KEY;
    let authenticated = false;

    if (isN8n && request.headers.authorization?.startsWith("Bearer ")) {
      authenticated = verifyN8nApiKey(request, reply, env.N8N_INTEGRATION_API_KEY, env.N8N_INTEGRATION_ENABLED);
      if (!authenticated) return;
    } else {
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      authenticated = true;
    }

    if (!authenticated) return;

    const message = await app.services.prisma.emailMessage.findFirst({
      where: { workspaceId: params.workspaceId, OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }] },
      select: { id: true }
    });

    if (!message) return reply.code(404).send({ message: "Message not found" });

    const parts = request.parts();
    const results: Array<{ id: string; filename: string; status: string }> = [];
    let providerAttachmentId: string | null = null;
    let isInline = false;

    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "providerAttachmentId") providerAttachmentId = part.value as string;
        if (part.fieldname === "isInline") isInline = part.value === "true";
        continue;
      }

      if (part.type !== "file") continue;

      const filename = part.filename ?? "attachment";
      const ext = filename.includes(".") ? `.${filename.split(".").pop()!.toLowerCase()}` : "";

      if (BLOCKED_EXTENSIONS.has(ext)) {
        results.push({ id: "", filename, status: "blocked_type" });
        continue;
      }

      const buffer = await part.toBuffer();

      if (buffer.length > MAX_FILE_SIZE) {
        results.push({ id: "", filename, status: "oversized" });
        continue;
      }

      const checksum = createHash("sha256").update(buffer).digest("hex");
      const sanitized = sanitizeFilename(filename);
      const storageKey = `${params.workspaceId}/${message.id}/${randomUUID()}-${sanitized}`;

      const existing = providerAttachmentId ? await app.services.prisma.emailAttachment.findFirst({
        where: { emailMessageId: message.id, providerAttachmentId }
      }) : null;

      if (existing && providerAttachmentId) {
        results.push({ id: existing.id, filename, status: "duplicate" });
        providerAttachmentId = null;
        isInline = false;
        continue;
      }

      const checksumDupe = await app.services.prisma.emailAttachment.findFirst({
        where: { emailMessageId: message.id, checksum }
      });

      if (checksumDupe) {
        results.push({ id: checksumDupe.id, filename, status: "duplicate_checksum" });
        providerAttachmentId = null;
        isInline = false;
        continue;
      }

      try {
        const storagePath = getStoragePath();
        const dir = resolve(storagePath, params.workspaceId, message.id);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${randomUUID()}-${sanitized}`), buffer);

        const attachment = await app.services.prisma.emailAttachment.create({
          data: {
            workspaceId: params.workspaceId,
            emailMessageId: message.id,
            providerAttachmentId,
            filename,
            sanitizedFilename: sanitized,
            mimeType: part.mimetype ?? "application/octet-stream",
            sizeBytes: buffer.length,
            storageKey,
            checksum,
            isInline,
            uploadStatus: "UPLOADED"
          }
        });

        results.push({ id: attachment.id, filename, status: "uploaded" });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          results.push({ id: "", filename, status: "duplicate" });
        } else {
          const errMsg = e instanceof Error ? e.message : "unknown";
          await app.services.prisma.emailAttachment.create({
            data: {
              workspaceId: params.workspaceId,
              emailMessageId: message.id,
              providerAttachmentId,
              filename,
              sanitizedFilename: sanitized,
              mimeType: part.mimetype ?? "application/octet-stream",
              sizeBytes: buffer.length,
              isInline,
              uploadStatus: "FAILED",
              errorMessage: errMsg
            }
          }).catch(() => {});
          results.push({ id: "", filename, status: "failed" });
        }
      }

      providerAttachmentId = null;
      isInline = false;
    }

    return reply.send({ status: "ok", attachments: results });
  });

  app.get("/api/v1/workspaces/:workspaceId/messages/:messageId/stored-attachments", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), messageId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const attachments = await app.services.prisma.emailAttachment.findMany({
      where: { workspaceId: params.workspaceId, emailMessageId: params.messageId, isInline: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, filename: true, sanitizedFilename: true, mimeType: true, sizeBytes: true,
        uploadStatus: true, isInline: true, createdAt: true
      }
    });

    return reply.send({ attachments });
  });

  app.get("/api/v1/workspaces/:workspaceId/attachments/:attachmentId/download", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), attachmentId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const attachment = await app.services.prisma.emailAttachment.findFirst({
      where: { id: params.attachmentId, workspaceId: params.workspaceId, uploadStatus: "UPLOADED" },
      select: { storageKey: true, filename: true, mimeType: true, sizeBytes: true }
    });

    if (!attachment?.storageKey) return reply.code(404).send({ message: "Attachment not found or not uploaded" });

    const storagePath = getStoragePath();
    const files = resolve(storagePath, attachment.storageKey.split("/").slice(0, 2).join("/"));

    try {
      const dir = resolve(storagePath, ...attachment.storageKey.split("/").slice(0, 2));
      const entries = existsSync(dir) ? require("node:fs").readdirSync(dir) as string[] : [];
      const match = entries.find((f: string) => attachment.storageKey?.endsWith(f));

      if (!match) return reply.code(404).send({ message: "File not found on storage" });

      const filePath = join(dir, match);
      const data = readFileSync(filePath);

      return reply
        .header("Content-Type", attachment.mimeType)
        .header("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.filename)}"`)
        .header("Content-Length", data.length)
        .send(data);
    } catch {
      return reply.code(500).send({ message: "Failed to read attachment" });
    }
  });

  app.patch("/api/v1/workspaces/:workspaceId/attachments/:attachmentId/retry", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), attachmentId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    await app.services.prisma.emailAttachment.update({
      where: { id: params.attachmentId },
      data: { uploadStatus: "PENDING", errorMessage: null }
    });

    return reply.send({ status: "reset_to_pending" });
  });
};
