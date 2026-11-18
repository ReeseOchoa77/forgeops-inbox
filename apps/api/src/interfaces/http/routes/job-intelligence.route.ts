import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  correctJobIntelligenceEvent,
  getJobIntelligenceBundle,
  startJobIntelligenceAnalysis,
  verifyJobIntelligenceEvent,
} from "../../../application/services/job-intelligence.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const workspaceJobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const eventParams = workspaceJobParams.extend({
  eventId: z.string().min(1),
});

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
  return { userId: session.userId };
}

export async function registerJobIntelligenceRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/intelligence",
    async (request, reply) => {
      const params = workspaceJobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      const query = z
        .object({ category: z.string().optional() })
        .parse(request.query ?? {});
      const bundle = await getJobIntelligenceBundle({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        category: query.category ?? null,
      });
      if (!bundle) return reply.code(404).send({ message: "Job not found" });
      return reply.send(bundle);
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/intelligence/analyze",
    async (request, reply) => {
      const params = workspaceJobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      try {
        const result = await startJobIntelligenceAnalysis({
          prisma: app.services.prisma,
          queue: app.services.jobIntelligenceQueue,
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          userId: auth.userId,
          kind: "HISTORICAL_BACKFILL",
        });
        return reply.code(202).send(result);
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 500;
        return reply
          .code(status)
          .send({ message: err instanceof Error ? err.message : "Failed" });
      }
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/intelligence/runs/:runId",
    async (request, reply) => {
      const params = workspaceJobParams
        .extend({ runId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      const run = await app.services.prisma.jobIntelligenceAnalysisRun.findFirst({
        where: {
          id: params.runId,
          workspaceId: params.workspaceId,
          jobId: params.jobId,
        },
      });
      if (!run) return reply.code(404).send({ message: "Run not found" });
      return reply.send(run);
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/intelligence/events/:eventId/verify",
    async (request, reply) => {
      const params = eventParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      const updated = await verifyJobIntelligenceEvent({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        eventId: params.eventId,
        userId: auth.userId,
        action: "verify",
      });
      return reply.send(updated);
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/intelligence/events/:eventId/reject",
    async (request, reply) => {
      const params = eventParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      const updated = await verifyJobIntelligenceEvent({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        eventId: params.eventId,
        userId: auth.userId,
        action: "reject",
      });
      return reply.send(updated);
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/intelligence/events/:eventId/correct",
    async (request, reply) => {
      const params = eventParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      const body = z
        .object({
          title: z.string().min(1).max(240).optional(),
          description: z.string().min(1).max(4000).optional(),
          status: z.string().optional(),
          amount: z.number().nullable().optional(),
          financialKind: z.string().optional(),
          eventDate: z.string().nullable().optional(),
        })
        .parse(request.body ?? {});
      const patch: {
        title?: string;
        description?: string;
        status?: string;
        amount?: number | null;
        financialKind?: string;
        eventDate?: string | null;
      } = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.description !== undefined) patch.description = body.description;
      if (body.status !== undefined) patch.status = body.status;
      if (body.amount !== undefined) patch.amount = body.amount;
      if (body.financialKind !== undefined) patch.financialKind = body.financialKind;
      if (body.eventDate !== undefined) patch.eventDate = body.eventDate;
      const updated = await correctJobIntelligenceEvent({
        prisma: app.services.prisma,
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        eventId: params.eventId,
        userId: auth.userId,
        patch,
      });
      return reply.send(updated);
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/intelligence/refresh-summary",
    async (request, reply) => {
      const params = workspaceJobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      const result = await startJobIntelligenceAnalysis({
        prisma: app.services.prisma,
        queue: app.services.jobIntelligenceQueue,
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        userId: auth.userId,
        kind: "SUMMARY_ONLY",
      });
      return reply.code(202).send(result);
    }
  );
};
