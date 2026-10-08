import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION } from "@forgeops/ai";
import {
  classifyJobFileType,
  includeEmailAttachmentInJobLibrary,
  fileExtension,
  canPreviewFile,
  tasksForEmailJobLink,
  JOB_FILE_TYPE_FILTERS,
  normalizeName,
  buildOperationalTasksWhere,
  taskListOrderBy,
  BUSINESS_SUBTYPE_KEYS,
  type JobFileTypeFilter,
  type TaskStatusFilter,
  type TaskDueFilter,
  type TaskPriorityFilter,
  type TaskSourceFilter,
  type TaskEmailClassificationFilter,
  type TaskSort,
} from "@forgeops/shared";
import { presentFabricationItem, totalEstimatedHours } from "../../../application/services/job-fabrication.js";
import { buildJobListWhere, jobListOrderBy } from "../../../application/services/job-list-query.js";
import { deleteScopedEmailMessages } from "../../../application/services/clear-inbox.js";
import { serializeRelevanceRow } from "../../../application/services/inline-image-relevance-correct.js";
import {
  listJobParticipants,
  pickPrimaryProjectManager,
} from "../../../application/services/job-participants.js";
import {
  buildWorkPackageDtos,
  buildWorkPackageSummary,
} from "../../../application/services/job-work-packages.js";
import { buildJobScheduleSummary } from "../../../application/services/job-milestones.js";
import { buildChangesSummary } from "../../../application/services/job-change-management.js";
import { buildProcurementSummary } from "../../../application/services/job-procurement.js";
import { buildDeliverySummary } from "../../../application/services/job-deliveries.js";
import {
  buildJobFinancialSnapshot,
  normalizeMoney as normalizeFinancialMoney,
  moneyToString as financialMoneyToString,
} from "../../../application/services/job-financials.js";
import { buildBillingSnapshot } from "../../../application/services/job-billing.js";
import { buildRfqSummary } from "../../../application/services/job-rfqs.js";
import {
  DOCUMENT_CATEGORY_FILTERS,
  DOCUMENT_CONTROL_STATE_FILTERS,
  documentMatchesCategory,
  loadDocumentControlsForSources,
  type DocumentCategoryFilter,
  type DocumentControlStateFilter,
} from "../../../application/services/job-document-records.js";
import { deleteWorkspaceJob } from "../../../application/services/delete-workspace-job.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const IMAGE_RELEVANCE_FILTERS = [
  "ALL",
  "RELEVANT",
  "NOISE",
  "UNCERTAIN",
  "NOT_ANALYZED",
] as const;

const wsParams = z.object({ workspaceId: z.string().min(1) });
const jobParams = z.object({ workspaceId: z.string().min(1), jobId: z.string().min(1) });

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

function canPermanentlyDeleteJob(role: string, workspaceRole: string): boolean {
  // Prefer Membership.role OWNER (frontend convention); also accept workspaceRole OWNER.
  return role === "OWNER" || workspaceRole === "OWNER";
}

function localAttachmentRoot(): string {
  return process.env.ATTACHMENT_STORAGE_PATH?.trim() || join(process.cwd(), "data", "attachments");
}

async function bestEffortDeleteJobFileStorage(
  app: FastifyInstance,
  storageKey: string | null | undefined
): Promise<void> {
  if (!storageKey) return;
  try {
    const storage = app.services.attachmentStorage;
    if (storage.configured) await storage.delete(storageKey);
    else {
      const fullPath = join(localAttachmentRoot(), storageKey);
      if (existsSync(fullPath)) unlinkSync(fullPath);
    }
  } catch {
    /* best-effort */
  }
}

async function loadJobWithTenantCheck(
  app: FastifyInstance,
  reply: import("fastify").FastifyReply,
  jobId: string,
  workspaceId: string,
) {
  const job = await app.services.prisma.job.findFirst({ where: { id: jobId, workspaceId } });
  if (!job) { reply.code(404).send({ message: "Job not found" }); return null; }
  return job;
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  customerId: z.string().optional(),
  search: z.string().optional(),
  assignedUserId: z.string().optional(),
  hasOverdueTasks: z.enum(["true", "false"]).optional().transform(v => v === "true"),
  showArchived: z.enum(["true", "false"]).optional().transform(v => v === "true"),
  sortBy: z.enum(["name", "jobNumber", "status", "createdAt", "updatedAt", "activity", "startDate", "targetCompletionDate", "totalCost"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

const createJobSchema = z.object({
  jobNumber: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  status: z.enum(["LEAD", "BIDDING", "AWARDED", "ACTIVE", "ON_HOLD", "COMPLETE", "ARCHIVED", "COMPLETED", "CANCELLED"]).default("ACTIVE"),
  customerId: z.string().optional(),
  description: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  startDate: z.string().datetime().optional(),
  targetCompletionDate: z.string().datetime().optional(),
  memberUserIds: z.array(z.string()).optional(),
  aliases: z.array(z.string().min(1).max(300)).optional(),
});

/** Settings date inputs submit YYYY-MM-DD. Full ISO datetimes are also accepted. */
const jobDateInput = z.union([
  z.string().datetime(),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
]);

const updateJobSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  jobNumber: z.string().min(1).max(100).optional(),
  status: z.enum(["LEAD", "BIDDING", "AWARDED", "ACTIVE", "ON_HOLD", "COMPLETE", "ARCHIVED", "COMPLETED", "CANCELLED"]).optional(),
  customerId: z.string().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  startDate: jobDateInput.nullable().optional(),
  targetCompletionDate: jobDateInput.nullable().optional(),
  bidDueAt: jobDateInput.nullable().optional(),
  totalCost: z.union([z.number().nonnegative().max(1_000_000_000_000), z.null()]).optional(),
  /** Canonical sell baseline. Null = clear/unknown. Allows zero; negatives rejected for baseline. */
  originalContractValue: z.union([z.number().min(0).max(1_000_000_000_000), z.null()]).optional(),
  /** Canonical cost baseline estimate. Null = clear/unknown. Allows zero. */
  originalEstimatedCost: z.union([z.number().min(0).max(1_000_000_000_000), z.null()]).optional(),
  estimatorUserId: z.string().nullable().optional(),
  contractorCustomerId: z.string().nullable().optional(),
  clientCustomerId: z.string().nullable().optional(),
  siteName: z.string().max(200).nullable().optional(),
  siteAddress1: z.string().max(200).nullable().optional(),
  siteAddress2: z.string().max(200).nullable().optional(),
  siteCity: z.string().max(100).nullable().optional(),
  siteState: z.string().max(50).nullable().optional(),
  sitePostalCode: z.string().max(20).nullable().optional(),
});

function activityJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

const emailListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().optional(),
  emailType: z.string().optional(),
});

