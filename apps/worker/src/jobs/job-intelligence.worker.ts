import { prisma } from "@forgeops/db";
import {
  QueueNames,
  type JobIntelligenceJobPayload,
  type JobIntelligenceJobResult,
} from "@forgeops/shared";
import { Queue, Worker } from "bullmq";

import {
  failOpenJobIntelligenceRun,
  processJobIntelligenceRun,
} from "../application/processors/job-intelligence.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { createBullMqConnection } from "../infrastructure/redis/connection.js";

export const startJobIntelligenceWorker = (
  env: WorkerEnv
): {
  worker: Worker<JobIntelligenceJobPayload, JobIntelligenceJobResult>;
  queue: Queue<JobIntelligenceJobPayload, JobIntelligenceJobResult>;
} => {
  const queue = new Queue<JobIntelligenceJobPayload, JobIntelligenceJobResult>(
    QueueNames.JOB_INTELLIGENCE,
    {
      connection: createBullMqConnection(env.REDIS_URL),
    }
  );

  const worker = new Worker<JobIntelligenceJobPayload, JobIntelligenceJobResult>(
    QueueNames.JOB_INTELLIGENCE,
    async (job) => {
      const maxAttempts = job.opts.attempts ?? 1;
      try {
        return await processJobIntelligenceRun(job.data, {
          prisma,
          ...(env.OPENAI_API_KEY !== undefined
            ? { openaiApiKey: env.OPENAI_API_KEY }
            : { openaiApiKey: null }),
          openaiModel: env.OPENAI_MODEL,
          finalAttempt: job.attemptsMade >= maxAttempts,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "job_intelligence_failed";
        if (job.attemptsMade >= maxAttempts) {
          await failOpenJobIntelligenceRun(job.data.runId, prisma, message);
        }
        throw error;
      }
    },
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error("job-intelligence-worker-failed", {
      jobId: job?.id,
      runId: job?.data?.runId,
      message: err.message,
    });
  });

  return { worker, queue };
};
