import type { PrismaClient } from "@prisma/client";
import {
  MAILBOX_RECLASSIFY_ENQUEUE_BATCH,
  buildMailboxReclassifyWhere,
  ensureMailboxClassifyJob,
  type ClassifyQueueLike,
  type MailboxReclassifyFilters,
  type MailboxReclassifyJobPayload,
  type MailboxReclassifyJobResult,
} from "@forgeops/shared";

/**
 * Orchestrator: page matching EmailMessages and enqueue canonical mailbox-classify
 * with forceReclassify + reclassifyRunId. Respects CANCELLING between batches.
 */
export async function processMailboxReclassifyRun(
  payload: MailboxReclassifyJobPayload,
  deps: {
    prisma: PrismaClient;
    classifyQueue: ClassifyQueueLike;
  }
): Promise<MailboxReclassifyJobResult> {
  const run = await deps.prisma.mailboxReclassifyRun.findFirst({
    where: {
      id: payload.runId,
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
    },
  });

  if (!run) {
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: payload.runId,
      status: "failed",
      queued: 0,
      skipped: 0,
      errorMessage: "Run not found",
    };
  }

  if (run.status === "CANCELLED" || run.status === "CANCELLING") {
    await deps.prisma.mailboxReclassifyRun.update({
      where: { id: run.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "cancelled",
      queued: run.queued,
      skipped: run.skipped,
    };
  }

  const conn = await deps.prisma.inboxConnection.findFirst({
    where: {
      id: payload.inboxConnectionId,
      workspaceId: payload.workspaceId,
    },
    select: { email: true, ingestionSource: true },
  });
  if (!conn || conn.ingestionSource !== "NATIVE") {
    await deps.prisma.mailboxReclassifyRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: "Mailbox is not NATIVE",
        completedAt: new Date(),
      },
    });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "failed",
      queued: 0,
      skipped: 0,
      errorMessage: "Mailbox is not NATIVE",
    };
  }

  await deps.prisma.mailboxReclassifyRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
  });

  const filters = (run.filtersSnapshot ?? {}) as MailboxReclassifyFilters;
  const selectedRaw = run.selectedMessageIds;
  const selectedIds = Array.isArray(selectedRaw)
    ? selectedRaw.filter((id): id is string => typeof id === "string")
    : undefined;
  const taskMode =
    run.taskMode === "REGENERATE" ? "REGENERATE" : "REMOVE_ONLY";

  const where = buildMailboxReclassifyWhere({
    workspaceId: payload.workspaceId,
    inboxConnectionId: payload.inboxConnectionId,
    mailboxEmail: conn.email,
    filters,
    ...(selectedIds && selectedIds.length > 0
      ? { messageIds: selectedIds }
      : {}),
  });

  let queued = 0;
  let skipped = 0;
  let cursor: string | undefined;
  let cancelled = false;

  for (;;) {
    const fresh = await deps.prisma.mailboxReclassifyRun.findFirst({
      where: { id: run.id },
      select: { status: true },
    });
    if (
      !fresh ||
      fresh.status === "CANCELLING" ||
      fresh.status === "CANCELLED"
    ) {
      cancelled = true;
      break;
    }

    const page = await deps.prisma.emailMessage.findMany({
      where,
      orderBy: [{ id: "asc" }],
      take: MAILBOX_RECLASSIFY_ENQUEUE_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true },
    });
    if (page.length === 0) break;

    for (const row of page) {
      const statusNow = await deps.prisma.mailboxReclassifyRun.findFirst({
        where: { id: run.id },
        select: { status: true },
      });
      if (
        !statusNow ||
        statusNow.status === "CANCELLING" ||
        statusNow.status === "CANCELLED"
      ) {
        cancelled = true;
        break;
      }

      try {
        const outcome = await ensureMailboxClassifyJob({
          queue: deps.classifyQueue,
          workspaceId: payload.workspaceId,
          inboxConnectionId: payload.inboxConnectionId,
          emailMessageId: row.id,
          forceReclassify: true,
          reclassifyRunId: run.id,
          taskMode,
          ...(payload.initiatedBy
            ? { initiatedBy: payload.initiatedBy }
            : {}),
        });
        if (outcome === "enqueued") {
          queued += 1;
          await deps.prisma.emailMessage
            .update({
              where: { id: row.id },
              data: {
                classificationStatus: "PENDING",
                classificationLastAttemptAt: new Date(),
                classificationAttemptCount: { increment: 1 },
                classificationError: null,
              },
            })
            .catch(() => {});
        } else {
          skipped += 1;
        }
      } catch (e) {
        skipped += 1;
        console.warn("mailbox-reclassify-enqueue-failed", {
          runId: run.id,
          emailMessageId: row.id,
          error: e instanceof Error ? e.message : "unknown",
        });
      }
    }

    await deps.prisma.mailboxReclassifyRun.update({
      where: { id: run.id },
      data: { queued, skipped },
    });

    if (cancelled) break;
    cursor = page[page.length - 1]!.id;
    if (page.length < MAILBOX_RECLASSIFY_ENQUEUE_BATCH) break;
  }

  if (cancelled) {
    await deps.prisma.mailboxReclassifyRun.update({
      where: { id: run.id },
      data: {
        queued,
        skipped,
        status: "CANCELLED",
        completedAt: new Date(),
      },
    });
  } else if (queued === 0) {
    await deps.prisma.mailboxReclassifyRun.update({
      where: { id: run.id },
      data: {
        queued,
        skipped,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  } else {
    // Stay RUNNING until classify workers account for all queued jobs.
    await deps.prisma.mailboxReclassifyRun.update({
      where: { id: run.id },
      data: { queued, skipped, status: "RUNNING" },
    });
  }

  console.info({
    event: "mailbox-reclassify-orchestrator-finished",
    runId: run.id,
    cancelled,
    queued,
    skipped,
    totalMatched: run.totalMatched,
  });

  return {
    workspaceId: payload.workspaceId,
    inboxConnectionId: payload.inboxConnectionId,
    runId: run.id,
    status: cancelled ? "cancelled" : "completed",
    queued,
    skipped,
  };
}

/** Classify worker: bump run counters and finalize when all queued jobs finish. */
export async function recordReclassifyClassifyOutcome(input: {
  prisma: PrismaClient;
  reclassifyRunId: string;
  outcome: "completed" | "failed" | "skipped";
  tasksRemoved?: number;
  tasksGenerated?: number;
  taskPersistFailures?: number;
}): Promise<void> {
  const field =
    input.outcome === "completed"
      ? "completed"
      : input.outcome === "failed"
        ? "failed"
        : "skipped";

  await input.prisma.mailboxReclassifyRun
    .update({
      where: { id: input.reclassifyRunId },
      data: {
        [field]: { increment: 1 },
        ...(input.tasksRemoved
          ? { tasksRemoved: { increment: input.tasksRemoved } }
          : {}),
        ...(input.tasksGenerated
          ? { tasksGenerated: { increment: input.tasksGenerated } }
          : {}),
        ...(input.taskPersistFailures
          ? { taskPersistFailures: { increment: input.taskPersistFailures } }
          : {}),
      },
    })
    .catch(() => {});

  const run = await input.prisma.mailboxReclassifyRun.findFirst({
    where: { id: input.reclassifyRunId },
  });
  if (!run) return;
  if (
    run.status === "CANCELLED" ||
    run.status === "COMPLETED" ||
    run.status === "FAILED"
  ) {
    return;
  }

  const accounted = run.completed + run.failed + run.skipped;
  if (run.queued > 0 && accounted >= run.queued) {
    await input.prisma.mailboxReclassifyRun.update({
      where: { id: run.id },
      data: {
        status: run.status === "CANCELLING" ? "CANCELLED" : "COMPLETED",
        completedAt: new Date(),
      },
    });
  }
}
