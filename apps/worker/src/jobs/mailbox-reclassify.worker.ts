import { prisma } from "@forgeops/db";
import {
  QueueNames,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
  type MailboxReclassifyJobPayload,
  type MailboxReclassifyJobResult,
} from "@forgeops/shared";
import { Queue, Worker } from "bullmq";

import { processMailboxReclassifyRun } from "../application/processors/mailbox-reclassify.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { createBullMqConnection } from "../infrastructure/redis/connection.js";

export const startMailboxReclassifyWorker = (
  env: WorkerEnv
): {
  worker: Worker<MailboxReclassifyJobPayload, MailboxReclassifyJobResult>;
} => {
  const classifyQueue = new Queue<
    MailboxClassifyJobPayload,
    MailboxClassifyJobResult
  >(QueueNames.MAILBOX_CLASSIFY, {
    connection: createBullMqConnection(env.REDIS_URL),
  });

  const worker = new Worker<
    MailboxReclassifyJobPayload,
    MailboxReclassifyJobResult
  >(
    QueueNames.MAILBOX_RECLASSIFY,
    async (job) =>
      processMailboxReclassifyRun(job.data, {
        prisma,
        classifyQueue,
      }),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.info("job-completed", {
      queue: QueueNames.MAILBOX_RECLASSIFY,
      id: job.id,
      result: job.returnvalue,
    });
  });

  worker.on("failed", (job, err) => {
    console.error("job-failed", {
      queue: QueueNames.MAILBOX_RECLASSIFY,
      id: job?.id,
      error: err.message,
    });
    if (job?.data.runId) {
      void prisma.mailboxReclassifyRun
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
