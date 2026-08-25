import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  HISTORICAL_IMPORT_LIMIT_PRESETS,
  HISTORICAL_IMPORT_MAX_LIMIT,
  historicalImportJobId,
  QueueNames,
  shouldRegisterNativePush,
} from "@forgeops/shared";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

function hasMinRole(current: string, required: string): boolean {
  return (ROLE_RANK[current] ?? 0) >= (ROLE_RANK[required] ?? 999);
}

const connectionParamsSchema = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
});

const importParamsSchema = connectionParamsSchema.extend({
  importId: z.string().min(1),
});

const listenerSettingsPatchSchema = z
  .object({
    nativeListeningEnabled: z.boolean().optional(),
    listenIncoming: z.boolean().optional(),
    listenSent: z.boolean().optional(),
    excludeJunk: z.boolean().optional(),
    excludeTrash: z.boolean().optional(),
    ingestionSource: z.enum(["NATIVE", "N8N", "SHADOW"]).optional(),
  })
  .strict();

const historicalImportBodySchema = z
  .object({
    limit: z.number().int().min(1).max(HISTORICAL_IMPORT_MAX_LIMIT).optional(),
    preset: z.enum(["25", "50", "100", "250"]).optional(),
  })
  .strict()
  .refine((v) => v.limit != null || v.preset != null, {
    message: "Provide limit or preset",
  });

async function requireAdminMembership(
  app: FastifyInstance,
  request: Parameters<typeof getSessionFromRequest>[0],
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
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
  return { session, membership };
}

function serializeListenerSettings(connection: {
  id: string;
  email: string;
  provider: string;
  status: string;
  ingestionSource: string;
  nativeListeningEnabled: boolean;
  listenIncoming: boolean;
  listenSent: boolean;
  excludeJunk: boolean;
  excludeTrash: boolean;
  lastSyncedAt: Date | null;
  lastReceivedAt: Date | null;
  lastProcessedAt: Date | null;
  lastSyncError: string | null;
  lastErrorMessage: string | null;
}) {
  return {
    connectionId: connection.id,
    email: connection.email,
    provider: connection.provider,
    status: connection.status,
    ingestionSource: connection.ingestionSource,
    processingMode:
      connection.ingestionSource === "SHADOW"
        ? "SHADOW"
        : connection.ingestionSource === "NATIVE"
          ? "NATIVE"
          : "N8N",
    shadowSupported: false,
    nativeListeningEnabled: connection.nativeListeningEnabled,
    listener: {
      listenIncoming: connection.listenIncoming,
      listenSent: connection.listenSent,
      excludeJunk: connection.excludeJunk,
      excludeTrash: connection.excludeTrash,
    },
    activity: {
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      lastReceivedAt: connection.lastReceivedAt?.toISOString() ?? null,
      lastProcessedAt: connection.lastProcessedAt?.toISOString() ?? null,
      lastError:
        connection.lastSyncError ?? connection.lastErrorMessage ?? null,
    },
  };
}

