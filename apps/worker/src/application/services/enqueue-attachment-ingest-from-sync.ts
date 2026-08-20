import {
  QueueNames,
  buildAttachmentIngestJobId,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export type AttachmentIngestSyncCandidate = {
  emailMessageId: string;
  providerMessageId: string;
};

/**
 * Enqueue ATTACHMENT_INGEST jobs after native Outlook sync.
 * Returns how many jobs were successfully accepted (including deduped duplicates).
 */
export async function enqueueAttachmentIngestFromSync(input: {
  queue: Queue<AttachmentIngestJobPayload, AttachmentIngestResult>;
  workspaceId: string;
  inboxConnectionId: string;
  candidates: AttachmentIngestSyncCandidate[];
}): Promise<{ enqueuedCount: number; failedCount: number }> {
  let enqueuedCount = 0;
  let failedCount = 0;

  for (const candidate of input.candidates) {
    const jobId = buildAttachmentIngestJobId(candidate.emailMessageId);
    const payload: AttachmentIngestJobPayload = {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      emailMessageId: candidate.emailMessageId,
      providerMessageId: candidate.providerMessageId,
    };

    try {
      await input.queue.add(QueueNames.ATTACHMENT_INGEST, payload, {
        jobId,
        attempts: 5,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      });
      enqueuedCount += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Idempotent: same EmailMessage already queued
      if (/already exists/i.test(message)) {
        enqueuedCount += 1;
        continue;
      }
      failedCount += 1;
      console.warn("attachment-ingest-queue-failed", {
        emailMessageId: candidate.emailMessageId,
        jobId,
        error: message,
      });
    }
  }

  return { enqueuedCount, failedCount };
}
