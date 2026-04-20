import {
  QueueNames,
  type InboxAnalysisJobPayload,
  type InboxSyncResult,
  type InboxAnalysisResult
} from "@forgeops/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { inboxSyncJobOptions } from "../../../infrastructure/queues/bullmq-inbox-sync-dispatcher.js";
import { inboxAnalysisJobOptions } from "../../../infrastructure/queues/bullmq-inbox-analysis-dispatcher.js";
import { getSessionFromRequest } from "../authentication.js";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1)
});

const waitQuerySchema = z.object({
  wait: z.enum(["true", "false"]).optional().transform(v => v === "true"),
  timeoutMs: z.coerce.number().int().positive().max(300_000).default(120_000)
});

export const registerInboxActionsRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/sync",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const query = waitQuerySchema.parse(request.query);
      const session = await getSessionFromRequest(request);

      if (!session) {
        return reply.code(401).send({ message: "Authentication required" });
      }

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );

      if (!membership) {
        return reply.code(403).send({ message: "Workspace access denied" });
      }

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: { id: params.connectionId, workspaceId: params.workspaceId },
        select: { id: true, status: true, email: true }
      });

      if (!connection) {
        return reply.code(404).send({ message: "Inbox connection not found" });
      }

      if (
        connection.status === "DISCONNECTED" ||
        connection.status === "PAUSED" ||
        connection.status === "REQUIRES_REAUTH"
      ) {
        return reply.code(409).send({
          message: `Cannot sync: connection is ${connection.status}`,
          status: connection.status
        });
      }

      const job = await app.services.inboxSyncQueue.add(
        QueueNames.INBOX_SYNC,
        {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
          initiatedBy: session.userId
        },
        inboxSyncJobOptions
      );

      if (!job.id) {
        throw new Error("BullMQ did not return a job identifier");
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.connectionId,
        action: "inbox_connection.sync_requested",
        metadata: { jobId: String(job.id) },
        request
      });

      if (!query.wait) {
        return reply.code(202).send({ status: "queued", jobId: String(job.id) });
      }

      try {
        const result = await job.waitUntilFinished(
          app.services.inboxSyncQueueEvents,
          query.timeoutMs
        );

        return reply.send({
          status: "completed",
          jobId: String(job.id),
          sync: result as InboxSyncResult
        });
      } catch (error) {
        return reply.code(500).send({
          status: "failed",
          jobId: String(job.id),
          error: error instanceof Error ? error.message : "Sync failed"
        });
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/analyze",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const query = waitQuerySchema.parse(request.query);
      const session = await getSessionFromRequest(request);

      if (!session) {
        return reply.code(401).send({ message: "Authentication required" });
      }

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );

      if (!membership) {
        return reply.code(403).send({ message: "Workspace access denied" });
      }

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: { id: params.connectionId, workspaceId: params.workspaceId },
        select: { id: true }
      });

      if (!connection) {
        return reply.code(404).send({ message: "Inbox connection not found" });
      }

      const payload: InboxAnalysisJobPayload = {
        workspaceId: params.workspaceId,
        inboxConnectionId: params.connectionId,
        initiatedBy: session.userId
      };

      const job = await app.services.inboxAnalysisQueue.add(
        QueueNames.INBOX_ANALYSIS,
        payload,
        inboxAnalysisJobOptions
      );

      if (!job.id) {
        throw new Error("BullMQ did not return a job identifier");
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.connectionId,
        action: "inbox_connection.analysis_requested",
        metadata: { jobId: String(job.id) },
        request
      });

      if (!query.wait) {
        return reply.code(202).send({ status: "queued", jobId: String(job.id) });
      }

      try {
        const result = await job.waitUntilFinished(
          app.services.inboxAnalysisQueueEvents,
          query.timeoutMs
        );

        return reply.send({
          status: "completed",
          jobId: String(job.id),
          analysis: result as InboxAnalysisResult
        });
      } catch (error) {
        return reply.code(500).send({
          status: "failed",
          jobId: String(job.id),
          error: error instanceof Error ? error.message : "Analysis failed"
        });
      }
    }
  );
};
