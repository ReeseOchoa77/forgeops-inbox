import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BIDDING_FOLDER_SCAN_RANGE_OPTIONS,
  DEFAULT_BIDDING_FOLDER_SCAN_RANGE,
  emptyBidEmailAnalyzeProgress,
  type BidEmailAnalyzeProgress,
} from "@forgeops/shared";

import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import {
  BidEmailAnalyzeError,
  enqueueBidEmailAnalyze,
} from "../../../application/services/enqueue-bid-email-analyze.js";
import {
  countBidFolderDiscoveryByRole,
  listBidFolderDiscoveryEmails,
} from "../../../application/services/list-bid-folder-discovery.js";
import {
  PromoteBidCandidateError,
  canPromoteBidCandidate,
  promoteBidCandidate,
  rejectBidCandidate,
  updateBidCandidateReview,
} from "../../../application/services/promote-bid-candidate.js";

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
    role: membership.role,
  };
}

function serializeRun(run: {
  id: string;
  workspaceId: string;
  inboxConnectionId: string;
  status: string;
  progress: unknown;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  scanRangePreset?: string;
  scanSinceAt?: Date | null;
  scanUntilAt?: Date | null;
}) {
  const progress =
    run.progress && typeof run.progress === "object" && !Array.isArray(run.progress)
      ? ({
          ...emptyBidEmailAnalyzeProgress(),
          ...(run.progress as object),
        } as BidEmailAnalyzeProgress)
      : emptyBidEmailAnalyzeProgress();
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    inboxConnectionId: run.inboxConnectionId,
    status: run.status,
    scanRangePreset: run.scanRangePreset ?? progress.scanRangePreset,
    scanSinceAt: run.scanSinceAt?.toISOString() ?? progress.scanSinceAt,
    scanUntilAt: run.scanUntilAt?.toISOString() ?? null,
    progress,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
  };
}

