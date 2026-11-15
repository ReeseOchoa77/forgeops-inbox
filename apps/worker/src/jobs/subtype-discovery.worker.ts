import { prisma } from "@forgeops/db";
import {
  QueueNames,
  type SubtypeDiscoveryJobPayload,
  type SubtypeDiscoveryJobResult,
} from "@forgeops/shared";
import { Worker } from "bullmq";

import { processSubtypeDiscoveryRun } from "../application/processors/subtype-discovery.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { createBullMqConnection } from "../infrastructure/redis/connection.js";

export const startSubtypeDiscoveryWorker = (
  env: WorkerEnv
): {
  worker: Worker<SubtypeDiscoveryJobPayload, SubtypeDiscoveryJobResult>;
} => {
  const worker = new Worker<
    SubtypeDiscoveryJobPayload,
    SubtypeDiscoveryJobResult
  >(
    QueueNames.SUBTYPE_DISCOVERY,
    async (job) =>
      processSubtypeDiscoveryRun(job.data, {
        prisma,
        ...(env.OPENAI_API_KEY ? { openaiApiKey: env.OPENAI_API_KEY } : {}),
        ...(env.OPENAI_SUBTYPE_MODEL
          ? { interpretModel: env.OPENAI_SUBTYPE_MODEL }
          : {}),
      }),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.info("job-completed", {
      queue: QueueNames.SUBTYPE_DISCOVERY,
      id: job.id,
      result: job.returnvalue,
    });
  });

  worker.on("failed", (job, err) => {
    console.error("job-failed", {
      queue: QueueNames.SUBTYPE_DISCOVERY,
      id: job?.id,
      error: err.message,
    });
    if (job?.data.runId) {
      void prisma.subtypeDiscoveryRun
        .updateMany({
          where: {
            id: job.data.runId,
            status: { in: ["PENDING", "RUNNING", "CANCELLING"] },
          },
          data: {
            status: "FAILED",
            errorMessage: err.message.slice(0, 480),
            completedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  });

  return { worker };
};
