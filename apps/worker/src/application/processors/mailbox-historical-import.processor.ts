import type { PrismaClient } from "@prisma/client";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  providerKindFromEnum,
  shouldEnqueueNativeClassification,
  buildMailboxClassifyJobId,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
  type MailboxHistoricalImportJobPayload,
  type MailboxHistoricalImportJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

import { enqueueAttachmentIngestFromSync } from "../services/enqueue-attachment-ingest-from-sync.js";
import { importProviderMailbox } from "../services/import-provider-mailbox.js";

const CLASSIFY_WAIT_MS = 5 * 60 * 1000;
const CLASSIFY_POLL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recountCategoryCounts(
  prisma: PrismaClient,
  workspaceId: string,
  inboxConnectionId: string,
  providerMessageIds: string[]
): Promise<{ businessCount: number; personalCount: number }> {
  if (providerMessageIds.length === 0) {
    return { businessCount: 0, personalCount: 0 };
  }
  const rows = await prisma.emailMessage.findMany({
    where: {
      workspaceId,
      inboxConnectionId,
      gmailMessageId: { in: providerMessageIds },
    },
    select: { mailboxCategory: true },
  });
  let businessCount = 0;
  let personalCount = 0;
  for (const row of rows) {
    if (row.mailboxCategory === "BUSINESS") businessCount += 1;
    else if (row.mailboxCategory === "PERSONAL") personalCount += 1;
  }
  return { businessCount, personalCount };
}

/**
 * Background historical import:
 * - Does NOT require nativeListeningEnabled (manual admin action)
 * - Respects requestedLimit (paginated provider fetch up to hard max)
 * - Dedupes via existing (inboxConnectionId, gmailMessageId) uniqueness
 * - Enqueues native classification only when processing mode is NATIVE
 * - Enqueues Outlook attachment ingest independently of classification
 * - Does not advance the live syncCursor (avoids coupling to listener cursor)
 * - Updates processedCount during read/import/classify so the UI progress bar moves
 */
