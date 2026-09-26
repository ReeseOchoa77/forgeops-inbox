export interface InboxSyncJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  initiatedBy?: string;
}

export interface InboxSyncResult {
  workspaceId: string;
  inboxConnectionId: string;
  threadsImported: number;
  messagesImported: number;
  duplicatesSkipped: number;
  newestSyncCursor: string | null;
  /** Newly created EmailMessage ids (prefer these for native classification). */
  createdMessageIds?: string[];
  /** Existing messages that were updated from the provider (do not auto-reclassify). */
  updatedMessageIds?: string[];
  duplicateMessageIds?: string[];
  /** Set when native sync is skipped (e.g. N8N-owned mailbox). */
  skipped?: boolean;
  skipReason?: string;
}

export interface InboxAnalysisJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  initiatedBy?: string;
}

export interface InboxAnalysisResult {
  workspaceId: string;
  inboxConnectionId: string;
  messagesAnalyzed: number;
  messagesClassified: number;
  taskCandidatesCreated: number;
  lowConfidenceItemsFlaggedForReview: number;
}

/** Message-scoped production native classification (replaces whole-mailbox rules-normalizer). */
export interface MailboxClassifyJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  initiatedBy?: string;
  /**
   * Admin/testing: allow overwrite of an existing native Classification
   * (still respects NATIVE ingestion gate).
   */
  forceReclassify?: boolean;
  /** When set, classify worker updates MailboxReclassifyRun counters. */
  reclassifyRunId?: string;
  /**
   * Only for reclassification console jobs.
   * REMOVE_ONLY: skip task extraction; delete classifier tasks after successful core classify.
   * REGENERATE: run task extraction; replace classifier tasks (stale cleanup).
   * Undefined = normal production behavior (unchanged).
   */
  taskMode?: "REMOVE_ONLY" | "REGENERATE";
}

export interface MailboxClassifyJobResult {
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  status: "completed" | "skipped" | "failed";
  skipReason?: string;
  modelName?: string;
  modelVersion?: string;
  mailboxCategory?: string | null;
  durationMs?: number;
  errorMessage?: string;
  tasksRemoved?: number;
  tasksGenerated?: number;
  taskPersistFailures?: number;
}

/** Orchestrator job: page matching emails and enqueue mailbox-classify with force. */
export interface MailboxReclassifyJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  initiatedBy?: string;
}

export interface MailboxReclassifyJobResult {
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  status: "completed" | "cancelled" | "failed";
  queued: number;
  skipped: number;
  errorMessage?: string;
}

export interface MailboxHistoricalImportJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  importId: string;
  /**
   * By count: 1…250.
   * Since date: 0 (HISTORICAL_IMPORT_UNLIMITED) — import all pages since date.
   */
  requestedLimit: number;
  /** ISO timestamp — when set, import messages received on/after this instant. */
  sinceDate?: string;
  initiatedBy?: string;
}

export interface MailboxHistoricalImportJobResult {
  workspaceId: string;
  inboxConnectionId: string;
  importId: string;
  processedCount: number;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  businessCount: number;
  personalCount: number;
  status: "COMPLETED" | "FAILED";
  errorMessage?: string;
}

/** Manual classification of already-stored inline images. Does not change attachment bytes. */
export interface InlineImageRelevanceJobPayload {
  workspaceId: string;
  initiatedBy?: string;
  /** Re-call vision for images that already have this analyzer version. */
  force?: boolean;
  /** Exclusive cursor. The next page starts after this attachment id. */
  afterAttachmentId?: string | null;
  page?: number;
  /** Ties continuation pages to one manual run so a finished run can start again. */
  runId?: string;
}

export interface InlineImageRelevanceJobResult {
  workspaceId: string;
  analyzed: number;
  reused: number;
  failed: number;
  unsupported: number;
  remaining: number;
  deterministic: number;
  hashHuman: number;
  hashModel: number;
  vision: number;
  uncertain: number;
  relevant: number;
  noise: number;
  visionCalls: number;
  inputTokens: number;
  outputTokens: number;
  continued: boolean;
}

export interface AttachmentIngestJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  /** Optional hint; worker loads provider message id from EmailMessage when omitted. */
  providerMessageId?: string;
}

export interface AttachmentIngestResult {
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  status:
    | "skipped_no_inspect"
    | "skipped_no_token"
    | "skipped_unsupported_provider"
    | "listed_empty"
    | "completed"
    | "completed_with_failures"
    | "list_failed";
  listedCount: number;
  uploadedCount: number;
  skippedExistingCount: number;
  failedCount: number;
  missingContentIds: string[];
  errorMessage?: string;
}

export interface ProjectFolderEmailAnalyzeJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  initiatedBy?: string;
}

export interface ProjectFolderEmailAnalyzeProgress {
  foldersTotal: number;
  foldersDone: number;
  currentFolderName: string | null;
  processed: number;
  created: number;
  existing: number;
  assigned: number;
  classifyQueued: number;
  classifySkipped: number;
  attachmentQueued: number;
  conflicts: number;
  failed: number;
  unavailable: number;
}

export interface ProjectFolderEmailAnalyzeJobResult {
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  progress: ProjectFolderEmailAnalyzeProgress;
  errorMessage?: string;
}

