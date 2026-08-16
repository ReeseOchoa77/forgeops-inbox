import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({ workspaceId: z.string().min(1), jobId: z.string().min(1) });
const folderParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
  folderId: z.string().min(1),
});
const fileParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
  fileId: z.string().min(1),
});

const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
  parentFolderId: z.string().min(1).nullable().optional(),
});

const renameFolderSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateFileSchema = z.object({
  folderId: z.string().min(1).nullable().optional(),
  filename: z.string().min(1).max(300).optional(),
});

const listQuery = z.object({
  folderId: z.string().min(1).optional(),
});

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".scr", ".msi", ".com",
  ".vbs", ".js", ".ps1", ".sh", ".pif", ".ws", ".wsf",
]);

const MAX_SIZE = 25 * 1024 * 1024;

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

function generateCuid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  const counter = (Math.floor(Math.random() * 0xffffff)).toString(36);
  return `c${timestamp}${random}${counter}`;
}

function localStorageRoot(): string {
  return process.env.ATTACHMENT_STORAGE_PATH
    ?? resolve(process.cwd(), "data", "attachments");
}

async function requireAuth(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  workspaceId: string,
) {
  const session = await getSessionFromRequest(request);
  if (!session) { reply.code(401).send({ message: "Authentication required" }); return null; }
  const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
  if (!membership) { reply.code(403).send({ message: "Workspace access denied" }); return null; }
  return { userId: session.userId, role: membership.role, workspaceRole: membership.workspaceRole };
}

function canEdit(workspaceRole: string): boolean {
  return workspaceRole === "OWNER" || workspaceRole === "EDITOR";
}

async function loadJob(
  app: FastifyInstance,
  reply: import("fastify").FastifyReply,
  jobId: string,
  workspaceId: string,
) {
  const job = await app.services.prisma.job.findFirst({ where: { id: jobId, workspaceId } });
  if (!job) { reply.code(404).send({ message: "Job not found" }); return null; }
  return job;
}

