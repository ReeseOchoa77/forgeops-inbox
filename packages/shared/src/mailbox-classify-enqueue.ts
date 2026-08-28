import { QueueNames, buildMailboxClassifyJobId } from "./constants/queues.js";
import type { MailboxClassifyJobPayload } from "./types/jobs.js";

export type ClassifyQueueLike = {
  add: (
    name: string,
    data: MailboxClassifyJobPayload,
    opts?: {
      jobId?: string;
      attempts?: number;
      backoff?: { type: string; delay: number };
      removeOnComplete?: { count: number };
      removeOnFail?: { count: number };
    }
  ) => Promise<unknown>;
  getJob: (jobId: string) => Promise<{
    getState: () => Promise<string>;
    remove: () => Promise<void>;
  } | null | undefined>;
};

/**
 * Ensure a mailbox-classify job can be added for this message id.
 *
 * BullMQ custom jobIds are unique while the job record exists. With
 * removeOnFail/removeOnComplete counts, failed/completed jobs often remain
 * and block re-add. Minimal safe strategy:
 * - waiting/active/delayed/paused → skip (already queued / in flight)
 * - completed/failed/unknown terminal → remove then re-add
 * - missing → add
 */
export async function ensureMailboxClassifyJob(input: {
  queue: ClassifyQueueLike;
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  initiatedBy?: string;
}): Promise<"enqueued" | "skipped_inflight"> {
  const jobId = buildMailboxClassifyJobId(input.emailMessageId);
  const existing = await input.queue.getJob(jobId);

  if (existing) {
    const state = await existing.getState();
    if (
      state === "waiting" ||
      state === "active" ||
      state === "delayed" ||
      state === "paused" ||
      state === "waiting-children"
    ) {
      return "skipped_inflight";
    }
    try {
      await existing.remove();
    } catch {
      // Race: another worker may have removed it; continue to add.
    }
  }

  const payload: MailboxClassifyJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    emailMessageId: input.emailMessageId,
    ...(input.initiatedBy ? { initiatedBy: input.initiatedBy } : {}),
  };

  try {
    await input.queue.add(QueueNames.MAILBOX_CLASSIFY, payload, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Parallel enqueue: treat "already exists" as in-flight success (same as attachment ingest).
    if (/already exists/i.test(msg)) {
      return "skipped_inflight";
    }
    throw e;
  }

  return "enqueued";
}
