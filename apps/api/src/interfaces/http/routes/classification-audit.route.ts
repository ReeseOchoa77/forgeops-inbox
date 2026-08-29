import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  buildClassificationEvidenceViewModel,
  buildInspectionSignals,
  buildPriorityInspection,
  computeClassificationHistoryStatus,
  listAvailableInspectionStages,
  resolveInspectionJobMarkers,
  type ClassificationHistoryStatus,
  type ClassificationInspectionPayload,
} from "@forgeops/shared";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

/** Same sentinel as inbox-read All Mailboxes aggregate. */
const ALL_MAILBOXES_CONNECTION_ID = "__all__";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const classificationParamsSchema = paramsSchema.extend({
  classificationId: z.string().min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  /** ALL | CORRECTED | CONFIRMED — no Needs Review product filter */
  status: z.enum(["ALL", "CORRECTED", "CONFIRMED"]).default("ALL"),
  /** ALL | BUSINESS | PERSONAL */
  category: z.enum(["ALL", "BUSINESS", "PERSONAL"]).default("ALL"),
});

const detailQuerySchema = z.object({
  includeBody: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

/** @deprecated Needs Review filter removed from product — returns impossible match. */
export function buildNeedsReviewClassificationWhere(): Prisma.ClassificationWhereInput {
  return { id: "__removed_needs_review_filter__" };
}

/** @deprecated use computeClassificationHistoryStatus */
export function computeAuditStatus(input: {
  requiresReview: boolean;
  reviewStatus: string;
  previousCategory: string | null | undefined;
}): ClassificationHistoryStatus {
  return computeClassificationHistoryStatus({
    reviewStatus: input.reviewStatus,
    previousCategory: input.previousCategory,
  });
}

function hasMinRole(role: string, min: "ADMIN" | "OWNER"): boolean {
  if (min === "OWNER") return role === "OWNER";
  return role === "OWNER" || role === "ADMIN";
}

function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

function asMatchEvidenceArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Classification history list + inspection detail.
 * Product surface is audit/debug — not a Needs Review workflow.
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
          message: isAll
            ? "No inbox connections found"
            : "Inbox connection not found",
        });
      }

      const connectionIds = connections.map((c) => c.id);
      const connectionEmailById = new Map(
        connections.map((c) => [c.id, c.email])
      );

      const messageScope: Prisma.EmailMessageWhereInput = {
        workspaceId: params.workspaceId,
        inboxConnectionId:
          connectionIds.length === 1
            ? connectionIds[0]!
            : { in: connectionIds },
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

      if (query.status === "CORRECTED") {
        where.reviewStatus = "APPROVED";
        where.message = {
          ...messageScope,
          previousCategory: { not: null },
        };
      } else if (query.status === "CONFIRMED") {
        where.reviewStatus = "APPROVED";
        where.message = {
          ...messageScope,
          previousCategory: null,
        };
      }

      const skip = (query.page - 1) * query.pageSize;

      const baseMessageScope: Prisma.EmailMessageWhereInput = {
        workspaceId: params.workspaceId,
        inboxConnectionId:
          connectionIds.length === 1
            ? connectionIds[0]!
            : { in: connectionIds },
        isTrashed: false,
      };

      const baseForCounts: Prisma.ClassificationWhereInput = {
        workspaceId: params.workspaceId,
        messageId: { not: null },
        message: baseMessageScope,
      };

      const [totalCount, correctedCount, confirmedCount, rows] =
        await Promise.all([
          app.services.prisma.classification.count({ where: baseForCounts }),
          app.services.prisma.classification.count({
            where: {
              ...baseForCounts,
              reviewStatus: "APPROVED",
              message: { ...baseMessageScope, previousCategory: { not: null } },
            },
          }),
          app.services.prisma.classification.count({
            where: {
              ...baseForCounts,
              reviewStatus: "APPROVED",
              message: { ...baseMessageScope, previousCategory: null },
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
              reviewStatus: true,
              reviewedAt: true,
              mailboxCategory: true,
              businessTypeKey: true,
              priority: true,
              createdAt: true,
              job: {
                select: { id: true, jobNumber: true, name: true },
              },
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
                  priority: true,
                },
              },
            },
          }),
        ]);

      const filteredTotal =
        query.status === "CORRECTED"
          ? correctedCount
          : query.status === "CONFIRMED"
            ? confirmedCount
            : totalCount;

      const items = rows
        .filter((r) => r.message)
        .map((r) => {
          const message = r.message!;
          const finalCategory = message.mailboxCategory;
          const predictedCategory =
            message.previousCategory ?? r.mailboxCategory ?? finalCategory;
          const historyStatus = computeClassificationHistoryStatus({
            reviewStatus: r.reviewStatus,
            previousCategory: message.previousCategory,
          });

          return {
            classificationId: r.id,
            messageId: message.id,
            inboxConnectionId: message.inboxConnectionId,
            mailboxEmail:
              connectionEmailById.get(message.inboxConnectionId) ?? null,
            date: (
              message.receivedAt ??
              message.sentAt ??
              r.createdAt
            ).toISOString(),
            senderName: message.senderName,
            senderEmail: message.senderEmail,
            subject: message.subject,
            snippet: message.snippet,
            predictedCategory,
            finalCategory,
            businessTypeKey: r.businessTypeKey,
            priority: r.priority ?? message.priority,
            job: r.job
              ? {
                  id: r.job.id,
                  jobNumber: r.job.jobNumber,
                  name: r.job.name,
                }
              : null,
            confidence: Number(r.confidence.toString()),
            reviewStatus: r.reviewStatus,
            historyStatus,
            auditStatus: historyStatus,
            reviewedAt: r.reviewedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          };
        });

      request.log.info({
        event: "api-performance",
        route: "classification-audit.list",
        totalMs: Math.round(performance.now() - t0),
        resultCount: items.length,
        status: query.status,
        pageSize: query.pageSize,
      });

      return reply.send({
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        filters: {
          status: query.status,
          category: query.category,
        },
        summary: {
          total: totalCount,
          corrected: correctedCount,
          confirmed: confirmedCount,
        },
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount: filteredTotal,
          totalPages:
            filteredTotal === 0
              ? 0
              : Math.ceil(filteredTotal / query.pageSize),
        },
        items,
      });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/classification-audit/:classificationId",
    async (request, reply) => {
      const t0 = performance.now();
      const params = classificationParamsSchema.parse(request.params);
      const query = detailQuerySchema.parse(request.query ?? {});

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
      const connections = await app.services.prisma.inboxConnection.findMany({
        where: isAll
          ? {
              workspaceId: params.workspaceId,
              status: { in: ["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH"] },
            }
          : { id: params.id, workspaceId: params.workspaceId },
        select: { id: true },
      });
      if (connections.length === 0) {
        return reply.code(404).send({ message: "Inbox connection not found" });
      }
      const connectionIds = connections.map((c) => c.id);

      const row = await app.services.prisma.classification.findFirst({
        where: {
          id: params.classificationId,
          workspaceId: params.workspaceId,
          messageId: { not: null },
          message: {
            workspaceId: params.workspaceId,
            inboxConnectionId: { in: connectionIds },
            isTrashed: false,
          },
        },
        select: {
          id: true,
          messageId: true,
          mailboxCategory: true,
          businessTypeKey: true,
          businessTypeConfidence: true,
          priority: true,
          confidence: true,
          containsActionRequest: true,
          summary: true,
          modelName: true,
          modelVersion: true,
          reviewStatus: true,
          classificationEvidence: true,
          matchEvidence: true,
          entityMatchConfidence: true,
          createdAt: true,
          processedAt: true,
          customer: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
          job: { select: { id: true, jobNumber: true, name: true } },
          tasks: {
            where: { workspaceId: params.workspaceId },
            select: {
              id: true,
              title: true,
              summary: true,
              dueAt: true,
              priority: true,
              status: true,
              confidence: true,
            },
            orderBy: { createdAt: "asc" },
            take: 20,
          },
          corrections: {
            where: { workspaceId: params.workspaceId },
            select: {
              id: true,
              originalMailboxCategory: true,
              correctedMailboxCategory: true,
              originalBusinessType: true,
              correctedBusinessType: true,
              originalJobId: true,
              correctedJobId: true,
              originalPriority: true,
              correctedPriority: true,
              reason: true,
              reviewedAt: true,
            },
            orderBy: { reviewedAt: "desc" },
            take: 20,
          },
          message: {
            select: {
              id: true,
              subject: true,
              snippet: true,
              senderName: true,
              senderEmail: true,
              toAddresses: true,
              receivedAt: true,
              sentAt: true,
              previousCategory: true,
              mailboxCategory: true,
              ...(query.includeBody ? { bodyText: true } : {}),
            },
          },
        },
      });

      if (!row || !row.message || !row.messageId) {
        return reply.code(404).send({ message: "Classification not found" });
      }

      const message = row.message;
      const finalCategory = message.mailboxCategory ?? row.mailboxCategory;
      const evidence = row.classificationEvidence;
      const vm = buildClassificationEvidenceViewModel(evidence, finalCategory);
      const signals = buildInspectionSignals(vm);
      const priorityDecision = buildPriorityInspection(evidence, row.priority);

      const senderEmail = message.senderEmail.toLowerCase().trim();
      const domain = domainFromEmail(senderEmail);

      const [senderEvidence, domainEvidence] = await Promise.all([
        app.services.prisma.senderEvidence.findUnique({
          where: {
            workspaceId_normalizedEmail: {
              workspaceId: params.workspaceId,
              normalizedEmail: senderEmail,
            },
          },
          select: {
            senderEmail: true,
            displayName: true,
            status: true,
            confidence: true,
            businessEvidenceCount: true,
            personalEvidenceCount: true,
            manualBusinessConfirmations: true,
            manualPersonalConfirmations: true,
          },
        }),
        domain
          ? app.services.prisma.domainEvidence.findUnique({
              where: {
                workspaceId_domain: {
                  workspaceId: params.workspaceId,
                  domain,
                },
              },
              select: {
                domain: true,
                status: true,
                confidence: true,
                isPublicDomain: true,
                businessEvidenceCount: true,
                personalEvidenceCount: true,
              },
            })
          : Promise.resolve(null),
      ]);

      const historyStatus = computeClassificationHistoryStatus({
        reviewStatus: row.reviewStatus,
        previousCategory: message.previousCategory,
      });

      const { jobAssociation, jobCandidate } = resolveInspectionJobMarkers({
        evidence,
        linkedJob: row.job,
      });

      const payload: ClassificationInspectionPayload = {
        classification: {
          id: row.id,
          messageId: row.messageId,
          mailboxCategory: finalCategory,
          businessTypeKey: row.businessTypeKey,
          businessTypeConfidence: row.businessTypeConfidence
            ? Number(row.businessTypeConfidence.toString())
            : null,
          priority: row.priority,
          confidence: Number(row.confidence.toString()),
          containsActionRequest: row.containsActionRequest,
          summary: row.summary,
          modelName: row.modelName,
          modelVersion: row.modelVersion,
          reviewStatus: row.reviewStatus,
          historyStatus,
          createdAt: row.createdAt.toISOString(),
          processedAt: row.processedAt?.toISOString() ?? null,
        },
        decision: vm
          ? {
              rule: vm.decisionRule,
              title: vm.decisionTitle,
              summary: vm.decisionSummary,
              category: vm.categoryLabel,
              format: vm.format,
              cumulative: vm.cumulative,
            }
          : null,
        signals,
        priorityDecision,
        entities: {
          customer: row.customer,
          vendor: row.vendor,
          job: row.job,
          entityMatchConfidence: row.entityMatchConfidence
            ? Number(row.entityMatchConfidence.toString())
            : null,
          matchEvidence: asMatchEvidenceArray(row.matchEvidence),
        },
        jobAssociation,
        jobCandidate,
        tasks: row.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          summary: t.summary,
          dueAt: t.dueAt?.toISOString() ?? null,
          priority: t.priority,
          status: t.status,
          confidence: Number(t.confidence.toString()),
        })),
        senderEvidence: senderEvidence
          ? {
              email: senderEvidence.senderEmail,
              status: senderEvidence.status,
              confidence: Number(senderEvidence.confidence.toString()),
              displayName: senderEvidence.displayName,
              businessEvidenceCount: senderEvidence.businessEvidenceCount,
              personalEvidenceCount: senderEvidence.personalEvidenceCount,
              manualBusinessConfirmations:
                senderEvidence.manualBusinessConfirmations,
              manualPersonalConfirmations:
                senderEvidence.manualPersonalConfirmations,
            }
          : null,
        domainEvidence: domainEvidence
          ? {
              domain: domainEvidence.domain,
              status: domainEvidence.status,
              confidence: Number(domainEvidence.confidence.toString()),
              isPublicDomain: domainEvidence.isPublicDomain,
              businessEvidenceCount: domainEvidence.businessEvidenceCount,
              personalEvidenceCount: domainEvidence.personalEvidenceCount,
            }
          : null,
        corrections: row.corrections.map((c) => ({
          id: c.id,
          originalMailboxCategory: c.originalMailboxCategory,
          correctedMailboxCategory: c.correctedMailboxCategory,
          originalBusinessType: c.originalBusinessType,
          correctedBusinessType: c.correctedBusinessType,
          originalJobId: c.originalJobId,
          correctedJobId: c.correctedJobId,
          originalPriority: c.originalPriority,
          correctedPriority: c.correctedPriority,
          reason: c.reason,
          reviewedAt: c.reviewedAt.toISOString(),
        })),
        email: {
          fromName: message.senderName,
          fromEmail: message.senderEmail,
          to: message.toAddresses,
          subject: message.subject,
          date: (
            message.receivedAt ??
            message.sentAt ??
            row.createdAt
          ).toISOString(),
          snippet: message.snippet,
          ...(query.includeBody
            ? {
                bodyText:
                  "bodyText" in message
                    ? ((message as { bodyText?: string | null }).bodyText ??
                      null)
                    : null,
              }
            : {}),
        },
        availableStages: listAvailableInspectionStages({
          hasSignals: signals.length > 0,
          hasSubtype: Boolean(row.businessTypeKey),
          hasEntities: Boolean(
            row.customer ||
              row.vendor ||
              row.job ||
              asMatchEvidenceArray(row.matchEvidence).length
          ),
          hasTasks: row.tasks.length > 0,
          hasPriorityDecision: Boolean(priorityDecision),
        }),
      };

      request.log.info({
        event: "api-performance",
        route: "classification-audit.inspect",
        totalMs: Math.round(performance.now() - t0),
        includeBody: Boolean(query.includeBody),
        stages: payload.availableStages.length,
      });

      return reply.send(payload);
    }
  );
};
