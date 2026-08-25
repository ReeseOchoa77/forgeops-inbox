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
}

export interface MailboxHistoricalImportJobPayload {
  workspaceId: string;
  inboxConnectionId: string;
  importId: string;
  requestedLimit: number;
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

