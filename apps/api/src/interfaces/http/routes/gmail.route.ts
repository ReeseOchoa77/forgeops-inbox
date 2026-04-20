import {
  QueueNames,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult,
  type InboxSyncResult
} from "@forgeops/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { inboxAnalysisJobOptions } from "../../../infrastructure/queues/bullmq-inbox-analysis-dispatcher.js";
import { inboxSyncJobOptions } from "../../../infrastructure/queues/bullmq-inbox-sync-dispatcher.js";
import { getSessionFromRequest } from "../authentication.js";

const gmailSyncBodySchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1)
});

const workspaceConnectionParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1)
});

const developmentSyncQuerySchema = z.object({
  wait: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  timeoutMs: z.coerce.number().int().positive().max(300_000).default(120_000)
});

const inboxSyncResultSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  threadsImported: z.number().int().nonnegative(),
  messagesImported: z.number().int().nonnegative(),
  duplicatesSkipped: z.number().int().nonnegative(),
  newestSyncCursor: z.string().min(1).nullable()
});

const inboxAnalysisResultSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  messagesAnalyzed: z.number().int().nonnegative(),
  messagesClassified: z.number().int().nonnegative(),
  taskCandidatesCreated: z.number().int().nonnegative(),
  lowConfidenceItemsFlaggedForReview: z.number().int().nonnegative()
});

const isDevelopmentRouteEnabled = (app: FastifyInstance): boolean =>
  app.services.env.NODE_ENV !== "production" &&
  app.services.env.DEV_ENABLE_BOOTSTRAP_ROUTES;

const loadAccessibleConnection = async (input: {
  app: FastifyInstance;
  request: FastifyRequest;
  workspaceId: string;
  inboxConnectionId: string;
}) => {
  const session = await getSessionFromRequest(input.request);

  if (!session) {
    return {
      session: null,
      membership: null,
      connection: null
    };
  }

  const membership = await requireWorkspaceMembership(
    input.app.services.prisma,
    session.userId,
    input.workspaceId
  );

  if (!membership) {
    return {
      session,
      membership: null,
      connection: null
    };
  }

  const connection = await input.app.services.prisma.inboxConnection.findFirst({
    where: {
      id: input.inboxConnectionId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      status: true,
      syncCursor: true,
      lastSyncedAt: true
    }
  });

  return {
    session,
    membership,
    connection
  };
};

const enqueueInboxSyncJob = async (input: {
  app: FastifyInstance;
  workspaceId: string;
  inboxConnectionId: string;
  initiatedBy?: string;
}) => {
  const job = await input.app.services.inboxSyncQueue.add(
    QueueNames.INBOX_SYNC,
    {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {})
    },
    inboxSyncJobOptions
  );

  if (!job.id) {
    throw new Error("BullMQ did not return a job identifier");
  }

  return job;
};

const enqueueInboxAnalysisJob = async (input: {
  app: FastifyInstance;
  workspaceId: string;
  inboxConnectionId: string;
  initiatedBy?: string;
}) => {
  const payload: InboxAnalysisJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {})
  };
  const job = await input.app.services.inboxAnalysisQueue.add(
    QueueNames.INBOX_ANALYSIS,
    payload,
    inboxAnalysisJobOptions
  );

  if (!job.id) {
    throw new Error("BullMQ did not return a job identifier");
  }

  return job;
};

