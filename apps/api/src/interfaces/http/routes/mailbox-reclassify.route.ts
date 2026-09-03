import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BUSINESS_SUBTYPE_KEYS } from "@forgeops/ai";
import {
  QueueNames,
  buildMailboxReclassifyJobId,
  DEFAULT_RECLASSIFY_TASK_MODE,
  RECLASSIFY_CATEGORY_VALUES,
  RECLASSIFY_DIRECTION_VALUES,
  RECLASSIFY_JOB_SCOPE_VALUES,
  RECLASSIFY_PRIORITY_VALUES,
  RECLASSIFY_PROCESSING_STATUS_VALUES,
  RECLASSIFY_READ_VALUES,
  RECLASSIFY_TASK_MODE_VALUES,
  MAILBOX_RECLASSIFY_MAX_SELECTED,
  type MailboxReclassifyFilters,
  type MailboxReclassifyJobPayload,
  type MailboxReclassifyJobResult,
} from "@forgeops/shared";

import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import {
  MailboxReclassifyError,
  assertNativeMailbox,
  previewMailboxReclassify,
  sanitizeReclassifyFilters,
  searchMailboxSenders,
} from "../../../application/services/mailbox-reclassify.js";

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

function hasMinRole(current: string, required: string): boolean {
  return (ROLE_RANK[current] ?? -1) >= (ROLE_RANK[required] ?? 999);
}

const connectionParams = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
});

const runParams = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
  runId: z.string().min(1),
});

const filtersSchema = z
  .object({
    category: z.enum(RECLASSIFY_CATEGORY_VALUES).optional(),
    businessTypeKeys: z
      .array(z.enum(BUSINESS_SUBTYPE_KEYS as unknown as [string, ...string[]]))
      .max(20)
      .optional(),
    senderEmailEquals: z.string().max(320).optional(),
    senderContains: z.string().max(320).optional(),
    readStatus: z.enum(RECLASSIFY_READ_VALUES).optional(),
    direction: z.enum(RECLASSIFY_DIRECTION_VALUES).optional(),
    dateRange: z.enum(["TODAY", "WEEK", "MONTH"]).optional(),
    customStartYmd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    customEndYmd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    timezone: z.string().min(1).max(80).optional(),
    priorities: z.array(z.enum(RECLASSIFY_PRIORITY_VALUES)).max(4).optional(),
    jobScope: z.enum(RECLASSIFY_JOB_SCOPE_VALUES).optional(),
    jobId: z.string().min(1).max(64).optional(),
    processingStatus: z.enum(RECLASSIFY_PROCESSING_STATUS_VALUES).optional(),
    hasAttachments: z.boolean().nullable().optional(),
  })
  .strict();

function toFilters(body: z.infer<typeof filtersSchema>): MailboxReclassifyFilters {
  return sanitizeReclassifyFilters({
    ...(body.category ? { category: body.category } : {}),
    ...(body.businessTypeKeys ? { businessTypeKeys: body.businessTypeKeys } : {}),
    ...(body.senderEmailEquals
      ? { senderEmailEquals: body.senderEmailEquals }
      : {}),
    ...(body.senderContains ? { senderContains: body.senderContains } : {}),
    ...(body.readStatus ? { readStatus: body.readStatus } : {}),
    ...(body.direction ? { direction: body.direction } : {}),
    ...(body.dateRange ? { dateRange: body.dateRange } : {}),
    ...(body.customStartYmd ? { customStartYmd: body.customStartYmd } : {}),
    ...(body.customEndYmd ? { customEndYmd: body.customEndYmd } : {}),
    ...(body.timezone ? { timezone: body.timezone } : {}),
    ...(body.priorities ? { priorities: body.priorities } : {}),
    ...(body.jobScope ? { jobScope: body.jobScope } : {}),
    ...(body.jobId ? { jobId: body.jobId } : {}),
    ...(body.processingStatus
      ? { processingStatus: body.processingStatus }
      : {}),
    ...(body.hasAttachments !== undefined
      ? { hasAttachments: body.hasAttachments }
      : {}),
  });
}

function mapErrorStatus(code: MailboxReclassifyError["code"]): number {
  if (code === "CONNECTION_NOT_FOUND" || code === "RUN_NOT_FOUND") return 404;
  if (code === "NOT_NATIVE" || code === "ACTIVE_RUN_EXISTS" || code === "RUN_NOT_CANCELLABLE")
    return 409;
  return 400;
}

