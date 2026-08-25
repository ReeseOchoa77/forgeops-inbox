import type { PrismaClient } from "@prisma/client";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  providerKindFromEnum,
  shouldEnqueueNativeClassification,
  buildMailboxClassifyJobId,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
  type MailboxHistoricalImportJobPayload,
  type MailboxHistoricalImportJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

import { importProviderMailbox } from "../services/import-provider-mailbox.js";

/**
 * Background historical import:
 * - Does NOT require nativeListeningEnabled (manual admin action)
 * - Respects requestedLimit (paginated provider fetch up to hard max)
 * - Dedupes via existing (inboxConnectionId, gmailMessageId) uniqueness
 * - Enqueues native analysis only when processing mode is NATIVE
 * - Does not advance the live syncCursor (avoids coupling to listener cursor)
 */
export async function processMailboxHistoricalImport(
  payload: MailboxHistoricalImportJobPayload,
  deps: {
    prisma: PrismaClient;
    providerRegistry: ProviderRegistry;
    tokenCipher: TokenCipher;
    analysisQueue: Queue<InboxAnalysisJobPayload, InboxAnalysisResult>;
    classifyQueue: Queue<MailboxClassifyJobPayload, MailboxClassifyJobResult>;
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

    let importedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    let createdMessageIds: string[] = [];

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
    } catch (error) {
      failedCount = providerMessageIds.length;
      throw error;
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
    }

    // Category counts from whatever is already classified (n8n or prior native).
    // Classification jobs run async — counts here reflect pre-existing categories only.
    let businessCount = 0;
    let personalCount = 0;
    for (const row of existingAfter) {
      if (row.mailboxCategory === "BUSINESS") businessCount += 1;
      else if (row.mailboxCategory === "PERSONAL") personalCount += 1;
    }

    const processedCount = providerMessageIds.length;

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
