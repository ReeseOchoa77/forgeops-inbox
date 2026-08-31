import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import {
  RETRY_CLASSIFICATION_MAX_LIMIT,
  RetryClassificationError,
  retryClassificationBulk,
  retryClassificationForMessage,
} from "../../../application/services/retry-classification.js";

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
const workspaceMessageParams = z.object({
  workspaceId: z.string().min(1),
  messageId: z.string().min(1),
});

const bulkBodySchema = z
  .object({
    inboxConnectionId: z.string().min(1).optional(),
    messageIds: z.array(z.string().min(1)).max(RETRY_CLASSIFICATION_MAX_LIMIT).optional(),
    allUnclassified: z.boolean().optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(RETRY_CLASSIFICATION_MAX_LIMIT)
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!(body.messageIds?.length) && !body.allUnclassified) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide messageIds and/or allUnclassified=true",
        path: ["messageIds"],
      });
    }
  });

export function registerRetryClassificationRoutes(app: FastifyInstance): void {
  app.post(
    "/api/v1/workspaces/:workspaceId/messages/:messageId/retry-classification",
    async (request, reply) => {
      const params = workspaceMessageParams.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) {
        return reply.code(401).send({ message: "Authentication required" });
      }
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) {
        return reply.code(403).send({ message: "Workspace access denied" });
      }
      if (!hasMinRole(membership.role, "MEMBER")) {
        return reply
          .code(403)
          .send({ message: "MEMBER or above required to retry classification" });
      }

      try {
        const outcome = await retryClassificationForMessage({
          prisma: app.services.prisma,
          queue: app.services.mailboxClassifyQueue,
          workspaceId: params.workspaceId,
          emailMessageId: params.messageId,
          initiatedBy: session.userId,
        });
        request.log.info({
          event: "retry-classification-single",
          workspaceId: params.workspaceId,
          messageId: params.messageId,
          outcome,
        });
        return reply.code(outcome === "queued" ? 202 : 200).send({
          messageId: params.messageId,
          outcome,
        });
      } catch (error) {
        if (error instanceof RetryClassificationError) {
          const status =
            error.code === "MESSAGE_NOT_FOUND"
              ? 404
              : error.code === "CROSS_WORKSPACE"
                ? 403
                : error.code === "NOT_NATIVE"
                  ? 409
                  : 400;
          return reply.code(status).send({ message: error.message, code: error.code });
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/retry-classification",
    async (request, reply) => {
      const params = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const body = bulkBodySchema.parse(request.body ?? {});
      const session = await getSessionFromRequest(request);
      if (!session) {
        return reply.code(401).send({ message: "Authentication required" });
      }
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) {
        return reply.code(403).send({ message: "Workspace access denied" });
      }
      if (!hasMinRole(membership.role, "MEMBER")) {
        return reply
          .code(403)
          .send({ message: "MEMBER or above required to retry classification" });
      }

      try {
        const result = await retryClassificationBulk({
          prisma: app.services.prisma,
          queue: app.services.mailboxClassifyQueue,
          workspaceId: params.workspaceId,
          inboxConnectionId: body.inboxConnectionId ?? null,
          ...(body.messageIds ? { messageIds: body.messageIds } : {}),
          ...(body.allUnclassified != null
            ? { allUnclassified: body.allUnclassified }
            : {}),
          ...(body.limit != null ? { limit: body.limit } : {}),
          initiatedBy: session.userId,
        });
        request.log.info({
          event: "retry-classification-bulk",
          workspaceId: params.workspaceId,
          inboxConnectionId: body.inboxConnectionId ?? null,
          ...result,
        });
        return reply.code(202).send(result);
      } catch (error) {
        if (error instanceof RetryClassificationError) {
          const status =
            error.code === "CONNECTION_NOT_FOUND"
              ? 404
              : error.code === "CROSS_WORKSPACE" || error.code === "MESSAGE_NOT_FOUND"
                ? 403
                : error.code === "NOT_NATIVE"
                  ? 409
                  : 400;
          return reply.code(status).send({ message: error.message, code: error.code });
        }
        throw error;
      }
    }
  );
}
