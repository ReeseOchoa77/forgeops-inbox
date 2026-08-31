import type { PrismaClient } from "@prisma/client";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  ensureMailboxClassifyJob,
  truncateClassificationError,
  type RetryClassificationOutcome,
} from "@forgeops/shared";
import type { ClassifyQueueLike } from "./requeue-unclassified-native.js";

export const RETRY_CLASSIFICATION_MAX_LIMIT = HISTORICAL_IMPORT_MAX_LIMIT;
export const RETRY_CLASSIFICATION_CONCURRENCY = 5;
export const RETRY_CLASSIFICATION_PAGE_SIZE = 50;

export type RetryClassificationErrorCode =
  | "MESSAGE_NOT_FOUND"
  | "CROSS_WORKSPACE"
  | "CONNECTION_NOT_FOUND"
  | "NOT_NATIVE"
  | "INVALID_REQUEST";

export class RetryClassificationError extends Error {
  readonly code: RetryClassificationErrorCode;

  constructor(code: RetryClassificationErrorCode, message: string) {
    super(message);
    this.name = "RetryClassificationError";
    this.code = code;
  }
}

export type RetryClassificationCounts = {
  totalFound: number;
  queued: number;
  alreadyProcessing: number;
  alreadyClassified: number;
  failed: number;
};

async function markQueued(
  prisma: PrismaClient,
  messageId: string
): Promise<void> {
  await prisma.emailMessage.update({
    where: { id: messageId },
    data: {
      classificationStatus: "PENDING",
      classificationLastAttemptAt: new Date(),
      classificationAttemptCount: { increment: 1 },
      classificationError: null,
    },
  });
}

/**
 * Enqueue canonical mailbox-classify for one message. Never writes Classification rows.
 */
export async function retryClassificationForMessage(input: {
  prisma: PrismaClient;
  queue: ClassifyQueueLike;
  workspaceId: string;
  emailMessageId: string;
  initiatedBy?: string;
  /** When set, message must belong to this mailbox. */
  inboxConnectionId?: string;
}): Promise<RetryClassificationOutcome> {
  const message = await input.prisma.emailMessage.findFirst({
    where: {
      id: input.emailMessageId,
      workspaceId: input.workspaceId,
      ...(input.inboxConnectionId
        ? { inboxConnectionId: input.inboxConnectionId }
        : {}),
    },
    select: {
      id: true,
      workspaceId: true,
      inboxConnectionId: true,
      inboxConnection: { select: { ingestionSource: true } },
      classifications: { select: { id: true }, take: 1 },
    },
  });

  if (!message) {
    // Distinguish missing vs wrong workspace when id exists elsewhere
    const any = await input.prisma.emailMessage.findFirst({
      where: { id: input.emailMessageId },
      select: { workspaceId: true },
    });
    if (any && any.workspaceId !== input.workspaceId) {
      throw new RetryClassificationError(
        "CROSS_WORKSPACE",
        "Message does not belong to this workspace"
      );
    }
    throw new RetryClassificationError("MESSAGE_NOT_FOUND", "Message not found");
  }

  if (message.classifications.length > 0) {
    return "already_classified";
  }

  if (message.inboxConnection.ingestionSource !== "NATIVE") {
    throw new RetryClassificationError(
      "NOT_NATIVE",
      "Retry classification is only available for NATIVE mailboxes"
    );
  }

  try {
    const outcome = await ensureMailboxClassifyJob({
      queue: input.queue,
      workspaceId: input.workspaceId,
      inboxConnectionId: message.inboxConnectionId,
      emailMessageId: message.id,
      ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
    });
    if (outcome === "skipped_inflight") {
      return "already_processing";
    }
    await markQueued(input.prisma, message.id);
    return "queued";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await input.prisma.emailMessage
      .update({
        where: { id: message.id },
        data: {
          classificationStatus: "FAILED",
          classificationLastAttemptAt: new Date(),
          classificationError: truncateClassificationError(
            `enqueue failed: ${msg}`
          ),
        },
      })
      .catch(() => {});
    return "failed_to_enqueue";
  }
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (idx < items.length) {
        const current = idx;
        idx += 1;
        await fn(items[current]!);
      }
    }
  );
  await Promise.all(workers);
}

