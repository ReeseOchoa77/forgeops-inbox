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
