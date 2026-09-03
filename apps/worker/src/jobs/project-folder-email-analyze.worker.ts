import { prisma } from "@forgeops/db";
import {
  QueueNames,
  TokenCipher,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
  type ProjectFolderEmailAnalyzeJobPayload,
  type ProjectFolderEmailAnalyzeJobResult,
} from "@forgeops/shared";
import { Queue, Worker } from "bullmq";

import { processProjectFolderEmailAnalyze } from "../application/processors/project-folder-email-analyze.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { createBullMqConnection } from "../infrastructure/redis/connection.js";

export const startProjectFolderEmailAnalyzeWorker = (
  env: WorkerEnv
): {
  worker: Worker<
    ProjectFolderEmailAnalyzeJobPayload,
    ProjectFolderEmailAnalyzeJobResult
  >;
  queue: Queue<
    ProjectFolderEmailAnalyzeJobPayload,
    ProjectFolderEmailAnalyzeJobResult
  >;
} => {
  const tokenCipher = new TokenCipher(env.TOKEN_ENCRYPTION_SECRET);

  const classifyQueue = new Queue<
    MailboxClassifyJobPayload,
    MailboxClassifyJobResult
  >(QueueNames.MAILBOX_CLASSIFY, {
    connection: createBullMqConnection(env.REDIS_URL),
  });

  const attachmentIngestQueue = new Queue<
    AttachmentIngestJobPayload,
    AttachmentIngestResult
  >(QueueNames.ATTACHMENT_INGEST, {
    connection: createBullMqConnection(env.REDIS_URL),
  });

  const queue = new Queue<
    ProjectFolderEmailAnalyzeJobPayload,
    ProjectFolderEmailAnalyzeJobResult
  >(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, {
    connection: createBullMqConnection(env.REDIS_URL),
  });

  const worker = new Worker<
    ProjectFolderEmailAnalyzeJobPayload,
    ProjectFolderEmailAnalyzeJobResult
  >(
    QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
    async (job) =>
      processProjectFolderEmailAnalyze(job.data, {
        prisma,
        tokenCipher,
        outlookConfig: {
          ...(env.OUTLOOK_CLIENT_ID ? { clientId: env.OUTLOOK_CLIENT_ID } : {}),
          ...(env.OUTLOOK_CLIENT_SECRET
            ? { clientSecret: env.OUTLOOK_CLIENT_SECRET }
            : {}),
          tenantId: env.OUTLOOK_TENANT_ID,
        },
        classifyQueue,
        attachmentIngestQueue,
      }),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error("project-folder-email-analyze-failed", {
      jobId: job?.id,
      runId: job?.data.runId,
      error: err.message,
    });
  });

  return { worker, queue };
};
