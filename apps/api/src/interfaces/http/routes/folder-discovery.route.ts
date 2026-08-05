import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeName } from "@forgeops/shared";

import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { verifyN8nApiKey } from "../n8n-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectJobInfo(folderName: string): { jobNumber: string | null; jobName: string | null } {
  const match = folderName.match(/^(\d{2,6})\s*[-–—]\s*(.+)$/);
  if (match) return { jobNumber: match[1]!, jobName: match[2]!.trim() };
  const numMatch = folderName.match(/^(\d{2,6})\s+(.+)$/);
  if (numMatch) return { jobNumber: numMatch[1]!, jobName: numMatch[2]!.trim() };
  return { jobNumber: null, jobName: null };
}

function buildFolderPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

async function requireAuth(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) { reply.code(401).send({ message: "Authentication required" }); return null; }
  const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
  if (!membership) { reply.code(403).send({ message: "Workspace access denied" }); return null; }
  return { userId: session.userId, role: membership.role, workspaceRole: membership.workspaceRole };
}

function isAdminOrOwner(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const outlookFolderSyncSchema = z.object({
  mailboxEmail: z.string().email(),
  provider: z.enum(["outlook"]).default("outlook"),
  isFullSync: z.boolean().default(false),
  folders: z.array(z.object({
    providerFolderId: z.string().min(1),
    parentProviderFolderId: z.string().nullable(),
    name: z.string().min(1),
    path: z.string().min(1),
    childFolderCount: z.number().int().min(0).default(0),
  })).min(1).max(5000),
});

const createRootSchema = z.object({
  rootName: z.string().min(1).max(200).optional(),
  mailboxEmail: z.string().email().optional(),
  providerFolderId: z.string().optional(),
  folderPath: z.string().optional(),
  folderName: z.string().min(1).max(200).optional(),
}).refine((d) => !!(d.rootName || d.folderName), {
  message: "rootName or folderName is required",
});

const matchSchema = z.object({ jobId: z.string().min(1) });

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export const registerFolderDiscoveryRoutes = async (app: FastifyInstance): Promise<void> => {

  // =========================================================================
  // 2A: N8N OUTLOOK FOLDER INGESTION
  // =========================================================================

  app.post("/api/v1/integrations/n8n/outlook-folders", async (request, reply) => {
    const env = app.services.env;
    if (!verifyN8nApiKey(request, reply, env.N8N_INTEGRATION_API_KEY, env.N8N_INTEGRATION_ENABLED)) {
      return;
    }

    let body: z.infer<typeof outlookFolderSyncSchema>;
    try {
      body = outlookFolderSyncSchema.parse(request.body);
    } catch (error) {
      return reply.code(400).send({
        message: "Invalid request payload",
        issues: error instanceof z.ZodError ? error.issues : []
      });
    }

    const normalizedMailbox = body.mailboxEmail.toLowerCase();
    const mailbox = await app.services.prisma.workspaceMailbox.findFirst({
      where: { normalizedEmail: normalizedMailbox, status: "ACTIVE" },
      select: { workspaceId: true }
    });

    if (!mailbox) {
      return reply.code(404).send({ message: `No active workspace mailbox found for ${body.mailboxEmail}` });
    }

    const workspaceId = mailbox.workspaceId;

    const roots = await app.services.prisma.jobFolderRoot.findMany({
      where: { workspaceId, OR: [{ active: true }, { isActive: true }] },
      select: { normalizedName: true, folderPath: true, rootName: true }
    });

    function isFolderUnderRoot(folderPath: string): boolean {
      for (const root of roots) {
        // Require a child segment so the root folder itself is not a job candidate.
        if (root.folderPath && folderPath.startsWith(root.folderPath + "/")) return true;
        if (folderPath.startsWith(root.rootName + "/")) return true;
        const segments = folderPath.split("/");
        if (segments.length < 2) continue;
        const normalizedPath = normalizeName(segments[0] ?? "");
        if (normalizedPath === root.normalizedName) return true;
      }
      return false;
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let archived = 0;

    const seenFolderIds = new Set<string>();

    for (const folder of body.folders) {
      seenFolderIds.add(folder.providerFolderId);
      const normalized = normalizeName(folder.name);
      const isDescendant = isFolderUnderRoot(folder.path);

      let detectedJobNumber: string | null = null;
      let detectedJobName: string | null = null;
      let matchedJobId: string | null = null;
      let status: "DISCOVERED" | "MATCHED" = "DISCOVERED";

      if (isDescendant) {
        const info = detectJobInfo(folder.name);
        detectedJobNumber = info.jobNumber;
        detectedJobName = info.jobName;

        if (info.jobNumber) {
          const jobByNumber = await app.services.prisma.job.findFirst({
            where: { workspaceId, jobNumber: info.jobNumber },
            select: { id: true }
          });
          if (jobByNumber) {
            matchedJobId = jobByNumber.id;
            status = "MATCHED";
          }
        }

        if (!matchedJobId && info.jobName) {
          const normalizedJobName = normalizeName(info.jobName);
          const jobByName = await app.services.prisma.job.findFirst({
            where: { workspaceId, normalizedName: normalizedJobName },
            select: { id: true }
          });
          if (jobByName) {
            matchedJobId = jobByName.id;
            status = "MATCHED";
          }
        }

        if (!matchedJobId) {
          const aliasMatch = await app.services.prisma.entityAlias.findFirst({
            where: {
              workspaceId,
              entityType: "JOB",
              normalizedAlias: normalized,
              source: { notIn: ["OUTLOOK_FOLDER"] }
            },
            select: { jobId: true }
          });
          if (aliasMatch?.jobId) {
            matchedJobId = aliasMatch.jobId;
            status = "MATCHED";
          }
        }
      }

      const existing = await app.services.prisma.discoveredFolder.findUnique({
        where: {
          workspaceId_mailboxEmail_providerFolderId: {
            workspaceId,
            mailboxEmail: normalizedMailbox,
            providerFolderId: folder.providerFolderId
          }
        }
      });

      if (existing) {
        const hasChanges =
          existing.rawFolderName !== folder.name ||
          existing.folderPath !== folder.path ||
          existing.childFolderCount !== folder.childFolderCount ||
          existing.parentProviderFolderId !== folder.parentProviderFolderId;

        if (hasChanges || !existing.lastSeenAt || (Date.now() - existing.lastSeenAt.getTime() > 60000)) {
          const updateData: Record<string, unknown> = {
            rawFolderName: folder.name,
            normalizedFolderName: normalized,
            folderPath: folder.path,
            parentProviderFolderId: folder.parentProviderFolderId,
            childFolderCount: folder.childFolderCount,
            lastSeenAt: new Date(),
          };

          if (isDescendant && detectedJobNumber) updateData.detectedJobNumber = detectedJobNumber;
          if (isDescendant && detectedJobName) updateData.detectedJobName = detectedJobName;
          if (matchedJobId && existing.status === "DISCOVERED") {
            updateData.matchedJobId = matchedJobId;
            updateData.status = "MATCHED";
          }

          await app.services.prisma.discoveredFolder.update({
            where: { id: existing.id },
            data: updateData
          });
          updated++;
        } else {
          unchanged++;
        }
      } else {
        await app.services.prisma.discoveredFolder.create({
          data: {
            workspaceId,
            provider: "OUTLOOK",
            mailboxEmail: normalizedMailbox,
            providerFolderId: folder.providerFolderId,
            parentProviderFolderId: folder.parentProviderFolderId,
            folderPath: folder.path,
            rawFolderName: folder.name,
            normalizedFolderName: normalized,
            detectedJobNumber,
            detectedJobName,
            matchedJobId,
            status,
            childFolderCount: folder.childFolderCount,
          }
        });
        created++;
      }
    }

    if (body.isFullSync) {
      const archiveResult = await app.services.prisma.discoveredFolder.updateMany({
        where: {
          workspaceId,
          mailboxEmail: normalizedMailbox,
          providerFolderId: { notIn: [...seenFolderIds] },
          status: { notIn: ["ARCHIVED", "IGNORED"] }
        },
        data: { status: "ARCHIVED" }
      });
      archived = archiveResult.count;

      if (archived > 0) {
        await app.services.auditEventLogger.log({
          workspaceId,
          entityType: "DISCOVERED_FOLDER",
          entityId: normalizedMailbox,
          action: "discovered_folder.archived",
          metadata: { count: archived, reason: "full_sync" },
          request
        });
      }
    }

    return reply.send({ created, updated, unchanged, archived });
  });

  // =========================================================================
  // 2B: JOB FOLDER ROOT CONFIGURATION
  // =========================================================================

  app.get("/api/v1/workspaces/:workspaceId/job-folder-roots", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const roots = await app.services.prisma.jobFolderRoot.findMany({
      where: { workspaceId },
      orderBy: { rootName: "asc" }
    });

    return reply.send({ roots });
  });

  app.post("/api/v1/workspaces/:workspaceId/job-folder-roots", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const body = createRootSchema.parse(request.body);
    const resolvedName = (body.rootName ?? body.folderName)!;
    const normalized = normalizeName(resolvedName);

    const root = await app.services.prisma.jobFolderRoot.upsert({
      where: { workspaceId_normalizedName: { workspaceId, normalizedName: normalized } },
      update: {
        rootName: resolvedName,
        active: true,
        isActive: true,
        ...(body.mailboxEmail != null ? { mailboxEmail: body.mailboxEmail } : {}),
        ...(body.providerFolderId != null ? { providerFolderId: body.providerFolderId } : {}),
        ...(body.folderPath != null ? { folderPath: body.folderPath } : {}),
        ...(body.folderName != null ? { folderName: body.folderName } : {}),
      },
      create: {
        workspaceId,
        rootName: resolvedName,
        normalizedName: normalized,
        mailboxEmail: body.mailboxEmail ?? null,
        providerFolderId: body.providerFolderId ?? null,
        folderPath: body.folderPath ?? null,
        folderName: body.folderName ?? resolvedName,
        createdByUserId: auth.userId,
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB_FOLDER_ROOT",
      entityId: root.id,
      action: "job_folder_root.added",
      metadata: { rootName: resolvedName, mailboxEmail: body.mailboxEmail ?? null },
      request
    });

    return reply.code(201).send({ root });
  });

  app.delete("/api/v1/workspaces/:workspaceId/job-folder-roots/:rootId", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), rootId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const root = await app.services.prisma.jobFolderRoot.findFirst({
      where: { id: params.rootId, workspaceId: params.workspaceId }
    });
    if (!root) return reply.code(404).send({ message: "Root not found" });

    await app.services.prisma.jobFolderRoot.update({
      where: { id: params.rootId },
      data: { active: false, isActive: false }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB_FOLDER_ROOT",
      entityId: params.rootId,
      action: "job_folder_root.removed",
      metadata: { rootName: root.rootName },
      request
    });

    return reply.send({ status: "removed" });
  });

  // =========================================================================
  // 2C: DISCOVERED FOLDERS CRUD
  // =========================================================================

  app.get("/api/v1/workspaces/:workspaceId/discovered-folders", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const query = z.object({
      status: z.enum(["DISCOVERED", "APPROVED", "IGNORED", "MATCHED", "ARCHIVED"]).optional(),
      mailboxEmail: z.string().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(request.query);

    const where: Record<string, unknown> = { workspaceId };
    if (query.status) where.status = query.status;
    if (query.mailboxEmail) where.mailboxEmail = query.mailboxEmail.toLowerCase();
    if (query.search) {
      where.OR = [
        { rawFolderName: { contains: query.search, mode: "insensitive" } },
        { folderPath: { contains: query.search, mode: "insensitive" } },
        { detectedJobNumber: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [folders, total] = await Promise.all([
      app.services.prisma.discoveredFolder.findMany({
        where,
        orderBy: [{ status: "asc" }, { folderPath: "asc" }],
        include: { matchedJob: { select: { id: true, name: true, jobNumber: true } } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      app.services.prisma.discoveredFolder.count({ where }),
    ]);

    return reply.send({ folders, total, page: query.page, pageSize: query.pageSize });
  });

  app.post("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId/match", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const body = matchSchema.parse(request.body);

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const job = await app.services.prisma.job.findFirst({
      where: { id: body.jobId, workspaceId: params.workspaceId },
      select: { id: true, name: true }
    });
    if (!job) return reply.code(404).send({ message: "Job not found" });

    const normalizedAlias = normalizeName(folder.rawFolderName);
    await app.services.prisma.entityAlias.upsert({
      where: {
        workspaceId_entityType_normalizedAlias: {
          workspaceId: params.workspaceId,
          entityType: "JOB",
          normalizedAlias
        }
      },
      update: { jobId: body.jobId, source: "OUTLOOK_FOLDER" },
      create: {
        workspaceId: params.workspaceId,
        entityType: "JOB",
        jobId: body.jobId,
        alias: folder.rawFolderName,
        normalizedAlias,
        source: "OUTLOOK_FOLDER"
      }
    });

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: { status: "MATCHED", matchedJobId: body.jobId }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.matched",
      metadata: { folderName: folder.rawFolderName, jobId: body.jobId, jobName: job.name },
      request
    });

    return reply.send({ status: "MATCHED", matchedJobId: body.jobId });
  });

  app.post("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId/approve", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });
    if (!folder.matchedJobId) return reply.code(400).send({ message: "Folder must be matched to a job before approval" });

    const normalizedAlias = normalizeName(folder.rawFolderName);
    await app.services.prisma.entityAlias.upsert({
      where: {
        workspaceId_entityType_normalizedAlias: {
          workspaceId: params.workspaceId,
          entityType: "JOB",
          normalizedAlias
        }
      },
      update: { jobId: folder.matchedJobId, source: "OUTLOOK_FOLDER" },
      create: {
        workspaceId: params.workspaceId,
        entityType: "JOB",
        jobId: folder.matchedJobId,
        alias: folder.rawFolderName,
        normalizedAlias,
        source: "OUTLOOK_FOLDER"
      }
    });

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedByUserId: auth.userId }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.approved",
      metadata: { folderName: folder.rawFolderName, matchedJobId: folder.matchedJobId },
      request
    });

    return reply.send({ status: "APPROVED" });
  });

  app.post("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId/create-job", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const info = detectJobInfo(folder.rawFolderName);
    const jobName = info.jobName ?? folder.rawFolderName;
    const normalizedJobName = normalizeName(jobName);

    const existingJob = await app.services.prisma.job.findFirst({
      where: { workspaceId: params.workspaceId, normalizedName: normalizedJobName },
      select: { id: true }
    });

    if (existingJob) {
      return reply.code(409).send({ message: "A job with this normalized name already exists", existingJobId: existingJob.id });
    }

    const job = await app.services.prisma.job.create({
      data: {
        workspaceId: params.workspaceId,
        name: jobName,
        normalizedName: normalizedJobName,
        jobNumber: info.jobNumber ?? null,
        status: "ACTIVE",
        createdByUserId: auth.userId,
      }
    });

    const normalizedAlias = normalizeName(folder.rawFolderName);
    await app.services.prisma.entityAlias.upsert({
      where: {
        workspaceId_entityType_normalizedAlias: {
          workspaceId: params.workspaceId,
          entityType: "JOB",
          normalizedAlias
        }
      },
      update: { jobId: job.id, source: "OUTLOOK_FOLDER" },
      create: {
        workspaceId: params.workspaceId,
        entityType: "JOB",
        jobId: job.id,
        alias: folder.rawFolderName,
        normalizedAlias,
        source: "OUTLOOK_FOLDER"
      }
    });

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: {
        status: "APPROVED",
        matchedJobId: job.id,
        approvedAt: new Date(),
        approvedByUserId: auth.userId
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.job_created",
      metadata: { folderName: folder.rawFolderName, jobId: job.id, jobName: job.name, jobNumber: info.jobNumber },
      request
    });

    return reply.code(201).send({ status: "APPROVED", job: { id: job.id, name: job.name, jobNumber: job.jobNumber } });
  });

  app.post("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId/ignore", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: { status: "IGNORED", ignoredAt: new Date(), ignoredByUserId: auth.userId }
    });

    if (folder.matchedJobId) {
      const normalizedAlias = normalizeName(folder.rawFolderName);
      await app.services.prisma.entityAlias.deleteMany({
        where: {
          workspaceId: params.workspaceId,
          entityType: "JOB",
          normalizedAlias,
          source: "OUTLOOK_FOLDER",
          jobId: folder.matchedJobId
        }
      });
    }

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.ignored",
      metadata: { folderName: folder.rawFolderName },
      request
    });

    return reply.send({ status: "IGNORED" });
  });

  app.post("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId/restore", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const newStatus = folder.matchedJobId ? "MATCHED" : "DISCOVERED";

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: { status: newStatus, ignoredAt: null, ignoredByUserId: null }
    });

    if (folder.matchedJobId) {
      const normalizedAlias = normalizeName(folder.rawFolderName);
      await app.services.prisma.entityAlias.upsert({
        where: {
          workspaceId_entityType_normalizedAlias: {
            workspaceId: params.workspaceId,
            entityType: "JOB",
            normalizedAlias
          }
        },
        update: { jobId: folder.matchedJobId, source: "OUTLOOK_FOLDER" },
        create: {
          workspaceId: params.workspaceId,
          entityType: "JOB",
          jobId: folder.matchedJobId,
          alias: folder.rawFolderName,
          normalizedAlias,
          source: "OUTLOOK_FOLDER"
        }
      });
    }

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.restored",
      metadata: { folderName: folder.rawFolderName, restoredStatus: newStatus },
      request
    });

    return reply.send({ status: newStatus });
  });

  // =========================================================================
  // 2D: BACKWARD COMPATIBLE LEGACY ENDPOINTS
  // =========================================================================

  app.post("/api/v1/workspaces/:workspaceId/folders/discover", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership || !["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(membership.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = z.object({ connectionId: z.string().min(1) }).parse(request.body);

    const connection = await app.services.prisma.inboxConnection.findFirst({
      where: { id: body.connectionId, workspaceId, status: "ACTIVE" },
      select: { id: true, provider: true, email: true, encryptedRefreshToken: true }
    });

    if (!connection || !connection.encryptedRefreshToken) {
      return reply.code(404).send({ message: "Active connection not found" });
    }

    if (connection.provider !== "OUTLOOK") {
      return reply.code(400).send({ message: "Folder discovery is currently supported for Outlook only" });
    }

    const refreshToken = app.services.tokenCipher.decrypt(connection.encryptedRefreshToken);
    const env = app.services.env;

    if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET) {
      return reply.code(503).send({ message: "Outlook not configured" });
    }

    const tokenUrl = `https://login.microsoftonline.com/${env.OUTLOOK_TENANT_ID}/oauth2/v2.0/token`;
    const tokenBody = new URLSearchParams({
      client_id: env.OUTLOOK_CLIENT_ID,
      client_secret: env.OUTLOOK_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/Mail.Read offline_access"
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString()
    });

    if (!tokenRes.ok) return reply.code(502).send({ message: "Token refresh failed" });
    const tokens = await tokenRes.json() as { access_token: string };

    const allFolders: Array<{ id: string; displayName: string; parentFolderId: string | null; childFolderCount: number }> = [];

    async function fetchFolders(parentId?: string, parentPath?: string) {
      const url = parentId
        ? `https://graph.microsoft.com/v1.0/me/mailFolders/${parentId}/childFolders?$select=id,displayName,parentFolderId,childFolderCount&$top=100`
        : `https://graph.microsoft.com/v1.0/me/mailFolders?$select=id,displayName,parentFolderId,childFolderCount&$top=100`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (!res.ok) return;

      const data = await res.json() as { value: Array<{ id: string; displayName: string; parentFolderId: string | null; childFolderCount: number }> };
      for (const folder of data.value) {
        const path = buildFolderPath(parentPath ?? null, folder.displayName);
        allFolders.push({ ...folder, parentFolderId: parentId ?? null });

        if (folder.childFolderCount > 0) {
          await fetchFolders(folder.id, path);
        }
      }
    }

    try {
      await fetchFolders();
    } catch (e) {
      return reply.code(502).send({ message: `Folder fetch failed: ${e instanceof Error ? e.message : "unknown"}` });
    }

    const roots = await app.services.prisma.jobFolderRoot.findMany({
      where: { workspaceId, active: true },
      select: { normalizedName: true }
    });
    const rootNames = new Set(roots.map(r => r.normalizedName));

    const rootFolderIds = new Set<string>();
    for (const folder of allFolders) {
      if (rootNames.has(normalizeName(folder.displayName))) {
        rootFolderIds.add(folder.id);
      }
    }

    function isUnderJobRoot(folderId: string, visited = new Set<string>()): boolean {
      if (rootFolderIds.has(folderId)) return true;
      if (visited.has(folderId)) return false;
      visited.add(folderId);
      const folder = allFolders.find(f => f.id === folderId);
      if (!folder?.parentFolderId) return false;
      return isUnderJobRoot(folder.parentFolderId, visited);
    }

    let discovered = 0;
    let updatedCount = 0;
    const parentPaths = new Map<string, string>();
    for (const folder of allFolders) {
      const parentPath = folder.parentFolderId ? parentPaths.get(folder.parentFolderId) : undefined;
      const path = buildFolderPath(parentPath ?? null, folder.displayName);
      parentPaths.set(folder.id, path);
    }

    for (const folder of allFolders) {
      const normalized = normalizeName(folder.displayName);
      const info = detectJobInfo(folder.displayName);
      const path = parentPaths.get(folder.id) ?? folder.displayName;
      const isJobCandidate = isUnderJobRoot(folder.id);

      const existing = await app.services.prisma.discoveredFolder.findFirst({
        where: { workspaceId, providerFolderId: folder.id, mailboxEmail: connection.email }
      });

      if (existing) {
        await app.services.prisma.discoveredFolder.update({
          where: { id: existing.id },
          data: {
            rawFolderName: folder.displayName,
            normalizedFolderName: normalized,
            detectedJobNumber: info.jobNumber,
            detectedJobName: info.jobName,
            folderPath: path,
            parentProviderFolderId: folder.parentFolderId,
            childFolderCount: folder.childFolderCount,
            lastSeenAt: new Date()
          }
        });
        updatedCount++;
      } else if (isJobCandidate && !rootFolderIds.has(folder.id)) {
        await app.services.prisma.discoveredFolder.create({
          data: {
            workspaceId,
            provider: "OUTLOOK",
            mailboxEmail: connection.email,
            providerFolderId: folder.id,
            parentProviderFolderId: folder.parentFolderId,
            folderPath: path,
            rawFolderName: folder.displayName,
            normalizedFolderName: normalized,
            detectedJobNumber: info.jobNumber,
            detectedJobName: info.jobName,
            status: "DISCOVERED",
            childFolderCount: folder.childFolderCount
          }
        });
        discovered++;
      }
    }

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: session.userId,
      entityType: "FOLDER_DISCOVERY",
      entityId: connection.id,
      action: "folders.discovered",
      metadata: { totalFolders: allFolders.length, discovered, updated: updatedCount, jobRoots: [...rootNames] },
      request
    });

    return reply.send({ status: "ok", totalFolders: allFolders.length, discovered, updated: updatedCount });
  });

  app.get("/api/v1/workspaces/:workspaceId/folders", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const query = z.object({ status: z.enum(["DISCOVERED", "APPROVED", "IGNORED", "MATCHED", "ARCHIVED"]).optional() }).parse(request.query);

    const folders = await app.services.prisma.discoveredFolder.findMany({
      where: { workspaceId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ status: "asc" }, { folderPath: "asc" }],
      include: {
        matchedJob: { select: { id: true, name: true, jobNumber: true } }
      }
    });

    return reply.send({ folders });
  });

  app.patch("/api/v1/workspaces/:workspaceId/folders/:folderId", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      status: z.enum(["APPROVED", "IGNORED"]),
      matchedJobId: z.string().nullable().optional()
    }).parse(request.body);

    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership || !["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(membership.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });

    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const updateData: Record<string, unknown> = { status: body.status };
    if (body.matchedJobId !== undefined) updateData.matchedJobId = body.matchedJobId;
    if (body.status === "APPROVED") {
      updateData.approvedAt = new Date();
      updateData.approvedByUserId = session.userId;
    }
    if (body.status === "IGNORED") {
      updateData.ignoredAt = new Date();
      updateData.ignoredByUserId = session.userId;
    }

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: updateData
    });

    if (body.status === "APPROVED") {
      const aliasName = folder.rawFolderName;
      const normalizedAlias = normalizeName(aliasName);

      if (body.matchedJobId) {
        await app.services.prisma.entityAlias.upsert({
          where: {
            workspaceId_entityType_normalizedAlias: {
              workspaceId: params.workspaceId,
              entityType: "JOB",
              normalizedAlias
            }
          },
          update: { jobId: body.matchedJobId, source: "OUTLOOK_FOLDER" },
          create: {
            workspaceId: params.workspaceId,
            entityType: "JOB",
            jobId: body.matchedJobId,
            alias: aliasName,
            normalizedAlias,
            source: "OUTLOOK_FOLDER"
          }
        });
      }
    }

    if (body.status === "IGNORED" && folder.matchedJobId) {
      const normalizedAlias = normalizeName(folder.rawFolderName);
      await app.services.prisma.entityAlias.deleteMany({
        where: {
          workspaceId: params.workspaceId,
          entityType: "JOB",
          normalizedAlias,
          source: "OUTLOOK_FOLDER",
          jobId: folder.matchedJobId
        }
      });
    }

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: `folder.${body.status.toLowerCase()}`,
      metadata: { folderName: folder.rawFolderName, matchedJobId: body.matchedJobId ?? null },
      request
    });

    return reply.send({ status: body.status });
  });

  app.get("/api/v1/workspaces/:workspaceId/folders/roots", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const roots = await app.services.prisma.jobFolderRoot.findMany({
      where: { workspaceId },
      orderBy: { rootName: "asc" }
    });

    return reply.send({ roots });
  });

  app.post("/api/v1/workspaces/:workspaceId/folders/roots", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const body = z.object({ rootName: z.string().min(1).max(200) }).parse(request.body);

    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const normalized = normalizeName(body.rootName);
    const root = await app.services.prisma.jobFolderRoot.upsert({
      where: { workspaceId_normalizedName: { workspaceId, normalizedName: normalized } },
      update: { rootName: body.rootName, active: true, isActive: true },
      create: { workspaceId, rootName: body.rootName, normalizedName: normalized, createdByUserId: session.userId }
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: session.userId,
      entityType: "JOB_FOLDER_ROOT",
      entityId: root.id,
      action: "job_folder_root.added",
      metadata: { rootName: body.rootName },
      request
    });

    return reply.code(201).send({ root });
  });
};
