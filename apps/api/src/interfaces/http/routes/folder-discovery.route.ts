import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  emptyProjectFolderEmailAnalyzeProgress,
  folderStatusToMatchUi,
  normalizeName,
  type FolderStatusDb,
  type ProjectFolderEmailAnalyzeProgress,
} from "@forgeops/shared";

import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { verifyN8nApiKey } from "../n8n-auth.js";
import {
  getVerifiedProjectFolders,
  ProjectFolderScanError,
  scanNativeProjectFolders,
} from "../../../application/services/scan-project-folders.js";
import {
  enqueueProjectFolderEmailAnalyze,
  ProjectFolderEmailAnalyzeError,
} from "../../../application/services/enqueue-project-folder-email-analyze.js";

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

/**
 * Map *true* Prisma schema-drift errors to an actionable API message.
 *
 * Do NOT treat every Prisma P20xx code as schema drift — that mislabels pool
 * timeouts (P2024), unique/FK violations (P2002/P2003), not-found (P2025), etc.
 * as migrations. Production DB + generated client already include Project Folder
 * columns; only missing-table/column style failures are schema drift.
 */
function prismaSchemaDriftMessage(error: unknown): string | null {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  // Prisma: table does not exist / column does not exist
  if (code === "P2021" || code === "P2022") {
    return "Required database migration has not been applied";
  }

  if (
    /column .* does not exist/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /table .* does not exist/i.test(message) ||
    /type .* does not exist/i.test(message) ||
    /does not exist in the current database/i.test(message) ||
    /invalid.*enum value/i.test(message)
  ) {
    return "Required database migration has not been applied";
  }

  return null;
}

/** Stale generated client vs newer source (not a DB migration issue). */
function prismaClientDriftMessage(error: unknown): string | null {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/Unknown argument/i.test(message) || /Unknown field/i.test(message)) {
    return "API Prisma client is out of date — redeploy the API after prisma generate";
  }
  return null;
}

/** Non-secret DB identity for diagnosing API↔Railway DB mismatches. */
function safeDatabaseTarget(): {
  host: string | null;
  port: string | null;
  database: string | null;
  schema: string | null;
} {
  const raw = process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? "";
  try {
    const u = new URL(raw);
    const schema = u.searchParams.get("schema") ?? "public";
    return {
      host: u.hostname || null,
      port: u.port || null,
      database: u.pathname.replace(/^\//, "") || null,
      schema,
    };
  } catch {
    return { host: null, port: null, database: null, schema: null };
  }
}

function deployIdentity(): {
  railwayGitCommitSha: string | null;
  railwayDeploymentId: string | null;
  railwayServiceName: string | null;
  nodeEnv: string | null;
} {
  return {
    railwayGitCommitSha:
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      process.env.RAILWAY_GIT_COMMIT ??
      null,
    railwayDeploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    railwayServiceName: process.env.RAILWAY_SERVICE_NAME ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  };
}

function discoveredFolderClientFieldSupport(): Record<string, boolean> {
  // Runtime generated client enum — proves generate saw these schema fields.
  const fields = Prisma.DiscoveredFolderScalarFieldEnum as Record<string, string>;
  return {
    inboxConnectionId: Boolean(fields.inboxConnectionId),
    matchConfidence: Boolean(fields.matchConfidence),
    matchReason: Boolean(fields.matchReason),
    missingFromProvider: Boolean(fields.missingFromProvider),
    mailboxEmail: Boolean(fields.mailboxEmail),
    providerFolderId: Boolean(fields.providerFolderId),
  };
}

/** Ensure Prisma meta / nested values never blow up Fastify JSON serialization. */
function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === "bigint") return v.toString();
        if (v instanceof Date) return v.toISOString();
        if (v === undefined) return null;
        if (typeof v === "number" && !Number.isFinite(v)) return String(v);
        if (v && typeof v === "object" && v.constructor?.name === "Decimal") {
          return String(v);
        }
        return v;
      })
    );
  } catch {
    return String(value).slice(0, 500);
  }
}

