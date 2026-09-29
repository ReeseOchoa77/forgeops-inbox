import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  clearDocumentControl,
  JOB_DOCUMENT_RECORD_TYPES,
  JOB_DOCUMENT_SUBMITTAL_STATUSES,
  JobDocumentRecordError,
  upsertDocumentControl,
} from "../../../application/services/job-document-records.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .nullable();

const upsertBody = z
  .object({
    sourceType: z.enum(["EMAIL_ATTACHMENT", "JOB_UPLOAD"]),
    sourceId: z.string().min(1),
    documentType: z.enum(JOB_DOCUMENT_RECORD_TYPES),
    documentNumber: z.string().trim().max(100).nullable().optional(),
    title: z.string().trim().max(300).nullable().optional(),
    revision: z.string().trim().max(40).nullable().optional(),
    documentDate: dateOnly.optional(),
    workPackageId: z.string().min(1).nullable().optional(),
    submittalStatus: z.enum(JOB_DOCUMENT_SUBMITTAL_STATUSES).nullable().optional(),
    supersedesId: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    isCurrent: z.boolean().optional(),
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

export function registerJobDocumentRecordRoutes(app: FastifyInstance): void {
  app.put(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/document-control",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = upsertBody.parse(request.body ?? {});
      try {
        const control = await upsertDocumentControl(app.services.prisma, {
          workspaceId,
          jobId,
          sourceType: body.sourceType,
          sourceId: body.sourceId,
          documentType: body.documentType,
          documentNumber: body.documentNumber ?? null,
          title: body.title ?? null,
          revision: body.revision ?? null,
          ...(body.documentDate !== undefined ? { documentDate: body.documentDate } : {}),
          ...(body.workPackageId !== undefined ? { workPackageId: body.workPackageId } : {}),
          ...(body.submittalStatus !== undefined
            ? { submittalStatus: body.submittalStatus }
            : {}),
          ...(body.supersedesId !== undefined ? { supersedesId: body.supersedesId } : {}),
          notes: body.notes ?? null,
          ...(body.isCurrent !== undefined ? { isCurrent: body.isCurrent } : {}),
          actorUserId: auth.userId,
        });
        return reply.send({ control });
      } catch (error) {
        if (error instanceof JobDocumentRecordError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/document-control/:recordId",
    async (request, reply) => {
      const params = jobParams
        .extend({ recordId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      try {
        await clearDocumentControl(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          recordId: params.recordId,
          actorUserId: auth.userId,
        });
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof JobDocumentRecordError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );
}
