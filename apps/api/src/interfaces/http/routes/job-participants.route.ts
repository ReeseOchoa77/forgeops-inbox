import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createJobParticipant,
  deleteJobParticipant,
  JobParticipantError,
  JOB_PARTICIPANT_ROLES,
  listJobParticipants,
  searchParticipantCandidates,
  updateJobParticipant,
} from "../../../application/services/job-participants.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const participantParams = jobParams.extend({
  participantId: z.string().min(1),
});

const createBody = z
  .object({
    role: z.enum(JOB_PARTICIPANT_ROLES),
    userId: z.string().min(1).nullable().optional(),
    customerId: z.string().min(1).nullable().optional(),
    vendorId: z.string().min(1).nullable().optional(),
    contactId: z.string().min(1).nullable().optional(),
    isPrimary: z.boolean().optional(),
    title: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

const updateBody = z
  .object({
    role: z.enum(JOB_PARTICIPANT_ROLES).optional(),
    isPrimary: z.boolean().optional(),
    title: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
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
  return {
    userId: session.userId,
    role: membership.role,
    workspaceRole: membership.workspaceRole,
  };
}

function canEdit(workspaceRole: string): boolean {
  return workspaceRole === "OWNER" || workspaceRole === "EDITOR";
}

export function registerJobParticipantRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/participant-candidates",
    async (request, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const query = z
        .object({
          q: z.string().optional().default(""),
          limit: z.coerce.number().int().positive().max(25).optional(),
        })
        .parse(request.query ?? {});
      const candidates = await searchParticipantCandidates(app.services.prisma, {
        workspaceId,
        q: query.q,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      });
      return reply.send(candidates);
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/participants",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;

      const job = await app.services.prisma.job.findFirst({
        where: { id: jobId, workspaceId },
        select: { id: true },
      });
      if (!job) return reply.code(404).send({ message: "Job not found" });

      const participants = await listJobParticipants(app.services.prisma, {
        workspaceId,
        jobId,
      });
      return reply.send({ participants });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/participants",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEdit(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = createBody.parse(request.body ?? {});
      try {
        const participant = await createJobParticipant(app.services.prisma, {
          workspaceId,
          jobId,
          role: body.role,
          userId: body.userId ?? null,
          customerId: body.customerId ?? null,
          vendorId: body.vendorId ?? null,
          contactId: body.contactId ?? null,
          ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
          title: body.title ?? null,
          notes: body.notes ?? null,
          actorUserId: auth.userId,
        });
        return reply.code(201).send({ participant });
      } catch (error) {
        if (error instanceof JobParticipantError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/participants/:participantId",
    async (request, reply) => {
      const { workspaceId, jobId, participantId } = participantParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEdit(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = updateBody.parse(request.body ?? {});
      try {
        const participant = await updateJobParticipant(app.services.prisma, {
          workspaceId,
          jobId,
          participantId,
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          actorUserId: auth.userId,
        });
        return reply.send({ participant });
      } catch (error) {
        if (error instanceof JobParticipantError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/participants/:participantId",
    async (request, reply) => {
      const { workspaceId, jobId, participantId } = participantParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEdit(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      try {
        await deleteJobParticipant(app.services.prisma, {
          workspaceId,
          jobId,
          participantId,
          actorUserId: auth.userId,
        });
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof JobParticipantError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );
}
