import { prisma } from "@forgeops/db";
import {
  QueueNames,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult
} from "@forgeops/shared";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { InboxAnalysisProcessor } from "../application/processors/inbox-analysis.processor.js";
import type { WorkerEnv } from "../config/env.js";
import {
  createBullMqConnection,
  createRedisConnection
} from "../infrastructure/redis/connection.js";

export const startInboxAnalysisWorker = (
  env: WorkerEnv
): {
  worker: Worker<InboxAnalysisJobPayload, InboxAnalysisResult>;
  redis: Redis;
} => {
  const redis = createRedisConnection(env.REDIS_URL);
  const processor = new InboxAnalysisProcessor(prisma);

  const worker = new Worker<InboxAnalysisJobPayload, InboxAnalysisResult>(
    QueueNames.INBOX_ANALYSIS,
    async (job) =>
      processor.process({
        ...job.data,
        jobId: String(job.id)
      }),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: env.WORKER_CONCURRENCY
    }
  );

  worker.on("completed", (job) => {
    console.info("job-completed", {
      queue: QueueNames.INBOX_ANALYSIS,
      id: job.id,
      result: job.returnvalue
    });
  });

  worker.on("failed", (job, error) => {
    console.error("job-failed", {
      queue: QueueNames.INBOX_ANALYSIS,
      id: job?.id,
      error: error.message
    });
  });

  return { worker, redis };
};
