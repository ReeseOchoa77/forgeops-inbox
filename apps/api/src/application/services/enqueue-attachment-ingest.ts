import type { PrismaClient } from "@prisma/client";
import {
  QueueNames,
  shouldInspectAttachments,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export type AttachmentIngestEnqueueOutcome =
  | { enqueued: true; jobId: string }
  | { enqueued: false; reason: "no_inspect" | "no_token" | "unsupported_provider" | "queue_unavailable" };

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

  const jobId = `attachment-ingest:${input.emailMessageId}`;
  const payload: AttachmentIngestJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    emailMessageId: input.emailMessageId,
    ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
  };

  await input.queue.add(QueueNames.ATTACHMENT_INGEST, payload, {
    jobId,
    attempts: 5,
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  });

  log("attachment-ingest-enqueued", {
    jobId,
    emailMessageId: input.emailMessageId,
    inboxConnectionId: input.inboxConnectionId,
    workspaceId: input.workspaceId,
  });

  return { enqueued: true, jobId };
}
