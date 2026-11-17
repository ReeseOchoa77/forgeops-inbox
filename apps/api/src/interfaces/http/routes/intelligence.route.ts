import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getIntelligenceDefinition,
  listIntelligenceSafeDtos,
  toIntelligenceSafeDto,
} from "@forgeops/shared";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { inspectIntelligenceInstructions } from "../../../application/services/intelligence-prompt-inspection.js";
import {
  previewJobMatcherEvalDataset,
  runJobMatcherHistoricalEval,
} from "../../../application/services/run-job-matcher-historical-eval.js";
import { getJobMatcherEvalProgress } from "../../../application/services/job-matcher-eval-progress.js";
import {
  excludeJobMatcherEvalEmail,
  getJobMatcherEvalRun,
  listJobMatcherEvalExclusions,
  persistJobMatcherEvalRun,
  restoreJobMatcherEvalEmail,
} from "../../../application/services/job-matcher-eval-exclusions.js";
import {
  reverseJobMatcherEvalGroundTruthCorrection,
  verifyJobMatcherEvalGroundTruthCorrection,
} from "../../../application/services/job-matcher-eval-ground-truth-corrections.js";
import { runJobMatcherTestOne } from "../../../application/services/run-job-matcher-test-one.js";
import { loadIntelligenceEvalEmail } from "../../../application/services/load-intelligence-eval-email.js";
import {
  enqueueSubtypeDiscoveryRun,
  getSubtypeDiscoveryRun,
  listSubtypeDiscoveryRuns,
  previewSubtypeDiscoveryDataset,
  requestCancelSubtypeDiscoveryRun,
  SubtypeDiscoveryError,
} from "../../../application/services/subtype-discovery.js";
import {
  approveAndApplyRecommendation,
  getSubtypeTaxonomyEval,
  listRecommendationDecisions,
  listSubtypeTaxonomyEvals,
  listTaxonomyRevisions,
  previewApprovalChange,
  rollbackTaxonomyRevision,
  runSubtypeTaxonomyEval,
  SubtypeRecommendationReviewError,
  upsertRecommendationDecision,
} from "../../../application/services/subtype-recommendation-review.js";
import { getSessionFromRequest } from "../authentication.js";

const datasetSpecSchema = z.object({
  jobsMode: z.enum(["ALL", "SPECIFIC", "SELECTED"]),
  jobIds: z.array(z.string().min(1)).max(200).optional(),
  sampling: z.enum(["TOTAL", "PER_JOB", "ALL_ELIGIBLE"]),
  /** TOTAL sample max 1000; ALL_ELIGIBLE uses null (uncapped). */
  count: z.number().int().min(1).max(1000).nullable().optional(),
  jobLifecycle: z.enum(["ALL", "CURRENT", "ARCHIVED"]).optional(),
});

const wsParams = z.object({ workspaceId: z.string().min(1) });
const idParams = z.object({
  workspaceId: z.string().min(1),
  intelligenceId: z.string().min(1),
});

function requireAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function stripUndefined<T extends Record<string, unknown>>(
  obj: T
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}

async function requireIntelligenceAccess(
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
  if (!requireAdmin(membership.role)) {
    reply.code(403).send({ message: "Admin permission required" });
    return null;
  }
  return { userId: session.userId, role: membership.role };
}