function serializeHistoricalImport(row: {
  id: string;
  workspaceId: string;
  inboxConnectionId: string;
  status: string;
  requestedLimit: number;
  processedCount: number;
  importedCount: number;
  duplicateCount: number;
  businessCount: number;
  personalCount: number;
  failedCount: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    inboxConnectionId: row.inboxConnectionId,
    status: row.status,
    requestedLimit: row.requestedLimit,
    processedCount: row.processedCount,
    importedCount: row.importedCount,
    duplicateCount: row.duplicateCount,
    businessCount: row.businessCount,
    personalCount: row.personalCount,
    failedCount: row.failedCount,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Workspace mailbox control-plane: listener settings + historical import.
 * ADMIN/OWNER (Membership.role) can mutate; any member can read.
 */
export const registerMailboxControlRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/listener-settings",
    async (request, reply) => {
      const params = connectionParamsSchema.parse(request.params);
      const access = await requireAdminMembership(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!access) return;
      // Read allowed for any member
      void access;

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: { id: params.connectionId, workspaceId: params.workspaceId },
      });
      if (!connection) {
        return reply.code(404).send({ message: "Mailbox not found" });
      }

      return reply.send({ settings: serializeListenerSettings(connection) });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/listener-settings",
    async (request, reply) => {
      const params = connectionParamsSchema.parse(request.params);
      const access = await requireAdminMembership(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!access) return;

      if (!hasMinRole(access.membership.role, "ADMIN")) {
        return reply
          .code(403)
          .send({ message: "ADMIN or OWNER role required" });
      }

      const body = listenerSettingsPatchSchema.parse(request.body ?? {});

      if (body.ingestionSource === "SHADOW") {
        return reply.code(400).send({
          message:
            "SHADOW processing mode is reserved and not enabled yet. Use N8N or NATIVE.",
        });
      }

      const existing = await app.services.prisma.inboxConnection.findFirst({
        where: { id: params.connectionId, workspaceId: params.workspaceId },
      });
      if (!existing) {
        return reply.code(404).send({ message: "Mailbox not found" });
      }

      const nextSource = body.ingestionSource ?? existing.ingestionSource;
      const nextListening =
        body.nativeListeningEnabled ?? existing.nativeListeningEnabled;

      if (nextListening && nextSource !== "NATIVE") {
        return reply.code(400).send({
          message:
            "Native listening requires processing mode NATIVE. Switch processing mode first, or set both together.",
        });
      }

      const nextIncoming = body.listenIncoming ?? existing.listenIncoming;
      const nextSent = body.listenSent ?? existing.listenSent;
      if (!nextIncoming && !nextSent) {
        return reply.code(400).send({
          message:
            "At least one of Listen for Incoming or Sent must remain enabled",
        });
      }

      const updated = await app.services.prisma.inboxConnection.update({
        where: { id: existing.id },
        data: {
          ...(body.nativeListeningEnabled !== undefined
            ? { nativeListeningEnabled: body.nativeListeningEnabled }
            : {}),
          ...(body.listenIncoming !== undefined
            ? { listenIncoming: body.listenIncoming }
            : {}),
          ...(body.listenSent !== undefined
            ? { listenSent: body.listenSent }
            : {}),
          ...(body.excludeJunk !== undefined
            ? { excludeJunk: body.excludeJunk }
            : {}),
          ...(body.excludeTrash !== undefined
            ? { excludeTrash: body.excludeTrash }
            : {}),
          ...(body.ingestionSource !== undefined
            ? {
                ingestionSource: body.ingestionSource,
                ...(body.ingestionSource === "N8N"
                  ? { nativeListeningEnabled: false }
                  : {}),
              }
            : {}),
        },
      });

      await app.services.prisma.workspaceMailbox.updateMany({
        where: { inboxConnectionId: updated.id },
        data: {
          ingestionMode:
            updated.ingestionSource === "NATIVE" ? "NATIVE" : "N8N",
        },
      });

      await app.services.registerScheduledSync(
        updated.workspaceId,
        updated.id
      );

      if (shouldRegisterNativePush(updated)) {
        app
          .inject({
            method: "POST",
            url: `/api/v1/webhooks/register-push/${updated.id}`,
          })
          .catch(() => {});
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: access.session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: updated.id,
        action: "inbox_connection.listener_settings_updated",
        metadata: {
          nativeListeningEnabled: updated.nativeListeningEnabled,
          ingestionSource: updated.ingestionSource,
          listenIncoming: updated.listenIncoming,
          listenSent: updated.listenSent,
        },
        request,
      });

      return reply.send({ settings: serializeListenerSettings(updated) });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/historical-imports",
    async (request, reply) => {
      const params = connectionParamsSchema.parse(request.params);
      const access = await requireAdminMembership(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!access) return;

      if (!hasMinRole(access.membership.role, "ADMIN")) {
        return reply
          .code(403)
          .send({ message: "ADMIN or OWNER role required" });
      }

      const body = historicalImportBodySchema.parse(request.body ?? {});
      const requestedLimit =
        body.limit ??
        (body.preset ? Number(body.preset) : HISTORICAL_IMPORT_LIMIT_PRESETS[0]);

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: { id: params.connectionId, workspaceId: params.workspaceId },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          encryptedRefreshToken: true,
          email: true,
        },
      });
      if (!connection) {
        return reply.code(404).send({ message: "Mailbox not found" });
      }
      if (!connection.encryptedRefreshToken) {
        return reply.code(409).send({
          message:
            "Mailbox is not authorized with the provider. Connect/authorize before importing.",
        });
      }
      if (
        connection.status === "DISCONNECTED" ||
        connection.status === "REQUIRES_REAUTH"
      ) {
        return reply.code(409).send({
          message: `Mailbox status ${connection.status} cannot import. Reauthorize first.`,
        });
      }

      const active = await app.services.prisma.mailboxHistoricalImport.findFirst(
        {
          where: {
            inboxConnectionId: connection.id,
            status: { in: ["PENDING", "RUNNING"] },
          },
          select: { id: true },
        }
      );
      if (active) {
        return reply.code(409).send({
          message:
            "A historical import is already in progress for this mailbox",
          importId: active.id,
        });
      }

      const created = await app.services.prisma.mailboxHistoricalImport.create({
        data: {
          workspaceId: connection.workspaceId,
          inboxConnectionId: connection.id,
          requestedByUserId: access.session.userId,
          status: "PENDING",
          requestedLimit,
        },
      });

      await app.services.mailboxHistoricalImportQueue.add(
        QueueNames.MAILBOX_HISTORICAL_IMPORT,
        {
          workspaceId: connection.workspaceId,
          inboxConnectionId: connection.id,
          importId: created.id,
          requestedLimit,
          initiatedBy: access.session.userId,
        },
        {
          jobId: historicalImportJobId(created.id),
          attempts: 2,
          backoff: { type: "exponential", delay: 10000 },
          removeOnComplete: { count: 20 },
          removeOnFail: { count: 20 },
        }
      );

      return reply.code(202).send({
        import: serializeHistoricalImport(created),
        message: "Historical import queued",
      });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/historical-imports/:importId",
    async (request, reply) => {
      const params = importParamsSchema.parse(request.params);
      const access = await requireAdminMembership(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!access) return;

      const row = await app.services.prisma.mailboxHistoricalImport.findFirst({
        where: {
          id: params.importId,
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
        },
      });
      if (!row) {
        return reply.code(404).send({ message: "Import not found" });
      }

      return reply.send({ import: serializeHistoricalImport(row) });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/historical-imports",
    async (request, reply) => {
      const params = connectionParamsSchema.parse(request.params);
      const access = await requireAdminMembership(
        app,
        request,
        reply,
        params.workspaceId
      );
      if (!access) return;

      const rows = await app.services.prisma.mailboxHistoricalImport.findMany({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.connectionId,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      return reply.send({ imports: rows.map(serializeHistoricalImport) });
    }
  );
};
