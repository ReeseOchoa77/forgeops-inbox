import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  WorkerJobActionError,
  cancelWorkerJob,
  getWorkerJobDetail,
  listWorkerJobs,
  removeWorkerJob,
  retryWorkerJob,
  setQueuePaused,
  workerQueuesFromServices,
  type WorkerQueueHandle,
} from "../../../application/services/worker-jobs.js";
import { getSessionFromRequest } from "../authentication.js";

async function requirePlatformAdmin(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ userId: string } | null> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    reply.code(401).send({ message: "Authentication required" });
    return null;
  }
  const user = await app.services.prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, platformRole: true },
  });
  if (!user || user.platformRole !== "PLATFORM_ADMIN") {
    reply.code(403).send({ message: "Platform admin access required" });
    return null;
  }
  return { userId: user.id };
}

const listQuery = z.object({
  status: z.string().optional(),
  queue: z.string().optional(),
  q: z.string().max(200).optional(),
  workspaceId: z.string().optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

const jobParams = z.object({
  queue: z.string().min(1),
  jobId: z.string().min(1),
});

const queueParams = z.object({
  queue: z.string().min(1),
});

const disableScheduleBody = z.object({
  connectionId: z.string().min(1),
});

function queues(app: FastifyInstance) {
  return workerQueuesFromServices({
    inboxSyncQueue: app.services.inboxSyncQueue as unknown as WorkerQueueHandle,
    inboxAnalysisQueue: app.services.inboxAnalysisQueue as unknown as WorkerQueueHandle,
    attachmentIngestQueue: app.services.attachmentIngestQueue as unknown as WorkerQueueHandle,
    mailboxHistoricalImportQueue: app.services.mailboxHistoricalImportQueue as unknown as WorkerQueueHandle,
    mailboxClassifyQueue: app.services.mailboxClassifyQueue as unknown as WorkerQueueHandle,
    projectFolderEmailAnalyzeQueue: app.services.projectFolderEmailAnalyzeQueue as unknown as WorkerQueueHandle,
    mailboxReclassifyQueue: app.services.mailboxReclassifyQueue as unknown as WorkerQueueHandle,
  });
}

async function audit(
  app: FastifyInstance,
  request: FastifyRequest,
  actorUserId: string,
  action: string,
  entityId: string,
  workspaceId: string | null,
  metadata: Record<string, string>
): Promise<void> {
  if (!workspaceId) {
    request.log.info({ event: action, entityId, ...metadata });
    return;
  }
  await app.services.auditEventLogger.log({
    workspaceId,
    actorUserId,
    entityType: "worker_job",
    entityId: entityId.slice(0, 120),
    action,
    metadata,
    request,
  });
}

function sendActionError(reply: FastifyReply, error: unknown) {
  if (error instanceof WorkerJobActionError) {
    return reply.code(error.statusCode).send({ message: error.message, code: error.code });
  }
  throw error;
}

export function registerWorkerJobRoutes(app: FastifyInstance): void {
  app.get("/api/v1/system/worker-jobs", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const query = listQuery.parse(request.query);
    const result = await listWorkerJobs(
      { queues: queues(app), prisma: app.services.prisma },
      {
        ...(query.status ? { status: query.status } : {}),
        ...(query.queue ? { queue: query.queue } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.page != null ? { page: query.page } : {}),
        ...(query.pageSize != null ? { pageSize: query.pageSize } : {}),
      }
    );
    return reply.send(result);
  });

  app.get("/api/v1/system/worker-jobs/:queue/:jobId", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const params = jobParams.parse(request.params);
    const detail = await getWorkerJobDetail(
      { queues: queues(app), prisma: app.services.prisma },
      params.queue,
      params.jobId
    );
    if (!detail) return reply.code(404).send({ message: "Job not found" });
    return reply.send(detail);
  });

  app.post("/api/v1/system/worker-jobs/:queue/:jobId/retry", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const params = jobParams.parse(request.params);
    try {
      const result = await retryWorkerJob({ queues: queues(app) }, params.queue, params.jobId);
      await audit(app, request, admin.userId, "worker_job.retry", result.jobId, result.workspaceId, {
        queue: result.queue,
        jobId: result.jobId,
      });
      return reply.send(result);
    } catch (error) {
      return sendActionError(reply, error);
    }
  });

  app.post("/api/v1/system/worker-jobs/:queue/:jobId/cancel", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const params = jobParams.parse(request.params);
    try {
      const result = await cancelWorkerJob(
        { queues: queues(app), prisma: app.services.prisma },
        params.queue,
        params.jobId
      );
      await audit(app, request, admin.userId, "worker_job.cancel", result.jobId, result.workspaceId, {
        queue: result.queue,
        jobId: result.jobId,
        mode: result.mode,
      });
      return reply.send(result);
    } catch (error) {
      return sendActionError(reply, error);
    }
  });

  app.delete("/api/v1/system/worker-jobs/:queue/:jobId", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const params = jobParams.parse(request.params);
    try {
      const result = await removeWorkerJob({ queues: queues(app) }, params.queue, params.jobId);
      await audit(app, request, admin.userId, "worker_job.remove", result.jobId, result.workspaceId, {
        queue: result.queue,
        jobId: result.jobId,
      });
      return reply.send(result);
    } catch (error) {
      return sendActionError(reply, error);
    }
  });

  app.post("/api/v1/system/worker-queues/:queue/pause", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const params = queueParams.parse(request.params);
    try {
      const result = await setQueuePaused({ queues: queues(app) }, params.queue, true);
      request.log.info({ event: "worker_queue.pause", queue: result.queue, actorUserId: admin.userId });
      return reply.send({
        ...result,
        message: "Pausing a queue prevents waiting jobs from starting. Jobs already running may finish.",
      });
    } catch (error) {
      return sendActionError(reply, error);
    }
  });

  app.post("/api/v1/system/worker-queues/:queue/resume", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const params = queueParams.parse(request.params);
    try {
      const result = await setQueuePaused({ queues: queues(app) }, params.queue, false);
      request.log.info({ event: "worker_queue.resume", queue: result.queue, actorUserId: admin.userId });
      return reply.send(result);
    } catch (error) {
      return sendActionError(reply, error);
    }
  });

  app.post("/api/v1/system/worker-queues/:queue/schedules/disable", async (request, reply) => {
    const admin = await requirePlatformAdmin(app, request, reply);
    if (!admin) return;
    const params = queueParams.parse(request.params);
    const body = disableScheduleBody.parse(request.body);
    if (params.queue !== "inbox-sync") {
      return reply.code(409).send({ message: "Only inbox-sync schedules can be disabled here." });
    }
    await app.services.removeScheduledSync(body.connectionId);
    request.log.info({
      event: "worker_schedule.disable",
      queue: params.queue,
      connectionId: body.connectionId,
      actorUserId: admin.userId,
    });
    return reply.send({ queue: params.queue, connectionId: body.connectionId, disabled: true });
  });
}
