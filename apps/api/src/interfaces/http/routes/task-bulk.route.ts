import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { taskBulkDeleteCutoff } from "@forgeops/shared";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const connectionParams = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
});

const beforeQuerySchema = z.object({
  /** YYYY-MM-DD — delete tasks with sourceDate strictly before local start of this day. */
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** IANA timezone for interpreting `before` (default UTC). */
  timezone: z.string().min(1).max(80).optional().default("UTC"),
});

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

async function requireMember(
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
  return { session, membership };
}

async function assertConnection(
  app: FastifyInstance,
  reply: import("fastify").FastifyReply,
  workspaceId: string,
  connectionId: string
) {
  const conn = await app.services.prisma.inboxConnection.findFirst({
    where: { id: connectionId, workspaceId },
    select: { id: true },
  });
  if (!conn) {
    reply.code(404).send({ message: "Mailbox not found" });
    return null;
  }
  return conn;
}

/**
 * Task bulk cleanup: delete by sourceDate strictly before a cutoff date.
 * Scoped to workspace + inbox connection (same scope as Tasks list).
 */
export const registerTaskBulkRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/tasks/bulk-delete-preview",
    async (request, reply) => {
      const params = connectionParams.parse(request.params);
      const access = await requireMember(
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
      if (!(await assertConnection(app, reply, params.workspaceId, params.connectionId))) {
        return;
      }

      const query = beforeQuerySchema.parse(request.query ?? {});
      let cutoff: Date;
      try {
        cutoff = taskBulkDeleteCutoff(query.before, query.timezone);
      } catch {
        return reply.code(400).send({ message: "Invalid before date or timezone" });
      }

      const count = await app.services.prisma.task.count({
        where: {
          workspaceId: params.workspaceId,
          sourceDate: { lt: cutoff },
          sourceThread: { inboxConnectionId: params.connectionId },
        },
      });

      return reply.send({
        count,
        before: query.before,
        timezone: query.timezone,
        cutoffAt: cutoff.toISOString(),
        dateField: "sourceDate" as const,
        keepRule: "Tasks with sourceDate on or after the cutoff date are kept.",
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/tasks/bulk-delete",
    async (request, reply) => {
      const params = connectionParams.parse(request.params);
      const access = await requireMember(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!access) return;
      if (!hasMinRole(access.membership.role, "ADMIN")) {
        return reply
          .code(403)
          .send({ message: "ADMIN or OWNER role required" });
      }
      if (!(await assertConnection(app, reply, params.workspaceId, params.connectionId))) {
        return;
      }

      const body = beforeQuerySchema.parse(request.body ?? {});
      let cutoff: Date;
      try {
        cutoff = taskBulkDeleteCutoff(body.before, body.timezone);
      } catch {
        return reply.code(400).send({ message: "Invalid before date or timezone" });
      }

      const result = await app.services.prisma.task.deleteMany({
        where: {
          workspaceId: params.workspaceId,
          sourceDate: { lt: cutoff },
          sourceThread: { inboxConnectionId: params.connectionId },
        },
      });

      return reply.send({
        deleted: result.count,
        before: body.before,
        timezone: body.timezone,
        cutoffAt: cutoff.toISOString(),
        dateField: "sourceDate" as const,
      });
    }
  );
};
