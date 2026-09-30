import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  addShipmentItem,
  createInstallation,
  createShipment,
  deleteShipment,
  DeliveryError,
  INSTALLATION_EVENT_TYPES,
  listInstallations,
  listShipments,
  removeShipmentItem,
  SHIPMENT_STATUSES,
  updateShipment,
} from "../../../application/services/job-deliveries.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
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
  if (error instanceof DeliveryError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  throw error;
}

export function registerJobDeliveryRoutes(app: FastifyInstance): void {
  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/deliveries", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({
      deliveries: await listShipments(app.services.prisma, { workspaceId, jobId }),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/deliveries", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        deliveryNumber: z.string().trim().min(1).max(40),
        status: z.enum(SHIPMENT_STATUSES).optional(),
        plannedShipDate: dateOnly.optional(),
        plannedDeliveryDate: dateOnly.optional(),
        destinationName: z.string().max(200).nullable().optional(),
        destinationAddress1: z.string().max(200).nullable().optional(),
        destinationAddress2: z.string().max(200).nullable().optional(),
        destinationCity: z.string().max(100).nullable().optional(),
        destinationState: z.string().max(50).nullable().optional(),
        destinationPostalCode: z.string().max(20).nullable().optional(),
        useJobSite: z.boolean().optional(),
        carrierName: z.string().max(200).nullable().optional(),
        driverName: z.string().max(200).nullable().optional(),
        truckNumber: z.string().max(80).nullable().optional(),
        documentRecordIds: z.array(z.string().min(1)).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const delivery = await createShipment(app.services.prisma, {
        workspaceId,
        jobId,
        deliveryNumber: body.deliveryNumber,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.plannedShipDate !== undefined ? { plannedShipDate: body.plannedShipDate } : {}),
        ...(body.plannedDeliveryDate !== undefined
          ? { plannedDeliveryDate: body.plannedDeliveryDate }
          : {}),
        ...(body.destinationName !== undefined ? { destinationName: body.destinationName } : {}),
        ...(body.destinationAddress1 !== undefined
          ? { destinationAddress1: body.destinationAddress1 }
          : {}),
        ...(body.destinationAddress2 !== undefined
          ? { destinationAddress2: body.destinationAddress2 }
          : {}),
        ...(body.destinationCity !== undefined ? { destinationCity: body.destinationCity } : {}),
        ...(body.destinationState !== undefined ? { destinationState: body.destinationState } : {}),
        ...(body.destinationPostalCode !== undefined
          ? { destinationPostalCode: body.destinationPostalCode }
          : {}),
        ...(body.useJobSite !== undefined ? { useJobSite: body.useJobSite } : {}),
        carrierName: body.carrierName ?? null,
        driverName: body.driverName ?? null,
        truckNumber: body.truckNumber ?? null,
        documentRecordIds: body.documentRecordIds ?? [],
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ delivery });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/deliveries/:shipmentId",
    async (request, reply) => {
      const params = jobParams.extend({ shipmentId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      const body = z
        .object({
          deliveryNumber: z.string().trim().min(1).max(40).optional(),
          status: z.enum(SHIPMENT_STATUSES).optional(),
          plannedShipDate: dateOnly.optional(),
          actualShipDate: dateOnly.optional(),
          plannedDeliveryDate: dateOnly.optional(),
          actualDeliveryDate: dateOnly.optional(),
          destinationName: z.string().max(200).nullable().optional(),
          destinationAddress1: z.string().max(200).nullable().optional(),
          destinationAddress2: z.string().max(200).nullable().optional(),
          destinationCity: z.string().max(100).nullable().optional(),
          destinationState: z.string().max(50).nullable().optional(),
          destinationPostalCode: z.string().max(20).nullable().optional(),
          carrierName: z.string().max(200).nullable().optional(),
          driverName: z.string().max(200).nullable().optional(),
          truckNumber: z.string().max(80).nullable().optional(),
          documentRecordIds: z.array(z.string().min(1)).optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict()
        .parse(request.body ?? {});
      try {
        const delivery = await updateShipment(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          shipmentId: params.shipmentId,
          ...(body.deliveryNumber !== undefined ? { deliveryNumber: body.deliveryNumber } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.plannedShipDate !== undefined ? { plannedShipDate: body.plannedShipDate } : {}),
          ...(body.actualShipDate !== undefined ? { actualShipDate: body.actualShipDate } : {}),
          ...(body.plannedDeliveryDate !== undefined
            ? { plannedDeliveryDate: body.plannedDeliveryDate }
            : {}),
          ...(body.actualDeliveryDate !== undefined
            ? { actualDeliveryDate: body.actualDeliveryDate }
            : {}),
          ...(body.destinationName !== undefined ? { destinationName: body.destinationName } : {}),
          ...(body.destinationAddress1 !== undefined
            ? { destinationAddress1: body.destinationAddress1 }
            : {}),
          ...(body.destinationAddress2 !== undefined
            ? { destinationAddress2: body.destinationAddress2 }
            : {}),
          ...(body.destinationCity !== undefined ? { destinationCity: body.destinationCity } : {}),
          ...(body.destinationState !== undefined ? { destinationState: body.destinationState } : {}),
          ...(body.destinationPostalCode !== undefined
            ? { destinationPostalCode: body.destinationPostalCode }
            : {}),
          ...(body.carrierName !== undefined ? { carrierName: body.carrierName } : {}),
          ...(body.driverName !== undefined ? { driverName: body.driverName } : {}),
          ...(body.truckNumber !== undefined ? { truckNumber: body.truckNumber } : {}),
          ...(body.documentRecordIds !== undefined
            ? { documentRecordIds: body.documentRecordIds }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          actorUserId: auth.userId,
        });
        return reply.send({ delivery });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/deliveries/:shipmentId",
    async (request, reply) => {
      const params = jobParams.extend({ shipmentId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      try {
        await deleteShipment(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          shipmentId: params.shipmentId,
          actorUserId: auth.userId,
        });
        return reply.code(204).send();
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/deliveries/:shipmentId/items",
    async (request, reply) => {
      const params = jobParams.extend({ shipmentId: z.string().min(1) }).parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      const body = z
        .object({
          workPackageId: z.string().min(1).nullable().optional(),
          fabricationItemId: z.string().min(1).nullable().optional(),
          description: z.string().trim().max(500).nullable().optional(),
          quantity: qty.optional(),
          unit: z.string().trim().max(20).nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict()
        .parse(request.body ?? {});
      try {
        const delivery = await addShipmentItem(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          shipmentId: params.shipmentId,
          workPackageId: body.workPackageId ?? null,
          fabricationItemId: body.fabricationItemId ?? null,
          description: body.description ?? null,
          ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
          unit: body.unit ?? null,
          notes: body.notes ?? null,
          actorUserId: auth.userId,
        });
        return reply.code(201).send({ delivery });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/deliveries/:shipmentId/items/:itemId",
    async (request, reply) => {
      const params = jobParams
        .extend({ shipmentId: z.string().min(1), itemId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
      try {
        const delivery = await removeShipmentItem(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          shipmentId: params.shipmentId,
          itemId: params.itemId,
          actorUserId: auth.userId,
        });
        return reply.send({ delivery });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  app.get("/api/v1/workspaces/:workspaceId/jobs/:jobId/installations", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    return reply.send({
      installations: await listInstallations(app.services.prisma, { workspaceId, jobId }),
    });
  });

  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/installations", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });
    const body = z
      .object({
        eventType: z.enum(INSTALLATION_EVENT_TYPES).optional(),
        eventDate: dateOnly.optional(),
        workPackageId: z.string().min(1).nullable().optional(),
        shipmentId: z.string().min(1).nullable().optional(),
        participantId: z.string().min(1).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const installation = await createInstallation(app.services.prisma, {
        workspaceId,
        jobId,
        ...(body.eventType !== undefined ? { eventType: body.eventType } : {}),
        ...(body.eventDate !== undefined ? { eventDate: body.eventDate } : {}),
        workPackageId: body.workPackageId ?? null,
        shipmentId: body.shipmentId ?? null,
        participantId: body.participantId ?? null,
        notes: body.notes ?? null,
        actorUserId: auth.userId,
      });
      return reply.code(201).send({ installation });
    } catch (error) {
      return handleError(error, reply);
    }
  });
}
