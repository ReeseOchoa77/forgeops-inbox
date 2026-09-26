import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
  inlineImageCandidateWhere,
} from "@forgeops/ai";
import {
  QueueNames,
  buildInlineImageRelevanceJobId,
  type InlineImageRelevanceJobPayload,
} from "@forgeops/shared";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

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

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
});

const analyzeBody = z
  .object({
    force: z.boolean().optional(),
  })
  .strict();

export function registerInlineImageRelevanceRoutes(app: FastifyInstance): void {
  app.get("/api/v1/workspaces/:workspaceId/inline-image-relevance", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
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
    const summary = await loadSummary(app, params.workspaceId);
    return reply.send({ summary });
  });

  app.post(
    "/api/v1/workspaces/:workspaceId/inline-image-relevance/analyze",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const body = analyzeBody.parse(request.body ?? {});
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

      const inflight = await app.services.inlineImageRelevanceQueue.getJobs(
        ["waiting", "active", "delayed", "paused"],
        0,
        100
      );
      if (inflight.some((job) => job.data.workspaceId === params.workspaceId)) {
        return reply.code(409).send({ message: "Inline image analysis is already queued" });
      }

      const runId = Date.now().toString(36);
      const payload: InlineImageRelevanceJobPayload = {
        workspaceId: params.workspaceId,
        initiatedBy: "USER",
        force: body.force === true,
        page: 0,
        runId,
      };
      const jobId = buildInlineImageRelevanceJobId(params.workspaceId, 0, runId);
      try {
        await app.services.inlineImageRelevanceQueue.add(
          QueueNames.INLINE_IMAGE_RELEVANCE,
          payload,
          {
            jobId,
            attempts: 1,
            removeOnComplete: { count: 20 },
            removeOnFail: { count: 20 },
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/already exists|already waiting|duplicate/i.test(message)) {
          return reply.code(409).send({ message: "Inline image analysis is already queued" });
        }
        throw error;
      }

      const summary = await loadSummary(app, params.workspaceId);
      request.log.info({
        event: "inline-image-relevance-enqueued",
        workspaceId: params.workspaceId,
        jobId,
        force: payload.force === true,
        totalInlineImages: summary.totalInlineImages,
        classified: summary.classified,
      });
      return reply.send({ jobId, summary });
    }
  );
}

async function loadSummary(app: FastifyInstance, workspaceId: string) {
  const [totalInlineImages, grouped] = await Promise.all([
    app.services.prisma.emailAttachment.count({
      where: inlineImageCandidateWhere({ workspaceId, force: true }),
    }),
    app.services.prisma.inlineImageRelevanceClassification.groupBy({
      by: ["relevance"],
      where: {
        workspaceId,
        analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
      },
      _count: { _all: true },
    }),
  ]);
  const countFor = (relevance: "RELEVANT" | "NOISE" | "UNCERTAIN") =>
    grouped.find((row) => row.relevance === relevance)?._count._all ?? 0;
  const relevant = countFor("RELEVANT");
  const noise = countFor("NOISE");
  const uncertain = countFor("UNCERTAIN");
  return {
    analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
    totalInlineImages,
    classified: relevant + noise + uncertain,
    relevant,
    noise,
    uncertain,
    remaining: Math.max(0, totalInlineImages - (relevant + noise + uncertain)),
  };
}
