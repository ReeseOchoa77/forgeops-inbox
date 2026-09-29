import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditJob } from "../../../application/services/job-fabrication.js";
import {
  assignFabricationItemPackage,
  createWorkPackage,
  deleteWorkPackage,
  JOB_WORK_PACKAGE_STATUSES,
  JobWorkPackageError,
  loadJobScope,
  reorderWorkPackages,
  updateWorkPackage,
} from "../../../application/services/job-work-packages.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const jobParams = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

const packageParams = jobParams.extend({
  packageId: z.string().min(1),
});

const createBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(JOB_WORK_PACKAGE_STATUSES).optional(),
    parentId: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(JOB_WORK_PACKAGE_STATUSES).optional(),
    parentId: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
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

export function registerJobWorkPackageRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/scope",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const job = await app.services.prisma.job.findFirst({
        where: { id: jobId, workspaceId },
        select: { id: true },
      });
      if (!job) return reply.code(404).send({ message: "Job not found" });
      return reply.send(await loadJobScope(app.services.prisma, { workspaceId, jobId }));
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/work-packages",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      const job = await app.services.prisma.job.findFirst({
        where: { id: jobId, workspaceId },
        select: { id: true },
      });
      if (!job) return reply.code(404).send({ message: "Job not found" });
      const scope = await loadJobScope(app.services.prisma, { workspaceId, jobId });
      return reply.send({ packages: scope.packages, summary: scope.summary });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/work-packages",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = createBody.parse(request.body ?? {});
      try {
        const workPackage = await createWorkPackage(app.services.prisma, {
          workspaceId,
          jobId,
          name: body.name,
          description: body.description ?? null,
          ...(body.status !== undefined ? { status: body.status } : {}),
          parentId: body.parentId ?? null,
          notes: body.notes ?? null,
          actorUserId: auth.userId,
        });
        const scope = await loadJobScope(app.services.prisma, { workspaceId, jobId });
        return reply.code(201).send({ workPackage, ...scope });
      } catch (error) {
        if (error instanceof JobWorkPackageError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/work-packages/:packageId",
    async (request, reply) => {
      const { workspaceId, jobId, packageId } = packageParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = updateBody.parse(request.body ?? {});
      try {
        const workPackage = await updateWorkPackage(app.services.prisma, {
          workspaceId,
          jobId,
          packageId,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          actorUserId: auth.userId,
        });
        const scope = await loadJobScope(app.services.prisma, { workspaceId, jobId });
        return reply.send({ workPackage, ...scope });
      } catch (error) {
        if (error instanceof JobWorkPackageError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/work-packages/:packageId",
    async (request, reply) => {
      const { workspaceId, jobId, packageId } = packageParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      try {
        await deleteWorkPackage(app.services.prisma, {
          workspaceId,
          jobId,
          packageId,
          actorUserId: auth.userId,
        });
        const scope = await loadJobScope(app.services.prisma, { workspaceId, jobId });
        return reply.send(scope);
      } catch (error) {
        if (error instanceof JobWorkPackageError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.put(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/work-packages/reorder",
    async (request, reply) => {
      const { workspaceId, jobId } = jobParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = z.object({ orderedIds: z.array(z.string().min(1)).min(1) }).parse(request.body ?? {});
      try {
        await reorderWorkPackages(app.services.prisma, {
          workspaceId,
          jobId,
          orderedIds: body.orderedIds,
          actorUserId: auth.userId,
        });
        return reply.send(await loadJobScope(app.services.prisma, { workspaceId, jobId }));
      } catch (error) {
        if (error instanceof JobWorkPackageError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/fabrication-items/:itemId/work-package",
    async (request, reply) => {
      const params = jobParams
        .extend({ itemId: z.string().min(1) })
        .parse(request.params);
      const auth = await requireAuth(app, request, reply, params.workspaceId);
      if (!auth) return;
      if (!canEditJob(auth.workspaceRole)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }
      const body = z
        .object({ workPackageId: z.string().min(1).nullable() })
        .strict()
        .parse(request.body ?? {});
      try {
        await assignFabricationItemPackage(app.services.prisma, {
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          itemId: params.itemId,
          workPackageId: body.workPackageId,
          actorUserId: auth.userId,
        });
        return reply.send(
          await loadJobScope(app.services.prisma, {
            workspaceId: params.workspaceId,
            jobId: params.jobId,
          })
        );
      } catch (error) {
        if (error instanceof JobWorkPackageError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    }
  );
}
