import { prisma } from "@forgeops/db";
import {
  NATIVE_INBOX_SYNC_INTERVAL_MS,
  QueueNames,
  scheduledInboxSyncJobId,
  shouldScheduleNativeInboxSync,
} from "@forgeops/shared";
import { loadWorkerEnv } from "./config/env.js";
import { startAttachmentIngestWorker } from "./jobs/attachment-ingest.worker.js";
import { startInboxAnalysisWorker } from "./jobs/inbox-analysis.worker.js";
import { startInboxSyncWorker } from "./jobs/inbox-sync.worker.js";

const env = loadWorkerEnv();
const inboxSync = startInboxSyncWorker(env);
const inboxAnalysis = startInboxAnalysisWorker(env);
const attachmentIngest = startAttachmentIngestWorker(env);

async function reconcileScheduledSyncs(): Promise<void> {
  const connections = await prisma.inboxConnection.findMany({
    select: {
      id: true,
      workspaceId: true,
      email: true,
      status: true,
      ingestionSource: true,
    },
  });

  const byId = new Map(connections.map((c) => [c.id, c]));
  const existing = await inboxSync.syncQueue.getRepeatableJobs();
  const existingKeys = new Set(existing.map((j) => j.id ?? j.key));

  let removed = 0;
  for (const job of existing) {
    const jobId = job.id ?? "";
    const connectionId = jobId.startsWith("scheduled-sync:")
      ? jobId.slice("scheduled-sync:".length)
      : null;
    if (!connectionId) continue;
    const conn = byId.get(connectionId);
    // Unknown connection or N8N-owned → remove native sync schedule
    if (!conn || !shouldScheduleNativeInboxSync(conn)) {
      await inboxSync.syncQueue.removeRepeatableByKey(job.key);
      removed += 1;
      console.info("native-sync-schedule-removed", {
        inboxConnectionId: connectionId,
        reason: conn ? "n8n_ingestion_owner" : "connection_missing",
        ingestionSource: conn?.ingestionSource ?? null,
      });
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

const shutdown = async (signal: string): Promise<void> => {
  console.info("worker-shutdown", { signal });
  await Promise.all([
    inboxSync.worker.close(),
    inboxAnalysis.worker.close(),
    attachmentIngest.worker.close(),
    inboxSync.syncQueue.close(),
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
  queues: ["inbox-sync", "inbox-analysis", "attachment-ingest"],
});
