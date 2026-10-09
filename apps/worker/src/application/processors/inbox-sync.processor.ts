import type {
  InboxConnectionStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import type {
  InboxSyncResult,
  InboxAnalysisJobPayload,
  InboxAnalysisResult,
  AttachmentIngestJobPayload,
  AttachmentIngestResult,
  MailboxClassifyJobPayload,
  MailboxClassifyJobResult,
} from "@forgeops/shared";
import {
  ProviderRegistry,
  TokenCipher,
  providerKindFromEnum,
  shouldRunNativeInboxSync,
  shouldEnqueueNativeClassification,
  ensureMailboxClassifyJob,
  buildInboxSyncSucceededAuditMetadata,
  sanitizeAuditMetadata,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

import { importProviderMailbox } from "../services/import-provider-mailbox.js";
import { enqueueAttachmentIngestFromSync } from "../services/enqueue-attachment-ingest-from-sync.js";
import type { InboxSyncContext } from "../../domain/inbox-sync-context.js";

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

type ImportMailboxResult = Awaited<ReturnType<typeof importProviderMailbox>>;

/** Merge Inbox + Sent Items import outcomes for classify/attachment enqueue. */
export function mergeInboxSyncImports(
  inbox: ImportMailboxResult,
  sent: ImportMailboxResult | null
): ImportMailboxResult {
  if (!sent) return inbox;
  const created = [...new Set([...(inbox.createdMessageIds ?? []), ...(sent.createdMessageIds ?? [])])];
  const updated = [...new Set([...(inbox.updatedMessageIds ?? []), ...(sent.updatedMessageIds ?? [])])];
  const duplicates = [
    ...new Set([
      ...(inbox.duplicateMessageIds ?? []),
      ...(sent.duplicateMessageIds ?? []),
    ]),
  ];
  return {
    workspaceId: inbox.workspaceId,
    inboxConnectionId: inbox.inboxConnectionId,
    threadsImported: inbox.threadsImported + sent.threadsImported,
    messagesImported: inbox.messagesImported + sent.messagesImported,
    duplicatesSkipped: inbox.duplicatesSkipped + sent.duplicatesSkipped,
    createdMessageIds: created,
    updatedMessageIds: updated,
    duplicateMessageIds: duplicates,
    newestSyncCursor: inbox.newestSyncCursor,
    attachmentIngestCandidates: [
      ...inbox.attachmentIngestCandidates,
      ...sent.attachmentIngestCandidates,
    ],
    skippedClearedCount:
      (inbox.skippedClearedCount ?? 0) + (sent.skippedClearedCount ?? 0),
  };
}

const logAuditEvent = async (input: {
  prisma: PrismaClient;
  workspaceId: string;
  actorUserId?: string;
  connectionId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  let metadataJson: Prisma.InputJsonValue | undefined;
  if (input.metadata) {
    const sanitized = sanitizeAuditMetadata(input.metadata, {
      onWarn: ({ byteLength, truncated, strippedKeys }) => {
        console.warn("audit-metadata-oversized", {
          action: input.action,
          entityId: input.connectionId,
          workspaceId: input.workspaceId,
          byteLength,
          truncated,
          strippedKeys: strippedKeys.slice(0, 20),
        });
      },
    });
    metadataJson = toPrismaJson(sanitized.metadata);
  }
  await input.prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      entityType: "INBOX_CONNECTION",
      entityId: input.connectionId,
      action: input.action,
      ...(metadataJson !== undefined ? { metadata: metadataJson } : {}),
    },
  });
};

/**
 * Classify inbox-sync failures.
 *
 * REQUIRES_REAUTH = user must reconnect (revoked/expired refresh grant).
 * ERROR = ops/config problem (wrong client secret, etc.) — reconnect alone will not fix.
 * ACTIVE = transient; keep mailbox usable.
 *
 * Important: do NOT treat bare "unauthorized" / invalid_client as user reauth —
 * worker/API Outlook secret mismatch surfaces as invalid_client after a successful OAuth.
 */
