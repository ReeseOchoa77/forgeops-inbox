import { prisma } from "@forgeops/db";
import {
  NATIVE_INBOX_SYNC_INTERVAL_MS,
  QueueNames,
  connectionIdFromScheduledSyncJobId,
  scheduledInboxSyncJobId,
  shouldScheduleNativeInboxSync,
  ensureMailboxClassifyJob,
  canAutoRequeueClassification,
  MAX_AUTO_CLASSIFICATION_ATTEMPTS,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
} from "@forgeops/shared";
import { normalizeOpenAiApiKey } from "@forgeops/ai";
import { Queue } from "bullmq";
import { loadWorkerEnv } from "./config/env.js";
import { startAttachmentIngestWorker } from "./jobs/attachment-ingest.worker.js";
import { startInboxAnalysisWorker } from "./jobs/inbox-analysis.worker.js";
import { startInboxSyncWorker } from "./jobs/inbox-sync.worker.js";
import { startMailboxClassifyWorker } from "./jobs/mailbox-classify.worker.js";
import { startMailboxHistoricalImportWorker } from "./jobs/mailbox-historical-import.worker.js";
import { createBullMqConnection } from "./infrastructure/redis/connection.js";

const env = loadWorkerEnv();
const inboxSync = startInboxSyncWorker(env);
const inboxAnalysis = startInboxAnalysisWorker(env);
const attachmentIngest = startAttachmentIngestWorker(env);
const historicalImport = startMailboxHistoricalImportWorker(env);
const mailboxClassify = startMailboxClassifyWorker(env);

/** Producer queue for safety-net re-enqueue (worker only consumes). */
const mailboxClassifyQueue = new Queue<
  MailboxClassifyJobPayload,
  MailboxClassifyJobResult
>(QueueNames.MAILBOX_CLASSIFY, {
  connection: createBullMqConnection(env.REDIS_URL),
});

async function reconcileScheduledSyncs(): Promise<void> {
  const connections = await prisma.inboxConnection.findMany({
    select: {
      id: true,
      workspaceId: true,
      email: true,
      status: true,
      ingestionSource: true,
      nativeListeningEnabled: true,
    },
  });

  const byId = new Map(connections.map((c) => [c.id, c]));
  const existing = await inboxSync.syncQueue.getRepeatableJobs();
  const existingKeys = new Set(existing.map((j) => j.id ?? j.key));

  let removed = 0;
  for (const job of existing) {
    const jobId = job.id ?? "";
    const connectionId = connectionIdFromScheduledSyncJobId(jobId);
    if (!connectionId) continue;
    const conn = byId.get(connectionId);
    // Unknown connection or listener/mode gate → remove native sync schedule
    // Also remove legacy colon-form job ids so they are re-registered hyphenated.
    const isLegacyColonId = jobId.startsWith("scheduled-sync:");
    if (!conn || !shouldScheduleNativeInboxSync(conn) || isLegacyColonId) {
      await inboxSync.syncQueue.removeRepeatableByKey(job.key);
      removed += 1;
      console.info("native-sync-schedule-removed", {
        inboxConnectionId: connectionId,
        reason: !conn
          ? "connection_missing"
          : isLegacyColonId
            ? "legacy_colon_job_id"
            : "listener_or_mode_gate",
        ingestionSource: conn?.ingestionSource ?? null,
        nativeListeningEnabled: conn?.nativeListeningEnabled ?? null,
      });
      if (isLegacyColonId && conn && shouldScheduleNativeInboxSync(conn)) {
        existingKeys.delete(jobId);
      }
    }
  }

  let registered = 0;
  for (const conn of connections) {
    if (!shouldScheduleNativeInboxSync(conn)) continue;
    const jobId = scheduledInboxSyncJobId(conn.id);
    if (existingKeys.has(jobId)) continue;

    await inboxSync.syncQueue.add(
      QueueNames.INBOX_SYNC,
      {
        workspaceId: conn.workspaceId,
        inboxConnectionId: conn.id,
      },
      {
        jobId,
        repeat: { every: NATIVE_INBOX_SYNC_INTERVAL_MS },
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 },
      }
    );
    registered += 1;
  }

  console.info("scheduled-syncs-reconciled", {
    activeConnections: connections.length,
    newlyRegistered: registered,
    removedStaleOrN8n: removed,
    intervalMs: NATIVE_INBOX_SYNC_INTERVAL_MS,
  });
}

reconcileScheduledSyncs().catch((e) => {
  console.error("scheduled-sync-registration-failed", {
    error: e instanceof Error ? e.message : "unknown",
  });
});

const UNCLASSIFIED_GRACE_MS = 3 * 60 * 1000;
const UNCLASSIFIED_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const UNCLASSIFIED_RECONCILE_LIMIT_PER_CONN = 25;

