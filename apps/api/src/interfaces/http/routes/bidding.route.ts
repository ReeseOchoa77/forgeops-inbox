import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeName, tasksForEmailJobLink } from "@forgeops/shared";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";
import {
  ACTIVE_BID_STATUS,
  USER_BID_ASSIGNMENT,
  assignmentAllowed,
  biddingSummary,
  presentBiddingList,
  statusAfterRemoveFromBidding,
  threadJobConflicts,
  type BiddingActivityStats,
  type BiddingDueFilter,
  type BiddingSort,
} from "../../../application/services/bidding.js";

const wsParams = z.object({ workspaceId: z.string().min(1) });
const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const bidDate = z.union([
  z.string().datetime(),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
]);

async function requireAuth(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    reply.code(401).send({ message: "Authentication required" });
    return null;
  }
  const membership = await requireWorkspaceMembership(
    app.services.prisma,
    session.userId,
    workspaceId
  );
  if (!membership) {
    reply.code(403).send({ message: "Workspace access denied" });
    return null;
  }
  return {
    userId: session.userId,
    workspaceRole: membership.workspaceRole,
  };
}

function canEdit(workspaceRole: string): boolean {
  return workspaceRole === "OWNER" || workspaceRole === "EDITOR";
}

function parseBidDue(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
  return new Date(value);
}

type ActivityRow = {
  jobId: string;
  emailCount: number;
  threadCount: number;
  unreadCount: number;
  lastActivityAt: Date | null;
  recentSender: string | null;
};