export const registerGmailRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get("/api/v1/integrations/gmail/config", async () => {
    const gmailProvider = app.services.providerRegistry.getOAuthProvider("gmail");
    return {
      configured: gmailProvider.isConfigured(),
      authRedirectUri: app.services.env.GOOGLE_AUTH_REDIRECT_URI ?? null,
      inboxRedirectUri: app.services.env.GOOGLE_INBOX_REDIRECT_URI ?? null,
      requestedScopes: [...gmailProvider.getRequiredScopes()]
    };
  });

  app.post("/api/v1/integrations/gmail/sync", async (request, reply) => {
    const body = gmailSyncBodySchema.parse(request.body);
    const { session, membership, connection } = await loadAccessibleConnection({
      app,
      request,
      workspaceId: body.workspaceId,
      inboxConnectionId: body.inboxConnectionId
    });

    if (!session) {
      return reply.code(401).send({
        message: "Authentication required"
      });
    }

    if (!membership) {
      return reply.code(403).send({
        message: "Workspace access denied"
      });
    }

    if (!connection) {
      return reply.code(404).send({
        message: "Inbox connection not found"
      });
    }

    if (
      connection.status === "DISCONNECTED" ||
      connection.status === "PAUSED" ||
      connection.status === "REQUIRES_REAUTH"
    ) {
      return reply.code(409).send({
        message: "Inbox connection must be ACTIVE or retryable after an error before syncing",
        connection: {
          id: connection.id,
          status: connection.status,
          email: connection.email
        }
      });
    }

    const job = await enqueueInboxSyncJob({
      app,
      workspaceId: body.workspaceId,
      inboxConnectionId: body.inboxConnectionId,
      initiatedBy: session.userId
    });

    await app.services.auditEventLogger.log({
      workspaceId: body.workspaceId,
      actorUserId: session.userId,
      entityType: "INBOX_CONNECTION",
      entityId: body.inboxConnectionId,
      action: "inbox_connection.sync_requested",
      metadata: {
        jobId: String(job.id)
      },
      request
    });

    return reply.code(202).send({
      status: "queued",
      jobId: String(job.id)
    });
  });

  app.get(
    "/api/v1/dev/workspaces/:workspaceId/inbox-connections/:id/sync",
    async (request, reply) => {
      if (!isDevelopmentRouteEnabled(app)) {
        return reply.code(404).send({
          message: "Development sync routes are disabled"
        });
      }

      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = developmentSyncQuerySchema.parse(request.query);
      const { session, membership, connection } = await loadAccessibleConnection({
        app,
        request,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      if (
        connection.status === "DISCONNECTED" ||
        connection.status === "PAUSED" ||
        connection.status === "REQUIRES_REAUTH"
      ) {
        return reply.code(409).send({
          message:
            "Inbox connection must be ACTIVE or retryable after an error before syncing",
          connection: {
            id: connection.id,
            status: connection.status,
            email: connection.email
          }
        });
      }

      const job = await enqueueInboxSyncJob({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        initiatedBy: session.userId
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.sync_requested",
        metadata: {
          jobId: String(job.id),
          launchedFrom: "dev_browser_route",
          waitForCompletion: query.wait
        },
        request
      });

      if (!query.wait) {
        return reply.code(202).send({
          status: "queued",
          jobId: String(job.id)
        });
      }

      try {
        const rawResult = await job.waitUntilFinished(
          app.services.inboxSyncQueueEvents,
          query.timeoutMs
        );
        const syncResult = inboxSyncResultSchema.parse(
          rawResult as InboxSyncResult
        );

        return reply.send({
          status: "completed",
          jobId: String(job.id),
          sync: syncResult
        });
      } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
          message: "Inbox sync job failed",
          jobId: String(job.id),
          error: error instanceof Error ? error.message : "Unknown sync error"
        });
      }
    }
  );

  app.get(
    "/api/v1/dev/workspaces/:workspaceId/inbox-connections/:id/analyze",
    async (request, reply) => {
      if (!isDevelopmentRouteEnabled(app)) {
        return reply.code(404).send({
          message: "Development inbox analysis routes are disabled"
        });
      }

      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = developmentSyncQuerySchema.parse(request.query);
      const { session, membership, connection } = await loadAccessibleConnection({
        app,
        request,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const job = await enqueueInboxAnalysisJob({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        initiatedBy: session.userId
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.analysis_requested",
        metadata: {
          jobId: String(job.id),
          launchedFrom: "dev_browser_route",
          waitForCompletion: query.wait
        },
        request
      });

      if (!query.wait) {
        return reply.code(202).send({
          status: "queued",
          jobId: String(job.id)
        });
      }

      try {
        const rawResult = await job.waitUntilFinished(
          app.services.inboxAnalysisQueueEvents,
          query.timeoutMs
        );
        const analysisResult = inboxAnalysisResultSchema.parse(
          rawResult as InboxAnalysisResult
        );

        return reply.send({
          status: "completed",
          jobId: String(job.id),
          analysis: analysisResult
        });
      } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
          message: "Inbox analysis job failed",
          jobId: String(job.id),
          error: error instanceof Error ? error.message : "Unknown analysis error"
        });
      }
    }
  );
};