function tally(
  counts: RetryClassificationCounts,
  outcome: RetryClassificationOutcome
): void {
  if (outcome === "queued") counts.queued += 1;
  else if (outcome === "already_processing") counts.alreadyProcessing += 1;
  else if (outcome === "already_classified") counts.alreadyClassified += 1;
  else counts.failed += 1;
}

/**
 * Bulk retry: selected ids and/or all unclassified in mailbox/workspace scope.
 * Enqueues only — does not wait for classification to finish.
 */
export async function retryClassificationBulk(input: {
  prisma: PrismaClient;
  queue: ClassifyQueueLike;
  workspaceId: string;
  /** Real connection id, or omit / null for workspace-wide when allUnclassified. */
  inboxConnectionId?: string | null;
  messageIds?: string[];
  allUnclassified?: boolean;
  limit?: number;
  initiatedBy?: string;
}): Promise<RetryClassificationCounts> {
  const hasIds = (input.messageIds?.length ?? 0) > 0;
  const all = input.allUnclassified === true;
  if (!hasIds && !all) {
    throw new RetryClassificationError(
      "INVALID_REQUEST",
      "Provide messageIds and/or allUnclassified"
    );
  }

  const limit = Math.min(
    Math.max(1, input.limit ?? RETRY_CLASSIFICATION_MAX_LIMIT),
    RETRY_CLASSIFICATION_MAX_LIMIT
  );

  const counts: RetryClassificationCounts = {
    totalFound: 0,
    queued: 0,
    alreadyProcessing: 0,
    alreadyClassified: 0,
    failed: 0,
  };

  const connectionFilter =
    input.inboxConnectionId && input.inboxConnectionId !== "__all__"
      ? input.inboxConnectionId
      : undefined;

  if (connectionFilter) {
    const conn = await input.prisma.inboxConnection.findFirst({
      where: { id: connectionFilter, workspaceId: input.workspaceId },
      select: { id: true, ingestionSource: true },
    });
    if (!conn) {
      throw new RetryClassificationError(
        "CONNECTION_NOT_FOUND",
        "Mailbox not found"
      );
    }
    if (conn.ingestionSource !== "NATIVE") {
      throw new RetryClassificationError(
        "NOT_NATIVE",
        "Retry classification is only available for NATIVE mailboxes"
      );
    }
  }

  if (hasIds) {
    const ids = [...new Set(input.messageIds!)].slice(0, limit);
    counts.totalFound += ids.length;
    await runBounded(ids, RETRY_CLASSIFICATION_CONCURRENCY, async (id) => {
      const outcome = await retryClassificationForMessage({
        prisma: input.prisma,
        queue: input.queue,
        workspaceId: input.workspaceId,
        emailMessageId: id,
        ...(connectionFilter ? { inboxConnectionId: connectionFilter } : {}),
        ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
      });
      tally(counts, outcome);
    });
  }

  if (all) {
    const seen = new Set(input.messageIds ?? []);
    let skip = 0;
    let remaining = limit;

    while (remaining > 0) {
      const take = Math.min(RETRY_CLASSIFICATION_PAGE_SIZE, remaining);
      const rows = await input.prisma.emailMessage.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(connectionFilter
            ? { inboxConnectionId: connectionFilter }
            : { inboxConnection: { ingestionSource: "NATIVE" } }),
          classifications: { none: {} },
          ...(seen.size > 0 ? { id: { notIn: [...seen] } } : {}),
        },
        select: { id: true },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        skip,
        take,
      });
      if (rows.length === 0) break;
      counts.totalFound += rows.length;

      await runBounded(
        rows.map((r) => r.id),
        RETRY_CLASSIFICATION_CONCURRENCY,
        async (id) => {
          try {
            const outcome = await retryClassificationForMessage({
              prisma: input.prisma,
              queue: input.queue,
              workspaceId: input.workspaceId,
              emailMessageId: id,
              ...(connectionFilter
                ? { inboxConnectionId: connectionFilter }
                : {}),
              ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
            });
            tally(counts, outcome);
          } catch {
            counts.failed += 1;
          }
        }
      );

      skip += rows.length;
      remaining -= rows.length;
      if (rows.length < take) break;
    }
  }

  return counts;
}