export async function registerBidAnalysisRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/workspaces/:workspaceId/bid-analysis/analyze",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      // OWNER/ADMIN promote; MANAGER may run analysis (same as project-folder edit).
      if (!["OWNER", "ADMIN", "MANAGER"].includes(auth.role)) {
        return reply.code(403).send({ message: "Permission denied" });
      }

      const body = z
        .object({
          connectionId: z.string().min(1),
          operation: z.enum(["scan", "analyze"]).default("scan"),
          scanRangePreset: z.string().min(1).default(DEFAULT_BIDDING_FOLDER_SCAN_RANGE),
          customSinceAt: z.string().min(1).nullable().optional(),
        })
        .parse(request.body);

      try {
        const result = await enqueueBidEmailAnalyze({
          prisma: app.services.prisma,
          queue: app.services.bidEmailAnalyzeQueue,
          workspaceId,
          connectionId: body.connectionId,
          initiatedByUserId: auth.userId,
          operation: body.operation,
          scanRangePreset: body.scanRangePreset,
          ...(body.customSinceAt !== undefined
            ? { customSinceAt: body.customSinceAt }
            : {}),
        });

        await app.services.auditEventLogger.log({
          workspaceId,
          actorUserId: auth.userId,
          entityType: "FOLDER_DISCOVERY",
          entityId: body.connectionId,
          action: "bid_analysis.analyze_queued",
          metadata: {
            runId: result.runId,
            operation: result.operation,
            scanRangePreset: result.scanRangePreset,
            scanSinceAt: result.scanSinceAt,
          },
          request,
        });

        return reply.code(202).send({
          status: "queued",
          runId: result.runId,
          operation: result.operation,
          scanRangePreset: result.scanRangePreset,
          scanSinceAt: result.scanSinceAt,
        });
      } catch (e) {
        if (e instanceof BidEmailAnalyzeError) {
          const status =
            e.code === "CONNECTION_NOT_FOUND" || e.code === "NOT_OUTLOOK"
              ? 404
              : e.code === "NOT_AUTHORIZED"
                ? 401
                : e.code === "ALREADY_RUNNING" ||
                    e.code === "INVALID_RANGE" ||
                    e.code === "NO_DISCOVERY"
                  ? 409
                  : 502;
          return reply.code(status).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-analysis/scan-range-options",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      return reply.send({
        defaultPreset: DEFAULT_BIDDING_FOLDER_SCAN_RANGE,
        options: BIDDING_FOLDER_SCAN_RANGE_OPTIONS,
      });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-analysis/discovery",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const query = z
        .object({
          connectionId: z.string().min(1),
          role: z.enum(["BID_INVITE", "QUOTE"]),
          sort: z.enum(["newest", "oldest"]).default("newest"),
          search: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);

      const result = await listBidFolderDiscoveryEmails({
        prisma: app.services.prisma,
        workspaceId,
        connectionId: query.connectionId,
        role: query.role,
        sort: query.sort,
        ...(query.search !== undefined ? { search: query.search } : {}),
        page: query.page,
        pageSize: query.pageSize,
      });
      return reply.send(result);
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-analysis/discovery/counts",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const query = z
        .object({ connectionId: z.string().min(1) })
        .parse(request.query);
      const counts = await countBidFolderDiscoveryByRole({
        prisma: app.services.prisma,
        workspaceId,
        connectionId: query.connectionId,
      });
      return reply.send(counts);
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-analysis/runs/latest",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const query = z
        .object({ connectionId: z.string().min(1) })
        .parse(request.query);
      const run = await app.services.prisma.bidAnalysisRun.findFirst({
        where: {
          workspaceId,
          inboxConnectionId: query.connectionId,
        },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ run: run ? serializeRun(run) : null });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-analysis/runs/:runId",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          runId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      const run = await app.services.prisma.bidAnalysisRun.findFirst({
        where: { id: params.runId, workspaceId: params.workspaceId },
      });
      if (!run) return reply.code(404).send({ message: "Bid analysis run not found" });
      return reply.send({ run: serializeRun(run) });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-analysis/candidates",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const query = z
        .object({
          status: z
            .enum(["DISCOVERED", "READY", "NEEDS_REVIEW", "CONFIRMED", "REJECTED"])
            .optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        })
        .parse(request.query);

      const rows = await app.services.prisma.bidCandidate.findMany({
        where: {
          workspaceId,
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: query.limit,
        include: {
          emails: {
            select: { id: true, role: true, matchConfidence: true },
          },
          canonicalJob: {
            select: { id: true, name: true, jobNumber: true, status: true },
          },
        },
      });

      return reply.send({
        candidates: rows.map((c) => {
          const inviteCount = c.emails.filter(
            (e) => e.role === "BID_INVITE" || e.role === "ADDENDUM" || e.role === "SUPPORTING"
          ).length;
          const quoteCount = c.emails.filter((e) => e.role === "QUOTE").length;
          return {
            id: c.id,
            status: c.status,
            proposedProjectName: c.proposedProjectName,
            proposedCustomerName: c.proposedCustomerName,
            proposedBidDueAt: c.proposedBidDueAt,
            proposedJobNumber: c.proposedJobNumber,
            proposedEstimatorUserId: c.proposedEstimatorUserId,
            confidence: c.confidence != null ? Number(c.confidence) : null,
            inviteCount,
            quoteCount,
            canonicalJobId: c.canonicalJobId,
            canonicalJob: c.canonicalJob,
            confirmedAt: c.confirmedAt,
            updatedAt: c.updatedAt,
            createdAt: c.createdAt,
          };
        }),
      });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-analysis/candidates/:candidateId",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          candidateId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;

      const c = await app.services.prisma.bidCandidate.findFirst({
        where: { id: params.candidateId, workspaceId: params.workspaceId },
        include: {
          emails: {
            include: {
              emailMessage: {
                select: {
                  id: true,
                  subject: true,
                  senderName: true,
                  senderEmail: true,
                  receivedAt: true,
                  sentAt: true,
                  hasAttachments: true,
                  attachmentMetadata: true,
                  jobId: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          canonicalJob: {
            select: { id: true, name: true, jobNumber: true, status: true },
          },
        },
      });
      if (!c) return reply.code(404).send({ message: "Bid candidate not found" });

      return reply.send({
        candidate: {
          id: c.id,
          status: c.status,
          identityKey: c.identityKey,
          proposedProjectName: c.proposedProjectName,
          proposedCustomerName: c.proposedCustomerName,
          proposedBidDueAt: c.proposedBidDueAt,
          proposedJobNumber: c.proposedJobNumber,
          proposedEstimatorUserId: c.proposedEstimatorUserId,
          confidence: c.confidence != null ? Number(c.confidence) : null,
          evidence: c.evidence,
          reviewNotes: c.reviewNotes,
          canonicalJobId: c.canonicalJobId,
          canonicalJob: c.canonicalJob,
          confirmedAt: c.confirmedAt,
          confirmedByUserId: c.confirmedByUserId,
          emails: c.emails.map((link) => ({
            id: link.id,
            role: link.role,
            matchConfidence:
              link.matchConfidence != null ? Number(link.matchConfidence) : null,
            matchEvidence: link.matchEvidence,
            isPrimary: link.isPrimary,
            email: link.emailMessage,
          })),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
      });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/bid-analysis/candidates/:candidateId",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          candidateId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!["OWNER", "ADMIN", "MANAGER"].includes(auth.role)) {
        return reply.code(403).send({ message: "Permission denied" });
      }
      const body = z
        .object({
          projectName: z.string().nullable().optional(),
          customerName: z.string().nullable().optional(),
          bidDueAt: z.string().datetime().nullable().optional(),
          jobNumber: z.string().nullable().optional(),
          estimatorUserId: z.string().nullable().optional(),
          status: z.enum(["READY", "NEEDS_REVIEW", "DISCOVERED"]).optional(),
          reviewNotes: z.string().nullable().optional(),
        })
        .parse(request.body);

      try {
        await updateBidCandidateReview({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          candidateId: params.candidateId,
          ...(body.projectName !== undefined
            ? { projectName: body.projectName }
            : {}),
          ...(body.customerName !== undefined
            ? { customerName: body.customerName }
            : {}),
          ...(body.bidDueAt !== undefined
            ? {
                bidDueAt: body.bidDueAt ? new Date(body.bidDueAt) : null,
              }
            : {}),
          ...(body.jobNumber !== undefined ? { jobNumber: body.jobNumber } : {}),
          ...(body.estimatorUserId !== undefined
            ? { estimatorUserId: body.estimatorUserId }
            : {}),
          ...(body.status ? { status: body.status } : {}),
          ...(body.reviewNotes !== undefined
            ? { reviewNotes: body.reviewNotes }
            : {}),
        });
        return reply.send({ status: "ok", candidateId: params.candidateId });
      } catch (e) {
        if (e instanceof PromoteBidCandidateError) {
          const code = e.code === "NOT_FOUND" ? 404 : 409;
          return reply.code(code).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/bid-analysis/candidates/:candidateId/promote",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          candidateId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canPromoteBidCandidate(auth.role)) {
        return reply
          .code(403)
          .send({ message: "Only OWNER/ADMIN can create bids from staging" });
      }

      const body = z
        .object({
          mode: z.enum(["create", "attach"]).default("create"),
          existingJobId: z.string().min(1).optional(),
          projectName: z.string().optional(),
          customerName: z.string().nullable().optional(),
          customerId: z.string().nullable().optional(),
          bidDueAt: z.string().datetime().nullable().optional(),
          jobNumber: z.string().nullable().optional(),
          estimatorUserId: z.string().nullable().optional(),
          alternateProjectNames: z.array(z.string()).optional(),
          confirmCreateDespiteExisting: z.boolean().optional(),
        })
        .parse(request.body ?? {});

      try {
        const result = await promoteBidCandidate({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          candidateId: params.candidateId,
          userId: auth.userId,
          mode: body.mode,
          ...(body.existingJobId !== undefined
            ? { existingJobId: body.existingJobId }
            : {}),
          ...(body.projectName !== undefined
            ? { projectName: body.projectName }
            : {}),
          ...(body.customerName !== undefined
            ? { customerName: body.customerName }
            : {}),
          ...(body.customerId !== undefined
            ? { customerId: body.customerId }
            : {}),
          ...(body.bidDueAt !== undefined
            ? {
                bidDueAt: body.bidDueAt ? new Date(body.bidDueAt) : null,
              }
            : {}),
          ...(body.jobNumber !== undefined ? { jobNumber: body.jobNumber } : {}),
          ...(body.estimatorUserId !== undefined
            ? { estimatorUserId: body.estimatorUserId }
            : {}),
          ...(body.alternateProjectNames
            ? { alternateProjectNames: body.alternateProjectNames }
            : {}),
          ...(body.confirmCreateDespiteExisting !== undefined
            ? {
                confirmCreateDespiteExisting: body.confirmCreateDespiteExisting,
              }
            : {}),
        });

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          actorUserId: auth.userId,
          entityType: "JOB",
          entityId: result.jobId,
          action: "bid_analysis.candidate_promoted",
          metadata: {
            candidateId: result.candidateId,
            created: result.created,
            attachedEmailCount: result.attachedEmailCount,
          },
          request,
        });

        return reply.code(result.created ? 201 : 200).send(result);
      } catch (e) {
        if (e instanceof PromoteBidCandidateError) {
          const status =
            e.code === "NOT_FOUND" || e.code === "ATTACH_JOB_NOT_FOUND"
              ? 404
              : e.code === "EXISTING_JOB" || e.code === "JOB_NUMBER_TAKEN"
                ? 409
                : e.code === "FORBIDDEN"
                  ? 403
                  : 400;
          return reply.code(status).send({
            message: e.message,
            code: e.code,
            cause: e.causePayload,
          });
        }
        throw e;
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/bid-analysis/candidates/:candidateId/reject",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          candidateId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canPromoteBidCandidate(auth.role) && auth.role !== "MANAGER") {
        return reply.code(403).send({ message: "Permission denied" });
      }
      const body = z
        .object({ reviewNotes: z.string().nullable().optional() })
        .parse(request.body ?? {});

      try {
        const result = await rejectBidCandidate({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          candidateId: params.candidateId,
          userId: auth.userId,
          ...(body.reviewNotes !== undefined
            ? { reviewNotes: body.reviewNotes }
            : {}),
        });
        return reply.send({ status: "rejected", ...result });
      } catch (e) {
        if (e instanceof PromoteBidCandidateError) {
          const code = e.code === "NOT_FOUND" ? 404 : 409;
          return reply.code(code).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );
}
