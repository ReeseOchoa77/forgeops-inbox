import { prisma } from "@forgeops/db";
import {
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  type InboxSyncJobPayload,
  type InboxSyncResult
} from "@forgeops/shared";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { InboxSyncProcessor } from "../application/processors/inbox-sync.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { GmailSyncProvider } from "../infrastructure/providers/gmail/gmail-provider.js";
import { OutlookSyncProvider } from "../infrastructure/providers/outlook/outlook-provider.js";
import {
  createBullMqConnection,
  createRedisConnection
} from "../infrastructure/redis/connection.js";

export const startInboxSyncWorker = (
  env: WorkerEnv
): { worker: Worker<InboxSyncJobPayload, InboxSyncResult>; redis: Redis } => {
  const redis = createRedisConnection(env.REDIS_URL);

  const providerRegistry = new ProviderRegistry();
  providerRegistry.registerSyncProvider(
    new GmailSyncProvider({
      ...(env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : {}),
      ...(env.GOOGLE_CLIENT_SECRET
        ? { clientSecret: env.GOOGLE_CLIENT_SECRET }
        : {}),
      ...(env.GOOGLE_INBOX_REDIRECT_URI
        ? { redirectUri: env.GOOGLE_INBOX_REDIRECT_URI }
        : {})
    })
  );
  providerRegistry.registerSyncProvider(
    new OutlookSyncProvider({
      ...(env.OUTLOOK_CLIENT_ID ? { clientId: env.OUTLOOK_CLIENT_ID } : {}),
      ...(env.OUTLOOK_CLIENT_SECRET
        ? { clientSecret: env.OUTLOOK_CLIENT_SECRET }
        : {}),
      tenantId: env.OUTLOOK_TENANT_ID
    })
  );

  const tokenCipher = new TokenCipher(env.TOKEN_ENCRYPTION_SECRET);
  const processor = new InboxSyncProcessor(prisma, providerRegistry, tokenCipher);

  const worker = new Worker<InboxSyncJobPayload, InboxSyncResult>(
    QueueNames.INBOX_SYNC,
    async (job) => {
      return processor.process({
        ...job.data,
        jobId: String(job.id)
      });
    },
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: env.WORKER_CONCURRENCY
    }
  );

  worker.on("completed", (job) => {
    console.info("job-completed", {
      queue: QueueNames.INBOX_SYNC,
      id: job.id,
      result: job.returnvalue
    });
  });

  worker.on("failed", (job, error) => {
    console.error("job-failed", {
      queue: QueueNames.INBOX_SYNC,
      id: job?.id,
      error: error.message
    });
  });

  return { worker, redis };
};
