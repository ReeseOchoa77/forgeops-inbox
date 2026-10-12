import { prisma } from "@forgeops/db";
import {
  QueueNames,
  TokenCipher,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
  type BidEmailAnalyzeJobPayload,
  type BidEmailAnalyzeJobResult,
} from "@forgeops/shared";
import { Queue, Worker } from "bullmq";

import {
  failOpenBidEmailAnalyzeRun,
  processBidEmailAnalyze,
} from "../application/processors/bid-email-analyze.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { createBullMqConnection } from "../infrastructure/redis/connection.js";

export const startBidEmailAnalyzeWorker = (
  env: WorkerEnv
): {
  worker: Worker<BidEmailAnalyzeJobPayload, BidEmailAnalyzeJobResult>;
  queue: Queue<BidEmailAnalyzeJobPayload, BidEmailAnalyzeJobResult>;
} => {
  const tokenCipher = new TokenCipher(env.TOKEN_ENCRYPTION_SECRET);

  const attachmentIngestQueue = new Queue<
    AttachmentIngestJobPayload,
    AttachmentIngestResult
  >(QueueNames.ATTACHMENT_INGEST, {
    connection: createBullMqConnection(env.REDIS_URL),
  });

  const queue = new Queue<BidEmailAnalyzeJobPayload, BidEmailAnalyzeJobResult>(
    QueueNames.BID_EMAIL_ANALYZE,
    {
      connection: createBullMqConnection(env.REDIS_URL),
    }
  );

  const worker = new Worker<BidEmailAnalyzeJobPayload, BidEmailAnalyzeJobResult>(
    QueueNames.BID_EMAIL_ANALYZE,
    async (job) => {
      const maxAttempts = job.opts.attempts ?? 1;
      return processBidEmailAnalyze(job.data, {
        prisma,
        tokenCipher,
        outlookConfig: {
          ...(env.OUTLOOK_CLIENT_ID ? { clientId: env.OUTLOOK_CLIENT_ID } : {}),
          ...(env.OUTLOOK_CLIENT_SECRET
            ? { clientSecret: env.OUTLOOK_CLIENT_SECRET }
            : {}),
          tenantId: env.OUTLOOK_TENANT_ID,
        },
        attachmentIngestQueue,
        finalAttempt: job.attemptsMade >= maxAttempts,
      });
    },
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    const runId = job?.data.runId;
    const maxAttempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    console.error("bid-email-analyze-failed", {
      jobId: job?.id,
      runId,
      attemptsMade,
      maxAttempts,
      error: err.message,
    });
    if (!runId || attemptsMade < maxAttempts) return;
    void failOpenBidEmailAnalyzeRun(prisma, runId, err.message).catch((statusError) => {
      console.error("bid-email-analyze-fail-status", {
        runId,
        error: statusError instanceof Error ? statusError.message : String(statusError),
      });
    });
  });

  return { worker, queue };
};