export const classifySyncFailure = (
  error: unknown
): {
  message: string;
  status: InboxConnectionStatus;
  clearAccessToken: boolean;
  classification: "requires_reauth" | "config_error" | "transient";
} => {
  const message = error instanceof Error ? error.message : "Unknown sync error";
  const normalized = message.toLowerCase();

  // App registration / secret / tenant misconfiguration (common after rotating secrets
  // on API but not worker).
  const configError =
    normalized.includes("invalid_client") ||
    normalized.includes("unauthorized_client") ||
    normalized.includes("outlook client is not configured") ||
    normalized.includes("aadsts7000215") || // Invalid client secret
    normalized.includes("aadsts700016") || // Application not found in tenant
    normalized.includes("aadsts70011"); // Invalid scope

  if (configError) {
    return {
      message,
      status: "ERROR",
      clearAccessToken: false,
      classification: "config_error",
    };
  }

  const requiresReauth =
    normalized.includes("invalid_grant") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("login required") ||
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
    clearAccessToken: requiresReauth,
    classification: requiresReauth ? "requires_reauth" : "transient",
  };
};

/** Extract safe (non-secret) fields from a sync/refresh error message for logs. */
export const extractSafeSyncFailureDiagnostics = (
  error: unknown
): {
  httpStatus: number | null;
  microsoftErrorCode: string | null;
} => {
  const message = error instanceof Error ? error.message : String(error);
  const httpStatusMatch = message.match(/\((\d{3})\):/);
  const httpStatus = httpStatusMatch ? Number(httpStatusMatch[1]) : null;

  let microsoftErrorCode: string | null = null;
  const jsonMatch = message.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        error?: unknown;
        error_codes?: unknown;
      };
      if (typeof parsed.error === "string") {
        microsoftErrorCode = parsed.error;
      }
      if (
        microsoftErrorCode == null &&
        Array.isArray(parsed.error_codes) &&
        parsed.error_codes.length > 0
      ) {
        microsoftErrorCode = String(parsed.error_codes[0]);
      }
    } catch {
      // ignore malformed JSON in error text
    }
  }
  if (!microsoftErrorCode) {
    const aadsts = message.match(/AADSTS\d+/i);
    if (aadsts) microsoftErrorCode = aadsts[0].toUpperCase();
  }

  return { httpStatus, microsoftErrorCode };
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
    private readonly analysisQueue?: Queue<InboxAnalysisJobPayload, InboxAnalysisResult>,
    private readonly attachmentIngestQueue?: Queue<AttachmentIngestJobPayload, AttachmentIngestResult>,
    private readonly classifyQueue?: Queue<MailboxClassifyJobPayload, MailboxClassifyJobResult>
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

    // Hard guard: N8N-owned mailboxes must never import via native Graph sync
    // (stale BullMQ jobs / webhook bugs / manual queue injection).
    if (!shouldRunNativeInboxSync(connection)) {
      console.info("native-sync-skipped", {
        workspaceId: context.workspaceId,
        inboxConnectionId: connection.id,
        reason: "listener_or_mode_gate",
        ingestionSource: connection.ingestionSource,
        nativeListeningEnabled: connection.nativeListeningEnabled,
        jobId: context.jobId,
      });
      return {
        workspaceId: context.workspaceId,
        inboxConnectionId: connection.id,
        threadsImported: 0,
        messagesImported: 0,
        duplicatesSkipped: 0,
        newestSyncCursor: connection.syncCursor,
        skipped: true,
        skipReason: "listener_or_mode_gate",
      };
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
      const refreshToken = this.tokenCipher.decrypt(
        connection.encryptedRefreshToken
      );
      const accessToken = safeDecrypt(
        this.tokenCipher,
        connection.encryptedAccessToken
      );
      const graphMailbox =
        connection.delegatedMailboxAccess
          ? { graphMailboxEmail: connection.email }
          : {};

      // 1) Inbox delta (independent cursor: syncCursor)
      const inboxMailbox = await provider.syncMailbox({
        refreshToken,
        accessToken,
        accessTokenExpiresAt: connection.accessTokenExpiresAt,
        syncCursor: connection.syncCursor,
        maxThreads: 100,
        mailFolder: "inbox",
        ...graphMailbox,
      });

      const inboxImport = await importProviderMailbox({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        inboxConnectionId: connection.id,
        mailbox: inboxMailbox,
      });

      // 2) Sent Items delta when listenSent (independent cursor: sentSyncCursor)
      let sentImport: Awaited<ReturnType<typeof importProviderMailbox>> | null =
        null;
      let sentMailbox: typeof inboxMailbox | null = null;
      if (connection.listenSent === true && providerKind === "outlook") {
        sentMailbox = await provider.syncMailbox({
          refreshToken: inboxMailbox.refreshedRefreshToken ?? refreshToken,
          accessToken: inboxMailbox.accessToken ?? accessToken,
          accessTokenExpiresAt:
            inboxMailbox.accessTokenExpiresAt ?? connection.accessTokenExpiresAt,
          syncCursor: connection.sentSyncCursor,
          maxThreads: 100,
          mailFolder: "sentitems",
          ...graphMailbox,
        });
        sentImport = await importProviderMailbox({
          prisma: this.prisma,
          workspaceId: context.workspaceId,
          inboxConnectionId: connection.id,
          mailbox: sentMailbox,
        });
      }

      const syncResult = mergeInboxSyncImports(inboxImport, sentImport);
      const syncCompletedAt = new Date();
      const latestMailbox = sentMailbox ?? inboxMailbox;

      const tokenUpdates: Record<string, unknown> = {};

      if (latestMailbox.accessToken) {
        tokenUpdates.encryptedAccessToken = this.tokenCipher.encrypt(
          latestMailbox.accessToken
        );
      }

      if (latestMailbox.refreshedRefreshToken) {
        tokenUpdates.encryptedRefreshToken = this.tokenCipher.encrypt(
          latestMailbox.refreshedRefreshToken
        );
      }

      await this.prisma.inboxConnection.update({
        where: {
          id: connection.id
        },
        data: {
          status: "ACTIVE",
          syncCursor: inboxImport.newestSyncCursor ?? connection.syncCursor,
          ...(connection.listenSent === true && providerKind === "outlook"
            ? {
                sentSyncCursor:
                  sentImport?.newestSyncCursor ?? connection.sentSyncCursor,
              }
            : {}),
          lastSyncedAt: syncCompletedAt,
          lastSyncError: null,
          lastSyncErrorAt: null,
          ...tokenUpdates,
          accessTokenExpiresAt: latestMailbox.accessTokenExpiresAt
        }
      });

      const createdCount = syncResult.createdMessageIds?.length ?? 0;
      const updatedCount = syncResult.updatedMessageIds?.length ?? 0;
      const duplicateCount = syncResult.duplicateMessageIds?.length ?? 0;
      const attachmentIngestCandidateCount =
        syncResult.attachmentIngestCandidates?.length ?? 0;
      const skippedClearedCount = syncResult.skippedClearedCount ?? 0;
      const syncCursorAdvanced = Boolean(
        inboxImport.newestSyncCursor &&
          inboxImport.newestSyncCursor !== connection.syncCursor
      );
      const sentSyncCursorAdvanced = Boolean(
        sentImport?.newestSyncCursor &&
          sentImport.newestSyncCursor !== connection.sentSyncCursor
      );

      await logAuditEvent({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        connectionId: connection.id,
        action: "inbox_connection.sync_succeeded",
        ...(context.initiatedBy ? { actorUserId: context.initiatedBy } : {}),
        metadata: buildInboxSyncSucceededAuditMetadata({
          provider: providerKind,
          jobId: context.jobId,
          refreshTokenRotated: Boolean(latestMailbox.refreshedRefreshToken),
          syncCursorAdvanced,
          threadsImported: syncResult.threadsImported,
          messagesImported: syncResult.messagesImported,
          duplicatesSkipped: syncResult.duplicatesSkipped,
          createdCount,
          updatedCount,
          duplicateCount,
          attachmentIngestCandidateCount,
          skippedClearedCount,
          ...(syncResult.skipped
            ? { skipped: true, skipReason: syncResult.skipReason }
            : {}),
        }),
      });

      // Full operational detail stays in application logs, not AuditEvent.
      console.info("inbox-sync-completed", {
        jobId: context.jobId,
        provider: providerKind,
        refreshTokenRotated: Boolean(latestMailbox.refreshedRefreshToken),
        workspaceId: syncResult.workspaceId,
        inboxConnectionId: syncResult.inboxConnectionId,
        threadsImported: syncResult.threadsImported,
        messagesImported: syncResult.messagesImported,
        duplicatesSkipped: syncResult.duplicatesSkipped,
        createdCount,
        updatedCount,
        duplicateCount,
        attachmentIngestCandidateCount,
        skippedClearedCount,
        syncCursorAdvanced,
        sentSyncCursorAdvanced,
        listenSent: connection.listenSent === true,
        hasNewestSyncCursor: Boolean(inboxImport.newestSyncCursor),
        hasNewestSentSyncCursor: Boolean(sentImport?.newestSyncCursor),
        newestSyncCursorLength: inboxImport.newestSyncCursor?.length ?? 0,
        skipped: syncResult.skipped ?? false,
        skipReason: syncResult.skipReason,
      });

      if (
        this.classifyQueue &&
        !syncResult.skipped &&
        shouldEnqueueNativeClassification(connection) &&
        (syncResult.createdMessageIds?.length ?? 0) > 0
      ) {
        let enqueued = 0;
        let skippedInflight = 0;
        for (const emailMessageId of syncResult.createdMessageIds ?? []) {
          try {
            const outcome = await ensureMailboxClassifyJob({
              queue: this.classifyQueue,
              workspaceId: context.workspaceId,
              inboxConnectionId: context.inboxConnectionId,
              emailMessageId,
              ...(context.initiatedBy
                ? { initiatedBy: context.initiatedBy }
                : {}),
            });
            if (outcome === "enqueued") {
              enqueued += 1;
              await this.prisma.emailMessage
                .update({
                  where: { id: emailMessageId },
                  data: {
                    classificationStatus: "PENDING",
                    classificationLastAttemptAt: new Date(),
                    classificationAttemptCount: { increment: 1 },
                    classificationError: null,
                  },
                })
                .catch(() => {});
            } else skippedInflight += 1;
          } catch (e) {
            console.warn("auto-classify-queue-failed", {
              emailMessageId,
              error: e instanceof Error ? e.message : "unknown",
            });
          }
        }
        console.info("auto-classify-queued", {
          jobId: context.jobId,
          workspaceId: context.workspaceId,
          inboxConnectionId: context.inboxConnectionId,
          createdCount: syncResult.createdMessageIds?.length ?? 0,
          enqueued,
          skippedInflight,
          skippedClearedCount,
        });
      }

      // Native Outlook sync already has OAuth tokens — enqueue attachment ingest
      if (
        this.attachmentIngestQueue &&
        connection.provider === "OUTLOOK" &&
        connection.encryptedRefreshToken &&
        syncResult.attachmentIngestCandidates.length > 0
      ) {
        const { enqueuedCount } = await enqueueAttachmentIngestFromSync({
          queue: this.attachmentIngestQueue,
          workspaceId: context.workspaceId,
          inboxConnectionId: context.inboxConnectionId,
          candidates: syncResult.attachmentIngestCandidates,
        });
        console.info("attachment-ingest-queued-from-sync", {
          jobId: context.jobId,
          count: enqueuedCount,
        });
      }

      const { attachmentIngestCandidates: _candidates, ...result } = syncResult;
      return result;
    } catch (error) {
      const failure = classifySyncFailure(error);
      const safeDiag = extractSafeSyncFailureDiagnostics(error);

      // SAFE diagnostics — never log tokens/secrets/codes.
      console.error("inbox-connection-status-transition", {
        event: "inbox_connection_marked_from_sync_failure",
        connectionId: connection.id,
        provider: providerKind,
        operation: "inbox_sync",
        fromStatus: "ACTIVE",
        toStatus: failure.status,
        classification: failure.classification,
        httpStatus: safeDiag.httpStatus,
        microsoftErrorCode: safeDiag.microsoftErrorCode,
        hasAccessToken: Boolean(connection.encryptedAccessToken),
        hasRefreshToken: Boolean(connection.encryptedRefreshToken),
        errorMessage: failure.message.slice(0, 500),
      });

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
          status: failure.status,
          classification: failure.classification,
          httpStatus: safeDiag.httpStatus,
          microsoftErrorCode: safeDiag.microsoftErrorCode,
          hasAccessToken: Boolean(connection.encryptedAccessToken),
          hasRefreshToken: Boolean(connection.encryptedRefreshToken),
        }
      });

      console.error("inbox-sync-failed", {
        jobId: context.jobId,
        provider: providerKind,
        workspaceId: context.workspaceId,
        inboxConnectionId: connection.id,
        error: failure.message,
        status: failure.status,
        classification: failure.classification,
        httpStatus: safeDiag.httpStatus,
        microsoftErrorCode: safeDiag.microsoftErrorCode,
      });

      throw error;
    }
  }
}
