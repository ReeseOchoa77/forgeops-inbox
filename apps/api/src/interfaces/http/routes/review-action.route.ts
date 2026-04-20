import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const reviewDecisionValues = ["APPROVED", "REJECTED"] as const;

const classificationReviewBodySchema = z.object({
  reviewStatus: z.enum(reviewDecisionValues)
});

const taskReviewBodySchema = z.object({
  reviewStatus: z.enum(reviewDecisionValues)
});

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  classificationId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional()
});

export const registerReviewActionRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.patch(
    "/api/v1/workspaces/:workspaceId/classifications/:classificationId/review",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          classificationId: z.string().min(1)
        })
        .parse(request.params);
      const body = classificationReviewBodySchema.parse(request.body);
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

      const classification =
        await app.services.prisma.classification.findFirst({
          where: {
            id: params.classificationId,
            workspaceId: params.workspaceId
          }
        });

      if (!classification) {
        return reply
          .code(404)
          .send({ message: "Classification not found" });
      }

      const updated = await app.services.prisma.classification.update({
        where: { id: classification.id },
        data: {
          reviewStatus: body.reviewStatus,
          reviewedByUserId: session.userId,
          reviewedAt: new Date(),
          requiresReview: false
        }
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "CLASSIFICATION",
        entityId: classification.id,
        action: `classification.review_${body.reviewStatus.toLowerCase()}`,
        request
      });

      return reply.send({
        status: "reviewed",
        classificationId: updated.id,
        reviewStatus: updated.reviewStatus
      });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/tasks/:taskId/review",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          taskId: z.string().min(1)
        })
        .parse(request.params);
      const body = taskReviewBodySchema.parse(request.body);
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

      const task = await app.services.prisma.task.findFirst({
        where: {
          id: params.taskId,
          workspaceId: params.workspaceId
        }
      });

      if (!task) {
        return reply.code(404).send({ message: "Task not found" });
      }

      const updated = await app.services.prisma.task.update({
        where: { id: task.id },
        data: {
          reviewStatus: body.reviewStatus,
          reviewedByUserId: session.userId,
          reviewedAt: new Date(),
          requiresReview: false
        }
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "TASK",
        entityId: task.id,
        action: `task.review_${body.reviewStatus.toLowerCase()}`,
        request
      });

      return reply.send({
        status: "reviewed",
        taskId: updated.id,
        reviewStatus: updated.reviewStatus
      });
    }
  );
};
