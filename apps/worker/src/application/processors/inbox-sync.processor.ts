import type {
  InboxConnectionStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import type { InboxSyncResult, InboxAnalysisJobPayload, InboxAnalysisResult } from "@forgeops/shared";
import {
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  providerKindFromEnum
} from "@forgeops/shared";
import type { Queue } from "bullmq";

import { importProviderMailbox } from "../services/import-provider-mailbox.js";
import type { InboxSyncContext } from "../../domain/inbox-sync-context.js";

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

const logAuditEvent = async (input: {
  prisma: PrismaClient;
  workspaceId: string;
  actorUserId?: string;
  connectionId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  await input.prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      entityType: "INBOX_CONNECTION",
      entityId: input.connectionId,
      action: input.action,
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {})
    }
  });
};

const classifySyncFailure = (
  error: unknown
): {
  message: string;
  status: InboxConnectionStatus;
  clearAccessToken: boolean;
} => {
  const message = error instanceof Error ? error.message : "Unknown sync error";
  const normalized = message.toLowerCase();

  const requiresReauth =
    normalized.includes("invalid_grant") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("login required") ||
    normalized.includes("invalid_client") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalidauthenticationtoken") ||
    normalized.includes("expiredtoken") ||
    normalized.includes("tokenexpired") ||
    normalized.includes("interaction_required") ||
    normalized.includes("aadsts70008") ||
    normalized.includes("aadsts700082") ||
    normalized.includes("aadsts50076") ||
    normalized.includes("aadsts50078") ||
    normalized.includes("aadsts50173") ||
    normalized.includes("compact token") ||
    /token.*expired/i.test(message) ||
    /refresh.*token.*invalid/i.test(message);

  return {
    message,
    status: requiresReauth ? "REQUIRES_REAUTH" : "ACTIVE",
    clearAccessToken: requiresReauth
  };
};

const safeDecrypt = (tokenCipher: TokenCipher, value: string | null): string | null => {
  if (!value) {
    return null;
  }

  try {
    return tokenCipher.decrypt(value);
  } catch {
    return null;
  }
};

