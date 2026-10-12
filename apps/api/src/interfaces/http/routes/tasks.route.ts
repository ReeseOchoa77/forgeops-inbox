import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  buildOperationalTasksWhere,
  taskListOrderBy,
  type TaskAssigneeScope,
  type TaskDirectionFilter,
  type TaskDueFilter,
  type TaskOwnershipView,
  type TaskPriorityFilter,
  type TaskSort,
  type TaskSourceFilter,
  type TaskStatusFilter,
} from "@forgeops/shared";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

function hasMinRole(current: string, required: string): boolean {
  return (ROLE_RANK[current] ?? 0) >= (ROLE_RANK[required] ?? 999);
}

function canViewWorkspaceTasks(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const workspaceParams = z.object({ workspaceId: z.string().min(1) });
const taskParams = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
});

const createBodySchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10_000).optional().nullable(),
  assigneeUserId: z.string().min(1),
  jobId: z.string().min(1).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional().default("NORMAL"),
});

const statusBodySchema = z.object({
  status: z.enum(["OPEN", "DONE"]),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  view: z.enum(["MY", "REQUESTS", "ALL"]).optional().default("MY"),
  /** Admin/Owner: ALL | UNASSIGNED | userId */
  assigneeUserId: z.string().min(1).optional(),
  statusFilter: z.enum(["OPEN", "COMPLETED", "ALL"]).optional(),
  due: z.enum(["ALL", "OVERDUE", "TODAY", "WEEK", "MONTH", "NONE"]).optional(),
  priority: z.enum(["ALL", "LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  source: z.enum(["ALL", "EMAIL", "MANUAL"]).optional(),
  businessTypeKey: z.string().optional(),
  sender: z.string().optional(),
  direction: z.enum(["ALL", "INCOMING", "SENT"]).optional(),
  jobId: z.string().optional(),
  sort: z.enum(["DUE_DATE", "NEWEST", "OLDEST", "PRIORITY"]).optional(),
  timezone: z.string().optional(),
  pinnedOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
  inboxConnectionId: z.string().min(1).optional(),
});

const userLiteSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
});

function toPrismaPriority(
  api: "LOW" | "NORMAL" | "HIGH" | "URGENT"
): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
  return api === "NORMAL" ? "MEDIUM" : api;
}

function toApiPriority(p: string): "LOW" | "NORMAL" | "HIGH" | "URGENT" {
  if (p === "MEDIUM") return "NORMAL";
  if (p === "LOW" || p === "HIGH" || p === "URGENT") return p;
  return "NORMAL";
}

function serializeDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function confidenceNumber(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : Number(v);
}

async function requireMemberAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
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
  return { session, membership };
}

const taskUserSelect = {
  id: true,
  name: true,
  email: true,
} as const;

const taskListSelect = {
  id: true,
  title: true,
  summary: true,
  description: true,
  assigneeGuess: true,
  assigneeUserId: true,
  requesterUserId: true,
  source: true,
  dueAt: true,
  priority: true,
  status: true,
  confidence: true,
  requiresReview: true,
  reviewQueue: true,
  reviewStatus: true,
  isPinned: true,
  createdAt: true,
  updatedAt: true,
  sourceDate: true,
  jobId: true,
  assigneeUser: { select: taskUserSelect },
  requesterUser: { select: taskUserSelect },
  sourceMessage: {
    select: {
      id: true,
      gmailMessageId: true,
      subject: true,
      snippet: true,
      senderEmail: true,
      senderName: true,
      sentAt: true,
      receivedAt: true,
      mailboxCategory: true,
      priority: true,
      jobId: true,
      direction: true,
      job: { select: { id: true, jobNumber: true, name: true } },
      inboxConnectionId: true,
      classifications: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { businessTypeKey: true },
      },
    },
  },
  classification: {
    select: { businessTypeKey: true },
  },
} as const;

