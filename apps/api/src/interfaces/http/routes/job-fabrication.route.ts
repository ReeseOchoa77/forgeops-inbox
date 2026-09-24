import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  canEditJob,
  fabricationItemWhere,
  presentFabricationItem,
} from "../../../application/services/job-fabrication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({ workspaceId: z.string().min(1), jobId: z.string().min(1) });
const itemParams = jobParams.extend({ itemId: z.string().min(1) });

const itemBody = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  estimatedHoursPerPiece: z.number().nonnegative().max(100_000),
});

const updateBody = itemBody.partial().extend({
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

async function requireAuth(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  workspaceId: string,
) {
  const session = await getSessionFromRequest(request);
  if (!session) { reply.code(401).send({ message: "Authentication required" }); return null; }
  const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
  if (!membership) { reply.code(403).send({ message: "Workspace access denied" }); return null; }
  return { userId: session.userId, workspaceRole: membership.workspaceRole };
}

async function loadScope(app: FastifyInstance, workspaceId: string, jobId: string) {
  const rows = await app.services.prisma.jobFabricationItem.findMany({
    where: fabricationItemWhere(workspaceId, jobId),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const items = rows.map(presentFabricationItem);
  const estimatedHours = items.reduce((sum, item) => sum + item.totalHours, 0);
  return {
    items,
    estimatedHours: Math.round(estimatedHours * 100) / 100,
  };
}

async function auditItem(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  input: { workspaceId: string; jobId: string; userId: string; itemId: string; op: "add" | "edit" | "remove" | "reorder"; name?: string },
) {
  await app.services.prisma.jobActivityLog.create({
    data: {
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "JOB_UPDATED",
      newValue: { fabricationItemId: input.itemId, op: input.op } as Prisma.InputJsonValue,
    },
  });
  await app.services.auditEventLogger.log({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    entityType: "JOB",
    entityId: input.jobId,
    action: "job.fabrication_item_changed",
    metadata: { itemId: input.itemId, op: input.op, ...(input.name ? { name: input.name } : {}) },
    request,
  });
}

export const registerJobFabricationRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post("/api/v1/workspaces/:workspaceId/jobs/:jobId/fabrication-items", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });

    const job = await app.services.prisma.job.findFirst({ where: { id: jobId, workspaceId }, select: { id: true } });
    if (!job) return reply.code(404).send({ message: "Job not found" });

    const body = itemBody.parse(request.body);
    const last = await app.services.prisma.jobFabricationItem.findFirst({
      where: fabricationItemWhere(workspaceId, jobId),
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const created = await app.services.prisma.jobFabricationItem.create({
      data: {
        workspaceId,
        jobId,
        name: body.name,
        quantity: body.quantity,
        estimatedHoursPerPiece: body.estimatedHoursPerPiece,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await auditItem(app, request, { workspaceId, jobId, userId: auth.userId, itemId: created.id, op: "add", name: created.name });
    return reply.code(201).send(await loadScope(app, workspaceId, jobId));
  });

  app.put("/api/v1/workspaces/:workspaceId/jobs/:jobId/fabrication-items/:itemId", async (request, reply) => {
    const { workspaceId, jobId, itemId } = itemParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });

    const existing = await app.services.prisma.jobFabricationItem.findFirst({
      where: fabricationItemWhere(workspaceId, jobId, itemId),
    });
    if (!existing) return reply.code(404).send({ message: "Fabrication item not found" });

    const body = updateBody.parse(request.body);
    const data: Prisma.JobFabricationItemUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.quantity !== undefined) data.quantity = body.quantity;
    if (body.estimatedHoursPerPiece !== undefined) data.estimatedHoursPerPiece = body.estimatedHoursPerPiece;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const updated = await app.services.prisma.jobFabricationItem.update({
      where: { id: existing.id },
      data,
    });
    await auditItem(app, request, { workspaceId, jobId, userId: auth.userId, itemId: updated.id, op: "edit", name: updated.name });
    return reply.send(await loadScope(app, workspaceId, jobId));
  });

  app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId/fabrication-items/:itemId", async (request, reply) => {
    const { workspaceId, jobId, itemId } = itemParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });

    const existing = await app.services.prisma.jobFabricationItem.findFirst({
      where: fabricationItemWhere(workspaceId, jobId, itemId),
      select: { id: true, name: true },
    });
    if (!existing) return reply.code(404).send({ message: "Fabrication item not found" });

    await app.services.prisma.jobFabricationItem.delete({ where: { id: existing.id } });
    await auditItem(app, request, { workspaceId, jobId, userId: auth.userId, itemId: existing.id, op: "remove", name: existing.name });
    return reply.send(await loadScope(app, workspaceId, jobId));
  });

  app.put("/api/v1/workspaces/:workspaceId/jobs/:jobId/fabrication-order", async (request, reply) => {
    const { workspaceId, jobId } = jobParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;
    if (!canEditJob(auth.workspaceRole)) return reply.code(403).send({ message: "Edit permission required" });

    const body = z.object({ ids: z.array(z.string().min(1)).max(500) }).parse(request.body);
    const rows = await app.services.prisma.jobFabricationItem.findMany({
      where: fabricationItemWhere(workspaceId, jobId),
      select: { id: true },
    });
    const known = new Set(rows.map((row) => row.id));
    if (body.ids.length !== known.size || body.ids.some((id) => !known.has(id))) {
      return reply.code(400).send({ message: "Fabrication item order does not match this job" });
    }

    await app.services.prisma.$transaction(
      body.ids.map((id, index) =>
        app.services.prisma.jobFabricationItem.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    await auditItem(app, request, { workspaceId, jobId, userId: auth.userId, itemId: jobId, op: "reorder" });
    return reply.send(await loadScope(app, workspaceId, jobId));
  });
};
