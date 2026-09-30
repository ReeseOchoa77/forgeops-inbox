import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  BillingError,
  INVOICE_STATUSES,
  buildBillingSnapshot,
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  listPeriodDeliveries,
  listPeriodInstallations,
  updateInvoice,
} from "../../../application/services/job-billing.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const invoiceParams = jobParams.extend({ invoiceId: z.string().min(1) });

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const money = z.union([z.number(), z.string(), z.null()]);

const coAllocation = z.object({
  changeOrderId: z.string().min(1),
  amount: money.optional(),
  notes: z.string().max(2000).nullable().optional(),
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
  return { userId: session.userId, workspaceRole: membership.workspaceRole };
}

function handleError(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof BillingError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  throw error;
}

export function registerJobBillingRoutes(app: FastifyInstance): void {
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/invoices", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    try {
      const [invoices, billingSnapshot] = await Promise.all([
        listInvoices(app.services.prisma, { workspaceId, jobId }),
        buildBillingSnapshot(app.services.prisma, { workspaceId, jobId }),
      ]);
      return reply.send({ invoices, billingSnapshot });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/billing-snapshot", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    try {
      const billingSnapshot = await buildBillingSnapshot(app.services.prisma, { workspaceId, jobId });
      if (!billingSnapshot) return reply.code(404).send({ message: "Job not found" });
      return reply.send({ billingSnapshot });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/invoices", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        invoiceNumber: z.string().trim().min(1).max(100),
        invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        billingPeriodStart: dateOnly.optional(),
        billingPeriodEnd: dateOnly.optional(),
        dueDate: dateOnly.optional(),
        amount: money.optional(),
        billToCustomerId: z.string().min(1).nullable().optional(),
        documentRecordId: z.string().min(1).nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
        changeOrderAllocations: z.array(coAllocation).max(100).optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const invoice = await createInvoice(app.services.prisma, {
        workspaceId,
        jobId,
        actorUserId: auth.userId,
        invoiceNumber: body.invoiceNumber,
        invoiceDate: body.invoiceDate,
        ...(body.billingPeriodStart !== undefined ? { billingPeriodStart: body.billingPeriodStart } : {}),
        ...(body.billingPeriodEnd !== undefined ? { billingPeriodEnd: body.billingPeriodEnd } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.billToCustomerId !== undefined ? { billToCustomerId: body.billToCustomerId } : {}),
        ...(body.documentRecordId !== undefined ? { documentRecordId: body.documentRecordId } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.changeOrderAllocations !== undefined
          ? { changeOrderAllocations: body.changeOrderAllocations }
          : {}),
      });
      return reply.code(201).send({ invoice });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/invoices/:invoiceId", async (request, reply) => {
    const { workspaceId, jobId, invoiceId } = invoiceParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    try {
      return reply.send({
        invoice: await getInvoice(app.services.prisma, { workspaceId, jobId, invoiceId }),
      });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.put("/api/v1/workspaces/:workspaceId/jobs/:jobId/invoices/:invoiceId", async (request, reply) => {
    const { workspaceId, jobId, invoiceId } = invoiceParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        invoiceNumber: z.string().trim().min(1).max(100).optional(),
        invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        billingPeriodStart: dateOnly.optional(),
        billingPeriodEnd: dateOnly.optional(),
        dueDate: dateOnly.optional(),
        amount: money.optional(),
        billToCustomerId: z.string().min(1).nullable().optional(),
        documentRecordId: z.string().min(1).nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
        changeOrderAllocations: z.array(coAllocation).max(100).optional(),
        status: z.enum(INVOICE_STATUSES).optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const invoice = await updateInvoice(app.services.prisma, {
        workspaceId,
        jobId,
        invoiceId,
        actorUserId: auth.userId,
        ...(body.invoiceNumber !== undefined ? { invoiceNumber: body.invoiceNumber } : {}),
        ...(body.invoiceDate !== undefined ? { invoiceDate: body.invoiceDate } : {}),
        ...(body.billingPeriodStart !== undefined ? { billingPeriodStart: body.billingPeriodStart } : {}),
        ...(body.billingPeriodEnd !== undefined ? { billingPeriodEnd: body.billingPeriodEnd } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.billToCustomerId !== undefined ? { billToCustomerId: body.billToCustomerId } : {}),
        ...(body.documentRecordId !== undefined ? { documentRecordId: body.documentRecordId } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.changeOrderAllocations !== undefined
          ? { changeOrderAllocations: body.changeOrderAllocations }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      });
      return reply.send({ invoice });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/invoices/:invoiceId", async (request, reply) => {
    const { workspaceId, jobId, invoiceId } = invoiceParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    try {
      await deleteInvoice(app.services.prisma, {
        workspaceId,
        jobId,
        invoiceId,
        actorUserId: auth.userId,
      });
      return reply.send({ ok: true });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/billing-period-evidence",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const query = z
        .object({
          periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(request.query);
      try {
        const [deliveries, installations] = await Promise.all([
          listPeriodDeliveries(app.services.prisma, {
            workspaceId,
            jobId,
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
          }),
          listPeriodInstallations(app.services.prisma, {
            workspaceId,
            jobId,
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
          }),
        ]);
        return reply.send({ deliveries, installations });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}
