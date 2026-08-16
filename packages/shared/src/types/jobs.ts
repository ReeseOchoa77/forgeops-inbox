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
