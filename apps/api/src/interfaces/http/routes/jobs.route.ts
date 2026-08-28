import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeName } from "@forgeops/shared";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

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
  sortBy: z.enum(["name", "jobNumber", "status", "createdAt", "updatedAt", "startDate", "targetCompletionDate"]).default("createdAt"),
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

const updateJobSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  jobNumber: z.string().min(1).max(100).optional(),
  status: z.enum(["LEAD", "BIDDING", "AWARDED", "ACTIVE", "ON_HOLD", "COMPLETE", "ARCHIVED", "COMPLETED", "CANCELLED"]).optional(),
  customerId: z.string().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  targetCompletionDate: z.string().datetime().nullable().optional(),
});

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
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { jobNumber: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const LOOKUP_LIMIT = 500;
    const jobs = await app.services.prisma.job.findMany({
      where,
      orderBy: { name: "asc" },
      take: LOOKUP_LIMIT,
      select: { id: true, jobNumber: true, name: true, status: true },
    });

    return reply.send({ jobs });
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

    const where: Record<string, unknown> = { workspaceId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (!query.showArchived) {
      where.archivedAt = null;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { jobNumber: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.assignedUserId) {
      where.members = { some: { userId: query.assignedUserId } };
    }
    // Push overdue filter into SQL so pagination/totals stay correct
    if (query.hasOverdueTasks) {
      where.tasks = {
        some: {
          status: { in: [...openTaskStatuses] },
          dueAt: { lt: now },
        },
      };
    }

    const tDb = performance.now();
    const [jobs, totalCount] = await Promise.all([
      app.services.prisma.job.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { [query.sortBy]: query.sortDir },
        select: {
          id: true,
          jobNumber: true,
          name: true,
          status: true,
          customerId: true,
          startDate: true,
          targetCompletionDate: true,
          archivedAt: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
          members: {
            select: { id: true, userId: true, role: true, createdAt: true },
            take: 10,
          },
          _count: { select: { assignedEmails: true } },
        },
      }),
      app.services.prisma.job.count({ where }),
    ]);

    const jobIds = jobs.map((j) => j.id);

    const [memberUsers, openTaskGroups, overdueTaskGroups, nextDueGroups, lastActivities] =
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
            app.services.prisma.jobActivityLog.findMany({
              where: { jobId: { in: jobIds } },
              orderBy: { createdAt: "desc" },
              distinct: ["jobId"],
              select: { jobId: true, createdAt: true },
            }),
          ]);
    const dbMs = Math.round(performance.now() - tDb);

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
    const lastActivityByJob = new Map(
      lastActivities.map((a) => [a.jobId, a.createdAt])
    );

    const enriched = jobs.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      name: job.name,
      status: job.status,
      customerId: job.customerId,
      customerName: job.customer?.name ?? null,
      description: null as string | null,
      startDate: job.startDate,
      targetCompletionDate: job.targetCompletionDate,
      archivedAt: job.archivedAt,
      createdAt: job.createdAt,
      emailCount: job._count.assignedEmails,
      openTaskCount: openCountByJob.get(job.id) ?? 0,
      overdueTaskCount: overdueCountByJob.get(job.id) ?? 0,
      lastActivityAt: lastActivityByJob.get(job.id) ?? null,
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
      dbMs,
      serializationMs: 0,
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

  // 3. GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const job = await app.services.prisma.job.findFirst({
      where: { id: jobId, workspaceId },
      include: {
        customer: { select: { id: true, name: true } },
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

    const memberUserIds = job.members.map((m) => m.userId);
    const users = memberUserIds.length
      ? await app.services.prisma.user.findMany({
          where: { id: { in: memberUserIds } },
          select: { id: true, email: true, name: true, avatarUrl: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      emailCount,
      openTasks,
      overdueTasks,
      completedTasks,
      recentEmails7d,
      recentEmails30d,
      lastActivity,
      nextDueTask,
      attachmentCount,
    ] = await Promise.all([
      app.services.prisma.emailMessage.count({ where: { jobId, workspaceId } }),
      app.services.prisma.task.count({ where: { jobId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } } }),
      app.services.prisma.task.count({
        where: { jobId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] }, dueAt: { lt: now } },
      }),
      app.services.prisma.task.count({ where: { jobId, status: "DONE" } }),
      app.services.prisma.emailMessage.count({ where: { jobId, workspaceId, sentAt: { gte: sevenDaysAgo } } }),
      app.services.prisma.emailMessage.count({ where: { jobId, workspaceId, sentAt: { gte: thirtyDaysAgo } } }),
      app.services.prisma.jobActivityLog.findFirst({
        where: { jobId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      app.services.prisma.task.findFirst({
        where: { jobId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] }, dueAt: { not: null } },
        orderBy: { dueAt: "asc" },
        select: { dueAt: true },
      }),
      app.services.prisma.emailAttachment.count({
        where: { emailMessage: { jobId, workspaceId } },
      }),
    ]);

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

    return reply.send({
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
        archivedAt: job.archivedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        emailCount,
        openTaskCount: openTasks,
        overdueTaskCount: overdueTasks,
        completedTaskCount: completedTasks,
        recentEmails7d,
        recentEmails30d,
        lastActivityAt: lastActivity?.createdAt?.toISOString() ?? null,
        nextDueDate: nextDueTask?.dueAt?.toISOString() ?? null,
        attachmentCount,
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
    });
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

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) { data.name = body.name; data.normalizedName = normalizeName(body.name); }
    if (body.jobNumber !== undefined) data.jobNumber = body.jobNumber;
    if (body.status !== undefined) data.status = body.status;
    if (body.customerId !== undefined) data.customerId = body.customerId;
    if (body.description !== undefined) data.description = body.description;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.targetCompletionDate !== undefined) data.targetCompletionDate = body.targetCompletionDate ? new Date(body.targetCompletionDate) : null;

    const updated = await app.services.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id: jobId },
        data,
        include: { customer: { select: { id: true, name: true } } },
      });

      await tx.jobActivityLog.create({
        data: {
          jobId,
          workspaceId,
          actorUserId: auth.userId,
          action: statusChanged ? "JOB_STATUS_CHANGED" : "JOB_UPDATED",
          previousValue: statusChanged
            ? ({ status: existing.status } as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          newValue: (statusChanged ? { status: body.status } : data) as Prisma.InputJsonValue,
        },
      });

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

    return reply.send({ job: updated });
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

    const tasks = await app.services.prisma.task.findMany({
      where: { jobId, workspaceId },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
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
      },
    });

    return reply.send({ tasks });
  });

  // 12. GET /api/v1/workspaces/:workspaceId/jobs/:jobId/documents — List job documents
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/documents", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const existing = await loadJobWithTenantCheck(app, reply, jobId, workspaceId);
    if (!existing) return;

    const attachments = await app.services.prisma.emailAttachment.findMany({
      where: {
        emailMessage: { jobId, workspaceId },
        isInline: false,
        uploadStatus: "UPLOADED",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        emailMessage: {
          select: {
            id: true,
            subject: true,
            senderEmail: true,
            sentAt: true,
          },
        },
      },
    });

    return reply.send({
      documents: attachments.map(a => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        emailSubject: a.emailMessage.subject,
        emailSenderEmail: a.emailMessage.senderEmail,
        emailMessageId: a.emailMessage.id,
        source: "email" as const,
      })),
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