export const registerIntelligenceRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  /** List discoverable intelligence (safe DTOs from registry). */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;

      const includeHidden =
        z
          .object({
            includeHidden: z
              .enum(["true", "false"])
              .optional()
              .transform((v) => v === "true"),
          })
          .parse(request.query).includeHidden === true;

      return reply.send({
        components: listIntelligenceSafeDtos({
          discoverableOnly: !includeHidden,
        }),
      });
    }
  );

  /** Detail for one registered intelligence + optional instruction inspection. */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/:intelligenceId",
    async (request, reply) => {
      const { workspaceId, intelligenceId } = idParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;

      const def = getIntelligenceDefinition(intelligenceId);
      if (!def) {
        return reply.code(404).send({ message: "Intelligence not found" });
      }

      const dto = toIntelligenceSafeDto(def);
      const instructions =
        def.instructions.available === true
          ? inspectIntelligenceInstructions(def.instructions.inspectionKeys)
          : [];

      return reply.send({
        component: dto,
        instructions,
      });
    }
  );

  /** Preview eligible counts for a dataset definition (no matcher run). */
  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/eval-dataset-preview",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;

      const body = z
        .object({
          dataset: datasetSpecSchema.optional(),
          limit: z.union([z.literal(50), z.literal(100), z.literal(500)]).optional(),
        })
        .parse(request.body);

      try {
        const preview = await previewJobMatcherEvalDataset({
          prisma: app.services.prisma,
          workspaceId,
          spec: body.dataset
            ? {
                jobsMode: body.dataset.jobsMode,
                sampling: body.dataset.sampling,
                ...(body.dataset.jobIds ? { jobIds: body.dataset.jobIds } : {}),
                ...(body.dataset.count !== undefined
                  ? { count: body.dataset.count }
                  : {}),
                ...(body.dataset.jobLifecycle
                  ? { jobLifecycle: body.dataset.jobLifecycle }
                  : {}),
              }
            : { limit: body.limit ?? 50 },
        });
        return reply.send({ preview });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Preview failed";
        return reply.code(400).send({ message });
      }
    }
  );

  /** Read-only historical Job Matcher evaluation (flexible dataset). */
  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;

      const body = z
        .object({
          dataset: datasetSpecSchema.optional(),
          /** V1 back-compat. */
          limit: z.union([z.literal(50), z.literal(100), z.literal(500)]).optional(),
          maxWrongDetails: z.number().int().min(1).max(100).optional(),
          /** Primary identity policy for single-policy runs (legacy). */
          identityPolicy: z
            .enum([
              "BASELINE",
              "CONTEXT_AWARE_V1",
              "CONTEXT_AWARE_V2",
              "CONTEXT_AWARE_V2_1",
              "CONTEXT_AWARE_V2_2",
              "CONTEXT_AWARE_V2_3",
              "CONTEXT_AWARE_V2_4",
              "CONTEXT_AWARE_V3",
              "CONTEXT_AWARE_V2_5",
            ])
            .optional(),
          /**
           * Preferred: evaluate / compare exactly these policies.
           * Length 1 = single; ≥ 2 = same-dataset comparison. Validated server-side.
           */
          identityPolicies: z
            .array(
              z.enum([
                "BASELINE",
                "CONTEXT_AWARE_V1",
                "CONTEXT_AWARE_V2",
                "CONTEXT_AWARE_V2_1",
                "CONTEXT_AWARE_V2_2",
                "CONTEXT_AWARE_V2_3",
                "CONTEXT_AWARE_V2_4",
                "CONTEXT_AWARE_V3",
                "CONTEXT_AWARE_V2_5",
              ])
            )
            .min(1)
            .max(9)
            .optional(),
          /**
           * Legacy shadow comparison on the same emails/snapshot.
           * Does not change production matcher default (CONTEXT_AWARE_V2).
           */
          compareWithIdentityPolicy: z
            .enum([
              "CONTEXT_AWARE_V1",
              "CONTEXT_AWARE_V2",
              "CONTEXT_AWARE_V2_1",
              "CONTEXT_AWARE_V2_2",
              "CONTEXT_AWARE_V2_3",
              "CONTEXT_AWARE_V2_4",
              "CONTEXT_AWARE_V3",
              "CONTEXT_AWARE_V2_5",
              "ALL_THREE",
            ])
            .optional(),
          /** Client-generated id for progress polling during long runs. */
          evaluationRunId: z.string().uuid().optional(),
        })
        .parse(request.body);

      try {
        const result = await runJobMatcherHistoricalEval({
          prisma: app.services.prisma,
          workspaceId,
          dataset: body.dataset
            ? {
                jobsMode: body.dataset.jobsMode,
                sampling: body.dataset.sampling,
                ...(body.dataset.jobIds ? { jobIds: body.dataset.jobIds } : {}),
                ...(body.dataset.count !== undefined
                  ? { count: body.dataset.count }
                  : {}),
                ...(body.dataset.jobLifecycle
                  ? { jobLifecycle: body.dataset.jobLifecycle }
                  : {}),
              }
            : { limit: body.limit ?? 50 },
          ...(body.maxWrongDetails != null
            ? { maxWrongDetails: body.maxWrongDetails }
            : {}),
          ...(body.identityPolicies
            ? { identityPolicies: body.identityPolicies }
            : {}),
          ...(body.identityPolicy ? { identityPolicy: body.identityPolicy } : {}),
          ...(body.compareWithIdentityPolicy
            ? { compareWithIdentityPolicy: body.compareWithIdentityPolicy }
            : {}),
          ...(body.evaluationRunId
            ? { evaluationRunId: body.evaluationRunId }
            : {}),
        });
        try {
          await persistJobMatcherEvalRun({
            prisma: app.services.prisma,
            workspaceId,
            createdByUserId: auth.userId,
            result,
          });
        } catch (persistErr) {
          console.error("job-matcher-eval-run-persist-failed", persistErr);
        }
        return reply.send({ evaluation: result });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Evaluation failed";
        return reply.code(400).send({ message });
      }
    }
  );

  /** Progress snapshot for a running/completed evaluation (in-memory, short TTL). */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId/progress",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          evaluationRunId: z.string().uuid(),
        })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const progress = getJobMatcherEvalProgress({
        workspaceId: params.workspaceId,
        evaluationRunId: params.evaluationRunId,
      });
      if (!progress) {
        return reply.code(404).send({ message: "Progress not found" });
      }
      return reply.send({ progress });
    }
  );

  /** Load a persisted evaluation run + its exclusions (for refresh). */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          evaluationRunId: z.string().uuid(),
        })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const run = await getJobMatcherEvalRun({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        evaluationRunId: params.evaluationRunId,
      });
      if (!run) {
        return reply.code(404).send({ message: "Evaluation run not found" });
      }
      return reply.send(run);
    }
  );

  /** List run-specific evaluation exclusions. */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId/exclusions",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          evaluationRunId: z.string().uuid(),
        })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const exclusions = await listJobMatcherEvalExclusions({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        evaluationRunId: params.evaluationRunId,
      });
      return reply.send({ exclusions });
    }
  );

  /** Exclude an email from adjusted metrics for this evaluation run. */
  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId/exclusions",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          evaluationRunId: z.string().uuid(),
        })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const body = z
        .object({
          emailMessageId: z.string().min(1),
          reason: z.string().max(500).optional(),
        })
        .parse(request.body);
      try {
        const exclusion = await excludeJobMatcherEvalEmail({
          prisma: app.services.prisma,
          workspaceId: params.workspaceId,
          evaluationRunId: params.evaluationRunId,
          emailMessageId: body.emailMessageId,
          actorUserId: auth.userId,
          reason: body.reason ?? null,
          request,
        });
        return reply.send({ exclusion });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Exclude failed";
        const code = message.includes("not found")
          ? 404
          : message.includes("not part")
            ? 400
            : 400;
        return reply.code(code).send({ message });
      }
    }
  );

  /** Restore a previously excluded email into adjusted metrics. */
  app.delete(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId/exclusions/:emailMessageId",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          evaluationRunId: z.string().uuid(),
          emailMessageId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const result = await restoreJobMatcherEvalEmail({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        evaluationRunId: params.evaluationRunId,
        emailMessageId: params.emailMessageId,
        actorUserId: auth.userId,
        request,
      });
      return reply.send(result);
    }
  );

  const gtCorrectionRunParams = z.object({
    workspaceId: z.string().min(1),
    evaluationRunId: z.string().uuid(),
  });

  /** List ACTIVE verified ground-truth corrections for emails in this evaluation run. */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId/ground-truth-corrections",
    async (request, reply) => {
      const params = gtCorrectionRunParams.parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const run = await getJobMatcherEvalRun({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        evaluationRunId: params.evaluationRunId,
      });
      if (!run) {
        return reply.code(404).send({ message: "Evaluation run not found" });
      }
      return reply.send({ groundTruthCorrections: run.groundTruthCorrections });
    }
  );

  /** Verify a model MATCH prediction as the true Job (eval ground truth only). */
  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId/ground-truth-corrections",
    async (request, reply) => {
      const params = gtCorrectionRunParams.parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const body = z
        .object({
          emailMessageId: z.string().min(1),
          correctedGroundTruthJobId: z.string().min(1),
          sourceModelPolicy: z.string().max(100).optional(),
          note: z.string().max(500).optional(),
        })
        .parse(request.body);
      try {
        const groundTruthCorrection =
          await verifyJobMatcherEvalGroundTruthCorrection({
            prisma: app.services.prisma,
            workspaceId: params.workspaceId,
            evaluationRunId: params.evaluationRunId,
            emailMessageId: body.emailMessageId,
            correctedGroundTruthJobId: body.correctedGroundTruthJobId,
            sourceModelPolicy: body.sourceModelPolicy ?? null,
            note: body.note ?? null,
            actorUserId: auth.userId,
            request,
          });
        return reply.send({ groundTruthCorrection });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Verify failed";
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ message });
      }
    }
  );

  /** Undo a verified ground-truth correction (marks it REVERSED). */
  app.delete(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/evaluate/:evaluationRunId/ground-truth-corrections/:emailMessageId",
    async (request, reply) => {
      const params = gtCorrectionRunParams
        .extend({ emailMessageId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;
      const result = await reverseJobMatcherEvalGroundTruthCorrection({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        emailMessageId: params.emailMessageId,
        actorUserId: auth.userId,
        request,
      });
      return reply.send(result);
    }
  );

  /** On-demand email body/headers for evaluation inspector (workspace-scoped). */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/emails/:emailMessageId",
    async (request, reply) => {
      const params = z
        .object({
          workspaceId: z.string().min(1),
          emailMessageId: z.string().min(1),
        })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!auth) return;

      const email = await loadIntelligenceEvalEmail({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        emailMessageId: params.emailMessageId,
      });
      if (!email) {
        return reply.code(404).send({ message: "Email not found in workspace" });
      }
      return reply.send({ email });
    }
  );

  /** List candidate emails for Test One (authoritative, workspace-scoped). */
  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/test-emails",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;

      const query = z
        .object({
          search: z.string().max(200).optional(),
          take: z.coerce.number().int().min(1).max(50).optional(),
        })
        .parse(request.query);

      const take = query.take ?? 25;
      const search = query.search?.trim();

      const emails = await app.services.prisma.emailMessage.findMany({
        where: {
          workspaceId,
          jobId: { not: null },
          OR: [
            { jobAssignmentIsManual: true },
            { jobAssignmentSource: "USER_ASSIGNED" },
            { jobAssignmentSource: "VERIFIED_PROJECT_FOLDER" },
          ],
          ...(search
            ? {
                subject: { contains: search, mode: "insensitive" as const },
              }
            : {}),
        },
        orderBy: { receivedAt: "desc" },
        take,
        select: {
          id: true,
          subject: true,
          senderEmail: true,
          receivedAt: true,
          jobId: true,
          jobAssignmentSource: true,
          job: { select: { id: true, name: true, jobNumber: true } },
        },
      });

      return reply.send({
        emails: emails.map((e) => ({
          id: e.id,
          subject: e.subject,
          senderEmail: e.senderEmail,
          receivedAt: e.receivedAt,
          jobId: e.jobId,
          jobName: e.job?.name ?? null,
          jobNumber: e.job?.jobNumber ?? null,
          jobAssignmentSource: e.jobAssignmentSource,
        })),
      });
    }
  );

  /** Read-only single-email matcher test. */
  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/job-matcher/test-one",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;

      const body = z
        .object({ emailMessageId: z.string().min(1) })
        .parse(request.body);

      try {
        const result = await runJobMatcherTestOne({
          prisma: app.services.prisma,
          workspaceId,
          emailMessageId: body.emailMessageId,
        });
        return reply.send({ test: result });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Test failed";
        return reply.code(400).send({ message });
      }
    }
  );

  const discoveryConfigSchema = z.object({
    samplePreset: z
      .enum(["ALL_ELIGIBLE", "500", "2500", "10000", "CUSTOM"])
      .optional(),
    customCount: z.number().int().min(1).max(10_000).nullable().optional(),
    mailboxCategory: z.enum(["BUSINESS", "PERSONAL", "ALL"]).optional(),
    inboxConnectionId: z.string().min(1).nullable().optional(),
    receivedAfter: z.string().min(1).nullable().optional(),
    receivedBefore: z.string().min(1).nullable().optional(),
  });

  /** Preview eligible/sample counts for Subtype Discovery (no job). */
  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/preview",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const body = discoveryConfigSchema.parse(request.body ?? {});
      try {
        const preview = await previewSubtypeDiscoveryDataset({
          prisma: app.services.prisma,
          workspaceId,
          config: stripUndefined(body),
        });
        return reply.send({ preview });
      } catch (e) {
        if (e instanceof SubtypeDiscoveryError) {
          return reply.code(400).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  /** Start an async Subtype Discovery run (BullMQ). Read-only — no taxonomy mutation. */
  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const body = discoveryConfigSchema.parse(request.body ?? {});
      try {
        const result = await enqueueSubtypeDiscoveryRun({
          prisma: app.services.prisma,
          queue: app.services.subtypeDiscoveryQueue,
          workspaceId,
          initiatedByUserId: auth.userId,
          config: stripUndefined(body),
        });
        return reply.code(202).send(result);
      } catch (e) {
        if (e instanceof SubtypeDiscoveryError) {
          const code = e.code === "ALREADY_RUNNING" ? 409 : 400;
          return reply.code(code).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const runs = await listSubtypeDiscoveryRuns({
        prisma: app.services.prisma,
        workspaceId,
      });
      return reply.send({ runs });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs/:runId",
    async (request, reply) => {
      const { workspaceId, runId } = z
        .object({ workspaceId: z.string().min(1), runId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const run = await getSubtypeDiscoveryRun({
        prisma: app.services.prisma,
        workspaceId,
        runId,
      });
      if (!run) return reply.code(404).send({ message: "Discovery run not found" });
      return reply.send({ run });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs/:runId/cancel",
    async (request, reply) => {
      const { workspaceId, runId } = z
        .object({ workspaceId: z.string().min(1), runId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      try {
        const result = await requestCancelSubtypeDiscoveryRun({
          prisma: app.services.prisma,
          workspaceId,
          runId,
        });
        return reply.send(result);
      } catch (e) {
        if (e instanceof SubtypeDiscoveryError) {
          const code = e.code === "NOT_FOUND" ? 404 : 400;
          return reply.code(code).send({ message: e.message, code: e.code });
        }
        throw e;
      }
    }
  );

  const runRecParams = z.object({
    workspaceId: z.string().min(1),
    runId: z.string().min(1),
    recommendationId: z.string().min(1),
  });

  const editPayloadSchema = z.object({
    suggestedSubtypeName: z.string().min(1).max(120),
    systemKey: z.string().min(2).max(48),
    recommendedParentType: z.literal("BUSINESS"),
    definition: z.string().max(4000),
    inclusionCriteria: z.string().max(2000),
    exclusionCriteria: z.string().max(2000),
  });

  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs/:runId/decisions",
    async (request, reply) => {
      const { workspaceId, runId } = z
        .object({ workspaceId: z.string().min(1), runId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const decisions = await listRecommendationDecisions({
        prisma: app.services.prisma,
        workspaceId,
        discoveryRunId: runId,
      });
      return reply.send({ decisions });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs/:runId/recommendations/:recommendationId/decision",
    async (request, reply) => {
      const { workspaceId, runId, recommendationId } = runRecParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const body = z
        .object({
          status: z.enum(["REJECTED", "MERGED", "DEFERRED", "PENDING"]),
          editedPayload: editPayloadSchema.nullable().optional(),
          mergeTargetKey: z.string().min(1).nullable().optional(),
          notes: z.string().max(1000).nullable().optional(),
        })
        .parse(request.body ?? {});
      try {
        const decision = await upsertRecommendationDecision({
          prisma: app.services.prisma,
          workspaceId,
          discoveryRunId: runId,
          recommendationId,
          status: body.status,
          ...(body.editedPayload !== undefined
            ? { editedPayload: body.editedPayload }
            : {}),
          ...(body.mergeTargetKey !== undefined
            ? { mergeTargetKey: body.mergeTargetKey }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          userId: auth.userId,
        });
        return reply.send({ decision });
      } catch (e) {
        return replyReviewError(reply, e);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs/:runId/recommendations/:recommendationId/preview-approval",
    async (request, reply) => {
      const { workspaceId, runId, recommendationId } = runRecParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const body = z
        .object({ editedPayload: editPayloadSchema.nullable().optional() })
        .parse(request.body ?? {});
      try {
        const preview = await previewApprovalChange({
          prisma: app.services.prisma,
          workspaceId,
          discoveryRunId: runId,
          recommendationId,
          ...(body.editedPayload !== undefined
            ? { editedPayload: body.editedPayload }
            : {}),
        });
        return reply.send({ preview });
      } catch (e) {
        return replyReviewError(reply, e);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs/:runId/recommendations/:recommendationId/approve",
    async (request, reply) => {
      const { workspaceId, runId, recommendationId } = runRecParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const body = z
        .object({
          confirmApply: z.literal(true),
          editedPayload: editPayloadSchema.nullable().optional(),
          notes: z.string().max(1000).nullable().optional(),
        })
        .parse(request.body ?? {});
      try {
        const result = await approveAndApplyRecommendation({
          prisma: app.services.prisma,
          audit: app.services.auditEventLogger,
          workspaceId,
          discoveryRunId: runId,
          recommendationId,
          userId: auth.userId,
          ...(body.editedPayload !== undefined
            ? { editedPayload: body.editedPayload }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          confirmApply: body.confirmApply,
        });
        return reply.send(result);
      } catch (e) {
        return replyReviewError(reply, e);
      }
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/taxonomy/revisions",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const revisions = await listTaxonomyRevisions({
        prisma: app.services.prisma,
        workspaceId,
      });
      return reply.send({ revisions });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/taxonomy/revisions/:revisionId/rollback",
    async (request, reply) => {
      const { workspaceId, revisionId } = z
        .object({ workspaceId: z.string().min(1), revisionId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const body = z.object({ confirmRollback: z.literal(true) }).parse(request.body ?? {});
      try {
        const result = await rollbackTaxonomyRevision({
          prisma: app.services.prisma,
          audit: app.services.auditEventLogger,
          workspaceId,
          revisionId,
          userId: auth.userId,
          confirmRollback: body.confirmRollback,
        });
        return reply.send(result);
      } catch (e) {
        return replyReviewError(reply, e);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/runs/:runId/taxonomy-eval",
    async (request, reply) => {
      const { workspaceId, runId } = z
        .object({ workspaceId: z.string().min(1), runId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const body = z
        .object({
          proposedRecommendationIds: z.array(z.string().min(1)).max(40),
        })
        .parse(request.body ?? {});
      try {
        const result = await runSubtypeTaxonomyEval({
          prisma: app.services.prisma,
          workspaceId,
          discoveryRunId: runId,
          proposedRecommendationIds: body.proposedRecommendationIds,
          userId: auth.userId,
        });
        return reply.send(result);
      } catch (e) {
        return replyReviewError(reply, e);
      }
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/taxonomy-evals",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const discoveryRunId = z
        .object({ discoveryRunId: z.string().min(1).optional() })
        .parse(request.query).discoveryRunId;
      const evals = await listSubtypeTaxonomyEvals({
        prisma: app.services.prisma,
        workspaceId,
        ...(discoveryRunId ? { discoveryRunId } : {}),
      });
      return reply.send({ evals });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/intelligence/subtype-discovery/taxonomy-evals/:evalRunId",
    async (request, reply) => {
      const { workspaceId, evalRunId } = z
        .object({ workspaceId: z.string().min(1), evalRunId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireIntelligenceAccess(app, request, reply, workspaceId);
      if (!auth) return;
      const evalRun = await getSubtypeTaxonomyEval({
        prisma: app.services.prisma,
        workspaceId,
        evalRunId,
      });
      if (!evalRun) return reply.code(404).send({ message: "Eval run not found" });
      return reply.send({ eval: evalRun });
    }
  );

};

function replyReviewError(
  reply: import("fastify").FastifyReply,
  e: unknown
) {
  if (e instanceof SubtypeRecommendationReviewError) {
    const code =
      e.code === "NOT_FOUND"
        ? 404
        : e.code === "DUPLICATE" || e.code === "ALREADY_DECIDED"
          ? 409
          : 400;
    return reply.code(code).send({ message: e.message, code: e.code });
  }
  throw e;
}
