import { prisma } from "@forgeops/db";
import { serializeOpenAiError } from "@forgeops/ai";
import {
  QueueNames,
  MAX_AUTO_CLASSIFICATION_ATTEMPTS,
  truncateClassificationError,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
} from "@forgeops/shared";
import { Worker } from "bullmq";

import { classifyEmailMessageNative } from "../application/services/classify-email-message-native.js";
import type { WorkerEnv } from "../config/env.js";
import { createBullMqConnection } from "../infrastructure/redis/connection.js";

export const startMailboxClassifyWorker = (
  env: WorkerEnv
): {
  worker: Worker<MailboxClassifyJobPayload, MailboxClassifyJobResult>;
} => {
  const worker = new Worker<MailboxClassifyJobPayload, MailboxClassifyJobResult>(
    QueueNames.MAILBOX_CLASSIFY,
    async (job) =>
      classifyEmailMessageNative(job.data, {
        prisma,
        openaiApiKey: env.OPENAI_API_KEY,
        openaiSemanticModel: env.OPENAI_SEMANTIC_MODEL,
        openaiSubtypeModel: env.OPENAI_SUBTYPE_MODEL,
        openaiEntityModel: env.OPENAI_ENTITY_MODEL,
        openaiTaskModel: env.OPENAI_TASK_MODEL,
      }),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: Math.max(1, Math.min(env.WORKER_CONCURRENCY, 3)),
    }
  );

  worker.on("failed", (job, err) => {
    console.error("mailbox-classify-job-failed", {
      emailMessageId: job?.data.emailMessageId,
      workspaceId: job?.data.workspaceId,
      inboxConnectionId: job?.data.inboxConnectionId,
      attemptsMade: job?.attemptsMade,
      error: err.message,
      ...serializeOpenAiError(err),
    });

    if (!job?.data.emailMessageId) return;
    const maxAttempts = job.opts.attempts ?? 3;
    const isFinal = (job.attemptsMade ?? 0) >= maxAttempts;
    if (!isFinal) return;

    void prisma.emailMessage
      .updateMany({
        where: {
          id: job.data.emailMessageId,
          workspaceId: job.data.workspaceId,
          classifications: { none: {} },
        },
        data: {
          classificationStatus: "FAILED",
          classificationLastAttemptAt: new Date(),
          classificationError: truncateClassificationError(err.message),
          // Cap auto attempts so safety-net stops after permanent failure.
          classificationAttemptCount: MAX_AUTO_CLASSIFICATION_ATTEMPTS,
        },
      })
      .catch(() => {});
  });

  return { worker };
};
