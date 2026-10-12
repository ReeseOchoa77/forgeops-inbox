import type { PrismaClient, Prisma } from "@prisma/client";
import {
  QueueNames,
  buildBidEmailAnalyzeJobId,
  emptyBidEmailAnalyzeProgress,
  type BidEmailAnalyzeJobPayload,
  type BidEmailAnalyzeJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export class BidEmailAnalyzeError extends Error {
  readonly code:
    | "CONNECTION_NOT_FOUND"
    | "NOT_OUTLOOK"
    | "NOT_AUTHORIZED"
    | "ALREADY_RUNNING"
    | "ENQUEUE_FAILED";

  constructor(code: BidEmailAnalyzeError["code"], message: string) {
    super(message);
    this.name = "BidEmailAnalyzeError";
    this.code = code;
  }
}

/**
 * Create BidAnalysisRun and enqueue Bid Invites/Quotes analysis.
 * Never creates Jobs — staging only.
 */
export async function enqueueBidEmailAnalyze(input: {
  prisma: PrismaClient;
  queue: Queue<BidEmailAnalyzeJobPayload, BidEmailAnalyzeJobResult>;
  workspaceId: string;
  connectionId: string;
  initiatedByUserId?: string;
}): Promise<{ runId: string }> {
  const connection = await input.prisma.inboxConnection.findFirst({
    where: {
      id: input.connectionId,
      workspaceId: input.workspaceId,
      status: { not: "DISCONNECTED" },
    },
    select: {
      id: true,
      provider: true,
      encryptedRefreshToken: true,
    },
  });

  if (!connection) {
    throw new BidEmailAnalyzeError(
      "CONNECTION_NOT_FOUND",
      "Mailbox connection not found in this workspace"
    );
  }
  if (connection.provider !== "OUTLOOK") {
    throw new BidEmailAnalyzeError(
      "NOT_OUTLOOK",
      "Bid analysis currently supports Outlook only"
    );
  }
  if (!connection.encryptedRefreshToken) {
    throw new BidEmailAnalyzeError(
      "NOT_AUTHORIZED",
      "Mailbox is not authorized — reconnect OAuth before analyzing bidding folders"
    );
  }

  const running = await input.prisma.bidAnalysisRun.findFirst({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: connection.id,
      status: { in: ["PENDING", "RUNNING"] },
    },
    select: { id: true },
  });
  if (running) {
    throw new BidEmailAnalyzeError(
      "ALREADY_RUNNING",
      "A Bid Analysis run is already in progress for this mailbox"
    );
  }

  const progress = emptyBidEmailAnalyzeProgress();
  const run = await input.prisma.bidAnalysisRun.create({
    data: {
      workspaceId: input.workspaceId,
      inboxConnectionId: connection.id,
      status: "PENDING",
      progress: progress as unknown as Prisma.InputJsonValue,
      initiatedByUserId: input.initiatedByUserId ?? null,
    },
  });

  const payload: BidEmailAnalyzeJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: connection.id,
    runId: run.id,
    ...(input.initiatedByUserId ? { initiatedBy: input.initiatedByUserId } : {}),
  };

  try {
    await input.queue.add(QueueNames.BID_EMAIL_ANALYZE, payload, {
      jobId: buildBidEmailAnalyzeJobId(run.id),
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 40 },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await input.prisma.bidAnalysisRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorMessage: `enqueue failed: ${msg}`.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch(() => {});
    throw new BidEmailAnalyzeError(
      "ENQUEUE_FAILED",
      `Failed to enqueue bid analysis: ${msg}`
    );
  }

  return { runId: run.id };
}
