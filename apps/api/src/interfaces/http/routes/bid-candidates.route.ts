/**
 * Operational Bid Candidates API — permanent opportunities (not Jobs).
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { scopeDetailFromUserText } from "@forgeops/shared";
import {
  createBidCandidate,
  type CreateBidCandidateInput,
} from "../../../application/services/create-bid-candidate.js";
import { createBidCandidateFromEmail } from "../../../application/services/create-bid-candidate-from-email.js";
import { linkEmailToBidCandidate } from "../../../application/services/link-email-to-bid-candidate.js";
import {
  listBidCandidates,
  type BidCandidateListFilter,
} from "../../../application/services/list-bid-candidates.js";
import {
  canConvertBidCandidateToJob,
  ConvertBidCandidateError,
  convertBidCandidateToJob,
  previewConvertBidCandidateToJob,
  PromoteBidCandidateError,
} from "../../../application/services/promote-bid-candidate.js";
import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";

async function requireAuth(
  app: FastifyInstance,
  request: { headers: unknown },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  workspaceId: string
) {
  const session = await getSessionFromRequest(request as never);
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
    workspaceRole: membership.workspaceRole,
  };
}

const lifecycleEnum = z.enum([
  "OPEN",
  "QUOTED",
  "CONVERTED",
  "LOST",
  "ARCHIVED",
]);

export async function registerBidCandidatesRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get(
    "/api/v1/workspaces/:workspaceId/bid-candidates",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;

      const query = z
        .object({
          quote: z.enum(["all", "with", "without"]).optional().default("all"),
          lifecycle: z.string().optional(),
          dueSoon: z
            .enum(["true", "false", "1", "0"])
            .optional()
            .transform((v) => v === "true" || v === "1"),
          includeArchived: z
            .enum(["true", "false", "1", "0"])
            .optional()
            .transform((v) => v === "true" || v === "1"),
          search: z.string().optional(),
        })
        .parse(request.query);

      let lifecycle: Array<z.infer<typeof lifecycleEnum>> | undefined;
      if (query.lifecycle?.trim()) {
        lifecycle = query.lifecycle
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((s): s is z.infer<typeof lifecycleEnum> =>
            lifecycleEnum.safeParse(s).success
          );
      } else if (query.includeArchived) {
        lifecycle = ["OPEN", "QUOTED", "CONVERTED", "LOST", "ARCHIVED"];
      }

      const filter: BidCandidateListFilter = {
        quote: query.quote,
        dueSoonDays: query.dueSoon ? 14 : null,
        search: query.search ?? null,
      };
      if (lifecycle) filter.lifecycle = lifecycle;

      const candidates = await listBidCandidates({
        prisma: app.services.prisma,
        workspaceId,
        filter,
      });

      const summary = {
        total: candidates.length,
        withQuote: candidates.filter((c) => c.quoteCount > 0).length,
        withoutQuote: candidates.filter((c) => c.quoteCount === 0).length,
        dueSoon: candidates.filter((c) => {
          if (!c.bidDueAt) return false;
          const ms = c.bidDueAt.getTime() - Date.now();
          return ms >= 0 && ms <= 14 * 24 * 60 * 60 * 1000;
        }).length,
      };

      return reply.send({ candidates, summary });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/bid-candidates",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!["OWNER", "ADMIN", "MANAGER"].includes(auth.role)) {
        return reply.code(403).send({ message: "Permission denied" });
      }

      const body = z
        .object({
          projectName: z.string().min(1).max(300),
          customerName: z.string().max(200).nullable().optional(),
          customerId: z.string().min(1).nullable().optional(),
          resolveCreateCustomer: z.boolean().optional(),
          bidDueAt: z.string().datetime().nullable().optional(),
          anticipatedStartAt: z.string().datetime().nullable().optional(),
          scope: z.string().max(5000).nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
          estimatorUserId: z.string().min(1).nullable().optional(),
          externalProjectNumber: z.string().max(100).nullable().optional(),
        })
        .parse(request.body);

      try {
        const createInput: CreateBidCandidateInput = {
          prisma: app.services.prisma,
          workspaceId,
          userId: auth.userId,
          projectName: body.projectName,
          resolveCreateCustomer: body.resolveCreateCustomer === true,
        };
        if (body.customerName !== undefined) {
          createInput.customerName = body.customerName;
        }
        if (body.customerId !== undefined) createInput.customerId = body.customerId;
        if (body.bidDueAt !== undefined) {
          createInput.bidDueAt = body.bidDueAt ? new Date(body.bidDueAt) : null;
        }
        if (body.anticipatedStartAt !== undefined) {
          createInput.anticipatedStartAt = body.anticipatedStartAt
            ? new Date(body.anticipatedStartAt)
            : null;
        }
        if (body.scope !== undefined) createInput.scope = body.scope;
        if (body.notes !== undefined) createInput.notes = body.notes;
        if (body.estimatorUserId !== undefined) {
          createInput.estimatorUserId = body.estimatorUserId;
        }
        if (body.externalProjectNumber !== undefined) {
          createInput.externalProjectNumber = body.externalProjectNumber;
        }
        const result = await createBidCandidate(createInput);
        return reply.code(201).send(result);
      } catch (e) {
        if (e instanceof PromoteBidCandidateError) {
          return reply.code(400).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/bid-candidates/:candidateId",
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
        where: {
          id: params.candidateId,
          workspaceId: params.workspaceId,
        },
        include: {
          customer: { select: { id: true, name: true } },
          canonicalJob: {
            select: {
              id: true,
              jobNumber: true,
              name: true,
              status: true,
            },
          },
          proposedEstimatorUser: {
            select: { id: true, name: true, email: true },
          },
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
                  direction: true,
                  hasAttachments: true,
                  attachmentMetadata: true,
                  inboxConnectionId: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          quoteStagings: {
            where: { matchStatus: { not: "REJECTED" } },
            include: {
              emailMessage: {
                select: {
                  id: true,
                  subject: true,
                  sentAt: true,
                  receivedAt: true,
                  hasAttachments: true,
                  attachmentMetadata: true,
                  inboxConnectionId: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!c) {
        return reply.code(404).send({ message: "Bid Candidate not found" });
      }

      return reply.send({
        candidate: {
          id: c.id,
          identityKey: c.identityKey,
          lifecycle: c.lifecycle,
          analysisStatus: c.status,
          projectName: c.proposedProjectName,
          customerName: c.customer?.name ?? c.proposedCustomerName,
          customerId: c.customerId,
          bidDueAt: c.proposedBidDueAt,
          anticipatedStartAt: c.anticipatedStartAt,
          estimator: c.proposedEstimatorUser,
          externalProjectNumber: c.proposedJobNumber,
          scopeSummary: c.proposedScope,
          scopeDetail: c.proposedScopeDetail,
          notes: c.proposedNotes,
          originalBidSource: c.originalBidSource,
          canonicalJobId: c.canonicalJobId,
          canonicalJob: c.canonicalJob
            ? {
                id: c.canonicalJob.id,
                jobNumber: c.canonicalJob.jobNumber,
                name: c.canonicalJob.name,
                status: c.canonicalJob.status,
              }
            : null,
          userEditedFields: c.userEditedFields,
          evidence: c.evidence,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          emails: c.emails.map((e) => ({
            id: e.id,
            role: e.role,
            isPrimary: e.isPrimary,
            matchConfidence:
              e.matchConfidence != null ? Number(e.matchConfidence) : null,
            message: e.emailMessage,
          })),
          quotes: c.quoteStagings.map((q) => ({
            id: q.id,
            displayName: q.displayName ?? q.sourceSubject,
            amount: q.extractedAmount != null ? Number(q.extractedAmount) : null,
            currency: q.currency,
            scopeSummary: q.extractedScope,
            scopeDetail: q.extractedScopeDetail,
            notes: q.extractedNotes,
            isDurable: q.isDurable,
            matchStatus: q.matchStatus,
            message: q.emailMessage,
          })),
        },
      });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/bid-candidates/:candidateId",
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
          projectName: z.string().min(1).max(300).optional(),
          customerName: z.string().max(200).nullable().optional(),
          customerId: z.string().min(1).nullable().optional(),
          bidDueAt: z.string().datetime().nullable().optional(),
          anticipatedStartAt: z.string().datetime().nullable().optional(),
          scope: z.string().max(5000).nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
          lifecycle: lifecycleEnum.optional(),
          estimatorUserId: z.string().min(1).nullable().optional(),
          externalProjectNumber: z.string().max(100).nullable().optional(),
        })
        .parse(request.body);

      const existing = await app.services.prisma.bidCandidate.findFirst({
        where: { id: params.candidateId, workspaceId: params.workspaceId },
        select: { id: true, userEditedFields: true, lifecycle: true },
      });
      if (!existing) {
        return reply.code(404).send({ message: "Bid Candidate not found" });
      }

      const locked = new Set(
        Array.isArray(existing.userEditedFields)
          ? existing.userEditedFields.filter(
              (k): k is string => typeof k === "string"
            )
          : []
      );

      if (body.projectName !== undefined) locked.add("proposedProjectName");
      if (body.customerName !== undefined) locked.add("proposedCustomerName");
      if (body.customerId !== undefined) locked.add("customerId");
      if (body.bidDueAt !== undefined) locked.add("proposedBidDueAt");
      if (body.anticipatedStartAt !== undefined) locked.add("anticipatedStartAt");
      if (body.scope !== undefined) {
        locked.add("proposedScope");
        locked.add("proposedScopeDetail");
      }
      if (body.notes !== undefined) locked.add("proposedNotes");
      if (body.lifecycle !== undefined) locked.add("lifecycle");
      if (body.estimatorUserId !== undefined) locked.add("proposedEstimatorUserId");
      if (body.externalProjectNumber !== undefined) {
        locked.add("proposedJobNumber");
      }

      if (body.customerId) {
        const cust = await app.services.prisma.customer.findFirst({
          where: { id: body.customerId, workspaceId: params.workspaceId },
          select: { id: true },
        });
        if (!cust) {
          return reply.code(400).send({ message: "Customer not found" });
        }
      }

      const data: Prisma.BidCandidateUncheckedUpdateInput = {
        userEditedFields: [...locked],
      };
      if (body.projectName !== undefined) {
        data.proposedProjectName = body.projectName;
      }
      if (body.customerName !== undefined) {
        data.proposedCustomerName = body.customerName;
      }
      if (body.customerId !== undefined) data.customerId = body.customerId;
      if (body.bidDueAt !== undefined) {
        data.proposedBidDueAt = body.bidDueAt ? new Date(body.bidDueAt) : null;
      }
      if (body.anticipatedStartAt !== undefined) {
        data.anticipatedStartAt = body.anticipatedStartAt
          ? new Date(body.anticipatedStartAt)
          : null;
      }
      if (body.scope !== undefined) {
        data.proposedScope = body.scope;
        data.proposedScopeDetail = body.scope
          ? (scopeDetailFromUserText(body.scope) as Prisma.InputJsonValue)
          : Prisma.DbNull;
      }
      if (body.notes !== undefined) data.proposedNotes = body.notes;
      if (body.lifecycle !== undefined) data.lifecycle = body.lifecycle;
      if (body.estimatorUserId !== undefined) {
        data.proposedEstimatorUserId = body.estimatorUserId;
      }
      if (body.externalProjectNumber !== undefined) {
        data.proposedJobNumber = body.externalProjectNumber;
      }

      await app.services.prisma.bidCandidate.update({
        where: { id: existing.id },
        data,
      });

      return reply.send({ candidateId: existing.id });
    }
  );

  /** Inbox → permanent Bid Candidate (no Job). */
  app.post(
    "/api/v1/workspaces/:workspaceId/bid-candidates/from-email",
    async (request, reply) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!["OWNER", "ADMIN", "MANAGER"].includes(auth.role)) {
        return reply.code(403).send({ message: "Permission denied" });
      }

      const body = z
        .object({
          messageId: z.string().min(1),
          projectName: z.string().min(1).max(300),
          customerName: z.string().max(200).nullable().optional(),
          customerId: z.string().min(1).nullable().optional(),
          resolveCreateCustomer: z.boolean().optional(),
          bidDueAt: z.string().datetime().nullable().optional(),
          anticipatedStartAt: z.string().datetime().nullable().optional(),
          scope: z.string().max(5000).nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
          externalProjectNumber: z.string().max(100).nullable().optional(),
          role: z
            .enum(["BID_INVITE", "QUOTE", "SUPPORTING", "ADDENDUM"])
            .optional(),
        })
        .parse(request.body);

      try {
        const result = await createBidCandidateFromEmail({
          prisma: app.services.prisma,
          workspaceId,
          userId: auth.userId,
          messageId: body.messageId,
          projectName: body.projectName,
          resolveCreateCustomer: body.resolveCreateCustomer === true,
          role: body.role ?? "BID_INVITE",
          ...(body.customerName !== undefined
            ? { customerName: body.customerName }
            : {}),
          ...(body.customerId !== undefined
            ? { customerId: body.customerId }
            : {}),
          ...(body.bidDueAt !== undefined
            ? { bidDueAt: body.bidDueAt ? new Date(body.bidDueAt) : null }
            : {}),
          ...(body.anticipatedStartAt !== undefined
            ? {
                anticipatedStartAt: body.anticipatedStartAt
                  ? new Date(body.anticipatedStartAt)
                  : null,
              }
            : {}),
          ...(body.scope !== undefined ? { scope: body.scope } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.externalProjectNumber !== undefined
            ? { externalProjectNumber: body.externalProjectNumber }
            : {}),
        });
        return reply.code(201).send(result);
      } catch (e) {
        if (e instanceof PromoteBidCandidateError) {
          const code =
            e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400;
          return reply.code(code).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  /** Inbox → assign / reassign EmailMessage to an existing Bid Candidate. */
  app.post(
    "/api/v1/workspaces/:workspaceId/bid-candidates/:candidateId/assign-email",
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
          messageId: z.string().min(1),
          role: z
            .enum(["BID_INVITE", "SUPPORTING", "ADDENDUM", "QUOTE"])
            .optional(),
          /** Correct a prior manual association. */
          forceReassign: z.boolean().optional(),
        })
        .parse(request.body);

      try {
        const result = await linkEmailToBidCandidate({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          candidateId: params.candidateId,
          emailMessageId: body.messageId,
          role: body.role ?? "BID_INVITE",
          userConfirmed: true,
          isPrimary: true,
          applyBidInviteSubtype: true,
          forceReassign: body.forceReassign !== false,
        });
        return reply.send(result);
      } catch (e) {
        if (e instanceof PromoteBidCandidateError) {
          const code =
            e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400;
          return reply.code(code).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  /**
   * Convert to Job — review preview (does not create a Job or reserve a number).
   */
  app.get(
    "/api/v1/workspaces/:workspaceId/bid-candidates/:candidateId/convert-to-job",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          candidateId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canConvertBidCandidateToJob(auth.workspaceRole)) {
        return reply
          .code(403)
          .send({ message: "Edit permission required to convert to a Job" });
      }

      try {
        const preview = await previewConvertBidCandidateToJob({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          candidateId: params.candidateId,
        });
        return reply.send({ preview });
      } catch (e) {
        if (e instanceof ConvertBidCandidateError) {
          const code = e.code === "NOT_FOUND" ? 404 : 400;
          return reply.code(code).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  /**
   * Convert to Job — commit. Idempotent when already CONVERTED.
   */
  app.post(
    "/api/v1/workspaces/:workspaceId/bid-candidates/:candidateId/convert-to-job",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          candidateId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canConvertBidCandidateToJob(auth.workspaceRole)) {
        return reply
          .code(403)
          .send({ message: "Edit permission required to convert to a Job" });
      }

      const body = z
        .object({
          mode: z.enum(["create", "attach"]).optional().default("create"),
          existingJobId: z.string().min(1).optional(),
          projectName: z.string().min(1).max(300).optional(),
          customerName: z.string().max(200).nullable().optional(),
          customerId: z.string().min(1).nullable().optional(),
          jobNumber: z.string().min(1).max(50).optional(),
          startDate: z.string().datetime().nullable().optional(),
          bidDueAt: z.string().datetime().nullable().optional(),
          description: z.string().max(10000).nullable().optional(),
          notes: z.string().max(10000).nullable().optional(),
          estimatorUserId: z.string().min(1).nullable().optional(),
          alternateProjectNames: z.array(z.string().max(200)).optional(),
          confirmCreateDespiteExisting: z.boolean().optional(),
          preserveJobFields: z.boolean().optional(),
        })
        .parse(request.body ?? {});

      try {
        const result = await convertBidCandidateToJob({
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
          ...(body.jobNumber !== undefined
            ? { jobNumber: body.jobNumber }
            : {}),
          ...(body.startDate !== undefined
            ? {
                startDate: body.startDate ? new Date(body.startDate) : null,
              }
            : {}),
          ...(body.bidDueAt !== undefined
            ? { bidDueAt: body.bidDueAt ? new Date(body.bidDueAt) : null }
            : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.estimatorUserId !== undefined
            ? { estimatorUserId: body.estimatorUserId }
            : {}),
          ...(body.alternateProjectNames !== undefined
            ? { alternateProjectNames: body.alternateProjectNames }
            : {}),
          ...(body.confirmCreateDespiteExisting !== undefined
            ? {
                confirmCreateDespiteExisting: body.confirmCreateDespiteExisting,
              }
            : {}),
          ...(body.preserveJobFields !== undefined
            ? { preserveJobFields: body.preserveJobFields }
            : {}),
        });

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          actorUserId: auth.userId,
          entityType: "JOB",
          entityId: result.jobId,
          action: result.reused
            ? "bid_candidate.convert_idempotent"
            : "bid_candidate.converted_to_job",
          metadata: {
            candidateId: result.candidateId,
            jobNumber: result.jobNumber,
            created: result.created,
            reused: result.reused,
            jobStatus: result.jobStatus,
          },
          request,
        });

        return reply.send({
          candidate: {
            id: result.candidateId,
            lifecycle: "CONVERTED",
            canonicalJobId: result.jobId,
          },
          job: {
            id: result.jobId,
            jobNumber: result.jobNumber,
            name: result.jobName,
            status: result.jobStatus,
          },
          created: result.created,
          reused: result.reused,
          attachedEmailCount: result.attachedEmailCount,
          emailConflicts: result.emailConflicts,
        });
      } catch (e) {
        if (e instanceof ConvertBidCandidateError) {
          const status =
            e.code === "NOT_FOUND"
              ? 404
              : e.code === "FORBIDDEN"
                ? 403
                : e.code === "JOB_NUMBER_TAKEN" || e.code === "EXISTING_JOB"
                  ? 409
                  : 400;
          return reply.code(status).send({
            message: e.message,
            code: e.code,
            ...(e.causePayload && typeof e.causePayload === "object"
              ? (e.causePayload as object)
              : {}),
          });
        }
        throw e;
      }
    }
  );
}
