export const QueueNames = {
  INBOX_SYNC: "inbox-sync",
  INBOX_ANALYSIS: "inbox-analysis",
  AI_EXTRACTION: "ai-extraction",
  ATTACHMENT_INGEST: "attachment-ingest",
  MAILBOX_HISTORICAL_IMPORT: "mailbox-historical-import",
  MAILBOX_CLASSIFY: "mailbox-classify",
  PROJECT_FOLDER_EMAIL_ANALYZE: "project-folder-email-analyze",
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/**
 * Deterministic BullMQ custom jobId for ATTACHMENT_INGEST.
 * Must not contain ":" — BullMQ rejects colons in custom job IDs.
 */
export function buildAttachmentIngestJobId(emailMessageId: string): string {
  return `attachment-ingest-${emailMessageId}`;
}

/** Deterministic job id for message-scoped native classification (retry-safe). */
export function buildMailboxClassifyJobId(emailMessageId: string): string {
  return `mailbox-classify-${emailMessageId}`;
}

/** Deterministic job id for a project-folder email analyze run. */
export function buildProjectFolderEmailAnalyzeJobId(runId: string): string {
  return `project-folder-email-analyze-${runId}`;
}

