import type { PrismaClient } from "@prisma/client";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  HISTORICAL_IMPORT_PAGE_SIZE,
  ProviderRegistry,
  TokenCipher,
  isUnlimitedHistoricalImport,
  providerKindFromEnum,
  shouldEnqueueNativeClassification,
  ensureMailboxClassifyJob,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
  type MailboxHistoricalImportJobPayload,
  type MailboxHistoricalImportJobResult,
  type ProviderMailboxSyncResult,
  type ProviderThreadSnapshot,
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

function filterThreadsForImport(
  threads: ProviderThreadSnapshot[],
  opts: {
    receivedAfter: Date | null;
    excludeJunk: boolean;
    excludeTrash: boolean;
    listenIncoming: boolean;
    listenSent: boolean;
    remainingCap: number | null;
  }
): ProviderThreadSnapshot[] {
  const filtered = threads
    .map((thread) => ({
      ...thread,
      messages: thread.messages.filter((message) => {
        if (opts.receivedAfter) {
          const ts =
            message.receivedAt?.getTime() ??
            message.sentAt?.getTime() ??
            null;
          if (ts == null || ts < opts.receivedAfter.getTime()) {
            return false;
          }
        }
        const labels = (message.providerLabels ?? []).map((l) =>
          l.toLowerCase()
        );
        if (
          opts.excludeJunk &&
          labels.some((l) => l.includes("junk") || l === "spam")
        ) {
          return false;
        }
        if (
          opts.excludeTrash &&
          labels.some((l) => l.includes("trash") || l.includes("deleted"))
        ) {
          return false;
        }
        const isSent = labels.some(
          (l) => l === "sent" || l.includes("sent items") || l === "sentitems"
        );
        if (isSent) return opts.listenSent;
        if (!isSent && !opts.listenIncoming) return false;
        return true;
      }),
    }))
    .filter((t) => t.messages.length > 0);

  if (opts.remainingCap == null) return filtered;

  let remaining = opts.remainingCap;
  const capped: ProviderThreadSnapshot[] = [];
  for (const thread of filtered) {
    if (remaining <= 0) break;
    if (thread.messages.length <= remaining) {
      capped.push(thread);
      remaining -= thread.messages.length;
    } else {
      capped.push({
        ...thread,
        messages: thread.messages.slice(0, remaining),
      });
      remaining = 0;
    }
  }
  return capped;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Background historical import:
 * - By count: bounded 1…250 (paginated internally)
 * - Since date: all eligible inbox mail on/after date, processed in PAGE_SIZE batches
 * - Dedupes via (inboxConnectionId, gmailMessageId)
 * - Enqueues native classification + Outlook attachment ingest per batch
 * - Persists resumeCursor between pages for crash/retry resume
 * - Does not advance live syncCursor
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
  const isSinceMode = Boolean(payload.sinceDate);
  const unlimited = isSinceMode || isUnlimitedHistoricalImport(payload.requestedLimit);
  const hardCap = unlimited
    ? null
    : Math.min(Math.max(1, payload.requestedLimit), HISTORICAL_IMPORT_MAX_LIMIT);

  const importRow = await deps.prisma.mailboxHistoricalImport.findUnique({
    where: { id: payload.importId },
  });
  if (!importRow) {
    throw new Error(`Historical import not found: ${payload.importId}`);
  }

  const resuming = Boolean(importRow.resumeCursor);
  let processedProviderMessageIds = asStringArray(
    importRow.processedProviderMessageIds
  );
  let importedCount = resuming ? importRow.importedCount : 0;
  let duplicateCount = resuming ? importRow.duplicateCount : 0;
  let failedCount = resuming ? importRow.failedCount : 0;
  let createdMessageIds: string[] = [];
  let pageCursor: string | null = importRow.resumeCursor ?? null;

  await deps.prisma.mailboxHistoricalImport.update({
    where: { id: payload.importId },
    data: {
      status: "RUNNING",
      startedAt: importRow.startedAt ?? new Date(),
      errorMessage: null,
      ...(resuming
        ? {}
        : {
            processedCount: 0,
            importedCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            businessCount: 0,
            personalCount: 0,
            processedProviderMessageIds: [],
            resumeCursor: null,
          }),
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

    const excludeJunk = connection.excludeJunk !== false;
    const excludeTrash = connection.excludeTrash !== false;
    const listenIncoming = connection.listenIncoming !== false;
    const listenSent = connection.listenSent === true;

    // Page until provider exhausted (since-date) or hardCap reached (by-count).
    while (true) {
      const alreadyProcessed = processedProviderMessageIds.length;
      if (hardCap != null && alreadyProcessed >= hardCap) break;

      const batchSize =
        hardCap == null
          ? HISTORICAL_IMPORT_PAGE_SIZE
          : Math.min(HISTORICAL_IMPORT_PAGE_SIZE, hardCap - alreadyProcessed);
      if (batchSize <= 0) break;

      let mailbox: ProviderMailboxSyncResult;
      try {
        mailbox = await provider.syncMailbox({
          refreshToken: deps.tokenCipher.decrypt(
            connection.encryptedRefreshToken
          ),
          accessToken: connection.encryptedAccessToken
            ? deps.tokenCipher.decrypt(connection.encryptedAccessToken)
            : null,
          accessTokenExpiresAt: connection.accessTokenExpiresAt,
          syncCursor: null,
          maxThreads: batchSize,
          ...(receivedAfter ? { receivedAfter } : {}),
          ...(pageCursor ? { pageCursor } : {}),
        });
      } catch (error) {
        // Persist cursor + counts so BullMQ retry / re-run can continue.
        await deps.prisma.mailboxHistoricalImport.update({
          where: { id: payload.importId },
          data: {
            status: "RUNNING",
            resumeCursor: pageCursor,
            processedCount: processedProviderMessageIds.length,
            importedCount,
            duplicateCount,
            failedCount,
            processedProviderMessageIds,
          },
        });
        throw error;
      }

      const remainingCap =
        hardCap == null ? null : hardCap - processedProviderMessageIds.length;
      const cappedThreads = filterThreadsForImport(mailbox.threads, {
        receivedAfter,
        excludeJunk,
        excludeTrash,
        listenIncoming,
        listenSent,
        remainingCap,
      });

      const batchProviderIds = cappedThreads.flatMap((t) =>
        t.messages.map((m) => m.providerMessageId)
      );

      let batchCreatedIds: string[] = [];
      let batchAttachmentCandidates: Array<{
        emailMessageId: string;
        providerMessageId: string;
      }> = [];

      if (cappedThreads.length > 0) {
        try {
          const result = await importProviderMailbox({
            prisma: deps.prisma,
            workspaceId: payload.workspaceId,
            inboxConnectionId: connection.id,
            mailbox: {
              ...mailbox,
              threads: cappedThreads,
            },
            // Explicit historical import may re-pull mail from before Clear Inbox.
            bypassInboxClearedAt: true,
          });
          importedCount += result.messagesImported;
          duplicateCount += result.duplicatesSkipped;
          batchCreatedIds = result.createdMessageIds ?? [];
          createdMessageIds.push(...batchCreatedIds);
          batchAttachmentCandidates = (
            result.attachmentIngestCandidates ?? []
          ).map((c) => ({
            emailMessageId: c.emailMessageId,
            providerMessageId: c.providerMessageId,
          }));
        } catch (error) {
          failedCount += batchProviderIds.length;
          await deps.prisma.mailboxHistoricalImport.update({
            where: { id: payload.importId },
            data: {
              resumeCursor: pageCursor,
              processedCount: processedProviderMessageIds.length,
              importedCount,
              duplicateCount,
              failedCount,
              processedProviderMessageIds,
            },
          });
          throw error;
        }
      }

      if (
        deps.attachmentIngestQueue &&
        connection.provider === "OUTLOOK" &&
        connection.encryptedRefreshToken &&
        batchAttachmentCandidates.length > 0
      ) {
        const { enqueuedCount } = await enqueueAttachmentIngestFromSync({
          queue: deps.attachmentIngestQueue,
          workspaceId: payload.workspaceId,
          inboxConnectionId: connection.id,
          candidates: batchAttachmentCandidates,
        });
        console.info("attachment-ingest-queued-from-historical-import", {
          importId: payload.importId,
          count: enqueuedCount,
        });
      }

      if (shouldEnqueueNativeClassification(connection)) {
        for (const emailMessageId of batchCreatedIds) {
          try {
            await ensureMailboxClassifyJob({
              queue: deps.classifyQueue,
              workspaceId: payload.workspaceId,
              inboxConnectionId: connection.id,
              emailMessageId,
              ...(payload.initiatedBy
                ? { initiatedBy: payload.initiatedBy }
                : {}),
            });
          } catch (e) {
            failedCount += 1;
            console.warn("historical-classify-queue-failed", {
              emailMessageId,
              error: e instanceof Error ? e.message : "unknown",
            });
          }
        }
      }

      const seen = new Set(processedProviderMessageIds);
      for (const id of batchProviderIds) {
        if (!seen.has(id)) {
          seen.add(id);
          processedProviderMessageIds.push(id);
        }
      }

      pageCursor = mailbox.nextPageCursor ?? null;

      await deps.prisma.mailboxHistoricalImport.update({
        where: { id: payload.importId },
        data: {
          processedCount: processedProviderMessageIds.length,
          importedCount,
          duplicateCount,
          failedCount,
          processedProviderMessageIds,
          resumeCursor: pageCursor,
        },
      });

      // Empty page with no continuation → done.
      if (!pageCursor) break;
      // Provider returned a full page but no new eligible messages — still advance via cursor.
      if (batchProviderIds.length === 0 && mailbox.threads.length === 0) break;
    }

    // By-count only: brief wait so the card shows classify progress.
    // Since-date / unlimited imports can be large — do not block COMPLETED on classify.
    if (
      !unlimited &&
      shouldEnqueueNativeClassification(connection) &&
      createdMessageIds.length > 0
    ) {
      const deadline = Date.now() + CLASSIFY_WAIT_MS;
      const baselineDone = Math.max(
        0,
        processedProviderMessageIds.length - createdMessageIds.length
      );
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
          processedProviderMessageIds
        );
        const processedCount = Math.min(hardCap ?? 0, baselineDone + classified);
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

    const { businessCount, personalCount } = await recountCategoryCounts(
      deps.prisma,
      payload.workspaceId,
      connection.id,
      processedProviderMessageIds
    );

    const processedCount = processedProviderMessageIds.length;

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
        processedProviderMessageIds,
        resumeCursor: null,
        completedAt: new Date(),
      },
    });

    await deps.prisma.inboxConnection.update({
      where: { id: connection.id },
      data: { lastProcessedAt: new Date() },
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
    const permanent =
      /not found|no refresh token|Invalid sinceDate/i.test(message) &&
      !pageCursor &&
      processedProviderMessageIds.length === 0;

    // Persist progress + resumeCursor. Keep RUNNING so BullMQ can retry mid-import;
    // the worker `failed` handler marks FAILED when attempts are exhausted.
    await deps.prisma.mailboxHistoricalImport.update({
      where: { id: payload.importId },
      data: {
        status: permanent ? "FAILED" : "RUNNING",
        ...(permanent
          ? {
              errorMessage: message.slice(0, 2000),
              completedAt: new Date(),
              resumeCursor: null,
            }
          : {
              errorMessage: null,
              resumeCursor: pageCursor,
            }),
        processedCount: processedProviderMessageIds.length,
        importedCount,
        duplicateCount,
        failedCount,
        processedProviderMessageIds,
      },
    });
    throw error instanceof Error ? error : new Error(message);
  }
}