export async function processMailboxHistoricalImport(
  payload: MailboxHistoricalImportJobPayload,
  deps: {
    prisma: PrismaClient;
    providerRegistry: ProviderRegistry;
    tokenCipher: TokenCipher;
    analysisQueue: Queue<InboxAnalysisJobPayload, InboxAnalysisResult>;
    classifyQueue: Queue<MailboxClassifyJobPayload, MailboxClassifyJobResult>;
    attachmentIngestQueue?: Queue<
      AttachmentIngestJobPayload,
      AttachmentIngestResult
    >;
  }
): Promise<MailboxHistoricalImportJobResult> {
  const limit = Math.min(
    Math.max(1, payload.requestedLimit),
    HISTORICAL_IMPORT_MAX_LIMIT
  );

  const importRow = await deps.prisma.mailboxHistoricalImport.findUnique({
    where: { id: payload.importId },
  });
  if (!importRow) {
    throw new Error(`Historical import not found: ${payload.importId}`);
  }

  await deps.prisma.mailboxHistoricalImport.update({
    where: { id: payload.importId },
    data: {
      status: "RUNNING",
      startedAt: importRow.startedAt ?? new Date(),
      errorMessage: null,
      processedCount: 0,
    },
  });

  try {
    const connection = await deps.prisma.inboxConnection.findFirst({
      where: {
        id: payload.inboxConnectionId,
        workspaceId: payload.workspaceId,
      },
    });
    if (!connection) {
      throw new Error("Inbox connection not found");
    }
    if (!connection.encryptedRefreshToken) {
      throw new Error("Inbox connection has no refresh token");
    }

    const providerKind = providerKindFromEnum(connection.provider);
    const provider = deps.providerRegistry.getSyncProvider(providerKind);

    const receivedAfter = payload.sinceDate
      ? new Date(payload.sinceDate)
      : null;
    if (receivedAfter && Number.isNaN(receivedAfter.getTime())) {
      throw new Error(`Invalid sinceDate on import job: ${payload.sinceDate}`);
    }

    // Fetch up to `limit` messages. Providers page internally (Outlook $top=50 pages).
    // Pass syncCursor: null so we do not consume/advance the live listener cursor.
    const mailbox = await provider.syncMailbox({
      refreshToken: deps.tokenCipher.decrypt(connection.encryptedRefreshToken),
      accessToken: connection.encryptedAccessToken
        ? deps.tokenCipher.decrypt(connection.encryptedAccessToken)
        : null,
      accessTokenExpiresAt: connection.accessTokenExpiresAt,
      syncCursor: null,
      maxThreads: limit,
      ...(receivedAfter ? { receivedAfter } : {}),
    });

    // Exclude junk/trash at product level when settings require it (default true).
    // Provider inbox sync is already inbox-scoped; filter residual junk/trash labels.
    const excludeJunk = connection.excludeJunk !== false;
    const excludeTrash = connection.excludeTrash !== false;
    const listenIncoming = connection.listenIncoming !== false;
    const listenSent = connection.listenSent === true;

    const filteredThreads = mailbox.threads
      .map((thread) => ({
        ...thread,
        messages: thread.messages.filter((message) => {
          if (receivedAfter) {
            const ts =
              message.receivedAt?.getTime() ??
              message.sentAt?.getTime() ??
              null;
            if (ts == null || ts < receivedAfter.getTime()) {
              return false;
            }
          }
          const labels = (message.providerLabels ?? []).map((l) =>
            l.toLowerCase()
          );
          if (
            excludeJunk &&
            labels.some((l) => l.includes("junk") || l === "spam")
          ) {
            return false;
          }
          if (
            excludeTrash &&
            labels.some((l) => l.includes("trash") || l.includes("deleted"))
          ) {
            return false;
          }
          const isSent = labels.some(
            (l) => l === "sent" || l.includes("sent items") || l === "sentitems"
          );
          if (isSent) return listenSent;
          if (!isSent && !listenIncoming) return false;
          return true;
        }),
      }))
      .filter((t) => t.messages.length > 0);

    // Enforce hard message limit across threads (newest-first providers already order).
    let remaining = limit;
    const cappedThreads = [];
    for (const thread of filteredThreads) {
      if (remaining <= 0) break;
      if (thread.messages.length <= remaining) {
        cappedThreads.push(thread);
        remaining -= thread.messages.length;
      } else {
        cappedThreads.push({
          ...thread,
          messages: thread.messages.slice(0, remaining),
        });
        remaining = 0;
      }
    }

    const providerMessageIds = cappedThreads.flatMap((t) =>
      t.messages.map((m) => m.providerMessageId)
    );

    // Mark that provider read finished — UI moves off indeterminate shimmer.
    await deps.prisma.mailboxHistoricalImport.update({
      where: { id: payload.importId },
      data: {
        processedProviderMessageIds: providerMessageIds,
        // ~25% of requested work after read, before DB import.
        processedCount: Math.max(
          1,
          Math.min(
            limit - 1,
            Math.round(providerMessageIds.length * 0.25) ||
              Math.round(limit * 0.15)
          )
        ),
      },
    });

    let importedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    let createdMessageIds: string[] = [];
    let attachmentIngestCandidates: Array<{
      emailMessageId: string;
      providerMessageId: string;
    }> = [];

    try {
      const result = await importProviderMailbox({
        prisma: deps.prisma,
        workspaceId: payload.workspaceId,
        inboxConnectionId: connection.id,
        mailbox: {
          ...mailbox,
          threads: cappedThreads,
        },
      });
      importedCount = result.messagesImported;
      duplicateCount = result.duplicatesSkipped;
      createdMessageIds = result.createdMessageIds ?? [];
      attachmentIngestCandidates = (result.attachmentIngestCandidates ?? []).map(
        (c) => ({
          emailMessageId: c.emailMessageId,
          providerMessageId: c.providerMessageId,
        })
      );
    } catch (error) {
      failedCount = providerMessageIds.length;
      throw error;
    }

    // Attachment ingest is independent of classification success/failure.
    if (
      deps.attachmentIngestQueue &&
      connection.provider === "OUTLOOK" &&
      connection.encryptedRefreshToken &&
      attachmentIngestCandidates.length > 0
    ) {
      const { enqueuedCount } = await enqueueAttachmentIngestFromSync({
        queue: deps.attachmentIngestQueue,
        workspaceId: payload.workspaceId,
        inboxConnectionId: connection.id,
        candidates: attachmentIngestCandidates,
      });
      console.info("attachment-ingest-queued-from-historical-import", {
        importId: payload.importId,
        count: enqueuedCount,
      });
    }

    // Per-message failure isolation: recount what landed vs requested ids.
    const existingAfter = providerMessageIds.length
      ? await deps.prisma.emailMessage.findMany({
          where: {
            workspaceId: payload.workspaceId,
            inboxConnectionId: connection.id,
            gmailMessageId: { in: providerMessageIds },
          },
          select: {
            id: true,
            gmailMessageId: true,
            mailboxCategory: true,
          },
        })
      : [];

    const landed = new Set(existingAfter.map((m) => m.gmailMessageId));
    failedCount = providerMessageIds.filter((id) => !landed.has(id)).length;

    const baselineDone = Math.max(
      0,
      providerMessageIds.length - createdMessageIds.length
    );

    await deps.prisma.mailboxHistoricalImport.update({
      where: { id: payload.importId },
      data: {
        importedCount,
        duplicateCount,
        failedCount,
        processedCount: Math.min(
          limit,
          Math.max(
            baselineDone,
            Math.round(providerMessageIds.length * 0.55) || baselineDone
          )
        ),
        processedProviderMessageIds: providerMessageIds,
      },
    });

    if (shouldEnqueueNativeClassification(connection)) {
      for (const emailMessageId of createdMessageIds) {
        try {
          await deps.classifyQueue.add(
            QueueNames.MAILBOX_CLASSIFY,
            {
              workspaceId: payload.workspaceId,
              inboxConnectionId: connection.id,
              emailMessageId,
              ...(payload.initiatedBy
                ? { initiatedBy: payload.initiatedBy }
                : {}),
            },
            {
              jobId: buildMailboxClassifyJobId(emailMessageId),
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
              removeOnComplete: { count: 50 },
              removeOnFail: { count: 50 },
            }
          );
        } catch (e) {
          failedCount += 1;
          console.warn("historical-classify-queue-failed", {
            emailMessageId,
            error: e instanceof Error ? e.message : "unknown",
          });
        }
      }

      // Wait for classify workers so the mailbox card progress bar covers classifying.
      if (createdMessageIds.length > 0) {
        const deadline = Date.now() + CLASSIFY_WAIT_MS;
        while (Date.now() < deadline) {
          const classified = await deps.prisma.classification.count({
            where: {
              workspaceId: payload.workspaceId,
              messageId: { in: createdMessageIds },
            },
          });
          const { businessCount, personalCount } = await recountCategoryCounts(
            deps.prisma,
            payload.workspaceId,
            connection.id,
            providerMessageIds
          );
          const processedCount = Math.min(limit, baselineDone + classified);
          await deps.prisma.mailboxHistoricalImport.update({
            where: { id: payload.importId },
            data: {
              processedCount,
              businessCount,
              personalCount,
              failedCount,
            },
          });
          if (classified >= createdMessageIds.length) break;
          await sleep(CLASSIFY_POLL_MS);
        }
      }
    }

    const { businessCount, personalCount } = await recountCategoryCounts(
      deps.prisma,
      payload.workspaceId,
      connection.id,
      providerMessageIds
    );

    const classifiedAtEnd =
      createdMessageIds.length > 0
        ? await deps.prisma.classification.count({
            where: {
              workspaceId: payload.workspaceId,
              messageId: { in: createdMessageIds },
            },
          })
        : 0;

    const processedCount = Math.min(
      limit,
      Math.max(providerMessageIds.length, baselineDone + classifiedAtEnd)
    );

    await deps.prisma.mailboxHistoricalImport.update({
      where: { id: payload.importId },
      data: {
        status: "COMPLETED",
        processedCount,
        importedCount,
        duplicateCount,
        failedCount,
        businessCount,
        personalCount,
        processedProviderMessageIds: providerMessageIds,
        completedAt: new Date(),
      },
    });

    // Touch activity timestamps without advancing syncCursor.
    await deps.prisma.inboxConnection.update({
      where: { id: connection.id },
      data: {
        lastProcessedAt: new Date(),
        ...(connection.encryptedAccessToken == null && mailbox.accessToken
          ? {}
          : {}),
      },
    });

    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: connection.id,
      importId: payload.importId,
      processedCount,
      importedCount,
      duplicateCount,
      failedCount,
      businessCount,
      personalCount,
      status: "COMPLETED",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    await deps.prisma.mailboxHistoricalImport.update({
      where: { id: payload.importId },
      data: {
        status: "FAILED",
        errorMessage: message.slice(0, 2000),
        completedAt: new Date(),
      },
    });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      importId: payload.importId,
      processedCount: 0,
      importedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      businessCount: 0,
      personalCount: 0,
      status: "FAILED",
      errorMessage: message,
    };
  }
}
