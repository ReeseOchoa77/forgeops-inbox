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
import { runJobMatcherTestOne } from "../../../application/services/run-job-matcher-test-one.js";
import { loadIntelligenceEvalEmail } from "../../../application/services/load-intelligence-eval-email.js";
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
          /** Primary identity policy. Default BASELINE (production semantics). */
          identityPolicy: z
            .enum([
              "BASELINE",
              "CONTEXT_AWARE_V1",
              "CONTEXT_AWARE_V2",
              "CONTEXT_AWARE_V2_1",
            ])
            .optional(),
          /**
           * Shadow comparison on the same emails/snapshot.
           * Does not change production matcher default (BASELINE).
           */
          compareWithIdentityPolicy: z
            .enum([
              "CONTEXT_AWARE_V1",
              "CONTEXT_AWARE_V2",
              "CONTEXT_AWARE_V2_1",
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
          ...(body.identityPolicy ? { identityPolicy: body.identityPolicy } : {}),
          ...(body.compareWithIdentityPolicy
            ? { compareWithIdentityPolicy: body.compareWithIdentityPolicy }
            : {}),
          ...(body.evaluationRunId
            ? { evaluationRunId: body.evaluationRunId }
            : {}),
        });
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
};
