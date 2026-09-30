import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  createProcurementItem,
  createPurchaseOrder,
  deleteProcurementItem,
  deletePurchaseOrder,
  listProcurementItems,
  listPurchaseOrders,
  PROCUREMENT_CATEGORIES,
  PROCUREMENT_ITEM_STATUSES,
  ProcurementError,
  PURCHASE_ORDER_STATUSES,
  recordProcurementReceipt,
  updateProcurementItem,
  updatePurchaseOrder,
} from "../../../application/services/job-procurement.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const money = z.union([z.number(), z.string(), z.null()]);
const qty = z.union([z.number(), z.string(), z.null()]);

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
  if (error instanceof ProcurementError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  throw error;
}

export function registerJobProcurementRoutes(app: FastifyInstance): void {
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/procurement-items", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({
      items: await listProcurementItems(app.services.prisma, { workspaceId, jobId }),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/procurement-items", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        description: z.string().trim().min(1).max(500),
        category: z.enum(PROCUREMENT_CATEGORIES).optional(),
        workPackageId: z.string().min(1).nullable().optional(),
        quantity: qty.optional(),
        unit: z.string().trim().max(20).nullable().optional(),
        status: z.enum(PROCUREMENT_ITEM_STATUSES).optional(),
        vendorId: z.string().min(1).nullable().optional(),
        requiredDate: dateOnly.optional(),
        expectedDate: dateOnly.optional(),
        estimatedCost: money.optional(),
        actualCost: money.optional(),
        sourceChangeId: z.string().min(1).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const item = await createProcurementItem(app.services.prisma, {
        workspaceId,
        jobId,
        description: body.description,
        ...(body.category !== undefined ? { category: body.category } : {}),
        workPackageId: body.workPackageId ?? null,
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        unit: body.unit ?? null,
        ...(body.status !== undefined ? { status: body.status } : {}),
        vendorId: body.vendorId ?? null,
        ...(body.requiredDate !== undefined ? { requiredDate: body.requiredDate } : {}),
        ...(body.expectedDate !== undefined ? { expectedDate: body.expectedDate } : {}),
        ...(body.estimatedCost !== undefined ? { estimatedCost: body.estimatedCost } : {}),
        ...(body.actualCost !== undefined ? { actualCost: body.actualCost } : {}),
        sourceChangeId: body.sourceChangeId ?? null,
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ item });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/procurement-items/:itemId",
    async (request, reply) => {
      const params = jobParams.extend({ itemId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      const body = z
        .object({
          description: z.string().trim().min(1).max(500).optional(),
          category: z.enum(PROCUREMENT_CATEGORIES).optional(),
          workPackageId: z.string().min(1).nullable().optional(),
          quantity: qty.optional(),
          unit: z.string().trim().max(20).nullable().optional(),
          status: z.enum(PROCUREMENT_ITEM_STATUSES).optional(),
          vendorId: z.string().min(1).nullable().optional(),
          requiredDate: dateOnly.optional(),
          expectedDate: dateOnly.optional(),
          receivedDate: dateOnly.optional(),
          estimatedCost: money.optional(),
          actualCost: money.optional(),
          purchaseOrderId: z.string().min(1).nullable().optional(),
          sourceChangeId: z.string().min(1).nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict()
        .parse(request.body ?? {});
      try {
        const item = await updateProcurementItem(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          itemId: params.itemId,
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.workPackageId !== undefined ? { workPackageId: body.workPackageId } : {}),
          ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.vendorId !== undefined ? { vendorId: body.vendorId } : {}),
          ...(body.requiredDate !== undefined ? { requiredDate: body.requiredDate } : {}),
          ...(body.expectedDate !== undefined ? { expectedDate: body.expectedDate } : {}),
          ...(body.receivedDate !== undefined ? { receivedDate: body.receivedDate } : {}),
          ...(body.estimatedCost !== undefined ? { estimatedCost: body.estimatedCost } : {}),
          ...(body.actualCost !== undefined ? { actualCost: body.actualCost } : {}),
          ...(body.purchaseOrderId !== undefined ? { purchaseOrderId: body.purchaseOrderId } : {}),
          ...(body.sourceChangeId !== undefined ? { sourceChangeId: body.sourceChangeId } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          actorUserId: auth.userId,
        });
        return reply.send({ item });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/procurement-items/:itemId",
    async (request, reply) => {
      const params = jobParams.extend({ itemId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      try {
        await deleteProcurementItem(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          itemId: params.itemId,
          actorUserId: auth.userId,
        });
        return reply.code(204).send();
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/procurement-items/:itemId/receipts",
    async (request, reply) => {
      const params = jobParams.extend({ itemId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      const body = z
        .object({
          receivedDate: dateOnly.optional(),
          quantityReceived: qty.optional(),
          marksComplete: z.boolean().optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict()
        .parse(request.body ?? {});
      try {
        const item = await recordProcurementReceipt(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          itemId: params.itemId,
          ...(body.receivedDate !== undefined ? { receivedDate: body.receivedDate } : {}),
          ...(body.quantityReceived !== undefined ? { quantityReceived: body.quantityReceived } : {}),
          ...(body.marksComplete !== undefined ? { marksComplete: body.marksComplete } : {}),
          notes: body.notes ?? null,
          actorUserId: auth.userId,
        });
        return reply.code(201).send({ item });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/purchase-orders", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({
      purchaseOrders: await listPurchaseOrders(app.services.prisma, { workspaceId, jobId }),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/purchase-orders", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        poNumber: z.string().trim().min(1).max(40),
        vendorId: z.string().min(1).nullable().optional(),
        status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
        orderedDate: dateOnly.optional(),
        expectedDate: dateOnly.optional(),
        amount: money.optional(),
        documentRecordId: z.string().min(1).nullable().optional(),
        itemIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const purchaseOrder = await createPurchaseOrder(app.services.prisma, {
        workspaceId,
        jobId,
        poNumber: body.poNumber,
        vendorId: body.vendorId ?? null,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.orderedDate !== undefined ? { orderedDate: body.orderedDate } : {}),
        ...(body.expectedDate !== undefined ? { expectedDate: body.expectedDate } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        documentRecordId: body.documentRecordId ?? null,
        itemIds: body.itemIds ?? [],
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ purchaseOrder });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/purchase-orders/:purchaseOrderId",
    async (request, reply) => {
      const params = jobParams.extend({ purchaseOrderId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      const body = z
        .object({
          poNumber: z.string().trim().min(1).max(40).optional(),
          vendorId: z.string().min(1).nullable().optional(),
          status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
          orderedDate: dateOnly.optional(),
          expectedDate: dateOnly.optional(),
          amount: money.optional(),
          documentRecordId: z.string().min(1).nullable().optional(),
          itemIds: z.array(z.string().min(1)).optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict()
        .parse(request.body ?? {});
      try {
        const purchaseOrder = await updatePurchaseOrder(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          purchaseOrderId: params.purchaseOrderId,
          ...(body.poNumber !== undefined ? { poNumber: body.poNumber } : {}),
          ...(body.vendorId !== undefined ? { vendorId: body.vendorId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.orderedDate !== undefined ? { orderedDate: body.orderedDate } : {}),
          ...(body.expectedDate !== undefined ? { expectedDate: body.expectedDate } : {}),
          ...(body.amount !== undefined ? { amount: body.amount } : {}),
          ...(body.documentRecordId !== undefined ? { documentRecordId: body.documentRecordId } : {}),
          ...(body.itemIds !== undefined ? { itemIds: body.itemIds } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          actorUserId: auth.userId,
        });
        return reply.send({ purchaseOrder });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/purchase-orders/:purchaseOrderId",
    async (request, reply) => {
      const params = jobParams.extend({ purchaseOrderId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      try {
        await deletePurchaseOrder(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          purchaseOrderId: params.purchaseOrderId,
          actorUserId: auth.userId,
        });
        return reply.code(204).send();
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );
}
