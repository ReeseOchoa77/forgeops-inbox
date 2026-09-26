import { prisma } from "@forgeops/db";
import {
  QueueNames,
  type InlineImageRelevanceJobPayload,
  type InlineImageRelevanceJobResult,
} from "@forgeops/shared";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";

import { processInlineImageRelevanceJob } from "../application/services/analyze-inline-images.js";
import type { WorkerEnv } from "../config/env.js";
import {
  createBullMqConnection,
  createRedisConnection,
} from "../infrastructure/redis/connection.js";
import { S3AttachmentStorage } from "../infrastructure/storage/attachment-storage.js";

export const startInlineImageRelevanceWorker = (
  env: WorkerEnv
): {
  worker: Worker<InlineImageRelevanceJobPayload, InlineImageRelevanceJobResult>;
  queue: Queue<InlineImageRelevanceJobPayload, InlineImageRelevanceJobResult>;
  redis: Redis;
} => {
  const redis = createRedisConnection(env.REDIS_URL);
  const connection = createBullMqConnection(env.REDIS_URL);
  const queue = new Queue<InlineImageRelevanceJobPayload, InlineImageRelevanceJobResult>(
    QueueNames.INLINE_IMAGE_RELEVANCE,
    { connection: createBullMqConnection(env.REDIS_URL) }
  );
  const storage = new S3AttachmentStorage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT,
  });

  const worker = new Worker<InlineImageRelevanceJobPayload, InlineImageRelevanceJobResult>(
    QueueNames.INLINE_IMAGE_RELEVANCE,
    async (job) =>
      processInlineImageRelevanceJob({
        prisma,
        payload: job.data,
        readObject: async (storageKey) => (await storage.getObject(storageKey)).data,
        openaiApiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_IMAGE_RELEVANCE_MODEL,
        queue,
      }),
    { connection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.info("job-completed", {
      queue: QueueNames.INLINE_IMAGE_RELEVANCE,
      id: job.id,
      workspaceId: job.data.workspaceId,
      analyzed: job.returnvalue.analyzed,
      visionCalls: job.returnvalue.visionCalls,
      failed: job.returnvalue.failed,
      remaining: job.returnvalue.remaining,
    });
  });

  worker.on("failed", (job, error) => {
    console.error("job-failed", {
      queue: QueueNames.INLINE_IMAGE_RELEVANCE,
      id: job?.id,
      workspaceId: job?.data.workspaceId,
      error: error.message,
    });
  });

  return { worker, queue, redis };
};
