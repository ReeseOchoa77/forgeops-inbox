import type { PrismaClient } from "@prisma/client";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  QueueNames,
  buildMailboxClassifyJobId,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

/** Conservative cap for requeue-unclassified recovery action. */
export const REQUEUE_UNCLASSIFIED_MAX_LIMIT = HISTORICAL_IMPORT_MAX_LIMIT;

export type RequeueUnclassifiedErrorCode =
  | "CONNECTION_NOT_FOUND"
  | "NOT_NATIVE";

export class RequeueUnclassifiedError extends Error {
  readonly code: RequeueUnclassifiedErrorCode;

  constructor(code: RequeueUnclassifiedErrorCode, message: string) {
    super(message);
    this.name = "RequeueUnclassifiedError";
    this.code = code;
  }
}

export type RequeueUnclassifiedResult = {
  eligibleCount: number;
  enqueuedCount: number;
  skippedCount: number;
};

export type ClassifyQueueLike = Pick<
  Queue<MailboxClassifyJobPayload, MailboxClassifyJobResult>,
  "add" | "getJob"
>;

type JobLike = {
  getState: () => Promise<string>;
  remove: () => Promise<void>;
};

/**
 * Messages eligible for native classify recovery:
 * - belong to workspace + connection
 * - have zero Classification rows (manual/n8n/native rows all block requeue)
 *
 * Ordering: newest first so recovery prioritizes recent mail.
 */
export async function findUnclassifiedNativeMessageIds(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  limit: number;
}): Promise<string[]> {
  const rows = await input.prisma.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      classifications: { none: {} },
    },
    select: { id: true },
    orderBy: [{ receivedAt: "desc" }, { sentAt: "desc" }, { id: "desc" }],
    take: input.limit,
  });
  return rows.map((r) => r.id);
}

/**
 * Ensure a mailbox-classify job can be added for this message id.
 *
 * BullMQ custom jobIds are unique while the job record exists. With
 * removeOnFail/removeOnComplete counts, failed/completed jobs often remain
 * and block re-add. Minimal safe strategy:
 * - waiting/active/delayed/paused → skip (already queued / in flight)
 * - completed/failed/unknown terminal → remove then re-add
 * - missing → add
 */
export async function ensureMailboxClassifyJob(input: {
  queue: ClassifyQueueLike;
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  initiatedBy?: string;
}): Promise<"enqueued" | "skipped_inflight"> {
  const jobId = buildMailboxClassifyJobId(input.emailMessageId);
  const existing = (await input.queue.getJob(jobId)) as JobLike | null | undefined;

  if (existing) {
    const state = await existing.getState();
    if (
      state === "waiting" ||
      state === "active" ||
      state === "delayed" ||
      state === "paused" ||
      state === "waiting-children"
    ) {
      return "skipped_inflight";
    }
    try {
      await existing.remove();
    } catch {
      // Race: another worker may have removed it; continue to add.
    }
  }

  const payload: MailboxClassifyJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    emailMessageId: input.emailMessageId,
    ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
  };

  await input.queue.add(QueueNames.MAILBOX_CLASSIFY, payload, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  });

  return "enqueued";
}

export async function countUnclassifiedNativeMessages(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
}): Promise<number> {
  await assertNativeConnection(input.prisma, input.workspaceId, input.inboxConnectionId);
  return input.prisma.emailMessage.count({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      classifications: { none: {} },
    },
  });
}

export async function requeueUnclassifiedNativeMessages(input: {
  prisma: PrismaClient;
  queue: ClassifyQueueLike;
  workspaceId: string;
  inboxConnectionId: string;
  limit?: number;
  initiatedBy?: string;
}): Promise<RequeueUnclassifiedResult> {
  await assertNativeConnection(
    input.prisma,
    input.workspaceId,
    input.inboxConnectionId
  );

  const limit = Math.min(
    Math.max(1, input.limit ?? REQUEUE_UNCLASSIFIED_MAX_LIMIT),
    REQUEUE_UNCLASSIFIED_MAX_LIMIT
  );

  const messageIds = await findUnclassifiedNativeMessageIds({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    limit,
  });

  let enqueuedCount = 0;
  let skippedCount = 0;

  for (const emailMessageId of messageIds) {
    const outcome = await ensureMailboxClassifyJob({
      queue: input.queue,
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      emailMessageId,
      ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
    });
    if (outcome === "enqueued") enqueuedCount += 1;
    else skippedCount += 1;
  }

  return {
    eligibleCount: messageIds.length,
    enqueuedCount,
    skippedCount,
  };
}

async function assertNativeConnection(
  prisma: PrismaClient,
  workspaceId: string,
  inboxConnectionId: string
): Promise<void> {
  const connection = await prisma.inboxConnection.findFirst({
    where: { id: inboxConnectionId, workspaceId },
    select: { id: true, ingestionSource: true },
  });
  if (!connection) {
    throw new RequeueUnclassifiedError(
      "CONNECTION_NOT_FOUND",
      "Mailbox not found"
    );
  }
  if (connection.ingestionSource !== "NATIVE") {
    throw new RequeueUnclassifiedError(
      "NOT_NATIVE",
      "Requeue unclassified is only available for NATIVE mailboxes"
    );
  }
}
