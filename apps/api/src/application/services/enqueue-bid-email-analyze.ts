import type { PrismaClient, Prisma } from "@prisma/client";
import {
  QueueNames,
  buildBidEmailAnalyzeJobId,
  emptyBidEmailAnalyzeProgress,
  DEFAULT_BIDDING_FOLDER_SCAN_RANGE,
  isBiddingFolderScanRangePreset,
  resolveBiddingFolderScanSinceAt,
  type BidEmailAnalyzeJobPayload,
  type BidEmailAnalyzeJobResult,
  type BidEmailAnalyzeOperation,
  type BiddingFolderScanRangePreset,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export class BidEmailAnalyzeError extends Error {
  readonly code:
    | "CONNECTION_NOT_FOUND"
    | "NOT_OUTLOOK"
    | "NOT_AUTHORIZED"
    | "ALREADY_RUNNING"
    | "INVALID_RANGE"
    | "NO_DISCOVERY"
    | "ENQUEUE_FAILED";

  constructor(code: BidEmailAnalyzeError["code"], message: string) {
    super(message);
    this.name = "BidEmailAnalyzeError";
    this.code = code;
  }
}

/**
 * Create BidAnalysisRun and enqueue Bid Invites/Quotes discovery or analysis.
 * Never creates Jobs — staging only. Scan date range constrains Graph queries.
 */
export async function enqueueBidEmailAnalyze(input: {
  prisma: PrismaClient;
  queue: Queue<BidEmailAnalyzeJobPayload, BidEmailAnalyzeJobResult>;
  workspaceId: string;
  connectionId: string;
  initiatedByUserId?: string;
  operation?: BidEmailAnalyzeOperation;
  scanRangePreset?: string;
  customSinceAt?: string | null;
}): Promise<{
  runId: string;
  operation: BidEmailAnalyzeOperation;
  scanRangePreset: string;
  scanSinceAt: string | null;
}> {
  const operation: BidEmailAnalyzeOperation =
    input.operation === "analyze" ? "analyze" : "scan";
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
  if (operation === "scan" && !connection.encryptedRefreshToken) {
    throw new BidEmailAnalyzeError(
      "NOT_AUTHORIZED",
      "Mailbox is not authorized — reconnect OAuth before scanning bidding folders"
    );
  }

  if (operation === "analyze") {
    const discoveryCount = await input.prisma.bidFolderDiscoveryEmail.count({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: connection.id,
      },
    });
    if (discoveryCount === 0) {
      throw new BidEmailAnalyzeError(
        "NO_DISCOVERY",
        "No discovered Bid Invite / Quote emails yet — run Scan Bidding Folders first"
      );
    }
  }

  const presetRaw = input.scanRangePreset ?? DEFAULT_BIDDING_FOLDER_SCAN_RANGE;
  if (!isBiddingFolderScanRangePreset(presetRaw)) {
    throw new BidEmailAnalyzeError("INVALID_RANGE", `Invalid scan range: ${presetRaw}`);
  }
  const preset: BiddingFolderScanRangePreset = presetRaw;

  let scanSinceAt: Date | null;
  try {
    scanSinceAt = resolveBiddingFolderScanSinceAt({
      preset,
      ...(input.customSinceAt !== undefined
        ? { customSinceAt: input.customSinceAt }
        : {}),
    });
  } catch (e) {
    throw new BidEmailAnalyzeError(
      "INVALID_RANGE",
      e instanceof Error ? e.message : "Invalid scan range"
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
  progress.scanRangePreset = preset;
  progress.scanSinceAt = scanSinceAt?.toISOString() ?? null;
  progress.operation = operation;

  const run = await input.prisma.bidAnalysisRun.create({
    data: {
      workspaceId: input.workspaceId,
      inboxConnectionId: connection.id,
      status: "PENDING",
      scanRangePreset: preset,
      scanSinceAt,
      progress: progress as unknown as Prisma.InputJsonValue,
      initiatedByUserId: input.initiatedByUserId ?? null,
    },
  });

  const payload: BidEmailAnalyzeJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: connection.id,
    runId: run.id,
    operation,
    scanRangePreset: preset,
    scanSinceAt: scanSinceAt?.toISOString() ?? null,
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

  return {
    runId: run.id,
    operation,
    scanRangePreset: preset,
    scanSinceAt: scanSinceAt?.toISOString() ?? null,
  };
}
