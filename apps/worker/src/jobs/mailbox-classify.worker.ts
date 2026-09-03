import { prisma } from "@forgeops/db";
import { serializeOpenAiError } from "@forgeops/ai";
import {
  QueueNames,
  MAX_AUTO_CLASSIFICATION_ATTEMPTS,
  formatClassificationFailureMessage,
  truncateClassificationError,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
} from "@forgeops/shared";
import { Worker } from "bullmq";

import { recordReclassifyClassifyOutcome } from "../application/processors/mailbox-reclassify.processor.js";
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
    async (job) => {
      console.info({
        event: "mailbox-classify-started",
        jobId: job.id,
        emailMessageId: job.data.emailMessageId,
        workspaceId: job.data.workspaceId,
        forceReclassify: Boolean(job.data.forceReclassify),
        reclassifyRunId: job.data.reclassifyRunId ?? null,
        attemptsMade: job.attemptsMade,
      });
      return classifyEmailMessageNative(job.data, {
        prisma,
        openaiApiKey: env.OPENAI_API_KEY,
        openaiSemanticModel: env.OPENAI_SEMANTIC_MODEL,
        openaiSubtypeModel: env.OPENAI_SUBTYPE_MODEL,
        openaiEntityModel: env.OPENAI_ENTITY_MODEL,
        openaiTaskModel: env.OPENAI_TASK_MODEL,
      });
    },
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: Math.max(1, Math.min(env.WORKER_CONCURRENCY, 3)),
    }
  );

  worker.on("completed", (job) => {
    const runId = job.data.reclassifyRunId;
    if (!runId) return;
    const outcome =
      job.returnvalue?.status === "completed"
        ? "completed"
        : job.returnvalue?.status === "skipped"
          ? "skipped"
          : "failed";
    void recordReclassifyClassifyOutcome({
      prisma,
      reclassifyRunId: runId,
      outcome,
      tasksRemoved: job.returnvalue?.tasksRemoved ?? 0,
      tasksGenerated: job.returnvalue?.tasksGenerated ?? 0,
      taskPersistFailures: job.returnvalue?.taskPersistFailures ?? 0,
    });
  });

  worker.on("failed", (job, err) => {
    console.error("mailbox-classify-job-failed", {
      emailMessageId: job?.data.emailMessageId,
      workspaceId: job?.data.workspaceId,
      inboxConnectionId: job?.data.inboxConnectionId,
      attemptsMade: job?.attemptsMade,
      forceReclassify: Boolean(job?.data.forceReclassify),
      reclassifyRunId: job?.data.reclassifyRunId ?? null,
      error: err.message,
      ...serializeOpenAiError(err),
    });

    if (!job?.data.emailMessageId) return;
    const maxAttempts = job.opts.attempts ?? 3;
    const isFinal = (job.attemptsMade ?? 0) >= maxAttempts;
    if (!isFinal) return;

    const force = Boolean(job.data.forceReclassify);
    void prisma.emailMessage
      .updateMany({
        where: {
          id: job.data.emailMessageId,
          workspaceId: job.data.workspaceId,
          ...(force ? {} : { classifications: { none: {} } }),
        },
        data: {
          classificationStatus: "FAILED",
          classificationLastAttemptAt: new Date(),
          classificationError: truncateClassificationError(
            formatClassificationFailureMessage("classification", err)
          ),
          classificationAttemptCount: MAX_AUTO_CLASSIFICATION_ATTEMPTS,
        },
      })
      .catch(() => {});

    if (job.data.reclassifyRunId) {
      void recordReclassifyClassifyOutcome({
        prisma,
        reclassifyRunId: job.data.reclassifyRunId,
        outcome: "failed",
      });
    }
  });

  return { worker };
};
