import { prisma } from "@forgeops/db";
import {
  QueueNames,
  TokenCipher,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
} from "@forgeops/shared";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { AttachmentIngestProcessor } from "../application/processors/attachment-ingest.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { OutlookClient } from "../infrastructure/providers/outlook/outlook-client.js";
import {
  createBullMqConnection,
  createRedisConnection,
} from "../infrastructure/redis/connection.js";
import { S3AttachmentStorage } from "../infrastructure/storage/attachment-storage.js";

export const startAttachmentIngestWorker = (
  env: WorkerEnv
): { worker: Worker<AttachmentIngestJobPayload, AttachmentIngestResult>; redis: Redis } => {
  const redis = createRedisConnection(env.REDIS_URL);

  const outlookClient = new OutlookClient({
    ...(env.OUTLOOK_CLIENT_ID ? { clientId: env.OUTLOOK_CLIENT_ID } : {}),
    ...(env.OUTLOOK_CLIENT_SECRET ? { clientSecret: env.OUTLOOK_CLIENT_SECRET } : {}),
    tenantId: env.OUTLOOK_TENANT_ID,
  });

  const storage = new S3AttachmentStorage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT,
  });

  const tokenCipher = new TokenCipher(env.TOKEN_ENCRYPTION_SECRET);
  const processor = new AttachmentIngestProcessor(
    prisma,
    tokenCipher,
    outlookClient,
    storage,
    env.ATTACHMENT_MAX_SIZE_BYTES
  );

  // Low concurrency — Graph mailbox concurrency is the constraint
  const worker = new Worker<AttachmentIngestJobPayload, AttachmentIngestResult>(
    QueueNames.ATTACHMENT_INGEST,
    async (job) => processor.process(job.data),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.info("job-completed", {
      queue: QueueNames.ATTACHMENT_INGEST,
      id: job.id,
      result: job.returnvalue,
    });
  });

  worker.on("failed", (job, error) => {
    console.error("job-failed", {
      queue: QueueNames.ATTACHMENT_INGEST,
      id: job?.id,
      emailMessageId: job?.data.emailMessageId,
      error: error.message,
    });
  });

  return { worker, redis };
};
