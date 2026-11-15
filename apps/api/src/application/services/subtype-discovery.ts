import type { Prisma, PrismaClient } from "@prisma/client";
import {
  QueueNames,
  buildSubtypeDiscoveryJobId,
  emptySubtypeDiscoveryProgress,
  resolveRequestedSampleSize,
  subtypeDiscoveryAlgorithmVersions,
  validateDiscoveryConfig,
  type SubtypeDiscoveryConfig,
  type SubtypeDiscoveryJobPayload,
  type SubtypeDiscoveryJobResult,
  type SubtypeDiscoveryProgress,
  type SubtypeDiscoveryRecommendation,
  type SubtypeDiscoverySummary,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export class SubtypeDiscoveryError extends Error {
  readonly code:
    | "ALREADY_RUNNING"
    | "INVALID_CONFIG"
    | "NOT_FOUND"
    | "ENQUEUE_FAILED"
    | "NOT_CANCELLABLE";

  constructor(code: SubtypeDiscoveryError["code"], message: string) {
    super(message);
    this.name = "SubtypeDiscoveryError";
    this.code = code;
  }
}

export async function previewSubtypeDiscoveryDataset(input: {
  prisma: PrismaClient;
  workspaceId: string;
  config: Partial<SubtypeDiscoveryConfig>;
}): Promise<{
  eligibleCount: number;
  requestedCount: number | null;
  willSample: number;
  capped: boolean;
  config: SubtypeDiscoveryConfig;
}> {
  const validated = validateDiscoveryConfig(input.config);
  if (!validated.ok) {
    throw new SubtypeDiscoveryError("INVALID_CONFIG", validated.error);
  }
  const config = validated.config;
  const where = buildWhere(input.workspaceId, config);
  const eligibleCount = await input.prisma.emailMessage.count({ where });
  const { requested } = resolveRequestedSampleSize(config, eligibleCount);
  const willSample =
    requested == null ? eligibleCount : Math.min(requested, eligibleCount);
  return {
    eligibleCount,
    requestedCount: requested,
    willSample,
    capped: requested != null && requested > eligibleCount,
    config,
  };
}

export async function enqueueSubtypeDiscoveryRun(input: {
  prisma: PrismaClient;
  queue: Queue<SubtypeDiscoveryJobPayload, SubtypeDiscoveryJobResult>;
  workspaceId: string;
  initiatedByUserId?: string;
  config: Partial<SubtypeDiscoveryConfig>;
}): Promise<{ runId: string; jobId: string; config: SubtypeDiscoveryConfig }> {
  const validated = validateDiscoveryConfig(input.config);
  if (!validated.ok) {
    throw new SubtypeDiscoveryError("INVALID_CONFIG", validated.error);
  }
  const config = validated.config;

  const active = await input.prisma.subtypeDiscoveryRun.findFirst({
    where: {
      workspaceId: input.workspaceId,
      status: { in: ["PENDING", "RUNNING", "CANCELLING"] },
    },
    select: { id: true },
  });
  if (active) {
    throw new SubtypeDiscoveryError(
      "ALREADY_RUNNING",
      `A discovery run is already in progress (${active.id}). Cancel it or wait for completion.`
    );
  }

  const versions = subtypeDiscoveryAlgorithmVersions();
  const run = await input.prisma.subtypeDiscoveryRun.create({
    data: {
      workspaceId: input.workspaceId,
      status: "PENDING",
      config: config as unknown as Prisma.InputJsonValue,
      sampledEmailIds: [],
      progress: emptySubtypeDiscoveryProgress() as unknown as Prisma.InputJsonValue,
      algorithmVersions: versions as unknown as Prisma.InputJsonValue,
      initiatedByUserId: input.initiatedByUserId ?? null,
    },
  });

  const jobId = buildSubtypeDiscoveryJobId(run.id);
  const payload: SubtypeDiscoveryJobPayload = {
    workspaceId: input.workspaceId,
    runId: run.id,
    ...(input.initiatedByUserId ? { initiatedBy: input.initiatedByUserId } : {}),
  };

  try {
    await input.queue.add(QueueNames.SUBTYPE_DISCOVERY, payload, {
      jobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    });
  } catch (e) {
    await input.prisma.subtypeDiscoveryRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage:
          e instanceof Error
            ? e.message.slice(0, 480)
            : "Failed to enqueue discovery job",
        completedAt: new Date(),
      },
    });
    throw new SubtypeDiscoveryError(
      "ENQUEUE_FAILED",
      e instanceof Error ? e.message : "Failed to enqueue discovery job"
    );
  }

  return { runId: run.id, jobId, config };
}

