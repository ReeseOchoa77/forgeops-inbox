import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  createJobRfq,
  deleteJobRfq,
  JOB_RFQ_STATUSES,
  JobRfqError,
  listJobRfqs,
  updateJobRfq,
} from "../../../application/services/job-rfqs.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const rfqParams = jobParams.extend({ rfqId: z.string().min(1) });

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const money = z.union([z.number(), z.string(), z.null()]);

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

function handleError(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof JobRfqError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  throw error;
}

export function registerJobRfqRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/rfqs",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      try {
        return reply.send({
          rfqs: await listJobRfqs(app.services.prisma, { workspaceId, jobId }),
        });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/rfqs",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = z
        .object({
          title: z.string().trim().min(1).max(300),
          description: z.string().max(10_000).nullable().optional(),
          vendorId: z.string().min(1).nullable().optional(),
          workPackageId: z.string().min(1).nullable().optional(),
          emailMessageId: z.string().min(1).nullable().optional(),
          status: z.enum(JOB_RFQ_STATUSES).optional(),
          requestedDate: dateOnly.optional(),
          dueDate: dateOnly.optional(),
          receivedDate: dateOnly.optional(),
          quotedAmount: money.optional(),
          notes: z.string().max(10_000).nullable().optional(),
        })
        .parse(request.body ?? {});
      try {
        const rfq = await createJobRfq(app.services.prisma, {
          workspaceId,
          jobId,
          actorUserId: auth.userId,
          title: body.title,
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.vendorId !== undefined ? { vendorId: body.vendorId } : {}),
          ...(body.workPackageId !== undefined
            ? { workPackageId: body.workPackageId }
            : {}),
          ...(body.emailMessageId !== undefined
            ? { emailMessageId: body.emailMessageId }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.requestedDate !== undefined
            ? { requestedDate: body.requestedDate }
            : {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
          ...(body.receivedDate !== undefined
            ? { receivedDate: body.receivedDate }
            : {}),
          ...(body.quotedAmount !== undefined
            ? { quotedAmount: body.quotedAmount }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        });
        return reply.code(201).send({ rfq });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/rfqs/:rfqId",
    async (request, reply) => {
      const { workspaceId, jobId, rfqId } = rfqParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = z
        .object({
          title: z.string().trim().min(1).max(300).optional(),
          description: z.string().max(10_000).nullable().optional(),
          vendorId: z.string().min(1).nullable().optional(),
          workPackageId: z.string().min(1).nullable().optional(),
          emailMessageId: z.string().min(1).nullable().optional(),
          status: z.enum(JOB_RFQ_STATUSES).optional(),
          requestedDate: dateOnly.optional(),
          dueDate: dateOnly.optional(),
          receivedDate: dateOnly.optional(),
          quotedAmount: money.optional(),
          notes: z.string().max(10_000).nullable().optional(),
        })
        .parse(request.body ?? {});
      try {
        const rfq = await updateJobRfq(app.services.prisma, {
          workspaceId,
          jobId,
          rfqId,
          actorUserId: auth.userId,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.vendorId !== undefined ? { vendorId: body.vendorId } : {}),
          ...(body.workPackageId !== undefined
            ? { workPackageId: body.workPackageId }
            : {}),
          ...(body.emailMessageId !== undefined
            ? { emailMessageId: body.emailMessageId }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.requestedDate !== undefined
            ? { requestedDate: body.requestedDate }
            : {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
          ...(body.receivedDate !== undefined
            ? { receivedDate: body.receivedDate }
            : {}),
          ...(body.quotedAmount !== undefined
            ? { quotedAmount: body.quotedAmount }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        });
        return reply.send({ rfq });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/rfqs/:rfqId",
    async (request, reply) => {
      const { workspaceId, jobId, rfqId } = rfqParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      try {
        await deleteJobRfq(app.services.prisma, {
          workspaceId,
          jobId,
          rfqId,
          actorUserId: auth.userId,
        });
        return reply.code(204).send();
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}
