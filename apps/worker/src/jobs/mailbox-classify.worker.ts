import { prisma } from "@forgeops/db";
import { serializeOpenAiError } from "@forgeops/ai";
import {
  QueueNames,
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
      error: err.message,
      ...serializeOpenAiError(err),
    });
  });

  return { worker };
};
