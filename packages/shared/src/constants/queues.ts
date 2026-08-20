export const QueueNames = {
  INBOX_SYNC: "inbox-sync",
  INBOX_ANALYSIS: "inbox-analysis",
  AI_EXTRACTION: "ai-extraction",
  ATTACHMENT_INGEST: "attachment-ingest"
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/**
 * Deterministic BullMQ custom jobId for ATTACHMENT_INGEST.
 * Must not contain ":" — BullMQ rejects colons in custom job IDs.
 */
export function buildAttachmentIngestJobId(emailMessageId: string): string {
  return `attachment-ingest-${emailMessageId}`;
}
