export const QueueNames = {
  INBOX_SYNC: "inbox-sync",
  INBOX_ANALYSIS: "inbox-analysis",
  AI_EXTRACTION: "ai-extraction",
  ATTACHMENT_INGEST: "attachment-ingest",
  MAILBOX_HISTORICAL_IMPORT: "mailbox-historical-import",
  MAILBOX_CLASSIFY: "mailbox-classify",
  PROJECT_FOLDER_EMAIL_ANALYZE: "project-folder-email-analyze",
  BID_EMAIL_ANALYZE: "bid-email-analyze",
  MAILBOX_RECLASSIFY: "mailbox-reclassify",
  INLINE_IMAGE_RELEVANCE: "inline-image-relevance",
  SUBTYPE_DISCOVERY: "subtype-discovery",
  JOB_INTELLIGENCE: "job-intelligence",
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

/** Deterministic job id for a Bid Invites/Quotes analysis run. */
export function buildBidEmailAnalyzeJobId(runId: string): string {
  return `bid-email-analyze-${runId}`;
}

/** Deterministic job id for a mailbox reclassification orchestrator run. */
export function buildMailboxReclassifyJobId(runId: string): string {
  return `mailbox-reclassify-${runId}`;
}

/** One manual inline-image relevance pass. runId keeps pages unique after a finished run. */
export function buildInlineImageRelevanceJobId(
  workspaceId: string,
  page = 0,
  runId = "run"
): string {
  return `inline-image-relevance-${workspaceId}-${runId}-p${page}`;
}

/** Deterministic job id for a Subtype Discovery run. */
export function buildSubtypeDiscoveryJobId(runId: string): string {
  return `subtype-discovery-${runId}`;
}

/** Deterministic job id for a Job Intelligence analysis run. */
export function buildJobIntelligenceRunJobId(runId: string): string {
  return `job-intelligence-${runId}`;
}

/**
 * Debounced incremental job id per Job (collapses concurrent new-email triggers).
 * Must not contain ":" — BullMQ rejects colons in custom job IDs.
 */
export function buildJobIntelligenceIncrementalJobId(jobId: string): string {
  return `job-intelligence-incremental-${jobId}`;
}