/**
 * Safety net: NATIVE messages with no Classification after a grace period
 * are re-enqueued via ensureMailboxClassifyJob (idempotent).
 * Skips FAILED / auto-attempt-exhausted messages (manual retry still works).
 */
async function reconcileUnclassifiedNative(): Promise<void> {
  const createdBefore = new Date(Date.now() - UNCLASSIFIED_GRACE_MS);
  const connections = await prisma.inboxConnection.findMany({
    where: {
      ingestionSource: "NATIVE",
      status: { in: ["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH"] },
    },
    select: { id: true, workspaceId: true },
  });

  let totalEligible = 0;
  let totalEnqueued = 0;
  let totalSkipped = 0;
  let totalSkippedCapped = 0;

  for (const conn of connections) {
    const rows = await prisma.emailMessage.findMany({
      where: {
        workspaceId: conn.workspaceId,
        inboxConnectionId: conn.id,
        classifications: { none: {} },
        createdAt: { lt: createdBefore },
        classificationAttemptCount: { lt: MAX_AUTO_CLASSIFICATION_ATTEMPTS },
        OR: [
          { classificationStatus: null },
          { classificationStatus: { in: ["PENDING", "PROCESSING"] } },
        ],
      },
      select: {
        id: true,
        classificationAttemptCount: true,
        classificationStatus: true,
      },
      orderBy: { createdAt: "asc" },
      take: UNCLASSIFIED_RECONCILE_LIMIT_PER_CONN,
    });
    if (rows.length === 0) continue;
    totalEligible += rows.length;

    for (const row of rows) {
      if (
        !canAutoRequeueClassification({
          classificationAttemptCount: row.classificationAttemptCount,
          classificationStatus: row.classificationStatus,
        })
      ) {
        totalSkippedCapped += 1;
        continue;
      }
      try {
        const outcome = await ensureMailboxClassifyJob({
          queue: mailboxClassifyQueue,
          workspaceId: conn.workspaceId,
          inboxConnectionId: conn.id,
          emailMessageId: row.id,
          initiatedBy: "worker-unclassified-reconcile",
        });
        if (outcome === "enqueued") {
          totalEnqueued += 1;
          await prisma.emailMessage
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
          totalSkipped += 1;
        }
      } catch (e) {
        console.warn("unclassified-reconcile-enqueue-failed", {
          emailMessageId: row.id,
          error: e instanceof Error ? e.message : "unknown",
        });
      }
    }
  }

  if (totalEligible > 0) {
    console.info("unclassified-native-reconciled", {
      connections: connections.length,
      eligible: totalEligible,
      enqueued: totalEnqueued,
      skippedInflight: totalSkipped,
      skippedCapped: totalSkippedCapped,
      graceMs: UNCLASSIFIED_GRACE_MS,
      maxAutoAttempts: MAX_AUTO_CLASSIFICATION_ATTEMPTS,
    });
  }
}

const unclassifiedReconcileTimer = setInterval(() => {
  void reconcileUnclassifiedNative().catch((e) => {
    console.error("unclassified-reconcile-failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
  });
}, UNCLASSIFIED_RECONCILE_INTERVAL_MS);
unclassifiedReconcileTimer.unref?.();

// Kick once shortly after boot (after workers are listening).
setTimeout(() => {
  void reconcileUnclassifiedNative().catch(() => {});
}, 30_000).unref?.();

const shutdown = async (signal: string): Promise<void> => {
  console.info("worker-shutdown", { signal });
  await Promise.all([
    inboxSync.worker.close(),
    inboxAnalysis.worker.close(),
    attachmentIngest.worker.close(),
    historicalImport.worker.close(),
    mailboxClassify.worker.close(),
    inboxSync.syncQueue.close(),
    historicalImport.queue.close(),
    mailboxClassifyQueue.close(),
    inboxSync.redis.quit(),
    inboxAnalysis.redis.quit(),
    attachmentIngest.redis.quit(),
  ]);
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

console.info("worker-started", {
  queues: [
    "inbox-sync",
    "inbox-analysis",
    "attachment-ingest",
    "mailbox-historical-import",
    "mailbox-classify",
  ],
});

// Safe OpenAI wiring check for native classification (no secrets).
console.info({
  event: "openai-worker-config",
  configured: Boolean(normalizeOpenAiApiKey(env.OPENAI_API_KEY)),
  semanticModel: env.OPENAI_SEMANTIC_MODEL,
  subtypeModel: env.OPENAI_SUBTYPE_MODEL,
  entityModel: env.OPENAI_ENTITY_MODEL,
  taskModel: env.OPENAI_TASK_MODEL,
  // createOpenAIClient is never given baseURL on the classify path.
  customBaseUrl: false,
  // Env may be set but is not read by worker env schema / client today.
  openaiBaseUrlEnvSet: Boolean(
    typeof process.env.OPENAI_BASE_URL === "string" &&
      process.env.OPENAI_BASE_URL.trim().length > 0
  ),
});
