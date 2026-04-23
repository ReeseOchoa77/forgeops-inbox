import { prisma } from "@forgeops/db";
import { QueueNames } from "@forgeops/shared";
import { loadWorkerEnv } from "./config/env.js";
import { startInboxAnalysisWorker } from "./jobs/inbox-analysis.worker.js";
import { startInboxSyncWorker } from "./jobs/inbox-sync.worker.js";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const env = loadWorkerEnv();
const inboxSync = startInboxSyncWorker(env);
const inboxAnalysis = startInboxAnalysisWorker(env);

async function registerScheduledSyncs(): Promise<void> {
  const connections = await prisma.inboxConnection.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, workspaceId: true, email: true }
  });

  const existing = await inboxSync.syncQueue.getRepeatableJobs();
  const existingKeys = new Set(existing.map(j => j.id ?? j.key));

  let registered = 0;
  for (const conn of connections) {
    const jobId = `scheduled-sync:${conn.id}`;
    if (existingKeys.has(jobId)) continue;

    await inboxSync.syncQueue.add(
      QueueNames.INBOX_SYNC,
      {
        workspaceId: conn.workspaceId,
        inboxConnectionId: conn.id
      },
      {
        jobId,
        repeat: { every: SYNC_INTERVAL_MS },
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 }
      }
    );
    registered += 1;
  }

  console.info("scheduled-syncs-registered", {
    activeConnections: connections.length,
    newlyRegistered: registered,
    alreadyExisting: existingKeys.size,
    intervalMs: SYNC_INTERVAL_MS
  });
}

registerScheduledSyncs().catch(e => {
  console.error("scheduled-sync-registration-failed", {
    error: e instanceof Error ? e.message : "unknown"
  });
});

const shutdown = async (signal: string): Promise<void> => {
  console.info("worker-shutdown", { signal });
  await Promise.all([
    inboxSync.worker.close(),
    inboxAnalysis.worker.close(),
    inboxSync.syncQueue.close(),
    inboxSync.redis.quit(),
    inboxAnalysis.redis.quit()
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
  queues: ["inbox-sync", "inbox-analysis"],
  concurrency: env.WORKER_CONCURRENCY,
  syncIntervalMs: SYNC_INTERVAL_MS
});
