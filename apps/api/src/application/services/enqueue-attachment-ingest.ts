import type { PrismaClient } from "@prisma/client";
import {
  QueueNames,
  buildAttachmentIngestJobId,
  shouldInspectAttachments,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export type AttachmentIngestEnqueueOutcome =
  | { enqueued: true; jobId: string }
  | {
      enqueued: false;
      reason:
        | "no_inspect"
        | "no_token"
        | "unsupported_provider"
        | "queue_unavailable"
        | "enqueue_error";
    };

/**
 * Token-gated enqueue for ForgeOps-owned Outlook attachment ingestion.
 * Keeps n8n multipart upload as the fallback when no OAuth refresh token exists.
 */
export async function enqueueAttachmentIngestIfEligible(input: {
  prisma: PrismaClient;
  queue: Queue<AttachmentIngestJobPayload, AttachmentIngestResult> | null | undefined;
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  providerMessageId?: string;
  hasAttachments: boolean;
  bodyHtml: string | null | undefined;
  log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<AttachmentIngestEnqueueOutcome> {
  const log = input.log ?? ((event, data) => console.info(event, data));

  if (
    !shouldInspectAttachments({
      hasAttachments: input.hasAttachments,
      bodyHtml: input.bodyHtml,
    })
  ) {
    return { enqueued: false, reason: "no_inspect" };
  }

  if (!input.queue) {
    log("attachment-ingest-skipped", {
      reason: "queue_unavailable",
      emailMessageId: input.emailMessageId,
      inboxConnectionId: input.inboxConnectionId,
    });
    return { enqueued: false, reason: "queue_unavailable" };
  }

  const connection = await input.prisma.inboxConnection.findFirst({
    where: {
      id: input.inboxConnectionId,
      workspaceId: input.workspaceId,
    },
    select: {
      provider: true,
      encryptedRefreshToken: true,
    },
  });

  if (!connection || connection.provider !== "OUTLOOK") {
    log("attachment-ingest-skipped", {
      reason: "unsupported_provider",
      emailMessageId: input.emailMessageId,
      inboxConnectionId: input.inboxConnectionId,
      provider: connection?.provider ?? null,
    });
    return { enqueued: false, reason: "unsupported_provider" };
  }

  if (!connection.encryptedRefreshToken) {
    log("attachment-ingest-skipped", {
      reason: "mailbox_not_oauth_connected",
      emailMessageId: input.emailMessageId,
      inboxConnectionId: input.inboxConnectionId,
      workspaceId: input.workspaceId,
      detail: "ForgeOps attachment ingestion requires an OAuth-backed InboxConnection with a refresh token. n8n upload remains the fallback.",
    });
    return { enqueued: false, reason: "no_token" };
  }

  const jobId = buildAttachmentIngestJobId(input.emailMessageId);
  const payload: AttachmentIngestJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    emailMessageId: input.emailMessageId,
    ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
  };

  // Prefer shared constant; fall back to literal so a stale shared build cannot
  // pass undefined into BullMQ add().
  const queueName = QueueNames.ATTACHMENT_INGEST || "attachment-ingest";

  try {
    await input.queue.add(queueName, payload, {
      jobId,
      attempts: 5,
      backoff: { type: "exponential", delay: 15_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Idempotent re-ingest of the same EmailMessage: treat existing job as success.
    if (/already exists/i.test(message)) {
      log("attachment-ingest-enqueued", {
        jobId,
        emailMessageId: input.emailMessageId,
        inboxConnectionId: input.inboxConnectionId,
        workspaceId: input.workspaceId,
        deduped: true,
      });
      return { enqueued: true, jobId };
    }
    throw e;
  }

  log("attachment-ingest-enqueued", {
    jobId,
    emailMessageId: input.emailMessageId,
    inboxConnectionId: input.inboxConnectionId,
    workspaceId: input.workspaceId,
  });

  return { enqueued: true, jobId };
}