export async function listSubtypeDiscoveryRuns(input: {
  prisma: PrismaClient;
  workspaceId: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    summary: SubtypeDiscoverySummary | null;
    config: SubtypeDiscoveryConfig;
  }>
> {
  const rows = await input.prisma.subtypeDiscoveryRun.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: { createdAt: "desc" },
    take: Math.min(input.limit ?? 20, 50),
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true,
      summary: true,
      config: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    summary: (r.summary as SubtypeDiscoverySummary | null) ?? null,
    config: r.config as unknown as SubtypeDiscoveryConfig,
  }));
}

export async function getSubtypeDiscoveryRun(input: {
  prisma: PrismaClient;
  workspaceId: string;
  runId: string;
}): Promise<{
  id: string;
  status: string;
  config: SubtypeDiscoveryConfig;
  progress: SubtypeDiscoveryProgress;
  summary: SubtypeDiscoverySummary | null;
  recommendations: SubtypeDiscoveryRecommendation[];
  algorithmVersions: Record<string, string>;
  sampledEmailCount: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
} | null> {
  const row = await input.prisma.subtypeDiscoveryRun.findFirst({
    where: { id: input.runId, workspaceId: input.workspaceId },
  });
  if (!row) return null;
  const sampled = Array.isArray(row.sampledEmailIds)
    ? (row.sampledEmailIds as string[])
    : [];
  return {
    id: row.id,
    status: row.status,
    config: row.config as unknown as SubtypeDiscoveryConfig,
    progress: {
      ...emptySubtypeDiscoveryProgress(),
      ...(row.progress as object),
    } as SubtypeDiscoveryProgress,
    summary: (row.summary as SubtypeDiscoverySummary | null) ?? null,
    recommendations: Array.isArray(row.recommendations)
      ? (row.recommendations as SubtypeDiscoveryRecommendation[])
      : [],
    algorithmVersions: (row.algorithmVersions as Record<string, string>) ?? {},
    sampledEmailCount: sampled.length,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function requestCancelSubtypeDiscoveryRun(input: {
  prisma: PrismaClient;
  workspaceId: string;
  runId: string;
}): Promise<{ status: string }> {
  const row = await input.prisma.subtypeDiscoveryRun.findFirst({
    where: { id: input.runId, workspaceId: input.workspaceId },
    select: { id: true, status: true },
  });
  if (!row) {
    throw new SubtypeDiscoveryError("NOT_FOUND", "Discovery run not found");
  }
  if (row.status === "COMPLETED" || row.status === "FAILED" || row.status === "CANCELLED") {
    throw new SubtypeDiscoveryError(
      "NOT_CANCELLABLE",
      `Run is already ${row.status}`
    );
  }
  if (row.status === "PENDING") {
    await input.prisma.subtypeDiscoveryRun.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        progress: {
          ...emptySubtypeDiscoveryProgress(),
          phase: "CANCELLED",
          message: "Cancelled before start",
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return { status: "CANCELLED" };
  }
  await input.prisma.subtypeDiscoveryRun.update({
    where: { id: row.id },
    data: { status: "CANCELLING" },
  });
  return { status: "CANCELLING" };
}

function buildWhere(
  workspaceId: string,
  config: SubtypeDiscoveryConfig
): Prisma.EmailMessageWhereInput {
  const where: Prisma.EmailMessageWhereInput = { workspaceId };
  if (config.mailboxCategory === "BUSINESS") {
    where.mailboxCategory = "BUSINESS";
  } else if (config.mailboxCategory === "PERSONAL") {
    where.mailboxCategory = "PERSONAL";
  }
  if (config.inboxConnectionId) {
    where.inboxConnectionId = config.inboxConnectionId;
  }
  if (config.receivedAfter || config.receivedBefore) {
    where.receivedAt = {};
    if (config.receivedAfter) where.receivedAt.gte = new Date(config.receivedAfter);
    if (config.receivedBefore) where.receivedAt.lte = new Date(config.receivedBefore);
  }
  return where;
}
