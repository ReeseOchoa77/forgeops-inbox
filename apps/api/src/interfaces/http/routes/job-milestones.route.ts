import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  createMilestone,
  deleteMilestone,
  JOB_MILESTONE_STATUSES,
  JOB_MILESTONE_TYPES,
  JobMilestoneError,
  listJobMilestones,
  updateMilestone,
} from "../../../application/services/job-milestones.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const milestoneParams = jobParams.extend({
  milestoneId: z.string().min(1),
});

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .nullable();

const createBody = z
  .object({
    type: z.enum(JOB_MILESTONE_TYPES).optional(),
    name: z.string().trim().max(200).nullable().optional(),
    plannedDate: dateOnly.optional(),
    workPackageId: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

const updateBody = z
  .object({
    type: z.enum(JOB_MILESTONE_TYPES).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    plannedDate: dateOnly.optional(),
    actualDate: dateOnly.optional(),
    workPackageId: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    status: z.enum(JOB_MILESTONE_STATUSES).optional(),
  })
  .strict();

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
  return { userId: session.userId, workspaceRole: membership.workspaceRole };
}

export function registerJobMilestoneRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/milestones",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const job = await app.services.prisma.job.findFirst({
        where: { id: jobId, workspaceId },
        select: { id: true },
      });
      if (!job) return reply.code(404).send({ message: "Job not found" });
      const milestones = await listJobMilestones(app.services.prisma, { workspaceId, jobId });
      return reply.send({ milestones });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/milestones",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = createBody.parse(request.body ?? {});
      try {
        const milestone = await createMilestone(app.services.prisma, {
          workspaceId,
          jobId,
          ...(body.type !== undefined ? { type: body.type } : {}),
          name: body.name ?? null,
          plannedDate: body.plannedDate === undefined ? null : body.plannedDate,
          workPackageId: body.workPackageId ?? null,
          notes: body.notes ?? null,
          actorUserId: auth.userId,
        });
        const milestones = await listJobMilestones(app.services.prisma, { workspaceId, jobId });
        return reply.code(201).send({ milestone, milestones });
      } catch (error) {
        if (error instanceof JobMilestoneError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/milestones/:milestoneId",
    async (request, reply) => {
      const { workspaceId, jobId, milestoneId } = milestoneParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = updateBody.parse(request.body ?? {});
      try {
        const milestone = await updateMilestone(app.services.prisma, {
          workspaceId,
          jobId,
          milestoneId,
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.plannedDate !== undefined ? { plannedDate: body.plannedDate } : {}),
          ...(body.actualDate !== undefined ? { actualDate: body.actualDate } : {}),
          ...(body.workPackageId !== undefined ? { workPackageId: body.workPackageId } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          actorUserId: auth.userId,
        });
        const milestones = await listJobMilestones(app.services.prisma, { workspaceId, jobId });
        return reply.send({ milestone, milestones });
      } catch (error) {
        if (error instanceof JobMilestoneError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/milestones/:milestoneId",
    async (request, reply) => {
      const { workspaceId, jobId, milestoneId } = milestoneParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      try {
        await deleteMilestone(app.services.prisma, {
          workspaceId,
          jobId,
          milestoneId,
          actorUserId: auth.userId,
        });
        const milestones = await listJobMilestones(app.services.prisma, { workspaceId, jobId });
        return reply.send({ milestones });
      } catch (error) {
        if (error instanceof JobMilestoneError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );
}