function serializeTaskRow(task: {
  id: string;
  title: string;
  summary: string | null;
  description: string | null;
  assigneeGuess: string | null;
  assigneeUserId: string | null;
  requesterUserId: string | null;
  source: string;
  dueAt: Date | null;
  priority: string;
  status: string;
  confidence: Prisma.Decimal | number;
  requiresReview: boolean;
  reviewQueue: string | null;
  reviewStatus: string;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  sourceDate: Date;
  jobId: string | null;
  assigneeUser: { id: string; name: string | null; email: string } | null;
  requesterUser: { id: string; name: string | null; email: string } | null;
  sourceMessage: {
    id: string;
    gmailMessageId: string;
    subject: string | null;
    snippet: string | null;
    senderEmail: string;
    senderName: string | null;
    sentAt: Date | null;
    receivedAt: Date | null;
    mailboxCategory: string | null;
    priority: string | null;
    jobId: string | null;
    direction: string | null;
    job: { id: string; jobNumber: string | null; name: string } | null;
    inboxConnectionId: string | null;
    classifications: Array<{ businessTypeKey: string | null }>;
  } | null;
  classification: { businessTypeKey: string | null } | null;
}) {
  const msg = task.sourceMessage;
  const subtype =
    task.classification?.businessTypeKey ??
    msg?.classifications[0]?.businessTypeKey ??
    null;

  return {
    task: {
      id: task.id,
      title: task.title,
      summary: task.summary,
      description: task.description,
      assigneeGuess: task.assigneeGuess,
      assigneeUserId: task.assigneeUserId,
      requesterUserId: task.requesterUserId,
      source: task.source,
      dueAt: serializeDate(task.dueAt),
      priority: toApiPriority(task.priority),
      status: task.status,
      confidence: confidenceNumber(task.confidence),
      requiresReview: task.requiresReview,
      reviewQueue: task.reviewQueue,
      reviewStatus: task.reviewStatus,
      isPinned: task.isPinned,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      sourceDate: task.sourceDate.toISOString(),
      jobId: task.jobId,
      assignee: task.assigneeUser
        ? userLiteSchema.parse(task.assigneeUser)
        : null,
      requester: task.requesterUser
        ? userLiteSchema.parse(task.requesterUser)
        : null,
    },
    sourceMessage: msg
      ? {
          id: msg.id,
          providerMessageId: msg.gmailMessageId,
          subject: msg.subject,
          snippet: msg.snippet,
          senderEmail: msg.senderEmail,
          receivedAt: serializeDate(msg.receivedAt),
        }
      : null,
    sourceEmail: msg
      ? {
          id: msg.id,
          subject: msg.subject,
          senderName: msg.senderName,
          senderAddress: msg.senderEmail,
          sentAt: serializeDate(msg.sentAt),
          receivedAt: serializeDate(msg.receivedAt),
          mailboxCategory: msg.mailboxCategory ?? null,
          businessSubtype: subtype,
          priority: msg.priority ? toApiPriority(msg.priority) : null,
          jobId: msg.jobId ?? msg.job?.id ?? null,
          jobNumber: msg.job?.jobNumber ?? null,
          jobName: msg.job?.name ?? null,
          inboxConnectionId: msg.inboxConnectionId ?? null,
          direction: msg.direction ?? null,
        }
      : null,
    classification: null,
  };
}

