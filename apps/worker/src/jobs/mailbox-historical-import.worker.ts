import { prisma } from "@forgeops/db";
import {
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult,
  type MailboxHistoricalImportJobPayload,
  type MailboxHistoricalImportJobResult,
} from "@forgeops/shared";
import { Queue, Worker } from "bullmq";

import { processMailboxHistoricalImport } from "../application/processors/mailbox-historical-import.processor.js";
import type { WorkerEnv } from "../config/env.js";
import { GmailSyncProvider } from "../infrastructure/providers/gmail/gmail-provider.js";
import { OutlookSyncProvider } from "../infrastructure/providers/outlook/outlook-provider.js";
import {
  createBullMqConnection,
} from "../infrastructure/redis/connection.js";

export const startMailboxHistoricalImportWorker = (
  env: WorkerEnv
): {
  worker: Worker<
    MailboxHistoricalImportJobPayload,
    MailboxHistoricalImportJobResult
  >;
  queue: Queue<
    MailboxHistoricalImportJobPayload,
    MailboxHistoricalImportJobResult
  >;
} => {
  const providerRegistry = new ProviderRegistry();
  providerRegistry.registerSyncProvider(
    new GmailSyncProvider({
      ...(env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : {}),
      ...(env.GOOGLE_CLIENT_SECRET
        ? { clientSecret: env.GOOGLE_CLIENT_SECRET }
        : {}),
      ...(env.GOOGLE_INBOX_REDIRECT_URI
        ? { redirectUri: env.GOOGLE_INBOX_REDIRECT_URI }
        : {}),
    })
  );
  providerRegistry.registerSyncProvider(
    new OutlookSyncProvider({
      ...(env.OUTLOOK_CLIENT_ID ? { clientId: env.OUTLOOK_CLIENT_ID } : {}),
      ...(env.OUTLOOK_CLIENT_SECRET
        ? { clientSecret: env.OUTLOOK_CLIENT_SECRET }
        : {}),
      tenantId: env.OUTLOOK_TENANT_ID,
    })
  );

  const tokenCipher = new TokenCipher(env.TOKEN_ENCRYPTION_SECRET);
  const analysisQueue = new Queue<InboxAnalysisJobPayload, InboxAnalysisResult>(
    QueueNames.INBOX_ANALYSIS,
    { connection: createBullMqConnection(env.REDIS_URL) }
  );

  const classifyQueue = new Queue<
    import("@forgeops/shared").MailboxClassifyJobPayload,
    import("@forgeops/shared").MailboxClassifyJobResult
  >(QueueNames.MAILBOX_CLASSIFY, {
    connection: createBullMqConnection(env.REDIS_URL),
  });

  const queue = new Queue<
    MailboxHistoricalImportJobPayload,
    MailboxHistoricalImportJobResult
  >(QueueNames.MAILBOX_HISTORICAL_IMPORT, {
    connection: createBullMqConnection(env.REDIS_URL),
  });

  const worker = new Worker<
    MailboxHistoricalImportJobPayload,
    MailboxHistoricalImportJobResult
  >(
    QueueNames.MAILBOX_HISTORICAL_IMPORT,
    async (job) =>
      processMailboxHistoricalImport(job.data, {
        prisma,
        providerRegistry,
        tokenCipher,
        analysisQueue,
        classifyQueue,
      }),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error("mailbox-historical-import-failed", {
      importId: job?.data.importId,
      error: err.message,
    });
  });

  return { worker, queue };
};
