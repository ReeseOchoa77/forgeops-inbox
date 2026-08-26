import type { PrismaClient } from "@prisma/client";
import {
  QueueNames,
  historicalImportJobId,
  type MailboxHistoricalImportJobPayload,
  type MailboxHistoricalImportJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export type HistoricalImportEnqueueResult =
  | { ok: true }
  | {
      ok: false;
      import: {
        id: string;
        workspaceId: string;
        inboxConnectionId: string;
        status: string;
        requestedLimit: number;
        sinceDate: Date | null;
        processedCount: number;
        importedCount: number;
        duplicateCount: number;
        businessCount: number;
        personalCount: number;
        failedCount: number;
        errorMessage: string | null;
        startedAt: Date | null;
        completedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      };
      errorMessage: string;
    };

export function formatHistoricalImportEnqueueError(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Queue enqueue failed";
  return `Failed to enqueue historical import: ${detail}`.slice(0, 2000);
}

/**
 * Enqueue a historical-import BullMQ job for an existing PENDING DB row.
 * On enqueue failure, marks the row FAILED so it does not block retries.
 */
export async function enqueueHistoricalImportJob(input: {
  prisma: PrismaClient;
  queue: Queue<MailboxHistoricalImportJobPayload, MailboxHistoricalImportJobResult>;
  importId: string;
  workspaceId: string;
  inboxConnectionId: string;
  requestedLimit: number;
  sinceDate?: string;
  initiatedBy?: string;
  log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<HistoricalImportEnqueueResult> {
  const log = input.log ?? ((event, data) => console.info(event, data));
  const payload: MailboxHistoricalImportJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    importId: input.importId,
    requestedLimit: input.requestedLimit,
    ...(input.sinceDate ? { sinceDate: input.sinceDate } : {}),
    ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
  };

  try {
    await input.queue.add(QueueNames.MAILBOX_HISTORICAL_IMPORT, payload, {
      jobId: historicalImportJobId(input.importId),
      attempts: 2,
      backoff: { type: "exponential", delay: 10000 },
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    });
    return { ok: true };
  } catch (error) {
    const errorMessage = formatHistoricalImportEnqueueError(error);
    log("historical-import-enqueue-failed", {
      importId: input.importId,
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      error: error instanceof Error ? error.message : "unknown",
    });

    const failed = await input.prisma.mailboxHistoricalImport.update({
      where: { id: input.importId },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: new Date(),
      },
    });

    return { ok: false, import: failed, errorMessage };
  }
}
