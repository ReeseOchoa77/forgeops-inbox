import type { PrismaClient } from "@prisma/client";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  ensureMailboxClassifyJob,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

/** Re-export shared enqueue helper for callers/tests. */
export { ensureMailboxClassifyJob };

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
    if (outcome === "enqueued") {
      enqueuedCount += 1;
      await input.prisma.emailMessage
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
    } else {
      skippedCount += 1;
    }
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