export class InboxSyncProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistry: ProviderRegistry,
    private readonly tokenCipher: TokenCipher,
    private readonly analysisQueue?: Queue<InboxAnalysisJobPayload, InboxAnalysisResult>
  ) {}

  async process(context: InboxSyncContext): Promise<InboxSyncResult> {
    const connection = await this.prisma.inboxConnection.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: context.workspaceId,
          id: context.inboxConnectionId
        }
      }
    });

    if (!connection) {
      throw new Error("Inbox connection not found for sync");
    }

    if (
      connection.status === "DISCONNECTED" ||
      connection.status === "PAUSED" ||
      connection.status === "REQUIRES_REAUTH"
    ) {
      throw new Error(
        "Inbox connection must be ACTIVE or retryable after an error before syncing"
      );
    }

    if (!connection.encryptedRefreshToken) {
      throw new Error("Inbox connection does not have a stored refresh token");
    }

    const providerKind = providerKindFromEnum(connection.provider);
    const provider = this.providerRegistry.getSyncProvider(providerKind);

    const syncStartedAt = new Date();
    await this.prisma.inboxConnection.update({
      where: {
        id: connection.id
      },
      data: {
        status: "ACTIVE",
        lastSyncStartedAt: syncStartedAt,
        lastSyncError: null,
        lastSyncErrorAt: null
      }
    });

    await logAuditEvent({
      prisma: this.prisma,
      workspaceId: context.workspaceId,
      connectionId: connection.id,
      action: "inbox_connection.sync_started",
      ...(context.initiatedBy ? { actorUserId: context.initiatedBy } : {}),
      metadata: {
        jobId: context.jobId,
        provider: providerKind,
        hasSyncCursor: Boolean(connection.syncCursor)
      }
    });

    try {
      const mailbox = await provider.syncMailbox({
        refreshToken: this.tokenCipher.decrypt(connection.encryptedRefreshToken),
        accessToken: safeDecrypt(this.tokenCipher, connection.encryptedAccessToken),
        accessTokenExpiresAt: connection.accessTokenExpiresAt,
        syncCursor: connection.syncCursor,
        maxThreads: 100
      });

      const syncResult = await importProviderMailbox({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        inboxConnectionId: connection.id,
        mailbox
      });
      const syncCompletedAt = new Date();

      const tokenUpdates: Record<string, unknown> = {};

      if (mailbox.accessToken) {
        tokenUpdates.encryptedAccessToken = this.tokenCipher.encrypt(
          mailbox.accessToken
        );
      }

      if (mailbox.refreshedRefreshToken) {
        tokenUpdates.encryptedRefreshToken = this.tokenCipher.encrypt(
          mailbox.refreshedRefreshToken
        );
      }

      await this.prisma.inboxConnection.update({
        where: {
          id: connection.id
        },
        data: {
          status: "ACTIVE",
          syncCursor: syncResult.newestSyncCursor ?? connection.syncCursor,
          lastSyncedAt: syncCompletedAt,
          lastSyncError: null,
          lastSyncErrorAt: null,
          ...tokenUpdates,
          accessTokenExpiresAt: mailbox.accessTokenExpiresAt
        }
      });

      await logAuditEvent({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        connectionId: connection.id,
        action: "inbox_connection.sync_succeeded",
        ...(context.initiatedBy ? { actorUserId: context.initiatedBy } : {}),
        metadata: {
          jobId: context.jobId,
          provider: providerKind,
          refreshTokenRotated: Boolean(mailbox.refreshedRefreshToken),
          ...syncResult
        }
      });

      console.info("inbox-sync-completed", {
        jobId: context.jobId,
        provider: providerKind,
        refreshTokenRotated: Boolean(mailbox.refreshedRefreshToken),
        ...syncResult
      });

      if (this.analysisQueue && (syncResult.messagesImported > 0 || syncResult.threadsImported > 0)) {
        try {
          const analysisPayload: InboxAnalysisJobPayload = {
            workspaceId: context.workspaceId,
            inboxConnectionId: context.inboxConnectionId,
            ...(context.initiatedBy ? { initiatedBy: context.initiatedBy } : {})
          };
          await this.analysisQueue.add(
            QueueNames.INBOX_ANALYSIS,
            analysisPayload,
            { attempts: 2, backoff: { type: "exponential", delay: 5000 } }
          );
          console.info("auto-analysis-queued", {
            jobId: context.jobId,
            workspaceId: context.workspaceId,
            inboxConnectionId: context.inboxConnectionId
          });
        } catch (e) {
          console.warn("auto-analysis-queue-failed", {
            error: e instanceof Error ? e.message : "unknown"
          });
        }
      }

      return syncResult;
    } catch (error) {
      const failure = classifySyncFailure(error);

      await this.prisma.inboxConnection.update({
        where: {
          id: connection.id
        },
        data: {
          status: failure.status,
          ...(failure.clearAccessToken
            ? {
                encryptedAccessToken: null,
                accessTokenExpiresAt: null
              }
            : {}),
          lastSyncError: failure.message,
          lastSyncErrorAt: new Date()
        }
      });

      await logAuditEvent({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        connectionId: connection.id,
        action: "inbox_connection.sync_failed",
        ...(context.initiatedBy ? { actorUserId: context.initiatedBy } : {}),
        metadata: {
          jobId: context.jobId,
          provider: providerKind,
          error: failure.message,
          status: failure.status
        }
      });

      console.error("inbox-sync-failed", {
        jobId: context.jobId,
        provider: providerKind,
        workspaceId: context.workspaceId,
        inboxConnectionId: connection.id,
        error: failure.message,
        status: failure.status
      });

      throw error;
    }
  }
}