export const registerTasksRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  /** Active workspace members for assignee picker (MEMBER+). */
  app.get(
    "/api/v1/workspaces/:workspaceId/task-assignees",
    async (request, reply) => {
      const { workspaceId } = workspaceParams.parse(request.params);
      const access = await requireMemberAccess(app, request, reply, workspaceId);
      if (!access) return;
      if (!hasMinRole(access.membership.role, "VIEWER")) {
        return reply.code(403).send({ message: "Workspace access denied" });
      }

      const rows = await app.services.prisma.membership.findMany({
        where: { workspaceId },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { user: { name: "asc" } },
      });

      return reply.send({
        members: rows.map((r) => ({
          id: r.user.id,
          name: r.user.name,
          email: r.user.email,
          role: r.role,
        })),
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/tasks",
    async (request, reply) => {
      const { workspaceId } = workspaceParams.parse(request.params);
      const access = await requireMemberAccess(app, request, reply, workspaceId);
      if (!access) return;
      if (!hasMinRole(access.membership.role, "MEMBER")) {
        return reply
          .code(403)
          .send({ message: "MEMBER role or higher required to create tasks" });
      }

      const raw = (request.body ?? {}) as Record<string, unknown>;
      if ("requesterUserId" in raw && raw.requesterUserId != null) {
        return reply.code(400).send({
          message: "requesterUserId cannot be set by the client",
        });
      }

      const body = createBodySchema.parse(raw);

      const assigneeMembership =
        await app.services.prisma.membership.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: body.assigneeUserId,
            },
          },
          select: { userId: true },
        });
      if (!assigneeMembership) {
        return reply.code(400).send({
          message: "Assignee must be an active member of this workspace",
        });
      }

      if (body.jobId) {
        const job = await app.services.prisma.job.findFirst({
          where: { id: body.jobId, workspaceId },
          select: { id: true },
        });
        if (!job) {
          return reply
            .code(400)
            .send({ message: "Job not found in this workspace" });
        }
      }

      const now = new Date();
      const created = await app.services.prisma.task.create({
        data: {
          workspaceId,
          source: "MANUAL",
          sourceThreadId: null,
          sourceMessageId: null,
          title: body.title,
          description: body.description?.trim() || null,
          summary: body.description?.trim() || null,
          assigneeUserId: body.assigneeUserId,
          requesterUserId: access.session.userId,
          jobId: body.jobId ?? null,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          priority: toPrismaPriority(body.priority),
          status: "OPEN",
          confidence: new Prisma.Decimal("1.0000"),
          requiresReview: false,
          reviewStatus: "NOT_REQUIRED",
          sourceDate: now,
        },
        select: taskListSelect,
      });

      await app.services.auditEventLogger.log({
        workspaceId,
        actorUserId: access.session.userId,
        entityType: "TASK",
        entityId: created.id,
        action: "task.created_manual",
        request,
      });

      return reply.code(201).send(serializeTaskRow(created));
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/tasks",
    async (request, reply) => {
      const { workspaceId } = workspaceParams.parse(request.params);
      const access = await requireMemberAccess(app, request, reply, workspaceId);
      if (!access) return;

      const query = listQuerySchema.parse(request.query);
      const workspaceWide = canViewWorkspaceTasks(access.membership.role);

      if (query.view === "ALL" && query.assigneeUserId && !workspaceWide) {
        return reply.code(403).send({
          message: "Only OWNER or ADMIN can filter tasks by another user",
        });
      }

      let connectionEmail: string | undefined;
      if (query.inboxConnectionId) {
        const conn = await app.services.prisma.inboxConnection.findFirst({
          where: { id: query.inboxConnectionId, workspaceId },
          select: { email: true },
        });
        if (!conn) {
          return reply.code(404).send({ message: "Inbox connection not found" });
        }
        connectionEmail = conn.email;
      }

      let assigneeScope: TaskAssigneeScope | undefined;
      if (query.view === "ALL" && workspaceWide) {
        assigneeScope = (query.assigneeUserId as TaskAssigneeScope) ?? "ALL";
      }

      const where = buildOperationalTasksWhere({
        workspaceId,
        ...(query.inboxConnectionId
          ? {
              inboxConnectionId: query.inboxConnectionId,
              includeManualWorkspaceTasks: true,
            }
          : {}),
        ownershipView: query.view as TaskOwnershipView,
        currentUserId: access.session.userId,
        canViewWorkspaceTasks: workspaceWide,
        ...(assigneeScope !== undefined ? { assigneeScope } : {}),
        ...(query.statusFilter
          ? { status: query.statusFilter as TaskStatusFilter }
          : {}),
        ...(query.due ? { due: query.due as TaskDueFilter } : {}),
        ...(query.priority
          ? { priority: query.priority as TaskPriorityFilter }
          : {}),
        ...(query.source ? { source: query.source as TaskSourceFilter } : {}),
        ...(query.businessTypeKey
          ? { businessTypeKey: query.businessTypeKey }
          : {}),
        ...(query.sender ? { sender: query.sender } : {}),
        ...(query.direction
          ? { direction: query.direction as TaskDirectionFilter }
          : {}),
        ...(query.jobId ? { jobFilter: query.jobId } : {}),
        ...(connectionEmail ? { connectionEmail } : {}),
        timezone: query.timezone || "UTC",
        ...(query.pinnedOnly ? { pinnedOnly: true } : {}),
      });

      const skip = (query.page - 1) * query.pageSize;
      const orderBy = [
        { isPinned: "desc" as const },
        { pinnedAt: { sort: "desc" as const, nulls: "last" as const } },
        ...taskListOrderBy((query.sort as TaskSort | undefined) ?? "DUE_DATE"),
      ];

      const rows = await app.services.prisma.task.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize + 1,
        select: taskListSelect,
      });

      const hasMore = rows.length > query.pageSize;
      const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows;
      const exactCount = skip + pageRows.length;
      const totalCount = hasMore ? null : exactCount;
      const totalPages = hasMore
        ? null
        : exactCount === 0
          ? 0
          : Math.ceil(exactCount / query.pageSize);

      return reply.send({
        workspaceId,
        filters: {
          view: query.view,
          assigneeUserId: query.assigneeUserId ?? null,
          statusFilter: query.statusFilter ?? null,
          due: query.due ?? null,
          priority: query.priority ?? null,
          source: query.source ?? null,
          direction: query.direction ?? null,
          jobId: query.jobId ?? null,
          pinnedOnly: query.pinnedOnly ?? false,
        },
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount,
          totalPages,
          hasMore,
        },
        tasks: pageRows.map(serializeTaskRow),
      });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/tasks/:taskId/status",
    async (request, reply) => {
      const params = taskParams.parse(request.params);
      const access = await requireMemberAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!access) return;
      if (!hasMinRole(access.membership.role, "MEMBER")) {
        return reply
          .code(403)
          .send({ message: "MEMBER role or higher required" });
      }

      const body = statusBodySchema.parse(request.body ?? {});
      const task = await app.services.prisma.task.findFirst({
        where: { id: params.taskId, workspaceId: params.workspaceId },
        select: {
          id: true,
          assigneeUserId: true,
          requesterUserId: true,
          status: true,
        },
      });
      if (!task) {
        return reply.code(404).send({ message: "Task not found" });
      }

      const workspaceWide = canViewWorkspaceTasks(access.membership.role);
      const uid = access.session.userId;
      const canMutate =
        workspaceWide ||
        task.assigneeUserId === uid ||
        task.requesterUserId === uid;
      if (!canMutate) {
        return reply.code(403).send({ message: "Not allowed to update this task" });
      }

      const updated = await app.services.prisma.task.update({
        where: { id: task.id },
        data: {
          status: body.status === "DONE" ? "DONE" : "OPEN",
          completedAt: body.status === "DONE" ? new Date() : null,
        },
        select: taskListSelect,
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: uid,
        entityType: "TASK",
        entityId: task.id,
        action:
          body.status === "DONE" ? "task.completed" : "task.reopened",
        request,
      });

      return reply.send(serializeTaskRow(updated));
    }
  );
};