export function registerMailboxReclassifyRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/meta",
    async (request, reply) => {
      const params = connectionParams.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "ADMIN or OWNER required" });
      }

      const conn = await assertNativeMailbox({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.connectionId,
      }).catch((e) => {
        if (e instanceof MailboxReclassifyError) {
          reply.code(mapErrorStatus(e.code)).send({ message: e.message, code: e.code });
          return null;
        }
        throw e;
      });
      if (!conn) return;

      return reply.send({
        mailbox: {
          id: conn.id,
          email: conn.email,
          provider: conn.provider,
          ingestionSource: conn.ingestionSource,
          status: conn.status,
        },
        businessSubtypeKeys: [...BUSINESS_SUBTYPE_KEYS],
        priorityValues: [...RECLASSIFY_PRIORITY_VALUES],
      });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/senders",
    async (request, reply) => {
      const params = connectionParams.parse(request.params);
      const query = z
        .object({
          q: z.string().min(1).max(200),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        })
        .parse(request.query);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "ADMIN or OWNER required" });
      }

      try {
        const senders = await searchMailboxSenders({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          q: query.q,
          ...(query.limit != null ? { limit: query.limit } : {}),
        });
        return reply.send({ senders });
      } catch (e) {
        if (e instanceof MailboxReclassifyError) {
          return reply
            .code(mapErrorStatus(e.code))
            .send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/preview",
    async (request, reply) => {
      const params = connectionParams.parse(request.params);
      const body = z
        .object({
          filters: filtersSchema.default({}),
          messageIds: z
            .array(z.string().min(1))
            .max(MAILBOX_RECLASSIFY_MAX_SELECTED)
            .optional(),
          taskMode: z.enum(RECLASSIFY_TASK_MODE_VALUES).optional(),
        })
        .strict()
        .parse(request.body ?? {});
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "ADMIN or OWNER required" });
      }

      try {
        const preview = await previewMailboxReclassify({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          filters: toFilters(body.filters),
          ...(body.messageIds ? { messageIds: body.messageIds } : {}),
          taskMode: body.taskMode ?? DEFAULT_RECLASSIFY_TASK_MODE,
        });
        request.log.info({
          event: "mailbox-reclassify-preview",
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          totalMatched: preview.totalMatched,
          classifierTasksToRemove: preview.classifierTasksToRemove,
          taskMode: preview.taskMode,
        });
        return reply.send(preview);
      } catch (e) {
        if (e instanceof MailboxReclassifyError) {
          return reply
            .code(mapErrorStatus(e.code))
            .send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/runs",
    async (request, reply) => {
      const params = connectionParams.parse(request.params);
      const body = z
        .object({
          filters: filtersSchema.default({}),
          messageIds: z
            .array(z.string().min(1))
            .max(MAILBOX_RECLASSIFY_MAX_SELECTED)
            .optional(),
          taskMode: z.enum(RECLASSIFY_TASK_MODE_VALUES).optional(),
          confirm: z.literal(true),
        })
        .strict()
        .parse(request.body ?? {});
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "ADMIN or OWNER required" });
      }

      try {
        const conn = await assertNativeMailbox({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
        });
        const filters = toFilters(body.filters);
        const taskMode = body.taskMode ?? DEFAULT_RECLASSIFY_TASK_MODE;

        const active = await app.services.prisma.mailboxReclassifyRun.findFirst({
          where: {
            workspaceId: params.workspaceId,
            inboxConnectionId: params.connectionId,
            status: { in: ["PENDING", "RUNNING", "CANCELLING"] },
          },
          select: { id: true, status: true },
        });
        if (active) {
          throw new MailboxReclassifyError(
            "ACTIVE_RUN_EXISTS",
            `A reclassification run is already ${active.status}`
          );
        }

        const preview = await previewMailboxReclassify({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          filters,
          ...(body.messageIds ? { messageIds: body.messageIds } : {}),
          taskMode,
        });
        if (preview.totalMatched === 0) {
          throw new MailboxReclassifyError(
            "INVALID_REQUEST",
            "No emails match the selected filters"
          );
        }

        const run = await app.services.prisma.mailboxReclassifyRun.create({
          data: {
            workspaceId: params.workspaceId,
            inboxConnectionId: params.connectionId,
            status: "PENDING",
            filtersSnapshot: filters as object,
            ...(body.messageIds && body.messageIds.length > 0
              ? { selectedMessageIds: body.messageIds }
              : {}),
            taskMode,
            totalMatched: preview.totalMatched,
            initiatedByUserId: session.userId,
          },
        });

        const queue = app.services.mailboxReclassifyQueue as {
          add: (
            name: string,
            data: MailboxReclassifyJobPayload,
            opts?: { jobId?: string; attempts?: number }
          ) => Promise<unknown>;
        };

        const payload: MailboxReclassifyJobPayload = {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          runId: run.id,
          initiatedBy: session.userId,
        };

        try {
          await queue.add(QueueNames.MAILBOX_RECLASSIFY, payload, {
            jobId: buildMailboxReclassifyJobId(run.id),
            attempts: 1,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await app.services.prisma.mailboxReclassifyRun.update({
            where: { id: run.id },
            data: {
              status: "FAILED",
              errorMessage: msg.slice(0, 480),
              completedAt: new Date(),
            },
          });
          throw e;
        }

        request.log.info({
          event: "mailbox-reclassify-run-started",
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          runId: run.id,
          totalMatched: preview.totalMatched,
          classifierTasksToRemove: preview.classifierTasksToRemove,
          taskMode,
          mailboxEmail: conn.email,
        });

        return reply.code(202).send({
          run: {
            id: run.id,
            status: run.status,
            taskMode: run.taskMode,
            totalMatched: run.totalMatched,
            queued: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            tasksRemoved: 0,
            tasksGenerated: 0,
            taskPersistFailures: 0,
          },
        });
      } catch (e) {
        if (e instanceof MailboxReclassifyError) {
          return reply
            .code(mapErrorStatus(e.code))
            .send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/runs/:runId",
    async (request, reply) => {
      const params = runParams.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "ADMIN or OWNER required" });
      }

      const run = await app.services.prisma.mailboxReclassifyRun.findFirst({
        where: {
          id: params.runId,
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
        },
      });
      if (!run) {
        return reply.code(404).send({ message: "Run not found", code: "RUN_NOT_FOUND" });
      }

      return reply.send({
        run: {
          id: run.id,
          status: run.status,
          taskMode: run.taskMode,
          totalMatched: run.totalMatched,
          queued: run.queued,
          completed: run.completed,
          failed: run.failed,
          skipped: run.skipped,
          tasksRemoved: run.tasksRemoved,
          tasksGenerated: run.tasksGenerated,
          taskPersistFailures: run.taskPersistFailures,
          errorMessage: run.errorMessage,
          startedAt: run.startedAt?.toISOString() ?? null,
          completedAt: run.completedAt?.toISOString() ?? null,
          createdAt: run.createdAt.toISOString(),
          filtersSnapshot: run.filtersSnapshot,
        },
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/runs/:runId/cancel",
    async (request, reply) => {
      const params = runParams.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "ADMIN or OWNER required" });
      }

      const run = await app.services.prisma.mailboxReclassifyRun.findFirst({
        where: {
          id: params.runId,
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
        },
        select: { id: true, status: true },
      });
      if (!run) {
        return reply.code(404).send({ message: "Run not found", code: "RUN_NOT_FOUND" });
      }
      if (
        run.status !== "PENDING" &&
        run.status !== "RUNNING" &&
        run.status !== "CANCELLING"
      ) {
        return reply.code(409).send({
          message: `Run is ${run.status} and cannot be cancelled`,
          code: "RUN_NOT_CANCELLABLE",
        });
      }

      const updated = await app.services.prisma.mailboxReclassifyRun.update({
        where: { id: run.id },
        data: {
          status: run.status === "PENDING" ? "CANCELLED" : "CANCELLING",
          ...(run.status === "PENDING"
            ? { completedAt: new Date() }
            : {}),
        },
      });

      request.log.info({
        event: "mailbox-reclassify-run-cancel-requested",
        workspaceId: params.workspaceId,
        inboxConnectionId: params.connectionId,
        runId: run.id,
        previousStatus: run.status,
        nextStatus: updated.status,
      });

      return reply.send({
        run: {
          id: updated.id,
          status: updated.status,
        },
      });
    }
  );
}

// Satisfy unused type import in tsc when queue typing is structural
export type _MailboxReclassifyJobResult = MailboxReclassifyJobResult;