export const registerJobsRoutes = async (app: FastifyInstance): Promise<void> => {

  // 0. GET /api/v1/workspaces/:workspaceId/jobs/lookup — Lightweight list for dropdowns (no N+1)
  app.get("/api/v1/workspaces/:workspaceId/jobs/lookup", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const query = z.object({
      showArchived: z.enum(["true", "false"]).optional().transform(v => v === "true"),
      search: z.string().optional(),
    }).parse(request.query);

    const where: Record<string, unknown> = { workspaceId };
    if (!query.showArchived) {
      where.archivedAt = null;
    }
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { jobNumber: { contains: term, mode: "insensitive" } },
        { customer: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    const LOOKUP_LIMIT = query.search ? 50 : 500;
    const jobs = await app.services.prisma.job.findMany({
      where,
      orderBy: { name: "asc" },
      take: LOOKUP_LIMIT,
      select: {
        id: true,
        jobNumber: true,
        name: true,
        status: true,
        customer: { select: { name: true } },
      },
    });

    return reply.send({
      jobs: jobs.map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        name: j.name,
        status: j.status,
        customerName: j.customer?.name ?? null,
      })),
    });
  });

  // Estimator and company options for Job Settings. Any workspace member may read them.
  app.get("/api/v1/workspaces/:workspaceId/jobs/party-options", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const [memberships, customers] = await Promise.all([
      app.services.prisma.membership.findMany({
        where: { workspaceId },
        select: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      }),
      app.services.prisma.customer.findMany({
        where: { workspaceId },
        select: { id: true, name: true },
        orderBy: { normalizedName: "asc" },
        take: 500,
      }),
    ]);

    return reply.send({
      members: memberships.map((row) => row.user),
      customers,
    });
  });

  // 1. GET /api/v1/workspaces/:workspaceId/jobs — List jobs with filters
  app.get("/api/v1/workspaces/:workspaceId/jobs", async (request, reply) => {
    const t0 = performance.now();
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const query = listQuerySchema.parse(request.query);
    const skip = (query.page - 1) * query.pageSize;
    const now = new Date();
    const openTaskStatuses = ["OPEN", "IN_PROGRESS", "BLOCKED"] as const;
    const searchTerm = query.search?.trim() ?? "";

    const where = buildJobListWhere({
      workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(searchTerm ? { search: searchTerm } : {}),
      showArchived: query.showArchived,
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      hasOverdueTasks: query.hasOverdueTasks,
      now,
    });

    const tDb = performance.now();
    let listMs = 0;
    let countMs = 0;
    const [jobs, totalCount] = await Promise.all([
      app.services.prisma.job.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: jobListOrderBy(query.sortBy, query.sortDir),
        select: {
          id: true,
          jobNumber: true,
          name: true,
          status: true,
          customerId: true,
          totalCost: true,
          startDate: true,
          targetCompletionDate: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
          customer: { select: { id: true, name: true } },
          members: {
            select: { id: true, userId: true, role: true, createdAt: true },
            take: 8,
          },
        },
      }).then((rows) => {
        listMs = Math.round(performance.now() - tDb);
        return rows;
      }),
      app.services.prisma.job.count({ where }).then((count) => {
        countMs = Math.round(performance.now() - tDb);
        return count;
      }),
    ]);
    const primaryQueryMs = Math.round(performance.now() - tDb);

    const jobIds = jobs.map((j) => j.id);

    const tAgg = performance.now();
    // Email counts are a separate grouped query on the page's job ids.
    // Counting them inside findMany joins EmailMessage before LIMIT.
    const [memberUsers, openTaskGroups, overdueTaskGroups, nextDueGroups, emailCountGroups] =
      jobIds.length === 0
        ? [[], [], [], [], []] as const
        : await Promise.all([
            (() => {
              const allMemberUserIds = [
                ...new Set(jobs.flatMap((j) => j.members.map((m) => m.userId))),
              ];
              return allMemberUserIds.length
                ? app.services.prisma.user.findMany({
                    where: { id: { in: allMemberUserIds } },
                    select: { id: true, email: true, name: true },
                  })
                : Promise.resolve([]);
            })(),
            app.services.prisma.task.groupBy({
              by: ["jobId"],
              where: {
                jobId: { in: jobIds },
                status: { in: [...openTaskStatuses] },
              },
              _count: { _all: true },
            }),
            app.services.prisma.task.groupBy({
              by: ["jobId"],
              where: {
                jobId: { in: jobIds },
                status: { in: [...openTaskStatuses] },
                dueAt: { lt: now },
              },
              _count: { _all: true },
            }),
            app.services.prisma.task.groupBy({
              by: ["jobId"],
              where: {
                jobId: { in: jobIds },
                status: { in: [...openTaskStatuses] },
                dueAt: { not: null },
              },
              _min: { dueAt: true },
            }),
            app.services.prisma.emailMessage.groupBy({
              by: ["jobId"],
              where: {
                workspaceId,
                jobId: { in: jobIds },
              },
              _count: { _all: true },
            }),
          ]);
    const aggregateMs = Math.round(performance.now() - tAgg);
    const dbMs = primaryQueryMs + aggregateMs;

    const memberUserMap = new Map(memberUsers.map((u) => [u.id, u]));
    const openCountByJob = new Map(
      openTaskGroups
        .filter((g): g is typeof g & { jobId: string } => Boolean(g.jobId))
        .map((g) => [g.jobId, g._count._all])
    );
    const overdueCountByJob = new Map(
      overdueTaskGroups
        .filter((g): g is typeof g & { jobId: string } => Boolean(g.jobId))
        .map((g) => [g.jobId, g._count._all])
    );
    const nextDueByJob = new Map(
      nextDueGroups
        .filter((g): g is typeof g & { jobId: string } => Boolean(g.jobId))
        .map((g) => [g.jobId, g._min.dueAt])
    );
    const emailCountByJob = new Map(
      emailCountGroups
        .filter((g): g is typeof g & { jobId: string } => Boolean(g.jobId))
        .map((g) => [g.jobId, g._count._all])
    );

    const enriched = jobs.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      name: job.name,
      status: job.status,
      customerId: job.customerId,
      customerName: job.customer?.name ?? null,
      description: null as string | null,
      totalCost: job.totalCost == null ? null : job.totalCost.toString(),
      startDate: job.startDate,
      targetCompletionDate: job.targetCompletionDate,
      archivedAt: job.archivedAt,
      createdAt: job.createdAt,
      emailCount: emailCountByJob.get(job.id) ?? 0,
      openTaskCount: openCountByJob.get(job.id) ?? 0,
      overdueTaskCount: overdueCountByJob.get(job.id) ?? 0,
      lastActivityAt: job.updatedAt,
      nextDueDate: nextDueByJob.get(job.id) ?? null,
      assignedMembers: job.members.map((m) => {
        const u = memberUserMap.get(m.userId);
        return {
          userId: m.userId,
          name: u?.name ?? null,
          email: u?.email ?? "",
          role: m.role,
        };
      }),
    }));

    const body = {
      jobs: enriched,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / query.pageSize),
      },
    };
    const payloadBytes = Buffer.byteLength(JSON.stringify(body));
    request.log.info({
      event: "api-performance",
      route: "jobs.list",
      totalMs: Math.round(performance.now() - t0),
      listMs,
      countMs,
      primaryQueryMs,
      aggregateMs,
      dbMs,
      hasSearch: searchTerm.length > 0,
      searchLength: searchTerm.length,
      resultCount: enriched.length,
      payloadBytes,
    });

    return reply.send(body);
  });

  // 2. POST /api/v1/workspaces/:workspaceId/jobs — Create job
  app.post("/api/v1/workspaces/:workspaceId/jobs", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = createJobSchema.parse(request.body);
    const normalizedName = normalizeName(body.name);

    const existingByNumber = await app.services.prisma.job.findFirst({
      where: { workspaceId, jobNumber: body.jobNumber },
    });
    if (existingByNumber) {
      return reply.code(409).send({ message: "A job with this job number already exists in this workspace" });
    }

    const existingByName = await app.services.prisma.job.findFirst({
      where: { workspaceId, normalizedName },
    });
    if (existingByName) {
      return reply.code(409).send({ message: "A job with this name already exists in this workspace" });
    }

    const job = await app.services.prisma.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          workspaceId,
          jobNumber: body.jobNumber,
          name: body.name,
          normalizedName,
          customerId: body.customerId ?? null,
          status: body.status,
          description: body.description ?? null,
          notes: body.notes ?? null,
          startDate: body.startDate ? new Date(body.startDate) : null,
          targetCompletionDate: body.targetCompletionDate ? new Date(body.targetCompletionDate) : null,
          createdByUserId: auth.userId,
        },
        include: {
          customer: { select: { id: true, name: true } },
        },
      });

      if (body.memberUserIds?.length) {
        await tx.jobMember.createMany({
          data: body.memberUserIds.map((userId) => ({
            jobId: created.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      if (body.aliases?.length) {
        await tx.entityAlias.createMany({
          data: body.aliases.map((alias) => ({
            workspaceId,
            entityType: "JOB" as const,
            jobId: created.id,
            alias,
            normalizedAlias: normalizeName(alias),
            source: "MANUAL" as const,
          })),
          skipDuplicates: true,
        });
      }

      await tx.jobActivityLog.create({
        data: {
          jobId: created.id,
          workspaceId,
          actorUserId: auth.userId,
          action: "JOB_CREATED",
          newValue: { jobNumber: body.jobNumber, name: body.name, status: body.status },
        },
      });

      return created;
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB",
      entityId: job.id,
      action: "job.created",
      metadata: { jobNumber: body.jobNumber, name: body.name },
      request,
    });

    return reply.code(201).send({ job });
  });

  // 3. GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail (lean core + metrics)
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId", async (request, reply) => {
    const t0 = performance.now();
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    const authMs = Math.round(performance.now() - t0);

    const tPrimary = performance.now();
    const job = await app.services.prisma.job.findFirst({
      where: { id: jobId, workspaceId },
      include: {
        customer: { select: { id: true, name: true } },
        estimator: { select: { id: true, name: true, email: true } },
        contractor: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        fabricationItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        members: {
          select: {
            id: true,
            userId: true,
            role: true,
            createdAt: true,
          },
        },
        aliases: {
          select: { id: true, alias: true, normalizedAlias: true, source: true, createdAt: true },
        },
      },
    });

    if (!job) {
      return reply.code(404).send({ message: "Job not found" });
    }
    const primaryQueryMs = Math.round(performance.now() - tPrimary);

    const now = new Date();
    const memberUserIds = job.members.map((m) => m.userId);
    const fabricationItems = job.fabricationItems.map(presentFabricationItem);
    const isBidding = job.status === "BIDDING";

    const tAgg = performance.now();
    // BIDDING: skip Schedule / Procurement / Deliveries / Billing aggregates (hidden modules).
    const emptySchedule = {
      upcoming: [] as Array<{
        id: string;
        name: string;
        typeLabel: string;
        plannedDate: string;
        workPackageName: string | null;
      }>,
      overdue: [] as Array<{
        id: string;
        name: string;
        typeLabel: string;
        plannedDate: string;
        workPackageName: string | null;
        daysOverdue: number;
      }>,
      upcomingCount: 0,
      overdueCount: 0,
      undatedOpenCount: 0,
    };
    const emptyProcurement = {
      needsOrderingCount: 0,
      atRiskCount: 0,
      pastExpectedCount: 0,
      orderedAmount: null as string | null,
    };
    const emptyDelivery = {
      plannedCount: 0,
      inTransitCount: 0,
      lateCount: 0,
      nextDelivery: null as null,
    };

    const [
      users,
      emailCount,
      openTasks,
      overdueTasks,
      participants,
      workPackageSummary,
      scheduleSummary,
      changesSummary,
      procurementSummary,
      deliverySummary,
      financialSnapshot,
      rfqSummary,
      nextDueTask,
      jobFileCount,
    ] = await Promise.all([
      memberUserIds.length
        ? app.services.prisma.user.findMany({
            where: { id: { in: memberUserIds } },
            select: { id: true, email: true, name: true, avatarUrl: true },
          })
        : Promise.resolve([]),
      app.services.prisma.emailMessage.count({ where: { jobId, workspaceId } }),
      app.services.prisma.task.count({
        where: { jobId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } },
      }),
      app.services.prisma.task.count({
        where: {
          jobId,
          status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
          dueAt: { lt: now },
        },
      }),
      listJobParticipants(app.services.prisma, { workspaceId, jobId }),
      app.services.prisma.jobWorkPackage
        .findMany({
          where: { workspaceId, jobId },
          select: {
            id: true,
            jobId: true,
            parentId: true,
            name: true,
            description: true,
            status: true,
            sortOrder: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
        .then((rows) => buildWorkPackageSummary(buildWorkPackageDtos(rows, []))),
      isBidding
        ? Promise.resolve(emptySchedule)
        : buildJobScheduleSummary(app.services.prisma, { workspaceId, jobId, now }),
      buildChangesSummary(app.services.prisma, { workspaceId, jobId, now }),
      isBidding
        ? Promise.resolve(emptyProcurement)
        : buildProcurementSummary(app.services.prisma, { workspaceId, jobId, now }),
      isBidding
        ? Promise.resolve(emptyDelivery)
        : buildDeliverySummary(app.services.prisma, { workspaceId, jobId, now }),
      isBidding
        ? Promise.resolve(null)
        : buildJobFinancialSnapshot(app.services.prisma, { workspaceId, jobId }),
      buildRfqSummary(app.services.prisma, { workspaceId, jobId }),
      app.services.prisma.task.findFirst({
        where: {
          jobId,
          status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
          dueAt: { not: null },
        },
        orderBy: { dueAt: "asc" },
        select: { dueAt: true },
      }),
      app.services.prisma.jobFile.count({
        where: { jobId, workspaceId, uploadStatus: "UPLOADED" },
      }),
    ]);
    const billingSnapshot =
      !isBidding && financialSnapshot
        ? await buildBillingSnapshot(app.services.prisma, {
            workspaceId,
            jobId,
            financial: financialSnapshot,
          })
        : null;
    const aggregateMs = Math.round(performance.now() - tAgg);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const projectManager = pickPrimaryProjectManager(participants);

    const mappedMembers = job.members.map((m) => {
      const u = userMap.get(m.userId);
      return {
        id: m.id,
        userId: m.userId,
        name: u?.name ?? null,
        email: u?.email ?? "",
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      };
    });

    const body = {
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        name: job.name,
        status: job.status,
        customerId: job.customerId,
        customerName: job.customer?.name ?? null,
        description: job.description,
        notes: job.notes,
        externalRef: job.externalRef,
        startDate: job.startDate?.toISOString() ?? null,
        targetCompletionDate: job.targetCompletionDate?.toISOString() ?? null,
        bidDueAt: job.bidDueAt?.toISOString() ?? null,
        totalCost: job.totalCost == null ? null : job.totalCost.toString(),
        originalContractValue:
          job.originalContractValue == null ? null : job.originalContractValue.toString(),
        originalEstimatedCost:
          job.originalEstimatedCost == null ? null : job.originalEstimatedCost.toString(),
        estimatedHours: totalEstimatedHours(fabricationItems),
        estimatorUserId: job.estimatorUserId,
        estimatorName: job.estimator?.name ?? null,
        contractorCustomerId: job.contractorCustomerId,
        contractorName: job.contractor?.name ?? null,
        clientCustomerId: job.clientCustomerId,
        clientName: job.client?.name ?? null,
        siteName: job.siteName,
        siteAddress1: job.siteAddress1,
        siteAddress2: job.siteAddress2,
        siteCity: job.siteCity,
        siteState: job.siteState,
        sitePostalCode: job.sitePostalCode,
        fabricationItems,
        archivedAt: job.archivedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        emailCount,
        openTaskCount: openTasks,
        overdueTaskCount: overdueTasks,
        nextDueDate: nextDueTask?.dueAt?.toISOString() ?? null,
        attachmentCount: jobFileCount,
        projectManager,
        participants,
        workPackageSummary,
        scheduleSummary,
        changesSummary,
        procurementSummary,
        deliverySummary,
        financialSnapshot,
        billingSnapshot,
        rfqSummary,
        members: mappedMembers,
        aliases: job.aliases.map((a) => ({
          id: a.id,
          alias: a.alias,
          normalizedAlias: a.normalizedAlias,
        })),
        assignedMembers: mappedMembers.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
        })),
      },
    };
    const payloadBytes = Buffer.byteLength(JSON.stringify(body));
    request.log.info({
      event: "api-performance",
      route: "jobs.detail",
      totalMs: Math.round(performance.now() - t0),
      authMs,
      primaryQueryMs,
      aggregateMs,
      payloadBytes,
    });

    return reply.send(body);
  });

  // 4. PUT /api/v1/workspaces/:workspaceId/jobs/:jobId — Update job
  app.put("/api/v1/workspaces/:workspaceId/jobs/:jobId", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const body = updateJobSchema.parse(request.body);

    if (body.jobNumber && body.jobNumber !== existing.jobNumber) {
      const dup = await app.services.prisma.job.findFirst({
        where: { workspaceId, jobNumber: body.jobNumber, id: { not: jobId } },
      });
      if (dup) {
        return reply.code(409).send({ message: "A job with this job number already exists in this workspace" });
      }
    }

    if (body.name && body.name !== existing.name) {
      const normalizedNew = normalizeName(body.name);
      const dup = await app.services.prisma.job.findFirst({
        where: { workspaceId, normalizedName: normalizedNew, id: { not: jobId } },
      });
      if (dup) {
        return reply.code(409).send({ message: "A job with this name already exists in this workspace" });
      }
    }

    const statusChanged = body.status && body.status !== existing.status;

    if (body.estimatorUserId) {
      const member = await app.services.prisma.membership.findFirst({
        where: { workspaceId, userId: body.estimatorUserId },
        select: { id: true },
      });
      if (!member) return reply.code(400).send({ message: "Estimator is not a member of this workspace" });
    }
    for (const customerId of [body.contractorCustomerId, body.clientCustomerId]) {
      if (!customerId) continue;
      const customer = await app.services.prisma.customer.findFirst({
        where: { id: customerId, workspaceId },
        select: { id: true },
      });
      if (!customer) return reply.code(400).send({ message: "Customer is not in this workspace" });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) { data.name = body.name; data.normalizedName = normalizeName(body.name); }
    if (body.jobNumber !== undefined) data.jobNumber = body.jobNumber;
    if (body.status !== undefined) data.status = body.status;
    if (body.customerId !== undefined) data.customerId = body.customerId;
    if (body.description !== undefined) data.description = body.description;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.targetCompletionDate !== undefined) data.targetCompletionDate = body.targetCompletionDate ? new Date(body.targetCompletionDate) : null;
    if (body.bidDueAt !== undefined) data.bidDueAt = body.bidDueAt ? new Date(body.bidDueAt) : null;
    if (body.totalCost !== undefined) data.totalCost = body.totalCost;
    if (body.originalContractValue !== undefined) {
      data.originalContractValue = normalizeFinancialMoney(body.originalContractValue);
    }
    if (body.originalEstimatedCost !== undefined) {
      data.originalEstimatedCost = normalizeFinancialMoney(body.originalEstimatedCost);
    }
    if (body.estimatorUserId !== undefined) data.estimatorUserId = body.estimatorUserId;
    if (body.contractorCustomerId !== undefined) data.contractorCustomerId = body.contractorCustomerId;
    if (body.clientCustomerId !== undefined) data.clientCustomerId = body.clientCustomerId;
    if (body.siteName !== undefined) data.siteName = body.siteName?.trim() || null;
    if (body.siteAddress1 !== undefined) data.siteAddress1 = body.siteAddress1?.trim() || null;
    if (body.siteAddress2 !== undefined) data.siteAddress2 = body.siteAddress2?.trim() || null;
    if (body.siteCity !== undefined) data.siteCity = body.siteCity?.trim() || null;
    if (body.siteState !== undefined) data.siteState = body.siteState?.trim() || null;
    if (body.sitePostalCode !== undefined) data.sitePostalCode = body.sitePostalCode?.trim() || null;

    const contractChanged =
      body.originalContractValue !== undefined &&
      financialMoneyToString(existing.originalContractValue) !==
        financialMoneyToString(body.originalContractValue === null ? null : body.originalContractValue);
    const estimatedCostChanged =
      body.originalEstimatedCost !== undefined &&
      financialMoneyToString(existing.originalEstimatedCost) !==
        financialMoneyToString(body.originalEstimatedCost === null ? null : body.originalEstimatedCost);

    const updated = await app.services.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id: jobId },
        data,
        include: {
          customer: { select: { id: true, name: true } },
          estimator: { select: { id: true, name: true, email: true } },
          contractor: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      });

      const nonFinancialKeys = Object.keys(data).filter(
        (k) => k !== "originalContractValue" && k !== "originalEstimatedCost"
      );
      if (statusChanged || nonFinancialKeys.length > 0) {
        const logData = Object.fromEntries(
          Object.entries(data).filter(
            ([k]) => k !== "originalContractValue" && k !== "originalEstimatedCost"
          )
        );
        await tx.jobActivityLog.create({
          data: {
            jobId,
            workspaceId,
            actorUserId: auth.userId,
            action: statusChanged ? "JOB_STATUS_CHANGED" : "JOB_UPDATED",
            previousValue: statusChanged
              ? ({ status: existing.status } as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            newValue: activityJson(statusChanged ? { status: body.status } : logData),
          },
        });
      }

      if (contractChanged) {
        await tx.jobActivityLog.create({
          data: {
            jobId,
            workspaceId,
            actorUserId: auth.userId,
            action: "ORIGINAL_CONTRACT_VALUE_UPDATED",
            previousValue: activityJson({
              originalContractValue: financialMoneyToString(existing.originalContractValue),
            }),
            newValue: activityJson({
              originalContractValue: financialMoneyToString(job.originalContractValue),
            }),
          },
        });
      }
      if (estimatedCostChanged) {
        await tx.jobActivityLog.create({
          data: {
            jobId,
            workspaceId,
            actorUserId: auth.userId,
            action: "ORIGINAL_ESTIMATED_COST_UPDATED",
            previousValue: activityJson({
              originalEstimatedCost: financialMoneyToString(existing.originalEstimatedCost),
            }),
            newValue: activityJson({
              originalEstimatedCost: financialMoneyToString(job.originalEstimatedCost),
            }),
          },
        });
      }

      return job;
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB",
      entityId: jobId,
      action: "job.updated",
      metadata: { fields: Object.keys(data) },
      request,
    });

    const financialSnapshot = await buildJobFinancialSnapshot(app.services.prisma, {
      workspaceId,
      jobId,
    });

    return reply.send({
      job: {
        ...updated,
        totalCost: updated.totalCost == null ? null : updated.totalCost.toString(),
        originalContractValue:
          updated.originalContractValue == null ? null : updated.originalContractValue.toString(),
        originalEstimatedCost:
          updated.originalEstimatedCost == null ? null : updated.originalEstimatedCost.toString(),
        estimatorName: updated.estimator?.name ?? null,
        contractorName: updated.contractor?.name ?? null,
        clientName: updated.client?.name ?? null,
        financialSnapshot,
      },
    });
  });

  // 5. POST /api/v1/workspaces/:workspaceId/jobs/:jobId/archive — Archive job
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/archive", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    if (existing.archivedAt) {
      return reply.code(409).send({ message: "Job is already archived" });
    }

    const job = await app.services.prisma.$transaction(async (tx) => {
      const archived = await tx.job.update({
        where: { id: jobId },
        data: { archivedAt: new Date(), status: "ARCHIVED" },
      });

      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "JOB_ARCHIVED",
          previousValue: { status: existing.status },
          newValue: { status: "ARCHIVED" },
        },
      });

      return archived;
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB",
      entityId: jobId,
      action: "job.archived",
      request,
    });

    return reply.send({ job });
  });

  // 6. POST /api/v1/workspaces/:workspaceId/jobs/:jobId/restore — Restore job
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/restore", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    if (!existing.archivedAt) {
      return reply.code(409).send({ message: "Job is not archived" });
    }

    const job = await app.services.prisma.$transaction(async (tx) => {
      const restored = await tx.job.update({
        where: { id: jobId },
        data: { archivedAt: null, status: "ACTIVE" },
      });

      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "JOB_RESTORED",
          previousValue: { status: "ARCHIVED" },
          newValue: { status: "ACTIVE" },
        },
      });

      return restored;
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB",
      entityId: jobId,
      action: "job.restored",
      request,
    });

    return reply.send({ job });
  });

  // 6b. DELETE /api/v1/workspaces/:workspaceId/jobs/:jobId — Permanent Job delete (OWNER)
  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canPermanentlyDeleteJob(auth.role, auth.workspaceRole)) {
      return reply.code(403).send({
        message: "Owner permission required to permanently delete a Job",
      });
    }

    const result = await deleteWorkspaceJob(app.services.prisma, {
      workspaceId,
      jobId,
    });
    if (!result.ok) {
      return reply.code(404).send({ message: "Job not found" });
    }

    for (const storageKey of result.storageKeys) {
      await bestEffortDeleteJobFileStorage(app, storageKey);
    }

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB",
      entityId: jobId,
      action: "job.deleted",
      metadata: {
        name: result.job.name,
        jobNumber: result.job.jobNumber,
        status: result.job.status,
      },
      request,
    });

    return reply.code(204).send();
  });

  // 7. POST /api/v1/workspaces/:workspaceId/jobs/:jobId/emails — Assign email to job
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/emails", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const body = z.object({
      messageId: z.string().optional(),
      threadId: z.string().optional(),
    }).refine((d) => d.messageId || d.threadId, { message: "Either messageId or threadId is required" })
      .parse(request.body);

    const now = new Date();

    if (body.threadId) {
      const threadId = body.threadId;
      const messages = await app.services.prisma.emailMessage.findMany({
        where: { workspaceId, threadId },
        select: { id: true, jobId: true },
      });

      if (messages.length === 0) {
        return reply.code(404).send({ message: "No messages found for this thread" });
      }

      await app.services.prisma.$transaction(async (tx) => {
        await tx.emailMessage.updateMany({
          where: { workspaceId, threadId },
          data: {
            jobId,
            jobAssignmentSource: "USER_ASSIGNED",
            jobAssignedAt: now,
            jobAssignedByUserId: auth.userId,
            jobAssignmentIsManual: true,
          },
        });
        const taskLink = tasksForEmailJobLink({
          workspaceId,
          sourceMessageIds: messages.map((row) => row.id),
          jobId,
        });
        if (taskLink) await tx.task.updateMany(taskLink);

        await tx.jobActivityLog.create({
          data: {
            jobId,
            workspaceId,
            actorUserId: auth.userId,
            action: "EMAIL_ASSIGNED",
            entityType: "THREAD",
            entityId: threadId,
            newValue: { threadId, messageCount: messages.length } as Prisma.InputJsonValue,
          },
        });
      });

      return reply.code(201).send({ assigned: messages.length, threadId });
    }

    const message = await app.services.prisma.emailMessage.findFirst({
      where: { id: body.messageId!, workspaceId },
      select: { id: true, jobId: true },
    });

    if (!message) {
      return reply.code(404).send({ message: "Email message not found" });
    }

    await app.services.prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({
        where: { id: message.id },
        data: {
          jobId,
          jobAssignmentSource: "USER_ASSIGNED",
          jobAssignedAt: now,
          jobAssignedByUserId: auth.userId,
          jobAssignmentIsManual: true,
        },
      });
      const taskLink = tasksForEmailJobLink({
        workspaceId,
        sourceMessageIds: [message.id],
        jobId,
      });
      if (taskLink) await tx.task.updateMany(taskLink);

      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "EMAIL_ASSIGNED",
          entityType: "EMAIL_MESSAGE",
          entityId: message.id,
        },
      });
    });

    return reply.code(201).send({ assigned: 1, messageId: message.id });
  });

  // 8. DELETE /api/v1/workspaces/:workspaceId/jobs/:jobId/emails/:messageId — Remove email from job
  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/emails/:messageId", async (request, reply) => {
    const params = z.object({
      workspaceId: z.string().min(1),
      jobId: z.string().min(1),
      messageId: z.string().min(1),
    }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, params.jobId, params.workspaceId);
    if (!existing) return;

    const message = await app.services.prisma.emailMessage.findFirst({
      where: { id: params.messageId, workspaceId: params.workspaceId, jobId: params.jobId },
    });

    if (!message) {
      return reply.code(404).send({ message: "Email message not found or not assigned to this job" });
    }

    await app.services.prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({
        where: { id: params.messageId },
        data: {
          jobId: null,
          jobMatchConfidence: null,
          jobMatchEvidence: Prisma.JsonNull,
          jobAssignmentSource: null,
          jobAssignedAt: null,
          jobAssignedByUserId: null,
          jobAssignmentIsManual: false,
        },
      });
      const taskLink = tasksForEmailJobLink({
        workspaceId: params.workspaceId,
        sourceMessageIds: [params.messageId],
        jobId: null,
      });
      if (taskLink) await tx.task.updateMany(taskLink);

      await tx.jobActivityLog.create({
        data: {
          jobId: params.jobId,
          workspaceId: params.workspaceId,
          actorUserId: auth.userId,
          action: "EMAIL_REMOVED",
          entityType: "EMAIL_MESSAGE",
          entityId: params.messageId,
        },
      });
    });

    return reply.code(204).send();
  });

  /**
   * Delete one Job email from ForgeOps. The Job and sibling messages stay.
   * Does not delete the message at the mail provider.
   * Does not move the mailbox clear watermark.
   */
  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/emails/:messageId/delete",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        jobId: z.string().min(1),
        messageId: z.string().min(1),
      }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEdit(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }

      const existing = await loadJobWithTenantCheck(app, reply, params.jobId, params.workspaceId);
      if (!existing) return;

      const message = await app.services.prisma.emailMessage.findFirst({
        where: { id: params.messageId, workspaceId: params.workspaceId, jobId: params.jobId },
        select: { id: true, threadId: true },
      });
      if (!message) {
        return reply.code(404).send({ message: "Email message not found or not assigned to this job" });
      }

      await app.services.prisma.$transaction(async (tx) => {
        await tx.jobActivityLog.create({
          data: {
            jobId: params.jobId,
            workspaceId: params.workspaceId,
            actorUserId: auth.userId,
            action: "EMAIL_REMOVED",
            entityType: "EMAIL_MESSAGE",
            entityId: message.id,
            newValue: { deleted: true },
          },
        });
        await deleteScopedEmailMessages(tx, {
          where: {
            id: message.id,
            workspaceId: params.workspaceId,
            jobId: params.jobId,
          },
          emptyThreadWhere: {
            id: message.threadId,
            workspaceId: params.workspaceId,
            messages: { none: {} },
          },
        });
      });

      return reply.send({ status: "deleted", messageId: message.id, jobId: params.jobId });
    }
  );

  // 9. POST /api/v1/workspaces/:workspaceId/jobs/:jobId/emails/move — Reassign email
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/emails/move", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const body = z.object({
      messageId: z.string().min(1),
      targetJobId: z.string().min(1),
    }).parse(request.body);

    const targetJob = await app.services.prisma.job.findFirst({
      where: { id: body.targetJobId, workspaceId },
    });
    if (!targetJob) {
      return reply.code(404).send({ message: "Target job not found in this workspace" });
    }

    const message = await app.services.prisma.emailMessage.findFirst({
      where: { id: body.messageId, workspaceId, jobId },
    });
    if (!message) {
      return reply.code(404).send({ message: "Email message not found or not assigned to this job" });
    }

    const now = new Date();

    await app.services.prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({
        where: { id: body.messageId },
        data: {
          jobId: body.targetJobId,
          jobAssignmentSource: "USER_ASSIGNED",
          jobAssignedAt: now,
          jobAssignedByUserId: auth.userId,
          jobAssignmentIsManual: true,
        },
      });
      const taskLink = tasksForEmailJobLink({
        workspaceId,
        sourceMessageIds: [body.messageId],
        jobId: body.targetJobId,
      });
      if (taskLink) await tx.task.updateMany(taskLink);

      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "EMAIL_REASSIGNED",
          entityType: "EMAIL_MESSAGE",
          entityId: body.messageId,
          previousValue: { jobId },
          newValue: { jobId: body.targetJobId },
        },
      });

      await tx.jobActivityLog.create({
        data: {
          jobId: body.targetJobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "EMAIL_ASSIGNED",
          entityType: "EMAIL_MESSAGE",
          entityId: body.messageId,
          previousValue: { jobId },
          newValue: { jobId: body.targetJobId },
        },
      });
    });

    return reply.send({ messageId: body.messageId, fromJobId: jobId, toJobId: body.targetJobId });
  });

  // 10. GET /api/v1/workspaces/:workspaceId/jobs/:jobId/emails — List job emails
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/emails", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const query = emailListQuery.parse(request.query);
    const skip = (query.page - 1) * query.pageSize;

    const where: Record<string, unknown> = { jobId, workspaceId };
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: "insensitive" } },
        { senderEmail: { contains: query.search, mode: "insensitive" } },
        { senderName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.emailType) {
      where.mailboxCategory = query.emailType;
    }

    const [messages, totalCount] = await Promise.all([
      app.services.prisma.emailMessage.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { sentAt: "desc" },
        select: {
          id: true,
          threadId: true,
          inboxConnectionId: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          sentAt: true,
          receivedAt: true,
          snippet: true,
          hasAttachments: true,
          isRead: true,
          mailboxCategory: true,
          jobMatchConfidence: true,
          jobAssignmentSource: true,
          jobAssignmentIsManual: true,
          jobAssignedAt: true,
        },
      }),
      app.services.prisma.emailMessage.count({ where }),
    ]);

    return reply.send({
      emails: messages,
      pagination: { page: query.page, pageSize: query.pageSize, totalCount, totalPages: Math.ceil(totalCount / query.pageSize) },
    });
  });

  // 11. GET /api/v1/workspaces/:workspaceId/jobs/:jobId/tasks — List job tasks
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/tasks", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const query = z
      .object({
        statusFilter: z.enum(["OPEN", "COMPLETED", "ALL"]).optional().default("OPEN"),
        due: z
          .enum(["ALL", "OVERDUE", "TODAY", "WEEK", "MONTH", "NONE"])
          .optional()
          .default("ALL"),
        priority: z
          .enum(["ALL", "LOW", "NORMAL", "HIGH", "URGENT"])
          .optional()
          .default("ALL"),
        source: z.enum(["ALL", "EMAIL", "MANUAL"]).optional().default("ALL"),
        emailClassification: z
          .enum(["ALL", "BUSINESS", "PERSONAL", "UNCLASSIFIED"])
          .optional()
          .default("ALL"),
        businessTypeKey: z.enum(BUSINESS_SUBTYPE_KEYS).optional(),
        sender: z.string().trim().max(200).optional(),
        sort: z
          .enum(["DUE_DATE", "NEWEST", "OLDEST", "PRIORITY"])
          .optional()
          .default("DUE_DATE"),
        timezone: z.string().min(1).max(80).optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(50),
      })
      .parse(request.query ?? {});

    const where = buildOperationalTasksWhere({
      workspaceId,
      jobId,
      // Job scope already implies association — still exclude unassigned bidding
      // orphans that somehow have Task.jobId set incorrectly? Prefer include all
      // tasks for this Job.jobId so BIDDING Job workflow works.
      excludeUnassignedBidding: false,
      status: query.statusFilter as TaskStatusFilter,
      due: query.due as TaskDueFilter,
      priority: query.priority as TaskPriorityFilter,
      source: query.source as TaskSourceFilter,
      emailClassification:
        query.emailClassification as TaskEmailClassificationFilter,
      ...(query.businessTypeKey
        ? { businessTypeKey: query.businessTypeKey }
        : {}),
      ...(query.sender ? { sender: query.sender } : {}),
      timezone: query.timezone || "UTC",
    });

    const skip = (query.page - 1) * query.pageSize;
    const taskRows = await app.services.prisma.task.findMany({
      where,
      orderBy: taskListOrderBy(query.sort as TaskSort),
      skip,
      take: query.pageSize + 1,
      select: {
        id: true,
        title: true,
        summary: true,
        description: true,
        dueAt: true,
        priority: true,
        status: true,
        assigneeUserId: true,
        completedAt: true,
        createdAt: true,
        sourceMessageId: true,
        sourceMessage: {
          select: {
            id: true,
            subject: true,
            senderName: true,
            senderEmail: true,
            sentAt: true,
            receivedAt: true,
            mailboxCategory: true,
            priority: true,
            jobId: true,
            job: { select: { id: true, jobNumber: true, name: true } },
            inboxConnectionId: true,
            classifications: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { businessTypeKey: true },
            },
          },
        },
        classification: { select: { businessTypeKey: true } },
      },
    });
    const hasMore = taskRows.length > query.pageSize;
    const tasks = hasMore ? taskRows.slice(0, query.pageSize) : taskRows;
    const exactCount = skip + tasks.length;
    const totalCount = hasMore ? null : exactCount;
    const totalPages = hasMore
      ? null
      : exactCount === 0
        ? 0
        : Math.ceil(exactCount / query.pageSize);

    const toApiPriority = (p: string | null | undefined) =>
      p === "MEDIUM" ? "NORMAL" : p ?? null;

    return reply.send({
      tasks: tasks.map((t) => {
        const msg = t.sourceMessage;
        const subtype =
          t.classification?.businessTypeKey ??
          msg?.classifications[0]?.businessTypeKey ??
          null;
        return {
          id: t.id,
          title: t.title,
          summary: t.summary,
          description: t.description,
          dueAt: t.dueAt?.toISOString() ?? null,
          priority: toApiPriority(t.priority) ?? "NORMAL",
          status: t.status,
          assigneeUserId: t.assigneeUserId,
          completedAt: t.completedAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
          sourceEmail: msg
            ? {
                id: msg.id,
                subject: msg.subject,
                senderName: msg.senderName,
                senderAddress: msg.senderEmail,
                sentAt: msg.sentAt?.toISOString() ?? null,
                receivedAt: msg.receivedAt?.toISOString() ?? null,
                mailboxCategory: msg.mailboxCategory ?? null,
                businessSubtype: subtype,
                priority: toApiPriority(msg.priority),
                jobId: msg.jobId ?? msg.job?.id ?? null,
                jobNumber: msg.job?.jobNumber ?? null,
                jobName: msg.job?.name ?? null,
                inboxConnectionId: msg.inboxConnectionId ?? null,
              }
            : null,
        };
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount,
        totalPages,
        hasMore,
      },
      filters: {
        statusFilter: query.statusFilter,
        due: query.due,
        priority: query.priority,
        source: query.source,
        emailClassification: query.emailClassification,
        businessTypeKey: query.businessTypeKey ?? null,
        sender: query.sender ?? null,
        sort: query.sort,
      },
    });
  });

  // 12. GET /api/v1/workspaces/:workspaceId/jobs/:jobId/documents
  // Unified Job file library: email attachments + direct JobFile uploads (metadata only).
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/documents", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const query = z
      .object({
        type: z.enum(JOB_FILE_TYPE_FILTERS).optional().default("ALL"),
        sort: z
          .enum(["newest", "oldest", "name", "type", "documentDate"])
          .optional()
          .default("newest"),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(200).default(100),
        imageRelevance: z.enum(IMAGE_RELEVANCE_FILTERS).optional().default("ALL"),
        docCategory: z.enum(DOCUMENT_CATEGORY_FILTERS).optional().default("ALL"),
        controlState: z.enum(DOCUMENT_CONTROL_STATE_FILTERS).optional().default("ALL"),
        q: z.string().trim().max(200).optional(),
      })
      .parse(request.query ?? {});

    const [attachments, jobUploads] = await Promise.all([
      app.services.prisma.emailAttachment.findMany({
        where: {
          workspaceId,
          emailMessage: { jobId, workspaceId },
          uploadStatus: "UPLOADED",
        },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          isInline: true,
          createdAt: true,
          emailMessage: {
            select: {
              id: true,
              subject: true,
              senderEmail: true,
              senderName: true,
              receivedAt: true,
              sentAt: true,
            },
          },
        },
      }),
      app.services.prisma.jobFile.findMany({
        where: {
          workspaceId,
          jobId,
          uploadStatus: "UPLOADED",
        },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          folderId: true,
        },
      }),
    ]);

    type LibraryFile = {
      id: string;
      filename: string;
      mimeType: string;
      extension: string;
      sizeBytes: number;
      date: string;
      sourceType: "EMAIL_ATTACHMENT" | "JOB_UPLOAD";
      fileType: ReturnType<typeof classifyJobFileType>;
      emailId: string | null;
      emailSubject: string | null;
      sender: string | null;
      folderId: string | null;
      previewable: boolean;
      imageRelevance: ReturnType<typeof serializeRelevanceRow> | null;
      control: Awaited<ReturnType<typeof loadDocumentControlsForSources>> extends Map<
        string,
        infer V
      >
        ? V | null
        : null;
    };

    const libraryAttachments = attachments.filter((a) =>
      includeEmailAttachmentInJobLibrary({
        isInline: a.isInline,
        mimeType: a.mimeType,
        filename: a.filename,
      })
    );

    // One batched relevance lookup for email-attachment images on this job (no N+1).
    const imageAttachmentIds = libraryAttachments
      .filter((a) => classifyJobFileType(a.mimeType, a.filename) === "IMAGES")
      .map((a) => a.id);

    const [relevanceRows, controlMap] = await Promise.all([
      imageAttachmentIds.length === 0
        ? Promise.resolve([])
        : app.services.prisma.inlineImageRelevanceClassification.findMany({
            where: {
              workspaceId,
              analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
              emailAttachmentId: { in: imageAttachmentIds },
            },
            select: {
              emailAttachmentId: true,
              relevance: true,
              noiseReason: true,
              confidence: true,
              method: true,
              analyzerVersion: true,
              evidence: true,
              analyzedAt: true,
              correctedAt: true,
              priorRelevance: true,
              priorMethod: true,
            },
          }),
      loadDocumentControlsForSources(app.services.prisma, {
        workspaceId,
        jobId,
        jobFileIds: jobUploads.map((f) => f.id),
        emailAttachmentIds: libraryAttachments.map((a) => a.id),
      }),
    ]);
    const relevanceByAttachmentId = new Map(
      relevanceRows.map((row) => [row.emailAttachmentId, serializeRelevanceRow(row)])
    );

    const files: LibraryFile[] = [
      ...libraryAttachments.map((a) => {
        const date =
          a.emailMessage.receivedAt ?? a.emailMessage.sentAt ?? a.createdAt;
        const fileType = classifyJobFileType(a.mimeType, a.filename);
        return {
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          extension: fileExtension(a.filename),
          sizeBytes: a.sizeBytes,
          date: date.toISOString(),
          sourceType: "EMAIL_ATTACHMENT" as const,
          fileType,
          emailId: a.emailMessage.id,
          emailSubject: a.emailMessage.subject,
          sender:
            a.emailMessage.senderName?.trim() ||
            a.emailMessage.senderEmail ||
            null,
          folderId: null,
          previewable: canPreviewFile({ filename: a.filename, contentType: a.mimeType }),
          imageRelevance:
            fileType === "IMAGES" ? relevanceByAttachmentId.get(a.id) ?? null : null,
          control: controlMap.get(`EMAIL_ATTACHMENT:${a.id}`) ?? null,
        };
      }),
      ...jobUploads.map((f) => ({
        id: f.id,
        filename: f.filename,
        mimeType: f.mimeType,
        extension: fileExtension(f.filename),
        sizeBytes: f.sizeBytes,
        date: f.createdAt.toISOString(),
        sourceType: "JOB_UPLOAD" as const,
        fileType: classifyJobFileType(f.mimeType, f.filename),
        emailId: null,
        emailSubject: null,
        sender: null,
        folderId: f.folderId,
        previewable: canPreviewFile({ filename: f.filename, contentType: f.mimeType }),
        imageRelevance: null,
        control: controlMap.get(`JOB_UPLOAD:${f.id}`) ?? null,
      })),
    ];

    const typeFilter = query.type as JobFileTypeFilter;
    const relevanceFilter = query.imageRelevance;
    const docCategory = query.docCategory as DocumentCategoryFilter;
    const controlState = query.controlState as DocumentControlStateFilter;
    const search = query.q?.toLowerCase() ?? "";

    let filtered =
      typeFilter === "ALL"
        ? files
        : files.filter((f) => f.fileType === typeFilter);

    if (relevanceFilter !== "ALL") {
      filtered = filtered.filter((f) => {
        if (f.fileType !== "IMAGES" || f.sourceType !== "EMAIL_ATTACHMENT") return false;
        if (relevanceFilter === "NOT_ANALYZED") return f.imageRelevance == null;
        return f.imageRelevance?.relevance === relevanceFilter;
      });
    }

    if (docCategory !== "ALL") {
      filtered = filtered.filter((f) =>
        documentMatchesCategory(f.control?.documentType, docCategory)
      );
    }

    if (controlState === "UNCLASSIFIED") {
      filtered = filtered.filter((f) => f.control == null);
    } else if (controlState === "CURRENT") {
      filtered = filtered.filter((f) => f.control?.isCurrent === true);
    } else if (controlState === "SUPERSEDED") {
      filtered = filtered.filter((f) => f.control != null && !f.control.isCurrent);
    }

    if (search) {
      filtered = filtered.filter((f) => {
        const hay = [
          f.filename,
          f.emailSubject,
          f.sender,
          f.control?.documentNumber,
          f.control?.title,
          f.control?.revision,
          f.control?.documentTypeLabel,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(search);
      });
    }

    filtered.sort((a, b) => {
      if (query.sort === "name") {
        return a.filename.localeCompare(b.filename) || a.id.localeCompare(b.id);
      }
      if (query.sort === "type") {
        const at = a.control?.documentTypeLabel ?? "Unclassified";
        const bt = b.control?.documentTypeLabel ?? "Unclassified";
        return at.localeCompare(bt) || a.filename.localeCompare(b.filename);
      }
      if (query.sort === "documentDate") {
        const ad = a.control?.documentDate ?? "";
        const bd = b.control?.documentDate ?? "";
        if (ad !== bd) {
          if (!ad) return 1;
          if (!bd) return -1;
          return ad < bd ? 1 : -1;
        }
        return a.filename.localeCompare(b.filename);
      }
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
      return query.sort === "oldest" ? diff : -diff;
    });

    const totalCount = filtered.length;
    const skip = (query.page - 1) * query.pageSize;
    const pageFiles = filtered.slice(skip, skip + query.pageSize);

    const imageFiles = files.filter(
      (f) => f.fileType === "IMAGES" && f.sourceType === "EMAIL_ATTACHMENT"
    );
    const imageRelevanceCounts = {
      all: imageFiles.length,
      relevant: imageFiles.filter((f) => f.imageRelevance?.relevance === "RELEVANT").length,
      noise: imageFiles.filter((f) => f.imageRelevance?.relevance === "NOISE").length,
      uncertain: imageFiles.filter((f) => f.imageRelevance?.relevance === "UNCERTAIN").length,
      notAnalyzed: imageFiles.filter((f) => f.imageRelevance == null).length,
    };

    // Backward-compatible `documents` = email attachments only (legacy shape).
    const documents = libraryAttachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
      emailSubject: a.emailMessage.subject,
      emailSenderEmail: a.emailMessage.senderEmail,
      emailMessageId: a.emailMessage.id,
      source: "email" as const,
    }));

    return reply.send({
      files: pageFiles,
      documents,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / query.pageSize)),
      },
      filters: {
        type: typeFilter,
        sort: query.sort,
        imageRelevance: relevanceFilter,
        docCategory,
        controlState,
        q: query.q ?? null,
      },
      imageRelevanceCounts,
    });
  });

  // 13. GET /api/v1/workspaces/:workspaceId/jobs/:jobId/activity — Activity log
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/activity", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const query = paginationQuery.parse(request.query);
    const skip = (query.page - 1) * query.pageSize;

    const [entries, totalCount] = await Promise.all([
      app.services.prisma.jobActivityLog.findMany({
        where: { jobId, workspaceId },
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize,
      }),
      app.services.prisma.jobActivityLog.count({ where: { jobId, workspaceId } }),
    ]);

    const actorIds = [...new Set(entries.map((e) => e.actorUserId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await app.services.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, name: true, avatarUrl: true },
        })
      : [];
    const actorMap = new Map(actors.map((u) => [u.id, u]));

    return reply.send({
      activity: entries.map((e) => ({
        ...e,
        actor: e.actorUserId ? actorMap.get(e.actorUserId) ?? null : null,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, totalCount, totalPages: Math.ceil(totalCount / query.pageSize) },
    });
  });

  // 14. POST /api/v1/workspaces/:workspaceId/jobs/:jobId/members — Add member
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/members", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const body = z.object({
      userId: z.string().min(1),
      role: z.string().max(50).optional(),
    }).parse(request.body);

    const membership = await app.services.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: body.userId } },
    });
    if (!membership) {
      return reply.code(400).send({ message: "User is not a member of this workspace" });
    }

    const existingMember = await app.services.prisma.jobMember.findUnique({
      where: { jobId_userId: { jobId, userId: body.userId } },
    });
    if (existingMember) {
      return reply.code(409).send({ message: "User is already a member of this job" });
    }

    const member = await app.services.prisma.$transaction(async (tx) => {
      const created = await tx.jobMember.create({
        data: { jobId, userId: body.userId, role: body.role ?? null },
      });

      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "MEMBER_ADDED",
          entityType: "USER",
          entityId: body.userId,
          newValue: { userId: body.userId, role: body.role ?? null },
        },
      });

      return created;
    });

    return reply.code(201).send({ member });
  });

  // 15. DELETE /api/v1/workspaces/:workspaceId/jobs/:jobId/members/:userId — Remove member
  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/members/:userId", async (request, reply) => {
    const params = z.object({
      workspaceId: z.string().min(1),
      jobId: z.string().min(1),
      userId: z.string().min(1),
    }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, params.jobId, params.workspaceId);
    if (!existing) return;

    const member = await app.services.prisma.jobMember.findUnique({
      where: { jobId_userId: { jobId: params.jobId, userId: params.userId } },
    });
    if (!member) {
      return reply.code(404).send({ message: "Member not found on this job" });
    }

    await app.services.prisma.$transaction(async (tx) => {
      await tx.jobMember.delete({
        where: { jobId_userId: { jobId: params.jobId, userId: params.userId } },
      });

      await tx.jobActivityLog.create({
        data: {
          jobId: params.jobId,
          workspaceId: params.workspaceId,
          actorUserId: auth.userId,
          action: "MEMBER_REMOVED",
          entityType: "USER",
          entityId: params.userId,
          previousValue: { userId: params.userId, role: member.role },
        },
      });
    });

    return reply.code(204).send();
  });

  // 16. POST /api/v1/workspaces/:workspaceId/jobs/:jobId/aliases — Add alias
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/aliases", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const body = z.object({
      alias: z.string().min(1).max(300),
    }).parse(request.body);

    const normalizedAlias = normalizeName(body.alias);

    const existingAlias = await app.services.prisma.entityAlias.findUnique({
      where: { workspaceId_entityType_normalizedAlias: { workspaceId, entityType: "JOB", normalizedAlias } },
    });
    if (existingAlias) {
      return reply.code(409).send({ message: "This alias already exists" });
    }

    const alias = await app.services.prisma.$transaction(async (tx) => {
      const created = await tx.entityAlias.create({
        data: {
          workspaceId,
          entityType: "JOB",
          jobId,
          alias: body.alias,
          normalizedAlias,
          source: "MANUAL",
        },
      });

      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: "ALIAS_ADDED",
          entityType: "ENTITY_ALIAS",
          entityId: created.id,
          newValue: { alias: body.alias },
        },
      });

      return created;
    });

    return reply.code(201).send({ alias });
  });

  // 17. DELETE /api/v1/workspaces/:workspaceId/jobs/:jobId/aliases/:aliasId — Remove alias
  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/aliases/:aliasId", async (request, reply) => {
    const params = z.object({
      workspaceId: z.string().min(1),
      jobId: z.string().min(1),
      aliasId: z.string().min(1),
    }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const existing = await loadJobWithTenantCheck(app, reply, params.jobId, params.workspaceId);
    if (!existing) return;

    const alias = await app.services.prisma.entityAlias.findFirst({
      where: { id: params.aliasId, workspaceId: params.workspaceId, jobId: params.jobId, entityType: "JOB" },
    });
    if (!alias) {
      return reply.code(404).send({ message: "Alias not found on this job" });
    }

    await app.services.prisma.$transaction(async (tx) => {
      await tx.entityAlias.delete({ where: { id: params.aliasId } });

      await tx.jobActivityLog.create({
        data: {
          jobId: params.jobId,
          workspaceId: params.workspaceId,
          actorUserId: auth.userId,
          action: "ALIAS_REMOVED",
          entityType: "ENTITY_ALIAS",
          entityId: params.aliasId,
          previousValue: { alias: alias.alias },
        },
      });
    });

    return reply.code(204).send();
  });
};