async function loadBidActivity(
  prisma: FastifyInstance["services"]["prisma"],
  workspaceId: string,
  jobIds: string[]
): Promise<Map<string, ActivityRow>> {
  const map = new Map<string, ActivityRow>();
  if (jobIds.length === 0) return map;
  const rows = await prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
    SELECT
      stats."jobId" AS "jobId",
      stats."emailCount" AS "emailCount",
      stats."threadCount" AS "threadCount",
      stats."unreadCount" AS "unreadCount",
      stats."lastActivityAt" AS "lastActivityAt",
      latest."recentSender" AS "recentSender"
    FROM (
      SELECT
        "jobId",
        COUNT(*)::int AS "emailCount",
        COUNT(DISTINCT "threadId")::int AS "threadCount",
        COUNT(*) FILTER (WHERE "isRead" = false)::int AS "unreadCount",
        MAX(COALESCE("receivedAt", "sentAt")) AS "lastActivityAt"
      FROM "EmailMessage"
      WHERE "workspaceId" = ${workspaceId}
        AND "jobId" IN (${Prisma.join(jobIds)})
        AND "isTrashed" = false
      GROUP BY "jobId"
    ) stats
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF("senderName", ''), "senderEmail") AS "recentSender"
      FROM "EmailMessage" m
      WHERE m."workspaceId" = ${workspaceId}
        AND m."jobId" = stats."jobId"
        AND m."isTrashed" = false
      ORDER BY COALESCE(m."receivedAt", m."sentAt") DESC
      LIMIT 1
    ) latest ON true
  `);
  for (const row of rows) {
    map.set(row.jobId, {
      ...row,
      emailCount: Number(row.emailCount),
      threadCount: Number(row.threadCount),
      unreadCount: Number(row.unreadCount),
    });
  }
  return map;
}

export const registerBiddingRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get("/api/v1/workspaces/:workspaceId/bidding", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const query = z
      .object({
        search: z.string().max(200).optional(),
        due: z.enum(["all", "week", "month", "past"]).default("all"),
        sort: z.enum(["due", "activity", "name"]).default("due"),
      })
      .parse(request.query);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const now = new Date();
    const jobs = await app.services.prisma.job.findMany({
      where: { workspaceId, status: ACTIVE_BID_STATUS, archivedAt: null },
      take: 300,
      select: {
        id: true,
        name: true,
        jobNumber: true,
        status: true,
        bidDueAt: true,
        customerId: true,
        customer: { select: { id: true, name: true } },
      },
    });
    const activity = await loadBidActivity(
      app.services.prisma,
      workspaceId,
      jobs.map((job) => job.id)
    );
    const stats = new Map<string, BiddingActivityStats>();
    for (const [id, row] of activity) {
      stats.set(id, {
        emailCount: row.emailCount,
        threadCount: row.threadCount,
        unreadCount: row.unreadCount,
        lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt) : null,
      });
    }
    const rows = jobs.map((job) => ({
      id: job.id,
      name: job.name,
      jobNumber: job.jobNumber,
      customerName: job.customer?.name ?? null,
      bidDueAt: job.bidDueAt,
      customerId: job.customerId,
      status: job.status,
    }));
    const summary = biddingSummary(rows, stats, now);
    const listed = presentBiddingList(rows, stats, {
      ...(query.search ? { search: query.search } : {}),
      due: query.due as BiddingDueFilter,
      sort: query.sort as BiddingSort,
      now,
    });

    return reply.send({
      summary,
      bids: listed.map((job) => {
        const row = activity.get(job.id);
        return {
          id: job.id,
          name: job.name,
          jobNumber: job.jobNumber,
          status: ACTIVE_BID_STATUS,
          customerId: job.customerId,
          customerName: job.customerName,
          bidDueAt: job.bidDueAt?.toISOString() ?? null,
          emailCount: row?.emailCount ?? 0,
          threadCount: row?.threadCount ?? 0,
          unreadCount: row?.unreadCount ?? 0,
          lastActivityAt: row?.lastActivityAt?.toISOString() ?? null,
          recentSender: row?.recentSender ?? null,
        };
      }),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/bidding/from-email", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEdit(auth.workspaceRole)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }
    const body = z
      .object({
        messageId: z.string().min(1),
        action: z.enum(["use_job", "create"]),
        jobId: z.string().min(1).optional(),
        name: z.string().min(1).max(300).optional(),
        jobNumber: z.string().max(100).nullable().optional(),
        customerId: z.string().nullable().optional(),
        bidDueAt: bidDate.nullable().optional(),
        confirmMove: z.boolean().optional(),
      })
      .parse(request.body);

    const message = await app.services.prisma.emailMessage.findFirst({
      where: { id: body.messageId, workspaceId },
      select: { id: true, threadId: true },
    });
    if (!message) return reply.code(404).send({ message: "Email message not found" });

    const threadMessages = await app.services.prisma.emailMessage.findMany({
      where: { workspaceId, threadId: message.threadId },
      select: {
        id: true,
        jobId: true,
        job: { select: { name: true } },
      },
    });

    const bidDueAt = parseBidDue(body.bidDueAt);
    const now = new Date();

    if (body.action === "create") {
      const name = body.name?.trim();
      if (!name) return reply.code(400).send({ message: "Project name is required" });
      const normalized = normalizeName(name);
      const existing = await app.services.prisma.job.findFirst({
        where: { workspaceId, normalizedName: normalized },
        select: { id: true, name: true, status: true, jobNumber: true, archivedAt: true },
      });
      if (existing) {
        return reply.code(409).send({
          code: "EXISTING_JOB",
          message: `A project named ${existing.name} already exists. Mark it as actively bidding instead of creating a second one.`,
          cause: {
            jobId: existing.id,
            name: existing.name,
            status: existing.status,
            jobNumber: existing.jobNumber,
          },
        });
      }
      if (body.jobNumber) {
        const numberTaken = await app.services.prisma.job.findFirst({
          where: { workspaceId, jobNumber: body.jobNumber },
          select: { id: true },
        });
        if (numberTaken) {
          return reply.code(409).send({ message: "A job with this job number already exists" });
        }
      }
      if (body.customerId) {
        const customer = await app.services.prisma.customer.findFirst({
          where: { id: body.customerId, workspaceId },
          select: { id: true },
        });
        if (!customer) return reply.code(400).send({ message: "Customer not found" });
      }

      const createConflicts = threadJobConflicts(
        threadMessages.map((row) => ({
          jobId: row.jobId,
          jobName: row.job?.name ?? null,
        })),
        "new-bid"
      );
      if (!assignmentAllowed(createConflicts, Boolean(body.confirmMove))) {
        const label = createConflicts
          .map((conflict) => conflict.jobName ?? "another project")
          .slice(0, 3)
          .join(", ");
        return reply.code(409).send({
          code: "THREAD_JOB_CONFLICT",
          message: `This thread includes email assigned to ${label}. Move it onto the new bid?`,
          cause: { conflicts: createConflicts },
        });
      }

      const created = await app.services.prisma.$transaction(async (tx) => {
        const job = await tx.job.create({
          data: {
            workspaceId,
            name,
            normalizedName: normalized,
            jobNumber: body.jobNumber?.trim() || null,
            customerId: body.customerId ?? null,
            status: ACTIVE_BID_STATUS,
            bidDueAt: bidDueAt ?? null,
            createdByUserId: auth.userId,
          },
          select: { id: true, name: true, jobNumber: true, status: true },
        });
        await tx.emailMessage.updateMany({
          where: { workspaceId, threadId: message.threadId },
          data: {
            jobId: job.id,
            ...USER_BID_ASSIGNMENT,
            jobAssignedAt: now,
            jobAssignedByUserId: auth.userId,
          },
        });
        const createdTaskLink = tasksForEmailJobLink({
          workspaceId,
          sourceMessageIds: threadMessages.map((row) => row.id),
          jobId: job.id,
        });
        if (createdTaskLink) await tx.task.updateMany(createdTaskLink);
        await tx.jobActivityLog.create({
          data: {
            jobId: job.id,
            workspaceId,
            actorUserId: auth.userId,
            action: "JOB_CREATED",
            newValue: { status: ACTIVE_BID_STATUS, threadId: message.threadId },
          },
        });
        return job;
      });

      await app.services.auditEventLogger.log({
        workspaceId,
        actorUserId: auth.userId,
        entityType: "JOB",
        entityId: created.id,
        action: "job.marked_bidding",
        metadata: { messageId: message.id, mode: "create", messageCount: threadMessages.length },
        request,
      });
      return reply.code(201).send({ job: created, assigned: threadMessages.length });
    }

    if (!body.jobId) return reply.code(400).send({ message: "Choose a project" });
    const job = await app.services.prisma.job.findFirst({
      where: { id: body.jobId, workspaceId },
      select: {
        id: true,
        name: true,
        jobNumber: true,
        status: true,
        archivedAt: true,
      },
    });
    if (!job) return reply.code(404).send({ message: "Job not found" });
    if (job.archivedAt) {
      return reply.code(409).send({ message: "This project is archived" });
    }

    const conflicts = threadJobConflicts(
      threadMessages.map((row) => ({
        jobId: row.jobId,
        jobName: row.job?.name ?? null,
      })),
      job.id
    );
    if (!assignmentAllowed(conflicts, Boolean(body.confirmMove))) {
      const label = conflicts
        .map((conflict) => conflict.jobName ?? "another project")
        .slice(0, 3)
        .join(", ");
      return reply.code(409).send({
        code: "THREAD_JOB_CONFLICT",
        message: `This thread includes email assigned to ${label}. Move it to ${job.name}?`,
        cause: { conflicts },
      });
    }

    await app.services.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: {
          status: ACTIVE_BID_STATUS,
          ...(bidDueAt !== undefined ? { bidDueAt } : {}),
        },
      });
      await tx.emailMessage.updateMany({
        where: { workspaceId, threadId: message.threadId },
        data: {
          jobId: job.id,
          ...USER_BID_ASSIGNMENT,
          jobAssignedAt: now,
          jobAssignedByUserId: auth.userId,
        },
      });
      const taskLink = tasksForEmailJobLink({
        workspaceId,
        sourceMessageIds: threadMessages.map((row) => row.id),
        jobId: job.id,
      });
      if (taskLink) await tx.task.updateMany(taskLink);
      await tx.jobActivityLog.create({
        data: {
          jobId: job.id,
          workspaceId,
          actorUserId: auth.userId,
          action: job.status === ACTIVE_BID_STATUS ? "EMAIL_ASSIGNED" : "JOB_STATUS_CHANGED",
          previousValue: { status: job.status },
          newValue: {
            status: ACTIVE_BID_STATUS,
            threadId: message.threadId,
            messageCount: threadMessages.length,
          },
        },
      });
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "JOB",
      entityId: job.id,
      action: "job.marked_bidding",
      metadata: {
        messageId: message.id,
        mode: "use_job",
        messageCount: threadMessages.length,
      },
      request,
    });

    return reply.send({
      job: {
        id: job.id,
        name: job.name,
        jobNumber: job.jobNumber,
        status: ACTIVE_BID_STATUS,
      },
      assigned: threadMessages.length,
    });
  });

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/remove-from-bidding",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEdit(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const job = await app.services.prisma.job.findFirst({
        where: { id: jobId, workspaceId },
        select: { id: true, status: true },
      });
      if (!job) return reply.code(404).send({ message: "Job not found" });
      const next = statusAfterRemoveFromBidding(job.status);
      if (!next) {
        return reply.code(409).send({ message: "This project is not an active bid" });
      }
      await app.services.prisma.$transaction(async (tx) => {
        await tx.job.update({
          where: { id: job.id },
          data: { status: next },
        });
        await tx.jobActivityLog.create({
          data: {
            jobId: job.id,
            workspaceId,
            actorUserId: auth.userId,
            action: "JOB_STATUS_CHANGED",
            previousValue: { status: job.status },
            newValue: { status: next },
          },
        });
      });
      await app.services.auditEventLogger.log({
        workspaceId,
        actorUserId: auth.userId,
        entityType: "JOB",
        entityId: job.id,
        action: "job.removed_from_bidding",
        metadata: { from: job.status, to: next },
        request,
      });
      return reply.send({ jobId: job.id, status: next });
    }
  );
};
