import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

/** Same sentinel as inbox-read All Mailboxes aggregate. */
const ALL_MAILBOXES_CONNECTION_ID = "__all__";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  /** ALL | NEEDS_REVIEW | REVIEWED */
  status: z.enum(["ALL", "NEEDS_REVIEW", "REVIEWED"]).default("ALL"),
  /** ALL | BUSINESS | PERSONAL */
  category: z.enum(["ALL", "BUSINESS", "PERSONAL"]).default("ALL"),
});

export type ClassificationAuditStatus =
  | "AUTO"
  | "NEEDS_REVIEW"
  | "CONFIRMED"
  | "CORRECTED"
  | "DISMISSED";

/** Needs human attention — not merely low confidence after human confirm. */
export function buildNeedsReviewClassificationWhere(): Prisma.ClassificationWhereInput {
  return {
    OR: [
      { requiresReview: true },
      { reviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
      {
        AND: [
          { reviewStatus: { notIn: ["APPROVED", "REJECTED"] } },
          {
            OR: [
              { itemStatus: "NEEDS_REVIEW" },
              { message: { is: { itemStatus: "NEEDS_REVIEW" } } },
            ],
          },
        ],
      },
    ],
  };
}

export function computeAuditStatus(input: {
  requiresReview: boolean;
  reviewStatus: string;
  previousCategory: string | null | undefined;
}): ClassificationAuditStatus {
  if (input.reviewStatus === "REJECTED") return "DISMISSED";
  if (input.reviewStatus === "APPROVED") {
    return input.previousCategory ? "CORRECTED" : "CONFIRMED";
  }
  if (
    input.requiresReview ||
    input.reviewStatus === "PENDING" ||
    input.reviewStatus === "IN_REVIEW"
  ) {
    return "NEEDS_REVIEW";
  }
  return "AUTO";
}

function hasMinRole(
  role: string,
  min: "ADMIN" | "OWNER"
): boolean {
  if (min === "OWNER") return role === "OWNER";
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Persistent classification audit list — every Classification row for the mailbox,
 * with Needs Review / Reviewed as filters (pageSize default 50).
 * Does not return body HTML/text or evidence JSON.
 */
export const registerClassificationAuditRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/classification-audit",
    async (request, reply) => {
      const t0 = performance.now();
      const params = paramsSchema.parse(request.params);
      const query = listQuerySchema.parse(request.query);

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
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply
          .code(403)
          .send({ message: "Classification audit requires Admin or Owner role" });
      }

      const isAll = params.id === ALL_MAILBOXES_CONNECTION_ID;
      const connections = isAll
        ? await app.services.prisma.inboxConnection.findMany({
            where: {
              workspaceId: params.workspaceId,
              status: { in: ["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH"] },
            },
            select: { id: true, email: true },
          })
        : await app.services.prisma.inboxConnection
            .findFirst({
              where: { id: params.id, workspaceId: params.workspaceId },
              select: { id: true, email: true },
            })
            .then((c) => (c ? [c] : []));

      if (connections.length === 0) {
        return reply.code(404).send({
          message: isAll ? "No inbox connections found" : "Inbox connection not found",
        });
      }

      const connectionIds = connections.map((c) => c.id);
      const connectionEmailById = new Map(
        connections.map((c) => [c.id, c.email])
      );

      const messageScope: Prisma.EmailMessageWhereInput = {
        workspaceId: params.workspaceId,
        inboxConnectionId:
          connectionIds.length === 1 ? connectionIds[0]! : { in: connectionIds },
        isTrashed: false,
      };
      if (query.category === "BUSINESS") {
        messageScope.mailboxCategory = "BUSINESS";
      } else if (query.category === "PERSONAL") {
        messageScope.mailboxCategory = "PERSONAL";
      }

      const where: Prisma.ClassificationWhereInput = {
        workspaceId: params.workspaceId,
        messageId: { not: null },
        message: messageScope,
      };

      if (query.status === "NEEDS_REVIEW") {
        Object.assign(where, buildNeedsReviewClassificationWhere());
      } else if (query.status === "REVIEWED") {
        where.reviewStatus = { in: ["APPROVED", "REJECTED"] };
      }

      const skip = (query.page - 1) * query.pageSize;

      const baseForCounts: Prisma.ClassificationWhereInput = {
        workspaceId: params.workspaceId,
        messageId: { not: null },
        message: {
          workspaceId: params.workspaceId,
          inboxConnectionId:
            connectionIds.length === 1
              ? connectionIds[0]!
              : { in: connectionIds },
          isTrashed: false,
        },
      };

      const [totalCount, needsReviewCount, reviewedCount, rows] =
        await Promise.all([
          app.services.prisma.classification.count({ where: baseForCounts }),
          app.services.prisma.classification.count({
            where: {
              ...baseForCounts,
              ...buildNeedsReviewClassificationWhere(),
            },
          }),
          app.services.prisma.classification.count({
            where: {
              ...baseForCounts,
              reviewStatus: { in: ["APPROVED", "REJECTED"] },
            },
          }),
          app.services.prisma.classification.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip,
            take: query.pageSize,
            select: {
              id: true,
              confidence: true,
              requiresReview: true,
              reviewStatus: true,
              reviewedAt: true,
              mailboxCategory: true,
              businessCategory: true,
              createdAt: true,
              message: {
                select: {
                  id: true,
                  subject: true,
                  snippet: true,
                  senderName: true,
                  senderEmail: true,
                  receivedAt: true,
                  sentAt: true,
                  mailboxCategory: true,
                  previousCategory: true,
                  inboxConnectionId: true,
                  itemStatus: true,
                },
              },
            },
          }),
        ]);

      const items = rows
        .filter((r) => r.message)
        .map((r) => {
          const message = r.message!;
          const finalCategory = message.mailboxCategory;
          const predictedCategory =
            message.previousCategory ??
            r.mailboxCategory ??
            finalCategory;
          const auditStatus = computeAuditStatus({
            requiresReview: r.requiresReview,
            reviewStatus: r.reviewStatus,
            previousCategory: message.previousCategory,
          });

          return {
            classificationId: r.id,
            messageId: message.id,
            inboxConnectionId: message.inboxConnectionId,
            mailboxEmail:
              connectionEmailById.get(message.inboxConnectionId) ?? null,
            date: (message.receivedAt ?? message.sentAt ?? r.createdAt).toISOString(),
            senderName: message.senderName,
            senderEmail: message.senderEmail,
            subject: message.subject,
            snippet: message.snippet,
            predictedCategory,
            finalCategory,
            confidence: Number(r.confidence.toString()),
            reviewStatus: r.reviewStatus,
            auditStatus,
            requiresReview: r.requiresReview,
            reviewedAt: r.reviewedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          };
        });

      const body = {
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        filters: {
          status: query.status,
          category: query.category,
        },
        summary: {
          total: totalCount,
          needsReview: needsReviewCount,
          reviewed: reviewedCount,
        },
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount:
            query.status === "NEEDS_REVIEW"
              ? needsReviewCount
              : query.status === "REVIEWED"
                ? reviewedCount
                : totalCount,
          totalPages: (() => {
            const n =
              query.status === "NEEDS_REVIEW"
                ? needsReviewCount
                : query.status === "REVIEWED"
                  ? reviewedCount
                  : totalCount;
            return n === 0 ? 0 : Math.ceil(n / query.pageSize);
          })(),
        },
        items,
      };

      request.log.info({
        event: "api-performance",
        route: "classification-audit.list",
        totalMs: Math.round(performance.now() - t0),
        resultCount: items.length,
        status: query.status,
        pageSize: query.pageSize,
      });

      return reply.send(body);
    }
  );
};
