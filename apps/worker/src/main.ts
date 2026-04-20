import { prisma } from "@forgeops/db";
import { loadWorkerEnv } from "./config/env.js";
import { startInboxAnalysisWorker } from "./jobs/inbox-analysis.worker.js";
import { startInboxSyncWorker } from "./jobs/inbox-sync.worker.js";

const env = loadWorkerEnv();
const inboxSync = startInboxSyncWorker(env);
const inboxAnalysis = startInboxAnalysisWorker(env);

const shutdown = async (signal: string): Promise<void> => {
  console.info("worker-shutdown", { signal });
  await Promise.all([
    inboxSync.worker.close(),
    inboxAnalysis.worker.close(),
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
  concurrency: env.WORKER_CONCURRENCY
});
