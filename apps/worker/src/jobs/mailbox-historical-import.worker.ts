import { prisma } from "@forgeops/db";
import {
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
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

  const attachmentIngestQueue = new Queue<
    AttachmentIngestJobPayload,
    AttachmentIngestResult
  >(QueueNames.ATTACHMENT_INGEST, {
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
        attachmentIngestQueue,
      }),
    {
      connection: createBullMqConnection(env.REDIS_URL),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error("mailbox-historical-import-failed", {
      importId: job?.data.importId,
      attemptsMade: job?.attemptsMade,
      error: err.message,
    });
    const importId = job?.data.importId;
    if (!importId || !job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    // Final failure only — mid-attempt throws leave status RUNNING + resumeCursor.
    if (job.attemptsMade < maxAttempts) return;
    void prisma.mailboxHistoricalImport
      .updateMany({
        where: {
          id: importId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "FAILED",
          errorMessage: err.message.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch((updateErr) => {
        console.error("mailbox-historical-import-mark-failed-error", {
          importId,
          error:
            updateErr instanceof Error ? updateErr.message : "unknown",
        });
      });
  });

  return { worker, queue };
};