/** Original Prisma/runtime exception details for diagnosis (no secrets, JSON-safe). */
function prismaErrorCause(error: unknown): {
  name: string;
  prismaCode: string | null;
  message: string;
  meta: unknown;
  clientFields: Record<string, boolean>;
  databaseTarget: ReturnType<typeof safeDatabaseTarget>;
  deploy: ReturnType<typeof deployIdentity>;
} {
  const name =
    error && typeof error === "object" && error.constructor
      ? error.constructor.name
      : typeof error;
  const prismaCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  const message =
    error instanceof Error
      ? error.message.slice(0, 800)
      : String(error).slice(0, 800);
  const rawMeta =
    error && typeof error === "object" && "meta" in error
      ? (error as { meta: unknown }).meta
      : null;
  return {
    name,
    prismaCode,
    message,
    meta: jsonSafe(rawMeta),
    clientFields: discoveredFolderClientFieldSupport(),
    databaseTarget: safeDatabaseTarget(),
    deploy: deployIdentity(),
  };
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

/** Explicit JSON-safe folder row — avoids Decimal/Date serialization 500s. */
function serializeDiscoveredFolderRow(folder: Record<string, unknown>) {
  const matchedJob = folder.matchedJob as
    | { id: string; name: string; jobNumber: string | null }
    | null
    | undefined;
  const matchConfidence = folder.matchConfidence;
  return {
    id: folder.id,
    workspaceId: folder.workspaceId,
    inboxConnectionId: folder.inboxConnectionId ?? null,
    provider: folder.provider,
    mailboxEmail: folder.mailboxEmail,
    providerFolderId: folder.providerFolderId,
    parentProviderFolderId: folder.parentProviderFolderId ?? null,
    folderPath: folder.folderPath,
    rawFolderName: folder.rawFolderName,
    normalizedFolderName: folder.normalizedFolderName,
    detectedJobNumber: folder.detectedJobNumber ?? null,
    detectedJobName: folder.detectedJobName ?? null,
    matchedJobId: folder.matchedJobId ?? null,
    matchedJob: matchedJob
      ? {
          id: matchedJob.id,
          name: matchedJob.name,
          jobNumber: matchedJob.jobNumber ?? null,
        }
      : null,
    matchConfidence:
      matchConfidence == null || matchConfidence === ""
        ? null
        : Number(matchConfidence),
    matchReason: folder.matchReason ?? null,
    missingFromProvider: Boolean(folder.missingFromProvider),
    status: folder.status,
    childFolderCount: Number(folder.childFolderCount ?? 0),
    firstSeenAt: toIso(folder.firstSeenAt),
    lastSeenAt: toIso(folder.lastSeenAt),
    approvedAt: toIso(folder.approvedAt),
    approvedByUserId: folder.approvedByUserId ?? null,
    ignoredAt: toIso(folder.ignoredAt),
    ignoredByUserId: folder.ignoredByUserId ?? null,
    createdAt: toIso(folder.createdAt),
    updatedAt: toIso(folder.updatedAt),
  };
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
      where: { workspaceId, active: true },
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
  // NATIVE /Projects SCAN + VERIFIED FOLDERS (Email Analysis backbone)
  // =========================================================================

  app.post("/api/v1/workspaces/:workspaceId/project-folders/scan", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(auth.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = z.object({ connectionId: z.string().min(1) }).parse(request.body);

    try {
      const summary = await scanNativeProjectFolders({
        prisma: app.services.prisma,
        workspaceId,
        connectionId: body.connectionId,
        decryptRefreshToken: (enc) => app.services.tokenCipher.decrypt(enc),
        env: app.services.env,
        actorUserId: auth.userId,
      });

      await app.services.auditEventLogger.log({
        workspaceId,
        actorUserId: auth.userId,
        entityType: "FOLDER_DISCOVERY",
        entityId: body.connectionId,
        action: "project_folders.scanned",
        metadata: {
          projectsRootPath: summary.projectsRoot.path,
          candidates: summary.candidates,
          created: summary.created,
          updated: summary.updated,
          verified: summary.verified,
          suggested: summary.suggested,
          unmatched: summary.unmatched,
          missingMarked: summary.missingMarked,
        },
        request,
      });

      return reply.send({ status: "ok", ...summary });
    } catch (e) {
      const drift = prismaSchemaDriftMessage(e);
      if (drift) {
        request.log.error({ err: e, event: "project_folders_scan_schema_drift" });
        return reply.code(503).send({
          message: drift,
          code: "SCHEMA_DRIFT",
          cause: jsonSafe(prismaErrorCause(e)),
        });
      }
      const clientDrift = prismaClientDriftMessage(e);
      if (clientDrift) {
        request.log.error({ err: e, event: "project_folders_scan_client_drift" });
        return reply.code(503).send({
          message: clientDrift,
          code: "PRISMA_CLIENT_DRIFT",
          cause: jsonSafe(prismaErrorCause(e)),
        });
      }
      if (e instanceof ProjectFolderScanError) {
        const status =
          e.code === "CONNECTION_NOT_FOUND" || e.code === "NOT_OUTLOOK"
            ? 404
            : e.code === "NOT_AUTHORIZED"
              ? 401
              : e.code === "OUTLOOK_NOT_CONFIGURED"
                ? 503
                : e.code === "PROJECTS_NOT_FOUND" || e.code === "PROJECTS_AMBIGUOUS"
                  ? 422
                  : 502;
        return reply.code(status).send({
          message: e.message,
          code: e.code,
          ...(e.details && typeof e.details === "object" ? (e.details as object) : {}),
        });
      }
      throw e;
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/project-folders/verified", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const query = z
      .object({
        connectionId: z.string().optional(),
        mailboxEmail: z.string().email().optional(),
      })
      .parse(request.query);

    let mailboxEmail = query.mailboxEmail?.toLowerCase();
    if (query.connectionId) {
      const conn = await app.services.prisma.inboxConnection.findFirst({
        where: { id: query.connectionId, workspaceId },
        select: { id: true, email: true },
      });
      if (!conn) {
        return reply.code(404).send({ message: "Mailbox connection not found in this workspace" });
      }
      mailboxEmail = conn.email.toLowerCase();
    }

    const folders = await getVerifiedProjectFolders(app.services.prisma, {
      workspaceId,
      ...(query.connectionId ? { inboxConnectionId: query.connectionId } : {}),
      ...(mailboxEmail ? { mailboxEmail } : {}),
    });

    return reply.send({
      folders: folders.map((f) => ({
        id: f.id,
        workspaceId: f.workspaceId,
        inboxConnectionId: f.inboxConnectionId,
        mailboxEmail: f.mailboxEmail,
        providerFolderId: f.providerFolderId,
        folderPath: f.folderPath,
        rawFolderName: f.rawFolderName,
        matchedJobId: f.matchedJobId,
        matchedJob: f.matchedJob,
        missingFromProvider: f.missingFromProvider,
        status: f.status,
        matchStatus: folderStatusToMatchUi(f.status as FolderStatusDb),
        matchConfidence:
          f.matchConfidence != null ? Number(f.matchConfidence) : null,
        matchReason: f.matchReason,
      })),
    });
  });

  /**
   * Active Jobs that have no DiscoveredFolder mapping for the selected mailbox
   * (connection-scoped + legacy NULL inboxConnectionId rows for that mailbox email).
   */
  app.get("/api/v1/workspaces/:workspaceId/project-folders/jobs-without-folder", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const query = z
      .object({
        connectionId: z.string().min(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);

    const conn = await app.services.prisma.inboxConnection.findFirst({
      where: { id: query.connectionId, workspaceId },
      select: { id: true, email: true },
    });
    if (!conn) {
      return reply.code(404).send({ message: "Mailbox connection not found in this workspace" });
    }
    const mailboxEmail = conn.email.toLowerCase();

    const matchedFolders = await app.services.prisma.discoveredFolder.findMany({
      where: {
        workspaceId,
        matchedJobId: { not: null },
        status: { in: ["MATCHED", "APPROVED"] },
        OR: [
          { inboxConnectionId: conn.id },
          {
            inboxConnectionId: null,
            mailboxEmail: { equals: mailboxEmail, mode: "insensitive" },
          },
        ],
      },
      select: { matchedJobId: true },
    });
    const matchedJobIds = [
      ...new Set(
        matchedFolders
          .map((f) => f.matchedJobId)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const jobWhere = {
      workspaceId,
      archivedAt: null,
      ...(matchedJobIds.length > 0 ? { id: { notIn: matchedJobIds } } : {}),
    };

    const [total, jobsTotal, jobs] = await Promise.all([
      app.services.prisma.job.count({ where: jobWhere }),
      app.services.prisma.job.count({
        where: { workspaceId, archivedAt: null },
      }),
      app.services.prisma.job.findMany({
        where: jobWhere,
        orderBy: [{ jobNumber: "asc" }, { name: "asc" }],
        take: query.pageSize,
        select: {
          id: true,
          jobNumber: true,
          name: true,
          status: true,
          customer: { select: { name: true } },
        },
      }),
    ]);

    return reply.send({
      total,
      jobsTotal,
      jobs: jobs.map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        name: j.name,
        status: j.status,
        customerName: j.customer?.name ?? null,
      })),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/project-folders/analyze-emails", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(auth.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = z
      .object({
        connectionId: z.string().min(1),
        folderIds: z.array(z.string().min(1)).max(200).optional(),
      })
      .parse(request.body);

    try {
      const { runId } = await enqueueProjectFolderEmailAnalyze({
        prisma: app.services.prisma,
        queue: app.services.projectFolderEmailAnalyzeQueue,
        workspaceId,
        connectionId: body.connectionId,
        ...(body.folderIds ? { folderIds: body.folderIds } : {}),
        initiatedByUserId: auth.userId,
      });

      await app.services.auditEventLogger.log({
        workspaceId,
        actorUserId: auth.userId,
        entityType: "FOLDER_DISCOVERY",
        entityId: body.connectionId,
        action: "project_folders.analyze_emails_queued",
        metadata: {
          runId,
          folderCount: body.folderIds?.length ?? "all_verified",
        },
        request,
      });

      return reply.code(202).send({ status: "queued", runId });
    } catch (e) {
      if (e instanceof ProjectFolderEmailAnalyzeError) {
        const status =
          e.code === "CONNECTION_NOT_FOUND" || e.code === "NOT_OUTLOOK"
            ? 404
            : e.code === "NOT_AUTHORIZED"
              ? 401
              : e.code === "NO_VERIFIED_FOLDERS" || e.code === "INVALID_REQUEST"
                ? 422
                : 502;
        return reply.code(status).send({ message: e.message, code: e.code });
      }
      throw e;
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/project-folders/analyze-emails/:runId", async (request, reply) => {
    const params = z
      .object({ workspaceId: z.string().min(1), runId: z.string().min(1) })
      .parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;

    const run = await app.services.prisma.projectFolderEmailAnalyzeRun.findFirst({
      where: { id: params.runId, workspaceId: params.workspaceId },
    });
    if (!run) return reply.code(404).send({ message: "Analyze run not found" });

    const progress =
      run.progress && typeof run.progress === "object" && !Array.isArray(run.progress)
        ? ({
            ...emptyProjectFolderEmailAnalyzeProgress(),
            ...(run.progress as object),
          } as ProjectFolderEmailAnalyzeProgress)
        : emptyProjectFolderEmailAnalyzeProgress();

    return reply.send({
      run: {
        id: run.id,
        workspaceId: run.workspaceId,
        inboxConnectionId: run.inboxConnectionId,
        status: run.status,
        folderIds: run.folderIds,
        progress,
        errorMessage: run.errorMessage,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
      },
    });
  });

  // =========================================================================
  // 2C: DISCOVERED FOLDERS CRUD
  // =========================================================================

  app.get("/api/v1/workspaces/:workspaceId/discovered-folders", async (request, reply) => {
    let stage = "parse_params";
    try {
      const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);

      stage = "auth";
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;

      stage = "parse_query";
      const query = z.object({
        status: z.enum(["DISCOVERED", "APPROVED", "IGNORED", "MATCHED", "ARCHIVED"]).optional(),
        mailboxEmail: z.string().optional(),
        /** Prefer this over mailboxEmail — scopes to InboxConnection + recoverable legacy rows. */
        connectionId: z.string().min(1).optional(),
        search: z.string().optional(),
        hasMatch: z.enum(["true", "false"]).optional().transform(v => v === "true" ? true : v === "false" ? false : undefined),
        root: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }).parse(request.query);

      stage = "build_where";
      const where: Record<string, unknown> = { workspaceId };
      if (query.status) where.status = query.status;
      if (query.hasMatch === true) where.matchedJobId = { not: null };
      if (query.hasMatch === false) where.matchedJobId = null;
      if (query.root) {
        where.folderPath = { startsWith: query.root, mode: "insensitive" };
      }

      let scopeMailboxEmail: string | null = null;
      if (query.connectionId) {
        stage = "scope_connection";
        const conn = await app.services.prisma.inboxConnection.findFirst({
          where: { id: query.connectionId, workspaceId },
          select: { id: true, email: true },
        });
        if (!conn) {
          return reply.code(404).send({ message: "Mailbox connection not found in this workspace" });
        }
        scopeMailboxEmail = conn.email.toLowerCase();
        // Bound rows: this connection, or legacy NULL inboxConnectionId for same mailbox
        // (case-insensitive — legacy rows may predate email normalization).
        where.OR = [
          { inboxConnectionId: conn.id },
          {
            inboxConnectionId: null,
            mailboxEmail: { equals: scopeMailboxEmail, mode: "insensitive" },
          },
        ];
      } else if (query.mailboxEmail) {
        scopeMailboxEmail = query.mailboxEmail.toLowerCase();
        where.mailboxEmail = { equals: scopeMailboxEmail, mode: "insensitive" };
      }

      if (query.search) {
        const searchOr = [
          { rawFolderName: { contains: query.search, mode: "insensitive" } },
          { folderPath: { contains: query.search, mode: "insensitive" } },
          { detectedJobNumber: { contains: query.search, mode: "insensitive" } },
          { detectedJobName: { contains: query.search, mode: "insensitive" } },
        ];
        if (where.OR) {
          where.AND = [{ OR: where.OR }, { OR: searchOr }];
          delete where.OR;
        } else {
          where.OR = searchOr;
        }
      }

      const summaryWhere: Record<string, unknown> = { workspaceId };
      if (query.connectionId && scopeMailboxEmail) {
        summaryWhere.OR = [
          { inboxConnectionId: query.connectionId },
          {
            inboxConnectionId: null,
            mailboxEmail: { equals: scopeMailboxEmail, mode: "insensitive" },
          },
        ];
      } else if (scopeMailboxEmail) {
        summaryWhere.mailboxEmail = {
          equals: scopeMailboxEmail,
          mode: "insensitive",
        };
      }

      stage = "find_many";
      const folders = await app.services.prisma.discoveredFolder.findMany({
        where,
        orderBy: [{ status: "asc" }, { folderPath: "asc" }],
        include: { matchedJob: { select: { id: true, name: true, jobNumber: true } } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });

      stage = "count";
      const total = await app.services.prisma.discoveredFolder.count({ where });

      // Summary aggregations are best-effort — must not fail the folder list itself.
      let metrics: Array<{ status: string; _count: number | { _all?: number } }> = [];
      let lastSyncAt: string | null = null;
      let mailboxEmails: string[] = [];
      stage = "summary";
      try {
        const [grouped, lastSynced, mailboxes] = await Promise.all([
          app.services.prisma.discoveredFolder.groupBy({
            by: ["status"],
            where: summaryWhere,
            _count: true,
          }),
          app.services.prisma.discoveredFolder.findFirst({
            where: summaryWhere,
            orderBy: { lastSeenAt: "desc" },
            select: { lastSeenAt: true },
          }),
          app.services.prisma.discoveredFolder.groupBy({
            by: ["mailboxEmail"],
            where: summaryWhere,
          }),
        ]);
        metrics = grouped;
        lastSyncAt = lastSynced?.lastSeenAt
          ? lastSynced.lastSeenAt.toISOString()
          : null;
        mailboxEmails = mailboxes.map((m) => m.mailboxEmail);
      } catch (summaryErr) {
        request.log.warn({
          err: summaryErr,
          event: "discovered_folders_summary_failed",
          workspaceId,
          connectionId: query.connectionId,
          cause: prismaErrorCause(summaryErr),
        });
      }

      const countOf = (m: { _count: number | { _all?: number } }) =>
        typeof m._count === "number" ? m._count : Number(m._count?._all ?? 0);

      const summary = {
        total: 0,
        discovered: countOf(
          metrics.find((m) => m.status === "DISCOVERED") ?? { _count: 0 }
        ),
        matched: countOf(
          metrics.find((m) => m.status === "MATCHED") ?? { _count: 0 }
        ),
        approved: countOf(
          metrics.find((m) => m.status === "APPROVED") ?? { _count: 0 }
        ),
        ignored: countOf(
          metrics.find((m) => m.status === "IGNORED") ?? { _count: 0 }
        ),
        archived: countOf(
          metrics.find((m) => m.status === "ARCHIVED") ?? { _count: 0 }
        ),
        lastSyncAt,
        mailboxes: mailboxEmails,
      };
      summary.total =
        summary.discovered +
        summary.matched +
        summary.approved +
        summary.ignored +
        summary.archived;
      // If summary aggregations failed, fall back to pagination total.
      if (summary.total === 0 && total > 0) {
        summary.total = total;
      }

      stage = "serialize";
      const payload = {
        folders: folders.map((f) =>
          serializeDiscoveredFolderRow(f as unknown as Record<string, unknown>)
        ),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount: total,
          totalPages: Math.ceil(total / query.pageSize),
        },
        summary,
      };

      stage = "send";
      return reply.send(payload);
    } catch (e) {
      // Auth already sent a response.
      if (reply.sent) return;

      const drift = prismaSchemaDriftMessage(e);
      const cause = {
        ...prismaErrorCause(e),
        stage,
      };
      const sendSafe = (status: number, body: Record<string, unknown>) => {
        try {
          return reply.code(status).send(jsonSafe(body) as Record<string, unknown>);
        } catch (sendErr) {
          request.log.error({
            err: sendErr,
            event: "discovered_folders_error_serialize_failed",
            stage,
            fallbackMessage: cause.message,
          });
          return reply.code(status).send({
            message: `Discovered folders failed at ${stage}: ${cause.message.slice(0, 300)}`,
            code: "DISCOVERED_FOLDERS_LIST_FAILED",
            stage,
          });
        }
      };
      if (drift) {
        request.log.error({
          err: e,
          event: "discovered_folders_schema_drift",
          stage,
          cause,
        });
        return sendSafe(503, {
          message: drift,
          code: "SCHEMA_DRIFT",
          stage,
          cause,
        });
      }
      const clientDrift = prismaClientDriftMessage(e);
      if (clientDrift) {
        request.log.error({
          err: e,
          event: "discovered_folders_client_drift",
          stage,
          cause,
        });
        return sendSafe(503, {
          message: clientDrift,
          code: "PRISMA_CLIENT_DRIFT",
          stage,
          cause,
        });
      }
      request.log.error({
        err: e,
        event: "discovered_folders_list_failed",
        stage,
        cause,
      });
      const detail =
        cause.prismaCode || cause.message
          ? `${cause.prismaCode ? `[${cause.prismaCode}] ` : ""}${cause.message}`.slice(
              0,
              400
            )
          : null;
      return sendSafe(500, {
        message: detail
          ? `Could not load discovered folders at ${stage}: ${detail}`
          : `Could not load discovered folders at ${stage}`,
        code: "DISCOVERED_FOLDERS_LIST_FAILED",
        stage,
        cause,
      });
    }
  });
  app.get("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId },
      include: { matchedJob: { select: { id: true, name: true, jobNumber: true, status: true } } },
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const auditHistory = await app.services.prisma.auditEvent.findMany({
      where: { workspaceId: params.workspaceId, entityType: "DISCOVERED_FOLDER", entityId: params.folderId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actorUser: { select: { id: true, email: true, name: true } } },
    });

    const alias = folder.matchedJobId
      ? await app.services.prisma.entityAlias.findFirst({
          where: {
            workspaceId: params.workspaceId,
            entityType: "JOB",
            jobId: folder.matchedJobId,
            normalizedAlias: normalizeName(folder.rawFolderName),
            source: "OUTLOOK_FOLDER",
          },
          select: { id: true, alias: true, normalizedAlias: true, createdAt: true },
        })
      : null;

    return reply.send({ folder, auditHistory, alias });
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
      data: {
        status: "APPROVED",
        matchedJobId: body.jobId,
        matchConfidence: 1,
        matchReason: "manual",
        approvedAt: new Date(),
        approvedByUserId: auth.userId,
        ignoredAt: null,
        ignoredByUserId: null,
        missingFromProvider: false,
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.matched",
      metadata: { folderName: folder.rawFolderName, jobId: body.jobId, jobName: job.name, verified: true },
      request
    });

    return reply.send({
      status: "APPROVED",
      matchStatus: "VERIFIED",
      matchedJobId: body.jobId,
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId/unmatch", async (request, reply) => {
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

    if (folder.matchedJobId) {
      await app.services.prisma.entityAlias.deleteMany({
        where: {
          workspaceId: params.workspaceId,
          entityType: "JOB",
          jobId: folder.matchedJobId,
          source: "OUTLOOK_FOLDER",
          normalizedAlias: normalizeName(folder.rawFolderName),
        }
      });
    }

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: {
        status: "DISCOVERED",
        matchedJobId: null,
        matchConfidence: null,
        matchReason: null,
        approvedAt: null,
        approvedByUserId: null,
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.unmatched",
      metadata: {
        folderName: folder.rawFolderName,
        previousJobId: folder.matchedJobId,
      },
      request
    });

    return reply.send({ status: "DISCOVERED", matchStatus: "UNMATCHED", matchedJobId: null });
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

    const bodySchema = z.object({
      jobNumber: z.string().min(1).max(100).optional(),
      name: z.string().min(1).max(300).optional(),
      status: z.enum(["LEAD", "BIDDING", "AWARDED", "ACTIVE", "ON_HOLD", "COMPLETE", "ARCHIVED", "COMPLETED", "CANCELLED"]).default("ACTIVE"),
      customerId: z.string().optional(),
      description: z.string().max(5000).optional(),
      startDate: z.string().optional(),
      targetCompletionDate: z.string().optional(),
    }).optional();

    const body = bodySchema.parse(request.body);

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });
    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const info = detectJobInfo(folder.rawFolderName);
    const jobName = body?.name ?? info.jobName ?? folder.rawFolderName;
    const jobNumber = body?.jobNumber ?? info.jobNumber ?? null;
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
        jobNumber: jobNumber,
        status: body?.status ?? "ACTIVE",
        description: body?.description ?? null,
        customerId: body?.customerId ?? null,
        startDate: body?.startDate ? new Date(body.startDate) : null,
        targetCompletionDate: body?.targetCompletionDate ? new Date(body.targetCompletionDate) : null,
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

  app.post("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId/archive", async (request, reply) => {
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

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: { status: "ARCHIVED" }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.archived",
      metadata: { folderName: folder.rawFolderName },
      request
    });

    return reply.send({ status: "ARCHIVED" });
  });

  app.delete("/api/v1/workspaces/:workspaceId/discovered-folders/:folderId", async (request, reply) => {
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

    const normalizedAlias = normalizeName(folder.rawFolderName);
    await app.services.prisma.entityAlias.deleteMany({
      where: {
        workspaceId: params.workspaceId,
        entityType: "JOB",
        normalizedAlias,
        source: "OUTLOOK_FOLDER",
        ...(folder.matchedJobId ? { jobId: folder.matchedJobId } : {})
      }
    });

    await app.services.prisma.discoveredFolder.delete({
      where: { id: params.folderId }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: "discovered_folder.deleted",
      metadata: { folderName: folder.rawFolderName, matchedJobId: folder.matchedJobId },
      request
    });

    return reply.send({ status: "DELETED" });
  });

  app.delete("/api/v1/workspaces/:workspaceId/discovered-folders", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!isAdminOrOwner(auth.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const aliasResult = await app.services.prisma.entityAlias.deleteMany({
      where: {
        workspaceId: params.workspaceId,
        entityType: "JOB",
        source: "OUTLOOK_FOLDER"
      }
    });

    const folderResult = await app.services.prisma.discoveredFolder.deleteMany({
      where: { workspaceId: params.workspaceId }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: auth.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.workspaceId,
      action: "discovered_folder.cleared",
      metadata: { deletedFolders: folderResult.count, deletedAliases: aliasResult.count },
      request
    });

    return reply.send({
      status: "CLEARED",
      deletedFolders: folderResult.count,
      deletedAliases: aliasResult.count
    });
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
      where: { workspaceId, active: true },
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
