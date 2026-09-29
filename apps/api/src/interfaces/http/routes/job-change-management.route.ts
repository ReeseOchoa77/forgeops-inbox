import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  CHANGE_ORDER_STATUSES,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  ChangeMgmtError,
  createChange,
  createChangeOrder,
  createDirective,
  createRfi,
  deleteRfi,
  DIRECTIVE_STATUSES,
  DIRECTIVE_TYPES,
  listChangeOrders,
  listChanges,
  listDirectives,
  listRfis,
  RFI_STATUSES,
  updateChange,
  updateChangeOrder,
  updateDirective,
  updateRfi,
} from "../../../application/services/job-change-management.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

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
  if (error instanceof ChangeMgmtError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  throw error;
}

export function registerJobChangeManagementRoutes(app: FastifyInstance): void {
  // ---- RFIs ----
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/rfis", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({ rfis: await listRfis(app.services.prisma, { workspaceId, jobId }) });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/rfis", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        number: z.string().trim().min(1).max(40),
        subject: z.string().trim().min(1).max(300),
        question: z.string().max(10000).nullable().optional(),
        status: z.enum(RFI_STATUSES).optional(),
        submittedDate: dateOnly.optional(),
        responseDueDate: dateOnly.optional(),
        requestedByParticipantId: z.string().min(1).nullable().optional(),
        assignedToParticipantId: z.string().min(1).nullable().optional(),
        workPackageIds: z.array(z.string().min(1)).optional(),
        documentRecordIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const rfi = await createRfi(app.services.prisma, {
        workspaceId,
        jobId,
        number: body.number,
        subject: body.subject,
        question: body.question ?? null,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.submittedDate !== undefined ? { submittedDate: body.submittedDate } : {}),
        ...(body.responseDueDate !== undefined ? { responseDueDate: body.responseDueDate } : {}),
        requestedByParticipantId: body.requestedByParticipantId ?? null,
        assignedToParticipantId: body.assignedToParticipantId ?? null,
        workPackageIds: body.workPackageIds ?? [],
        documentRecordIds: body.documentRecordIds ?? [],
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ rfi });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch("/api/v1/workspaces/:workspaceId/jobs/:jobId/rfis/:rfiId", async (request, reply) => {
    const params = jobParams.extend({ rfiId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        number: z.string().trim().min(1).max(40).optional(),
        subject: z.string().trim().min(1).max(300).optional(),
        question: z.string().max(10000).nullable().optional(),
        status: z.enum(RFI_STATUSES).optional(),
        submittedDate: dateOnly.optional(),
        responseDueDate: dateOnly.optional(),
        answeredDate: dateOnly.optional(),
        response: z.string().max(10000).nullable().optional(),
        requestedByParticipantId: z.string().min(1).nullable().optional(),
        assignedToParticipantId: z.string().min(1).nullable().optional(),
        workPackageIds: z.array(z.string().min(1)).optional(),
        documentRecordIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const rfi = await updateRfi(app.services.prisma, {
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        rfiId: params.rfiId,
        ...(body.number !== undefined ? { number: body.number } : {}),
        ...(body.subject !== undefined ? { subject: body.subject } : {}),
        ...(body.question !== undefined ? { question: body.question } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.submittedDate !== undefined ? { submittedDate: body.submittedDate } : {}),
        ...(body.responseDueDate !== undefined ? { responseDueDate: body.responseDueDate } : {}),
        ...(body.answeredDate !== undefined ? { answeredDate: body.answeredDate } : {}),
        ...(body.response !== undefined ? { response: body.response } : {}),
        ...(body.requestedByParticipantId !== undefined
          ? { requestedByParticipantId: body.requestedByParticipantId }
          : {}),
        ...(body.assignedToParticipantId !== undefined
          ? { assignedToParticipantId: body.assignedToParticipantId }
          : {}),
        ...(body.workPackageIds !== undefined ? { workPackageIds: body.workPackageIds } : {}),
        ...(body.documentRecordIds !== undefined ? { documentRecordIds: body.documentRecordIds } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        actorUserId: auth.userId,
      });
      return reply.send({ rfi });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/rfis/:rfiId", async (request, reply) => {
    const params = jobParams.extend({ rfiId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    try {
      await deleteRfi(app.services.prisma, {
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        rfiId: params.rfiId,
        actorUserId: auth.userId,
      });
      return reply.code(204).send();
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ---- Directives ----
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/directives", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({
      directives: await listDirectives(app.services.prisma, { workspaceId, jobId }),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/directives", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        type: z.enum(DIRECTIVE_TYPES),
        number: z.string().trim().min(1).max(40),
        title: z.string().trim().min(1).max(300),
        issuedDate: dateOnly.optional(),
        summary: z.string().max(10000).nullable().optional(),
        workPackageIds: z.array(z.string().min(1)).optional(),
        documentRecordIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const directive = await createDirective(app.services.prisma, {
        workspaceId,
        jobId,
        type: body.type,
        number: body.number,
        title: body.title,
        ...(body.issuedDate !== undefined ? { issuedDate: body.issuedDate } : {}),
        summary: body.summary ?? null,
        workPackageIds: body.workPackageIds ?? [],
        documentRecordIds: body.documentRecordIds ?? [],
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ directive });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/directives/:directiveId",
    async (request, reply) => {
      const params = jobParams.extend({ directiveId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      const body = z
        .object({
          type: z.enum(DIRECTIVE_TYPES).optional(),
          status: z.enum(DIRECTIVE_STATUSES).optional(),
          number: z.string().trim().min(1).max(40).optional(),
          title: z.string().trim().min(1).max(300).optional(),
          issuedDate: dateOnly.optional(),
          summary: z.string().max(10000).nullable().optional(),
          workPackageIds: z.array(z.string().min(1)).optional(),
          documentRecordIds: z.array(z.string().min(1)).optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict()
        .parse(request.body ?? {});
      try {
        const directive = await updateDirective(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          directiveId: params.directiveId,
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.number !== undefined ? { number: body.number } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.issuedDate !== undefined ? { issuedDate: body.issuedDate } : {}),
          ...(body.summary !== undefined ? { summary: body.summary } : {}),
          ...(body.workPackageIds !== undefined ? { workPackageIds: body.workPackageIds } : {}),
          ...(body.documentRecordIds !== undefined ? { documentRecordIds: body.documentRecordIds } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          actorUserId: auth.userId,
        });
        return reply.send({ directive });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // ---- Changes ----
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/changes", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({ changes: await listChanges(app.services.prisma, { workspaceId, jobId }) });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/changes", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        number: z.string().trim().min(1).max(40),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(10000).nullable().optional(),
        type: z.enum(CHANGE_TYPES).optional(),
        status: z.enum(CHANGE_STATUSES).optional(),
        sourceRfiId: z.string().min(1).nullable().optional(),
        sourceDirectiveId: z.string().min(1).nullable().optional(),
        costImpact: money.optional(),
        sellImpact: money.optional(),
        scheduleImpactDays: z.number().int().nullable().optional(),
        scheduleImpactNote: z.string().max(2000).nullable().optional(),
        workPackageIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const change = await createChange(app.services.prisma, {
        workspaceId,
        jobId,
        number: body.number,
        title: body.title,
        description: body.description ?? null,
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        sourceRfiId: body.sourceRfiId ?? null,
        sourceDirectiveId: body.sourceDirectiveId ?? null,
        ...(body.costImpact !== undefined ? { costImpact: body.costImpact } : {}),
        ...(body.sellImpact !== undefined ? { sellImpact: body.sellImpact } : {}),
        scheduleImpactDays: body.scheduleImpactDays ?? null,
        scheduleImpactNote: body.scheduleImpactNote ?? null,
        workPackageIds: body.workPackageIds ?? [],
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ change });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch("/api/v1/workspaces/:workspaceId/jobs/:jobId/changes/:changeId", async (request, reply) => {
    const params = jobParams.extend({ changeId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        number: z.string().trim().min(1).max(40).optional(),
        title: z.string().trim().min(1).max(300).optional(),
        description: z.string().max(10000).nullable().optional(),
        type: z.enum(CHANGE_TYPES).optional(),
        status: z.enum(CHANGE_STATUSES).optional(),
        sourceRfiId: z.string().min(1).nullable().optional(),
        sourceDirectiveId: z.string().min(1).nullable().optional(),
        changeOrderId: z.string().min(1).nullable().optional(),
        costImpact: money.optional(),
        sellImpact: money.optional(),
        scheduleImpactDays: z.number().int().nullable().optional(),
        scheduleImpactNote: z.string().max(2000).nullable().optional(),
        workPackageIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const change = await updateChange(app.services.prisma, {
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        changeId: params.changeId,
        ...(body.number !== undefined ? { number: body.number } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.sourceRfiId !== undefined ? { sourceRfiId: body.sourceRfiId } : {}),
        ...(body.sourceDirectiveId !== undefined ? { sourceDirectiveId: body.sourceDirectiveId } : {}),
        ...(body.changeOrderId !== undefined ? { changeOrderId: body.changeOrderId } : {}),
        ...(body.costImpact !== undefined ? { costImpact: body.costImpact } : {}),
        ...(body.sellImpact !== undefined ? { sellImpact: body.sellImpact } : {}),
        ...(body.scheduleImpactDays !== undefined
          ? { scheduleImpactDays: body.scheduleImpactDays }
          : {}),
        ...(body.scheduleImpactNote !== undefined
          ? { scheduleImpactNote: body.scheduleImpactNote }
          : {}),
        ...(body.workPackageIds !== undefined ? { workPackageIds: body.workPackageIds } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        actorUserId: auth.userId,
      });
      return reply.send({ change });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ---- Change Orders ----
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/change-orders", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({
      changeOrders: await listChangeOrders(app.services.prisma, { workspaceId, jobId }),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/change-orders", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        number: z.string().trim().min(1).max(40),
        title: z.string().trim().max(300).nullable().optional(),
        status: z.enum(CHANGE_ORDER_STATUSES).optional(),
        sellAmount: money.optional(),
        changeIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const changeOrder = await createChangeOrder(app.services.prisma, {
        workspaceId,
        jobId,
        number: body.number,
        title: body.title ?? null,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.sellAmount !== undefined ? { sellAmount: body.sellAmount } : {}),
        changeIds: body.changeIds ?? [],
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ changeOrder });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/change-orders/:changeOrderId",
    async (request, reply) => {
      const params = jobParams.extend({ changeOrderId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      const body = z
        .object({
          number: z.string().trim().min(1).max(40).optional(),
          title: z.string().trim().max(300).nullable().optional(),
          status: z.enum(CHANGE_ORDER_STATUSES).optional(),
          sellAmount: money.optional(),
          submittedDate: dateOnly.optional(),
          approvedDate: dateOnly.optional(),
          changeIds: z.array(z.string().min(1)).optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict()
        .parse(request.body ?? {});
      try {
        const changeOrder = await updateChangeOrder(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          changeOrderId: params.changeOrderId,
          ...(body.number !== undefined ? { number: body.number } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.sellAmount !== undefined ? { sellAmount: body.sellAmount } : {}),
          ...(body.submittedDate !== undefined ? { submittedDate: body.submittedDate } : {}),
          ...(body.approvedDate !== undefined ? { approvedDate: body.approvedDate } : {}),
          ...(body.changeIds !== undefined ? { changeIds: body.changeIds } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          actorUserId: auth.userId,
        });
        return reply.send({ changeOrder });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}