export const registerJobFilesRoutes = async (app: FastifyInstance) => {
  // List folders + files in a folder (or job root)
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/files", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const query = listQuery.parse(request.query);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    const folderId = query.folderId ?? null;

    const [folders, files, breadcrumb] = await Promise.all([
      app.services.prisma.jobDocumentFolder.findMany({
        where: { workspaceId, jobId, parentFolderId: folderId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          parentFolderId: true,
          createdAt: true,
          _count: { select: { childFolders: true, files: true } },
        },
      }),
      app.services.prisma.jobFile.findMany({
        where: { workspaceId, jobId, folderId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          folderId: true,
          uploadStatus: true,
          createdAt: true,
          createdByUserId: true,
        },
      }),
      folderId
        ? buildBreadcrumb(app, workspaceId, jobId, folderId)
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);

    return reply.send({
      folderId,
      breadcrumb,
      folders: folders.map(f => ({
        id: f.id,
        name: f.name,
        parentFolderId: f.parentFolderId,
        createdAt: f.createdAt,
        childFolderCount: f._count.childFolders,
        fileCount: f._count.files,
      })),
      files,
    });
  });

  // Create folder
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/folders", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const body = createFolderSchema.parse(request.body);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) return reply.code(403).send({ message: "Edit access required" });
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    const parentFolderId = body.parentFolderId ?? null;
    if (parentFolderId) {
      const parent = await app.services.prisma.jobDocumentFolder.findFirst({
        where: { id: parentFolderId, workspaceId, jobId },
      });
      if (!parent) return reply.code(404).send({ message: "Parent folder not found" });
    }

    const name = body.name.trim();
    const duplicate = await app.services.prisma.jobDocumentFolder.findFirst({
      where: { jobId, parentFolderId, name },
    });
    if (duplicate) return reply.code(409).send({ message: "A folder with that name already exists here" });

    const folder = await app.services.prisma.$transaction(async (tx) => {
      const created = await tx.jobDocumentFolder.create({
        data: {
          workspaceId,
          jobId,
          parentFolderId,
          name,
          createdByUserId: auth.userId,
        },
      });
      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "FOLDER_CREATED",
          entityType: "JOB_FOLDER",
          entityId: created.id,
          newValue: { name, parentFolderId },
        },
      });
      return created;
    });

    return reply.code(201).send({
      folder: {
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parentFolderId,
        createdAt: folder.createdAt,
      },
    });
  });

  // Rename folder
  app.patch("/api/v1/workspaces/:workspaceId/jobs/:jobId/folders/:folderId", async (request, reply) => {
    const { workspaceId, jobId, folderId } = folderParams.parse(request.params);
    const body = renameFolderSchema.parse(request.body);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) return reply.code(403).send({ message: "Edit access required" });
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    const folder = await app.services.prisma.jobDocumentFolder.findFirst({
      where: { id: folderId, workspaceId, jobId },
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const name = body.name.trim();
    const duplicate = await app.services.prisma.jobDocumentFolder.findFirst({
      where: {
        jobId,
        parentFolderId: folder.parentFolderId,
        name,
        NOT: { id: folderId },
      },
    });
    if (duplicate) return reply.code(409).send({ message: "A folder with that name already exists here" });

    const updated = await app.services.prisma.$transaction(async (tx) => {
      const result = await tx.jobDocumentFolder.update({
        where: { id: folderId },
        data: { name },
      });
      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "FOLDER_RENAMED",
          entityType: "JOB_FOLDER",
          entityId: folderId,
          previousValue: { name: folder.name },
          newValue: { name },
        },
      });
      return result;
    });

    return reply.send({
      folder: {
        id: updated.id,
        name: updated.name,
        parentFolderId: updated.parentFolderId,
        createdAt: updated.createdAt,
      },
    });
  });

  // Delete folder (cascades children via FK)
  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/folders/:folderId", async (request, reply) => {
    const { workspaceId, jobId, folderId } = folderParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) return reply.code(403).send({ message: "Edit access required" });
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    const folder = await app.services.prisma.jobDocumentFolder.findFirst({
      where: { id: folderId, workspaceId, jobId },
      include: { _count: { select: { childFolders: true, files: true } } },
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    // Collect nested file storage keys before delete
    const nestedFiles = await collectFolderFiles(app, workspaceId, jobId, folderId);

    await app.services.prisma.$transaction(async (tx) => {
      await tx.jobDocumentFolder.delete({ where: { id: folderId } });
      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "FOLDER_DELETED",
          entityType: "JOB_FOLDER",
          entityId: folderId,
          previousValue: {
            name: folder.name,
            childFolderCount: folder._count.childFolders,
            fileCount: folder._count.files,
          },
        },
      });
    });

    const storage = app.services.attachmentStorage;
    for (const file of nestedFiles) {
      if (!file.storageKey) continue;
      try {
        if (storage.configured) await storage.delete(file.storageKey);
        else deleteLocalFile(file.storageKey);
      } catch {
        // best-effort cleanup
      }
    }

    return reply.code(204).send();
  });

  // Upload file
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/files", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) return reply.code(403).send({ message: "Edit access required" });
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    let folderId: string | null = null;
    let fileBuffer: Buffer | null = null;
    let fileMimeType: string | null = null;
    let fileFilename: string | null = null;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "folderId") {
          const val = String(part.value ?? "").trim();
          folderId = val || null;
        }
        continue;
      }
      if (part.type === "file" && part.fieldname === "file") {
        fileBuffer = await part.toBuffer();
        fileMimeType = part.mimetype ?? null;
        fileFilename = part.filename ?? null;
      }
    }

    if (!fileBuffer) return reply.code(400).send({ message: "No file provided" });

    if (folderId) {
      const folder = await app.services.prisma.jobDocumentFolder.findFirst({
        where: { id: folderId, workspaceId, jobId },
      });
      if (!folder) return reply.code(404).send({ message: "Folder not found" });
    }

    const filename = fileFilename ?? "document";
    const mimeType = fileMimeType ?? "application/octet-stream";
    const sizeBytes = fileBuffer.length;
    const sanitized = sanitizeFilename(filename);
    const ext = getExtension(filename);

    if (sizeBytes > MAX_SIZE) {
      return reply.code(413).send({ message: `File exceeds maximum size of ${MAX_SIZE} bytes` });
    }
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return reply.code(400).send({ message: `File type ${ext} is not allowed` });
    }

    const fileId = generateCuid();
    const checksum = createHash("sha256").update(fileBuffer).digest("hex");
    const storageKey = `job-files/${workspaceId}/${jobId}/${fileId}/${sanitized}`;
    const storage = app.services.attachmentStorage;

    let uploadStatus: "UPLOADED" | "FAILED" = "UPLOADED";
    let errorMessage: string | null = null;

    try {
      if (storage.configured) {
        await storage.upload(storageKey, fileBuffer, mimeType);
      } else {
        const fullPath = join(localStorageRoot(), storageKey);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, fileBuffer);
      }
    } catch (e) {
      uploadStatus = "FAILED";
      errorMessage = e instanceof Error ? e.message : "Upload failed";
    }

    const created = await app.services.prisma.$transaction(async (tx) => {
      const file = await tx.jobFile.create({
        data: {
          id: fileId,
          workspaceId,
          jobId,
          folderId,
          filename,
          sanitizedFilename: sanitized,
          mimeType,
          sizeBytes,
          storageKey: uploadStatus === "UPLOADED" ? storageKey : null,
          checksum,
          uploadStatus,
          errorMessage,
          createdByUserId: auth.userId,
        },
      });
      if (uploadStatus === "UPLOADED") {
        await tx.jobActivityLog.create({
          data: {
            jobId,
            workspaceId,
            actorUserId: auth.userId,
            action: "DOCUMENT_UPLOADED",
            entityType: "JOB_FILE",
            entityId: file.id,
            newValue: { filename, folderId, sizeBytes, mimeType },
          },
        });
      }
      return file;
    });

    if (uploadStatus !== "UPLOADED") {
      return reply.code(502).send({
        message: errorMessage ?? "Failed to store file",
        file: serializeFile(created),
      });
    }

    return reply.code(201).send({ file: serializeFile(created) });
  });

  // Move / rename file
  app.patch("/api/v1/workspaces/:workspaceId/jobs/:jobId/files/:fileId", async (request, reply) => {
    const { workspaceId, jobId, fileId } = fileParams.parse(request.params);
    const body = updateFileSchema.parse(request.body);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) return reply.code(403).send({ message: "Edit access required" });
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    const existing = await app.services.prisma.jobFile.findFirst({
      where: { id: fileId, workspaceId, jobId },
    });
    if (!existing) return reply.code(404).send({ message: "File not found" });

    if (body.folderId !== undefined && body.folderId !== null) {
      const folder = await app.services.prisma.jobDocumentFolder.findFirst({
        where: { id: body.folderId, workspaceId, jobId },
      });
      if (!folder) return reply.code(404).send({ message: "Folder not found" });
    }

    const data: { folderId?: string | null; filename?: string; sanitizedFilename?: string } = {};
    if (body.folderId !== undefined) data.folderId = body.folderId;
    if (body.filename !== undefined) {
      data.filename = body.filename.trim();
      data.sanitizedFilename = sanitizeFilename(body.filename);
    }

    const updated = await app.services.prisma.$transaction(async (tx) => {
      const file = await tx.jobFile.update({ where: { id: fileId }, data });
      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "DOCUMENT_MOVED",
          entityType: "JOB_FILE",
          entityId: fileId,
          previousValue: { folderId: existing.folderId, filename: existing.filename },
          newValue: { folderId: file.folderId, filename: file.filename },
        },
      });
      return file;
    });

    return reply.send({ file: serializeFile(updated) });
  });

  // Delete file
  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/files/:fileId", async (request, reply) => {
    const { workspaceId, jobId, fileId } = fileParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) return reply.code(403).send({ message: "Edit access required" });
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    const existing = await app.services.prisma.jobFile.findFirst({
      where: { id: fileId, workspaceId, jobId },
    });
    if (!existing) return reply.code(404).send({ message: "File not found" });

    await app.services.prisma.$transaction(async (tx) => {
      await tx.jobFile.delete({ where: { id: fileId } });
      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "DOCUMENT_DELETED",
          entityType: "JOB_FILE",
          entityId: fileId,
          previousValue: {
            filename: existing.filename,
            folderId: existing.folderId,
            sizeBytes: existing.sizeBytes,
          },
        },
      });
    });

    if (existing.storageKey) {
      try {
        const storage = app.services.attachmentStorage;
        if (storage.configured) await storage.delete(existing.storageKey);
        else deleteLocalFile(existing.storageKey);
      } catch {
        // best-effort
      }
    }

    return reply.code(204).send();
  });

  // Download file
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/files/:fileId/download", async (request, reply) => {
    const { workspaceId, jobId, fileId } = fileParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!(await loadJob(app, reply, jobId, workspaceId))) return;

    const file = await app.services.prisma.jobFile.findFirst({
      where: { id: fileId, workspaceId, jobId, uploadStatus: "UPLOADED" },
    });
    if (!file?.storageKey) return reply.code(404).send({ message: "File not found" });

    const storage = app.services.attachmentStorage;
    if (storage.configured) {
      try {
        const signedUrl = await storage.getSignedDownloadUrl(
          file.storageKey,
          file.filename,
          file.mimeType,
          900,
        );
        return reply.code(302).redirect(signedUrl);
      } catch {
        return reply.code(502).send({ message: "Failed to generate download URL" });
      }
    }

    const fullPath = join(localStorageRoot(), file.storageKey);
    if (!existsSync(fullPath)) {
      return reply.code(404).send({ message: "File not found on storage" });
    }
    const data = readFileSync(fullPath);
    return reply
      .header("Content-Type", file.mimeType)
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`)
      .header("Content-Length", data.length)
      .send(data);
  });
};

function serializeFile(file: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
  uploadStatus: string;
  createdAt: Date;
  createdByUserId: string | null;
}) {
  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    folderId: file.folderId,
    uploadStatus: file.uploadStatus,
    createdAt: file.createdAt,
    createdByUserId: file.createdByUserId,
  };
}

async function buildBreadcrumb(
  app: FastifyInstance,
  workspaceId: string,
  jobId: string,
  folderId: string,
) {
  const crumbs: Array<{ id: string; name: string }> = [];
  let currentId: string | null = folderId;
  const guard = new Set<string>();
  while (currentId && !guard.has(currentId)) {
    guard.add(currentId);
    const folder: { id: string; name: string; parentFolderId: string | null } | null =
      await app.services.prisma.jobDocumentFolder.findFirst({
        where: { id: currentId, workspaceId, jobId },
        select: { id: true, name: true, parentFolderId: true },
      });
    if (!folder) break;
    crumbs.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parentFolderId;
  }
  return crumbs;
}

async function collectFolderFiles(
  app: FastifyInstance,
  workspaceId: string,
  jobId: string,
  rootFolderId: string,
) {
  const folderIds = [rootFolderId];
  const queue = [rootFolderId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = await app.services.prisma.jobDocumentFolder.findMany({
      where: { workspaceId, jobId, parentFolderId: id },
      select: { id: true },
    });
    for (const child of children) {
      folderIds.push(child.id);
      queue.push(child.id);
    }
  }
  return app.services.prisma.jobFile.findMany({
    where: { workspaceId, jobId, folderId: { in: folderIds } },
    select: { id: true, storageKey: true },
  });
}

function deleteLocalFile(storageKey: string) {
  const fullPath = join(localStorageRoot(), storageKey);
  if (existsSync(fullPath)) unlinkSync(fullPath);
}
