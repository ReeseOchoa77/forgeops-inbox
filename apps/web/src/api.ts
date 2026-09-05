const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

/** API error that preserves status/code/cause for SCHEMA_DRIFT diagnosis. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly causePayload?: unknown
  readonly stage?: string
  readonly errorName?: string

  constructor(input: {
    message: string
    status: number
    code?: string
    cause?: unknown
    stage?: string
    errorName?: string
  }) {
    super(input.message)
    this.name = 'ApiRequestError'
    this.status = input.status
    if (input.code !== undefined) this.code = input.code
    if (input.cause !== undefined) this.causePayload = input.cause
    if (input.stage !== undefined) this.stage = input.stage
    if (input.errorName !== undefined) this.errorName = input.errorName
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> ?? {})
  };

  if (options?.body) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: res.statusText }))) as {
      message?: string
      error?: string
      code?: string
      cause?: unknown
      stage?: string
      name?: string
    }
    throw new ApiRequestError({
      message: body.message ?? body.error ?? `Request failed: ${res.status}`,
      status: res.status,
      ...(body.code ? { code: body.code } : {}),
      ...(body.cause !== undefined ? { cause: body.cause } : {}),
      ...(body.stage ? { stage: body.stage } : {}),
      ...(body.name ? { errorName: body.name } : {}),
    })
  }
  return res.json() as Promise<T>;
}

export interface SessionResponse {
  authenticated: boolean;
  accessRevoked?: boolean;
  microsoftAuthAvailable?: boolean;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; isPlatformAdmin?: boolean; platformRole?: string } | null;
  memberships: Array<{
    id: string;
    role: string;
    workspaceRole: string;
    pinnedInboxConnectionId?: string | null;
    workspace: { id: string; name: string; slug: string };
  }>;
}

export type AuthorizationStatus =
  | 'REQUIRED'
  | 'CONNECTED'
  | 'REAUTHORIZATION_REQUIRED';

export interface InboxConnectionCapabilities {
  emailIngestion: boolean;
  directProviderAccess: boolean;
  attachmentIngestion: boolean;
  emailSending: boolean;
}

export interface ConnectionSummary {
  id: string
  provider: string
  email: string
  displayName: string | null
  status: string
  connectedAt: string | null
  lastSyncedAt: string | null
  lastProcessedAt?: string | null
  lastReceivedAt?: string | null
  lastSyncError?: string | null
  ingestionSource?: 'NATIVE' | 'N8N' | 'SHADOW'
  nativeListeningEnabled?: boolean
  listenIncoming?: boolean
  listenSent?: boolean
  excludeJunk?: boolean
  excludeTrash?: boolean
  /** Derived OAuth capability — never token material. */
  authorizationStatus: AuthorizationStatus
  capabilities: InboxConnectionCapabilities
  counts: { messages: number; threads: number }
}

export interface MailboxListenerSettings {
  connectionId: string
  email: string
  provider: string
  status: string
  ingestionSource: 'NATIVE' | 'N8N' | 'SHADOW'
  processingMode: 'NATIVE' | 'N8N' | 'SHADOW'
  shadowSupported: boolean
  nativeListeningEnabled: boolean
  listener: {
    listenIncoming: boolean
    listenSent: boolean
    excludeJunk: boolean
    excludeTrash: boolean
  }
  activity: {
    lastSyncedAt: string | null
    lastReceivedAt: string | null
    lastProcessedAt: string | null
    lastError: string | null
  }
}

export interface MailboxHistoricalImportStatus {
  id: string
  workspaceId: string
  inboxConnectionId: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string
  requestedLimit: number
  sinceDate: string | null
  processedCount: number
  importedCount: number
  duplicateCount: number
  businessCount: number
  personalCount: number
  failedCount: number
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface EmailContactSuggestion {
  name: string | null;
  email: string;
  organization: string | null;
  source: 'CONTACT' | 'CUSTOMER' | 'VENDOR' | 'MEMBER' | 'EMAIL_HISTORY';
}

export interface Classification {
  id: string;
  businessCategory: string | null;
  emailType: string;
  priority: string | null;
  summary: string | null;
  confidence: number;
  requiresReview: boolean;
  reviewStatus: string;
  containsActionRequest: boolean;
  businessTypeKey: string | null;
  businessTypeConfidence: number | null;
  /** Legacy weighted or new flags+cumulative evidence JSON from n8n. */
  classificationEvidence: Record<string, unknown> | null;
  routingHints?: Record<string, unknown> | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  summary: string | null;
  assigneeGuess: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  confidence: number;
  requiresReview: boolean;
  reviewStatus: string;
  isPinned?: boolean;
  createdAt: string;
  /** Canonical timeline date (email date for email-sourced tasks). */
  sourceDate?: string;
}

export interface MessageJobSummary {
  id: string;
  jobNumber: string | null;
  name: string;
  status: string;
}

export interface MessageSummary {
  id: string;
  providerMessageId: string;
  providerThreadId: string;
  subject: string | null;
  snippet: string | null;
  senderName: string | null;
  senderEmail: string;
  receivedAt: string | null;
  sentAt: string;
  priority: string | null;
  itemStatus: string;
  isRead: boolean;
  isImportant: boolean;
  isSpam: boolean;
  isTrashed: boolean;
  isPinned?: boolean;
  hasAttachments?: boolean;
  mailboxCategory: 'BUSINESS' | 'PERSONAL' | 'SPAM' | 'TRASH';
  previousCategory?: 'BUSINESS' | 'PERSONAL' | 'SPAM' | 'TRASH' | null;
  /** Owning mailbox — present on All Mailboxes list rows. */
  inboxConnectionId?: string;
  classification: Classification | null;
  taskCandidate: TaskSummary | null;
  job?: MessageJobSummary | null;
  jobAssignmentSource?: string | null;
  jobAssignmentIsManual?: boolean;
  jobMatchConfidence?: number | null;
  classificationStatus?: 'PENDING' | 'PROCESSING' | 'CLASSIFIED' | 'FAILED' | null;
  classificationLastAttemptAt?: string | null;
  classificationAttemptCount?: number;
  classificationError?: string | null;
}

export interface Participant { name: string | null; email: string; role: string }

export interface AttachmentMeta {
  attachmentId: string | null;
  contentId: string | null;
  filename: string | null;
  inline: boolean;
  mimeType: string | null;
  size: number | null;
}

export interface ThreadMessage {
  id: string;
  providerMessageId: string;
  providerThreadId: string;
  subject: string | null;
  senderName: string | null;
  senderEmail: string;
  toAddresses: Array<{ name: string | null; email: string }>;
  ccAddresses: Array<{ name: string | null; email: string }>;
  bccAddresses: Array<{ name: string | null; email: string }>;
  replyToAddresses: Array<{ name: string | null; email: string }>;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  bodyTruncated?: boolean;
  labelIds: string[];
  hasAttachments: boolean;
  attachmentMetadata: AttachmentMeta[];
  sentAt: string;
  receivedAt: string | null;
  priority: string | null;
  itemStatus: string;
  mailboxCategory?: string | null;
  previousCategory?: string | null;
  jobAssignmentSource?: string | null;
  jobAssignmentIsManual?: boolean;
  jobMatchConfidence?: number | null;
  job?: { id: string; jobNumber: string; name: string; status: string } | null;
  classification: Classification | null;
  taskCandidate: TaskSummary | null;
}

export interface ThreadDetail {
  thread: { id: string; providerThreadId: string; subject: string | null; normalizedSubject: string | null; messageCount: number };
  messages: ThreadMessage[];
}

export interface MessageDetail {
  message: {
    id: string;
    providerMessageId: string;
    providerThreadId: string;
    subject: string | null;
    senderName: string | null;
    senderEmail: string;
    toAddresses: Array<{ name: string | null; email: string }>;
    ccAddresses: Array<{ name: string | null; email: string }>;
    bodyText: string | null;
    bodyHtml: string | null;
    sentAt: string;
    receivedAt: string | null;
    priority: string | null;
    itemStatus: string;
    hasAttachments: boolean;
    attachmentMetadata: AttachmentMeta[];
    labelIds: string[];
    mailboxCategory: 'BUSINESS' | 'PERSONAL' | 'SPAM' | 'TRASH';
    previousCategory?: 'BUSINESS' | 'PERSONAL' | 'SPAM' | 'TRASH' | null;
  };
  thread: { id: string; providerThreadId: string; subject: string | null; normalizedSubject: string | null; messageCount: number };
  normalizedEmail: {
    cleanTextBody: string | null;
    sender: Participant;
    recipients: Participant[];
    labelHints: string[];
    categoryHints: string[];
    senderDomain: string | null;
  } | null;
  classification: Classification | null;
  taskCandidate: TaskSummary | null;
  job?: MessageJobSummary | null;
  jobAssignmentSource?: string | null;
  jobAssignmentIsManual?: boolean;
  jobMatchConfidence?: number | null;
}

export interface ReviewItem {
  message: MessageSummary;
  reviewReasons: string[];
}

export interface ClassificationAuditItem {
  classificationId: string;
  messageId: string;
  inboxConnectionId: string;
  mailboxEmail: string | null;
  date: string;
  senderName: string | null;
  senderEmail: string;
  subject: string | null;
  snippet: string | null;
  predictedCategory: string;
  finalCategory: string;
  businessTypeKey?: string | null;
  priority?: string | null;
  job?: { id: string; jobNumber: string | null; name: string } | null;
  confidence: number;
  reviewStatus: string;
  historyStatus?: 'AUTO' | 'CONFIRMED' | 'CORRECTED' | 'DISMISSED';
  /** @deprecated alias of historyStatus — never NEEDS_REVIEW */
  auditStatus: 'AUTO' | 'CONFIRMED' | 'CORRECTED' | 'DISMISSED' | string;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ClassificationInspection {
  classification: {
    id: string;
    messageId: string;
    mailboxCategory: string | null;
    businessTypeKey: string | null;
    businessTypeConfidence: number | null;
    priority: string | null;
    confidence: number;
    containsActionRequest: boolean;
    summary: string | null;
    modelName: string | null;
    modelVersion: string | null;
    reviewStatus: string;
    historyStatus: 'AUTO' | 'CONFIRMED' | 'CORRECTED' | 'DISMISSED';
    createdAt: string;
    processedAt: string | null;
  };
  decision: {
    rule: string | null;
    title: string | null;
    summary: string | null;
    category: 'BUSINESS' | 'PERSONAL' | null;
    format: string | null;
    cumulative: {
      contentPoints: number | null;
      subjectPoints: number | null;
      jobPoints: number | null;
      senderAdjustment: number | null;
      total: number | null;
      threshold: number | null;
    } | null;
  } | null;
  signals: Array<{
    key: string;
    label: string;
    direction: 'BUSINESS' | 'PERSONAL' | null;
    probabilityPct: number | null;
    strongFlag: boolean | null;
    points: number | null;
    explanation: string | null;
    includedInDecision: boolean;
    status: string | null;
    cumulativeAdjustment: number | null;
  }>;
  priorityDecision: {
    displayLabel: string;
    reason: string;
    jobConfidencePct: number | null;
    jobThresholdPct: number | null;
    actionRequestedLabel: string | null;
    deadlineLabel: string | null;
    showJobConfidence: boolean;
    showActionRequested: boolean;
    showDeadline: boolean;
  } | null;
  entities: {
    customer: { id: string; name: string } | null;
    vendor: { id: string; name: string } | null;
    job: { id: string; jobNumber: string | null; name: string } | null;
    entityMatchConfidence: number | null;
    matchEvidence: unknown[];
  };
  jobAssociation:
    | {
        status: 'CONFIRMED';
        jobId: string;
        jobNumber: string | null;
        name: string;
        decisionEffect: string;
        source: string;
        forcedDecision: boolean;
      }
    | { status: 'NONE' };
  jobCandidate:
    | {
        status: 'CANDIDATE';
        confidencePct: number | null;
        explanation: string | null;
        hintedJobId: string | null;
      }
    | { status: 'NONE' };
  tasks: Array<{
    id: string;
    title: string;
    summary: string | null;
    dueAt: string | null;
    priority: string;
    status: string;
    confidence: number;
  }>;
  senderEvidence: {
    email: string;
    status: string;
    confidence: number;
    displayName: string | null;
    businessEvidenceCount: number;
    personalEvidenceCount: number;
    manualBusinessConfirmations: number;
    manualPersonalConfirmations: number;
  } | null;
  domainEvidence: {
    domain: string;
    status: string;
    confidence: number;
    isPublicDomain: boolean;
    businessEvidenceCount: number;
    personalEvidenceCount: number;
  } | null;
  corrections: Array<{
    id: string;
    originalMailboxCategory: string | null;
    correctedMailboxCategory: string | null;
    originalBusinessType: string | null;
    correctedBusinessType: string | null;
    originalJobId: string | null;
    correctedJobId: string | null;
    originalPriority: string | null;
    correctedPriority: string | null;
    reason: string | null;
    reviewedAt: string;
  }>;
  email: {
    fromName: string | null;
    fromEmail: string;
    to: unknown;
    subject: string | null;
    date: string | null;
    snippet: string | null;
    bodyText?: string | null;
  };
  availableStages: string[];
}

export interface TaskListItem {
  task: TaskSummary;
  sourceMessage: { id: string; subject: string | null; senderEmail: string; receivedAt: string | null } | null;
  classification: Classification | null;
}

export interface ApprovedAccessEntry {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedBy: { id: string; email: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredFolderItem {
  id: string;
  workspaceId: string;
  mailboxEmail: string;
  inboxConnectionId?: string | null;
  provider: string;
  providerFolderId: string;
  parentProviderFolderId: string | null;
  folderPath: string | null;
  rawFolderName: string;
  normalizedFolderName: string;
  detectedJobNumber: string | null;
  detectedJobName: string | null;
  matchedJobId: string | null;
  matchedJob: { id: string; name: string; jobNumber: string | null; status?: string } | null;
  status: 'DISCOVERED' | 'MATCHED' | 'APPROVED' | 'IGNORED' | 'ARCHIVED';
  matchConfidence?: number | string | null;
  matchReason?: string | null;
  missingFromProvider?: boolean;
  childFolderCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  approvedAt: string | null;
  approvedByUserId: string | null;
  ignoredAt: string | null;
  ignoredByUserId: string | null;
  createdAt: string;
}

export interface ProjectFolderScanSummary {
  status?: string;
  projectsRoot: { id: string; path: string; displayName: string };
  totalUnderProjects: number;
  candidates: number;
  created: number;
  updated: number;
  missingMarked: number;
  verified: number;
  suggested: number;
  unmatched: number;
}

export interface FolderSummaryMetrics {
  total: number;
  discovered: number;
  matched: number;
  approved: number;
  ignored: number;
  archived: number;
  lastSyncAt: string | null;
  mailboxes: string[];
}

export interface FolderDetailResponse {
  folder: DiscoveredFolderItem;
  auditHistory: Array<{
    id: string;
    action: string;
    actorUser: { id: string; email: string; name: string | null } | null;
    metadata: unknown;
    createdAt: string;
  }>;
  alias: { id: string; alias: string; normalizedAlias: string; createdAt: string } | null;
}

export interface JobFolderRootItem {
  id: string;
  workspaceId: string;
  rootName: string;
  normalizedName: string;
  mailboxEmail: string | null;
  folderPath: string | null;
  active: boolean;
  createdAt: string;
}

export interface CalendarJobBadge {
  id: string;
  name: string;
  jobNumber: string | null;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  type: string;
  source: string;
  externalEventId?: string | null;
  linkedJobId: string | null;
  linkedTaskId: string | null;
  linkedEmailMessageId: string | null;
  linkedJob: CalendarJobBadge | null;
  createdByUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarTaskDueItem {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: null;
  allDay: true;
  type: 'TASK';
  source: 'FORGEOPS';
  linkedJobId: string | null;
  linkedTaskId: string;
  linkedEmailMessageId: string | null;
  linkedJob: CalendarJobBadge | null;
  taskStatus?: string;
  taskPriority?: string;
}

export type CalendarFeedItem =
  | (CalendarEventItem & { kind: 'event' })
  | (CalendarTaskDueItem & { kind: 'task' });

export const api = {
  getSession: () => request<SessionResponse>('/auth/session'),

  logout: () => request<{ status: string }>('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),

  getConnections: (workspaceId: string, opts?: { includeCounts?: boolean }) => {
    const q = opts?.includeCounts ? '?includeCounts=true' : '';
    return request<{ connections: ConnectionSummary[] }>(
      `/workspaces/${workspaceId}/inbox-connections${q}`
    );
  },

  getDashboardSummary: (workspaceId: string, inboxConnectionId: string) =>
    request<{
      openTasks: number;
      overdueTasks: number;
      dueToday: number;
      openRequests: number;
      unreadBusiness: number;
      activeJobs: number;
      reviewCount: number;
    }>(
      `/workspaces/${workspaceId}/dashboard-summary?inboxConnectionId=${encodeURIComponent(inboxConnectionId)}`
    ),

  getWorkspacePreferences: (workspaceId: string) =>
    request<{ pinnedInboxConnectionId: string | null }>(
      `/workspaces/${workspaceId}/me/preferences`
    ),

  patchWorkspacePreferences: (
    workspaceId: string,
    body: { pinnedInboxConnectionId: string | null }
  ) =>
    request<{ pinnedInboxConnectionId: string | null }>(
      `/workspaces/${workspaceId}/me/preferences`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  getMailboxListenerSettings: (workspaceId: string, connectionId: string) =>
    request<{ settings: MailboxListenerSettings }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/listener-settings`
    ),

  patchMailboxListenerSettings: (
    workspaceId: string,
    connectionId: string,
    body: Partial<{
      nativeListeningEnabled: boolean
      listenIncoming: boolean
      listenSent: boolean
      excludeJunk: boolean
      excludeTrash: boolean
      ingestionSource: 'NATIVE' | 'N8N' | 'SHADOW'
    }>
  ) =>
    request<{ settings: MailboxListenerSettings }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/listener-settings`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  startHistoricalImport: (
    workspaceId: string,
    connectionId: string,
    body: { preset?: '25' | '50' | '100' | '250'; limit?: number; sinceDate?: string }
  ) =>
    request<{ import: MailboxHistoricalImportStatus; message: string }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/historical-imports`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  getHistoricalImport: (workspaceId: string, connectionId: string, importId: string) =>
    request<{ import: MailboxHistoricalImportStatus }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/historical-imports/${importId}`
    ),

  listHistoricalImports: (workspaceId: string, connectionId: string) =>
    request<{ imports: MailboxHistoricalImportStatus[] }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/historical-imports`
    ),

  getUnclassifiedCount: (workspaceId: string, connectionId: string) =>
    request<{ eligibleCount: number }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/unclassified-count`
    ),

  requeueUnclassified: (
    workspaceId: string,
    connectionId: string,
    body?: { limit?: number }
  ) =>
    request<{
      eligibleCount: number
      enqueuedCount: number
      skippedCount: number
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/requeue-unclassified`,
      { method: 'POST', body: JSON.stringify(body ?? {}) }
    ),

  reclassifyMeta: (workspaceId: string, connectionId: string) =>
    request<{
      mailbox: {
        id: string
        email: string
        provider: string
        ingestionSource: string
        status: string
      }
      businessSubtypeKeys: string[]
      priorityValues: string[]
    }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/reclassify/meta`),

  reclassifySearchSenders: (
    workspaceId: string,
    connectionId: string,
    q: string
  ) =>
    request<{ senders: Array<{ senderEmail: string; count: number }> }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/reclassify/senders?q=${encodeURIComponent(q)}`
    ),

  reclassifyPreview: (
    workspaceId: string,
    connectionId: string,
    body: {
      filters: Record<string, unknown>
      messageIds?: string[]
      taskMode?: 'REMOVE_ONLY' | 'REGENERATE'
    }
  ) =>
    request<{
      totalMatched: number
      classifierTasksToRemove: number
      taskMode: 'REMOVE_ONLY' | 'REGENERATE'
      breakdown: {
        byProcessingStatus: Record<string, number>
        byMailboxCategory: Record<string, number>
        read: number
        unread: number
      }
      sample: Array<{
        id: string
        subject: string | null
        senderEmail: string
        receivedAt: string | null
        sentAt: string
        mailboxCategory: string
        classificationStatus: string | null
        priority: string | null
        jobId: string | null
        businessTypeKey: string | null
        isRead: boolean
      }>
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/reclassify/preview`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  reclassifyStart: (
    workspaceId: string,
    connectionId: string,
    body: {
      filters: Record<string, unknown>
      messageIds?: string[]
      taskMode?: 'REMOVE_ONLY' | 'REGENERATE'
      confirm: true
    }
  ) =>
    request<{
      run: {
        id: string
        status: string
        taskMode: string
        totalMatched: number
        queued: number
        completed: number
        failed: number
        skipped: number
        tasksRemoved: number
        tasksGenerated: number
        taskPersistFailures: number
      }
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/reclassify/runs`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  reclassifyGetRun: (
    workspaceId: string,
    connectionId: string,
    runId: string
  ) =>
    request<{
      run: {
        id: string
        status: string
        taskMode: string
        totalMatched: number
        queued: number
        completed: number
        failed: number
        skipped: number
        tasksRemoved: number
        tasksGenerated: number
        taskPersistFailures: number
        errorMessage: string | null
        startedAt: string | null
        completedAt: string | null
        createdAt: string
      }
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/reclassify/runs/${runId}`
    ),

  reclassifyCancel: (
    workspaceId: string,
    connectionId: string,
    runId: string
  ) =>
    request<{ run: { id: string; status: string } }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/reclassify/runs/${runId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  retryClassification: (workspaceId: string, messageId: string) =>
    request<{
      messageId: string
      outcome: 'queued' | 'already_processing' | 'already_classified' | 'failed_to_enqueue'
    }>(
      `/workspaces/${workspaceId}/messages/${messageId}/retry-classification`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  retryClassificationBulk: (
    workspaceId: string,
    body: {
      inboxConnectionId?: string
      messageIds?: string[]
      allUnclassified?: boolean
      limit?: number
    }
  ) =>
    request<{
      totalFound: number
      queued: number
      alreadyProcessing: number
      alreadyClassified: number
      failed: number
    }>(
      `/workspaces/${workspaceId}/retry-classification`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  clearInbox: (workspaceId: string, connectionId: string) =>
    request<{
      status: string
      deletedCount: number
      inboxClearedAt: string
      listenerEnabled: boolean
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/clear-inbox`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  getMessages: (workspaceId: string, connectionId: string, page = 1, pageSize = 25, filters?: {
    search?: string;
    searchIn?: 'all' | 'sender' | 'id';
    businessCategory?: 'BUSINESS' | 'NON_BUSINESS';
    classificationType?: string;
    hasTaskCandidate?: boolean;
    category?: 'important' | 'spam' | 'trash';
    businessTypeGroup?: string;
    businessTypeKey?: string;
    jobId?: string;
    reclassifiedOnly?: boolean;
    sentOnly?: boolean;
    unreadOnly?: boolean;
    unclassifiedOnly?: boolean;
    dateRange?: 'TODAY' | 'WEEK' | 'MONTH';
    timezone?: string;
    includeTotal?: boolean;
  }) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters?.search) params.set('search', filters.search);
    if (filters?.searchIn && filters.searchIn !== 'all') params.set('searchIn', filters.searchIn);
    if (filters?.businessCategory) params.set('businessCategory', filters.businessCategory);
    if (filters?.classificationType) params.set('classificationType', filters.classificationType);
    if (filters?.hasTaskCandidate !== undefined) params.set('hasTaskCandidate', String(filters.hasTaskCandidate));
    if (filters?.category) params.set('category', filters.category);
    if (filters?.businessTypeGroup) params.set('businessTypeGroup', filters.businessTypeGroup);
    if (filters?.businessTypeKey) params.set('businessTypeKey', filters.businessTypeKey);
    if (filters?.jobId) params.set('jobId', filters.jobId);
    if (filters?.reclassifiedOnly) params.set('reclassifiedOnly', 'true');
    if (filters?.sentOnly) params.set('sentOnly', 'true');
    if (filters?.unreadOnly) params.set('unreadOnly', 'true');
    if (filters?.unclassifiedOnly) params.set('unclassifiedOnly', 'true');
    if (filters?.dateRange) params.set('dateRange', filters.dateRange);
    if (filters?.timezone) params.set('timezone', filters.timezone);
    if (filters?.includeTotal) params.set('includeTotal', 'true');
    return request<{
      messages: MessageSummary[];
      pagination: {
        page: number;
        pageSize: number;
        totalCount: number | null;
        totalPages: number | null;
        hasMore: boolean;
      };
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages?${params.toString()}`
    );
  },

  markAsRead: (workspaceId: string, connectionId: string, messageId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}/read`, {
      method: 'PATCH',
      body: JSON.stringify({})
    }),

  trashMessage: (workspaceId: string, connectionId: string, messageId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}/trash`, {
      method: 'PATCH',
      body: JSON.stringify({})
    }),

  trashPersonalMessages: (workspaceId: string, connectionId: string, opts?: {
    search?: string;
    messageIds?: string[];
  }) =>
    request<{ status: string; trashed: number }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/trash-personal`,
      { method: 'PATCH', body: JSON.stringify(opts ?? {}) }
    ),

  untrashMessage: (workspaceId: string, connectionId: string, messageId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}/untrash`, {
      method: 'PATCH',
      body: JSON.stringify({})
    }),

  pinMessage: (workspaceId: string, connectionId: string, messageId: string, pinned: boolean) =>
    request<{ id: string; isPinned: boolean }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned })
    }),

  pinTask: (workspaceId: string, taskId: string, pinned: boolean) =>
    request<{ id: string; isPinned: boolean }>(`/workspaces/${workspaceId}/tasks/${taskId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned })
    }),

  confirmSenderEvidence: (workspaceId: string, senderEmail: string, senderName: string | null, classification: 'BUSINESS' | 'PERSONAL') =>
    request<{ status: string }>(`/workspaces/${workspaceId}/sender-evidence/confirm-by-email`, {
      method: 'POST',
      body: JSON.stringify({ senderEmail, senderName, classification })
    }),

  reclassifyMessage: (workspaceId: string, messageId: string, data: {
    mailboxCategory: 'BUSINESS' | 'PERSONAL';
    businessType?: string | null;
    customerId?: string | null;
    vendorId?: string | null;
    jobId?: string | null;
    priority?: string;
    reason?: string;
  }) =>
    request<{ status: string; from: string; to: string }>(`/workspaces/${workspaceId}/messages/${messageId}/reclassify`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  getCorrections: (workspaceId: string, messageId: string) =>
    request<{ corrections: Array<Record<string, unknown>> }>(`/workspaces/${workspaceId}/messages/${messageId}/corrections`),

  getMessageDetail: (workspaceId: string, connectionId: string, messageId: string) =>
    request<{ data: MessageDetail }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}`
    ),

  getThreadMessages: (workspaceId: string, connectionId: string, threadId: string, expandAll?: boolean) =>
    request<ThreadDetail>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/threads/${threadId}/messages${expandAll ? '?expandAll=true' : ''}`
    ),

  getMessageThread: (workspaceId: string, connectionId: string, messageId: string) =>
    request<ThreadDetail>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}/thread`
    ),

  getAttachmentUrl: (workspaceId: string, connectionId: string, messageId: string, attachmentId: string) =>
    `${BASE}/workspaces/${encodeURIComponent(workspaceId)}/inbox-connections/${encodeURIComponent(connectionId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/download`,

  getTasks: (
    workspaceId: string,
    connectionId: string,
    page = 1,
    pageSize = 25,
    filters?: {
      dateRange?: 'TODAY' | 'WEEK' | 'MONTH'
      timezone?: string
    }
  ) => {
    const p = new URLSearchParams()
    p.set('page', String(page))
    p.set('pageSize', String(pageSize))
    if (filters?.dateRange) p.set('dateRange', filters.dateRange)
    if (filters?.timezone) p.set('timezone', filters.timezone)
    return request<{
      tasks: TaskListItem[]
      pagination: { page: number; totalCount: number; totalPages: number }
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/tasks?${p}`
    )
  },

  getReviewQueue: (workspaceId: string, connectionId: string, page = 1) =>
    request<{ items: ReviewItem[]; pagination: { page: number; totalCount: number; totalPages: number }; thresholds: { classification: number; task: number } }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/review?page=${page}&pageSize=25`
    ),

  getClassificationAudit: (
    workspaceId: string,
    connectionId: string,
    opts?: {
      page?: number;
      pageSize?: number;
      status?: 'ALL' | 'CORRECTED' | 'CONFIRMED';
      category?: 'ALL' | 'BUSINESS' | 'PERSONAL';
    }
  ) => {
    const p = new URLSearchParams();
    p.set('page', String(opts?.page ?? 1));
    p.set('pageSize', String(opts?.pageSize ?? 50));
    if (opts?.status) p.set('status', opts.status);
    if (opts?.category) p.set('category', opts.category);
    return request<{
      summary: { total: number; corrected: number; confirmed: number };
      pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
      filters: { status: string; category: string };
      items: ClassificationAuditItem[];
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/classification-audit?${p.toString()}`
    );
  },

  getClassificationInspection: (
    workspaceId: string,
    connectionId: string,
    classificationId: string,
    opts?: { includeBody?: boolean }
  ) => {
    const p = new URLSearchParams();
    if (opts?.includeBody) p.set('includeBody', 'true');
    const q = p.toString();
    return request<ClassificationInspection>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/classification-audit/${classificationId}${q ? `?${q}` : ''}`
    );
  },

  reviewClassification: (workspaceId: string, classificationId: string, reviewStatus: 'APPROVED' | 'REJECTED') =>
    request<{ status: string }>(`/workspaces/${workspaceId}/classifications/${classificationId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewStatus })
    }),

  reviewTask: (workspaceId: string, taskId: string, reviewStatus: 'APPROVED' | 'REJECTED') =>
    request<{ status: string }>(`/workspaces/${workspaceId}/tasks/${taskId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewStatus })
    }),

  getApprovedAccess: (workspaceId: string) =>
    request<{ entries: ApprovedAccessEntry[] }>(`/workspaces/${workspaceId}/approved-access`),

  addApprovedAccess: (workspaceId: string, email: string, role = 'MEMBER') =>
    request<{ status: string; entry: ApprovedAccessEntry }>(`/workspaces/${workspaceId}/approved-access`, {
      method: 'POST',
      body: JSON.stringify({ email, role })
    }),

  revokeApprovedAccess: (workspaceId: string, accessId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/approved-access/${accessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'REVOKED' })
    }),

  updateAccessRole: (workspaceId: string, accessId: string, role: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/approved-access/${accessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    }),

  disconnectConnection: (workspaceId: string, connectionId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}`, {
      method: 'DELETE'
    }),

  /**
   * Manual native inbox sync. Backend contract is POST only
   * (`POST /api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/sync`).
   * GET is not registered and returns Fastify "Route not found".
   */
  syncConnection: (workspaceId: string, connectionId: string, wait = true) =>
    request<{ status: string; jobId: string; sync?: unknown }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/sync?wait=${wait}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    ),

  analyzeConnection: (workspaceId: string, connectionId: string, wait = true) =>
    request<{ status: string; jobId: string; analysis?: unknown }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/analyze?wait=${wait}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    ),

  reconnectConnection: (workspaceId: string, connectionId: string) =>
    request<{ status: string; authorizationUrl: string; flow?: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/reconnect`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  /** Targeted Microsoft OAuth for an existing tokenless (e.g. n8n) Outlook connection. */
  authorizeConnection: (workspaceId: string, connectionId: string) =>
    request<{ status: string; authorizationUrl: string; flow?: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/authorize`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  /** Register a monitored mailbox for an active team member (ADMIN/OWNER). Does not start OAuth. */
  registerMonitoredMailbox: (
    workspaceId: string,
    body: { email: string; provider: 'GMAIL' | 'OUTLOOK'; displayName?: string }
  ) =>
    request<{
      alreadyExists: boolean
      connection: {
        id: string
        workspaceId: string
        provider: string
        email: string
        displayName: string | null
        status: string
        ingestionSource: 'NATIVE' | 'N8N' | 'SHADOW'
        nativeListeningEnabled: boolean
        authorizationStatus: AuthorizationStatus
        capabilities: InboxConnectionCapabilities
      }
    }>(`/workspaces/${workspaceId}/monitored-mailboxes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  startInboxConnection: (workspaceId: string, provider: 'google' | 'outlook') =>
    request<{ status: string; authorizationUrl: string }>(`/workspaces/${workspaceId}/inbox-connections/${provider}/start`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  importCsv: (workspaceId: string, entity: 'customers' | 'vendors' | 'jobs', csvText: string) =>
    fetch(`${BASE}/workspaces/${workspaceId}/import/${entity}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/csv' },
      body: csvText
    }).then(async res => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Import failed');
      return body as ImportResult;
    }),

  importJson: (workspaceId: string, entity: 'customers' | 'vendors' | 'jobs', rows: Array<Record<string, unknown>>) =>
    request<ImportResult>(`/workspaces/${workspaceId}/import/${entity}`, {
      method: 'POST',
      body: JSON.stringify({ rows })
    }),

  sendMessage: async (
    workspaceId: string,
    connectionId: string,
    payload: {
      action: 'reply' | 'forward' | 'new';
      originalMessageId?: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      body: string;
      bodyFormat?: 'text' | 'html';
      files?: File[];
      /** Non-inline EmailAttachment IDs to include (forward). */
      existingAttachmentIds?: string[];
    }
  ) => {
    const files = payload.files ?? [];
    const existingIds = payload.existingAttachmentIds ?? [];
    const useMultipart = files.length > 0 || existingIds.length > 0;

    if (!useMultipart) {
      return request<{
        status: string;
        action: string;
        providerMessageId: string;
        emailMessageId?: string | null;
        attachmentCount?: number;
      }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/send`, {
        method: 'POST',
        body: JSON.stringify({
          action: payload.action,
          originalMessageId: payload.originalMessageId,
          to: payload.to,
          cc: payload.cc ?? [],
          bcc: payload.bcc ?? [],
          subject: payload.subject,
          body: payload.body,
          bodyFormat: payload.bodyFormat ?? 'html',
        }),
      });
    }

    const form = new FormData();
    form.append('action', payload.action);
    if (payload.originalMessageId) {
      form.append('originalMessageId', payload.originalMessageId);
    }
    form.append('to', JSON.stringify(payload.to));
    form.append('cc', JSON.stringify(payload.cc ?? []));
    form.append('bcc', JSON.stringify(payload.bcc ?? []));
    form.append('subject', payload.subject);
    form.append('body', payload.body);
    form.append('bodyFormat', payload.bodyFormat ?? 'html');
    if (existingIds.length > 0) {
      form.append('existingAttachmentIds', JSON.stringify(existingIds));
    }
    for (const file of files) {
      form.append('file', file, file.name);
    }

    const res = await fetch(
      `${BASE}/workspaces/${workspaceId}/inbox-connections/${connectionId}/send`,
      { method: 'POST', credentials: 'include', body: form }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? `Send failed: ${res.status}`);
    }
    return res.json() as Promise<{
      status: string;
      action: string;
      providerMessageId: string;
      emailMessageId?: string | null;
      attachmentCount?: number;
    }>;
  },

  getSendableMailboxes: (workspaceId: string) =>
    request<{
      mailboxes: Array<{
        id: string;
        email: string;
        displayName: string | null;
        provider: string;
      }>;
    }>(`/workspaces/${workspaceId}/sendable-mailboxes`),

  searchEmailContacts: (workspaceId: string, q: string, limit = 10) =>
    request<{
      contacts: EmailContactSuggestion[];
    }>(
      `/workspaces/${workspaceId}/email-contacts?q=${encodeURIComponent(q)}&limit=${limit}`
    ),

  getCalendar: (workspaceId: string, from: string, to: string) =>
    request<{
      from: string;
      to: string;
      events: CalendarEventItem[];
      taskDueItems: CalendarTaskDueItem[];
    }>(
      `/workspaces/${workspaceId}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),

  createCalendarEvent: (
    workspaceId: string,
    data: {
      title: string;
      description?: string | null;
      startAt: string;
      endAt?: string | null;
      allDay?: boolean;
      type?: 'MEETING' | 'EVENT' | 'NOTE' | 'DEADLINE';
      linkedJobId?: string | null;
    }
  ) =>
    request<{ event: CalendarEventItem }>(`/workspaces/${workspaceId}/calendar/events`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCalendarEvent: (
    workspaceId: string,
    eventId: string,
    data: Partial<{
      title: string;
      description: string | null;
      startAt: string;
      endAt: string | null;
      allDay: boolean;
      type: 'MEETING' | 'EVENT' | 'NOTE' | 'DEADLINE';
      linkedJobId: string | null;
    }>
  ) =>
    request<{ event: CalendarEventItem }>(
      `/workspaces/${workspaceId}/calendar/events/${eventId}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    ),

  deleteCalendarEvent: (workspaceId: string, eventId: string) =>
    fetch(`${BASE}/workspaces/${workspaceId}/calendar/events/${eventId}`, {
      method: 'DELETE',
      credentials: 'include',
    }).then(async (res) => {
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message ?? 'Delete failed');
      }
    }),

  aiExtract: async (workspaceId: string, file: File): Promise<ExtractionResult> => {
    const contentType = file.type === 'application/pdf' ? 'application/pdf'
      : file.name.endsWith('.csv') ? 'text/csv'
      : 'text/plain';

    const body = contentType === 'application/pdf'
      ? await file.arrayBuffer()
      : await file.text();

    const res = await fetch(`${BASE}/workspaces/${workspaceId}/import/extract`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': contentType },
      body
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Extraction failed');
    }

    const data = await res.json();
    return data.extraction as ExtractionResult;
  },

  uploadWorkspaceDocument: async (
    workspaceId: string,
    file: File,
    opts?: { linkedJobId?: string; runAiAnalysis?: boolean }
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.linkedJobId) form.append('linkedJobId', opts.linkedJobId);
    if (opts?.runAiAnalysis) form.append('runAiAnalysis', 'true');
    const res = await fetch(`${BASE}/workspaces/${workspaceId}/documents/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Upload failed');
    }
    return res.json() as Promise<{
      document: {
        id: string;
        filename: string;
        mimeType: string;
        status: string;
        processingStatus: string;
        aiAnalysisStatus: string;
        linkedJobId: string | null;
        extractedTextAvailable: boolean;
        sourceType: string;
      };
    }>;
  },

  adminGetWorkspaces: () =>
    request<{ workspaces: AdminWorkspace[] }>('/admin/workspaces'),

  adminCreateWorkspace: (name: string, slug: string) =>
    request<{ workspace: { id: string; name: string; slug: string } }>('/admin/workspaces', {
      method: 'POST', body: JSON.stringify({ name, slug })
    }),

  adminDeleteWorkspace: (workspaceId: string) =>
    request<{ status: string }>(`/admin/workspaces/${workspaceId}`, { method: 'DELETE' }),

  adminGetMailboxes: (opts?: { workspaceId?: string }) => {
    const p = new URLSearchParams();
    if (opts?.workspaceId) p.set('workspaceId', opts.workspaceId);
    const q = p.toString();
    return request<{ mailboxes: AdminMailbox[] }>(
      `/admin/mailboxes${q ? `?${q}` : ''}`
    );
  },

  adminRegisterMailbox: (data: { workspaceId: string; provider: string; email: string; ingestionSource?: string }) =>
    request<{ mailbox: { id: string; workspaceId: string; provider: string; email: string; status: string; ingestionMode: string } }>('/admin/mailboxes', {
      method: 'POST', body: JSON.stringify(data)
    }),

  adminPauseMailbox: (mailboxId: string) =>
    request<{ status: string }>(`/admin/mailboxes/${mailboxId}/pause`, { method: 'PATCH', body: JSON.stringify({}) }),

  adminResumeMailbox: (mailboxId: string) =>
    request<{ status: string }>(`/admin/mailboxes/${mailboxId}/resume`, { method: 'PATCH', body: JSON.stringify({}) }),

  adminChangeIngestionMode: (mailboxId: string, ingestionSource: 'NATIVE' | 'N8N') =>
    request<{ status: string }>(`/admin/mailboxes/${mailboxId}/ingestion-mode`, {
      method: 'PATCH', body: JSON.stringify({ ingestionSource })
    }),

  adminGetMembers: (workspaceId: string) =>
    request<{ members: AdminMember[] }>(`/admin/workspaces/${workspaceId}/members`),

  // Jobs
  getJobs: (workspaceId: string, params?: {
    page?: number; pageSize?: number; status?: string; customerId?: string;
    search?: string; assignedUserId?: string; hasOverdueTasks?: boolean;
    showArchived?: boolean; sortBy?: string; sortDir?: string;
  }) => {
    const p = new URLSearchParams();
    if (params?.page) p.set('page', String(params.page));
    if (params?.pageSize) p.set('pageSize', String(params.pageSize));
    if (params?.status) p.set('status', params.status);
    if (params?.customerId) p.set('customerId', params.customerId);
    if (params?.search) p.set('search', params.search);
    if (params?.assignedUserId) p.set('assignedUserId', params.assignedUserId);
    if (params?.hasOverdueTasks) p.set('hasOverdueTasks', 'true');
    if (params?.showArchived) p.set('showArchived', 'true');
    if (params?.sortBy) p.set('sortBy', params.sortBy);
    if (params?.sortDir) p.set('sortDir', params.sortDir);
    return request<{ jobs: JobSummary[]; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number } }>(
      `/workspaces/${workspaceId}/jobs?${p.toString()}`
    );
  },

  getJobsLookup: (workspaceId: string, params?: { showArchived?: boolean; search?: string }) => {
    const p = new URLSearchParams();
    if (params?.showArchived) p.set('showArchived', 'true');
    if (params?.search) p.set('search', params.search);
    return request<{ jobs: JobLookup[] }>(
      `/workspaces/${workspaceId}/jobs/lookup?${p.toString()}`
    );
  },

  createJob: (workspaceId: string, data: {
    jobNumber: string; name: string; status?: string; customerId?: string | null;
    description?: string; notes?: string; startDate?: string; targetCompletionDate?: string;
    memberUserIds?: string[]; aliases?: string[];
  }) => request<{ job: JobDetail }>(`/workspaces/${workspaceId}/jobs`, {
    method: 'POST', body: JSON.stringify(data)
  }),

  previewJobImport: async (workspaceId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/workspaces/${workspaceId}/jobs/import/preview`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json() as Promise<JobImportPreviewResponse>;
  },

  confirmJobImport: (
    workspaceId: string,
    body: {
      filename?: string;
      rows: Array<{
        rowIndex: number;
        import: boolean;
        date?: string | null;
        jobNumber: string;
        name: string;
        rawCustomerName?: string | null;
        customerAction: 'LINK' | 'CREATE' | 'NONE';
        customerId?: string | null;
      }>;
    }
  ) =>
    request<{
      importRunId: string;
      status: string;
      createdCount: number;
      skippedCount: number;
      errorCount: number;
      errors: Array<{ rowIndex: number; error: string }>;
      createdJobs: Array<{ id: string; jobNumber: string; name: string }>;
    }>(`/workspaces/${workspaceId}/jobs/import/confirm`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getJob: (workspaceId: string, jobId: string) =>
    request<{ job: JobDetail }>(`/workspaces/${workspaceId}/jobs/${jobId}`),

  updateJob: (workspaceId: string, jobId: string, data: {
    name?: string; jobNumber?: string; status?: string; customerId?: string | null;
    description?: string; notes?: string; startDate?: string | null; targetCompletionDate?: string | null;
  }) => request<{ job: JobDetail }>(`/workspaces/${workspaceId}/jobs/${jobId}`, {
    method: 'PUT', body: JSON.stringify(data)
  }),

  archiveJob: (workspaceId: string, jobId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/archive`, {
      method: 'POST', body: JSON.stringify({})
    }),

  restoreJob: (workspaceId: string, jobId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/restore`, {
      method: 'POST', body: JSON.stringify({})
    }),

  assignEmailToJob: (workspaceId: string, jobId: string, data: { messageId?: string; threadId?: string }) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/emails`, {
      method: 'POST', body: JSON.stringify(data)
    }),

  removeEmailFromJob: (workspaceId: string, jobId: string, messageId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/emails/${messageId}`, {
      method: 'DELETE'
    }),

  moveEmailToJob: (workspaceId: string, jobId: string, data: { messageId: string; targetJobId: string }) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/emails/move`, {
      method: 'POST', body: JSON.stringify(data)
    }),

  getJobEmails: (workspaceId: string, jobId: string, page = 1, pageSize = 25) =>
    request<{ emails: JobEmail[]; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number } }>(
      `/workspaces/${workspaceId}/jobs/${jobId}/emails?page=${page}&pageSize=${pageSize}`
    ),

  getJobTasks: (workspaceId: string, jobId: string) =>
    request<{ tasks: JobTask[] }>(`/workspaces/${workspaceId}/jobs/${jobId}/tasks`),

  getJobDocuments: (
    workspaceId: string,
    jobId: string,
    params?: {
      type?: 'ALL' | 'IMAGES' | 'PDF' | 'SPREADSHEETS' | 'DOCUMENTS' | 'OTHER';
      sort?: 'newest' | 'oldest';
      page?: number;
      pageSize?: number;
    }
  ) => {
    const p = new URLSearchParams();
    if (params?.type && params.type !== 'ALL') p.set('type', params.type);
    if (params?.sort) p.set('sort', params.sort);
    if (params?.page) p.set('page', String(params.page));
    if (params?.pageSize) p.set('pageSize', String(params.pageSize));
    const qs = p.toString();
    return request<{
      files: JobLibraryFile[];
      documents: JobDocument[];
      pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
      filters: { type: string; sort: string };
    }>(`/workspaces/${workspaceId}/jobs/${jobId}/documents${qs ? `?${qs}` : ''}`);
  },

  previewTaskBulkDelete: (
    workspaceId: string,
    connectionId: string,
    before: string,
    timezone?: string
  ) => {
    const p = new URLSearchParams({ before });
    if (timezone) p.set('timezone', timezone);
    return request<{
      count: number;
      before: string;
      timezone: string;
      cutoffAt: string;
      dateField: 'sourceDate' | 'createdAt';
      keepRule: string;
    }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/tasks/bulk-delete-preview?${p}`
    );
  },

  bulkDeleteTasks: (
    workspaceId: string,
    connectionId: string,
    before: string,
    timezone?: string
  ) =>
    request<{
      deleted: number;
      before: string;
      timezone: string;
      cutoffAt: string;
      dateField: 'sourceDate' | 'createdAt';
    }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/tasks/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify({ before, timezone: timezone ?? 'UTC' }),
    }),

  getJobFiles: (workspaceId: string, jobId: string, folderId?: string | null) => {
    const q = folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''
    return request<{
      folderId: string | null
      breadcrumb: Array<{ id: string; name: string }>
      folders: JobFileFolder[]
      files: JobStoredFile[]
    }>(`/workspaces/${workspaceId}/jobs/${jobId}/files${q}`)
  },

  createJobFolder: (workspaceId: string, jobId: string, data: { name: string; parentFolderId?: string | null }) =>
    request<{ folder: { id: string; name: string; parentFolderId: string | null; createdAt: string } }>(
      `/workspaces/${workspaceId}/jobs/${jobId}/folders`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  renameJobFolder: (workspaceId: string, jobId: string, folderId: string, name: string) =>
    request<{ folder: { id: string; name: string; parentFolderId: string | null; createdAt: string } }>(
      `/workspaces/${workspaceId}/jobs/${jobId}/folders/${folderId}`,
      { method: 'PATCH', body: JSON.stringify({ name }) }
    ),

  deleteJobFolder: async (workspaceId: string, jobId: string, folderId: string) => {
    const res = await fetch(`${BASE}/workspaces/${workspaceId}/jobs/${jobId}/folders/${folderId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`)
    }
  },

  uploadJobFile: async (workspaceId: string, jobId: string, file: File, folderId?: string | null) => {
    const form = new FormData()
    form.append('file', file)
    if (folderId) form.append('folderId', folderId)
    const res = await fetch(`${BASE}/workspaces/${workspaceId}/jobs/${jobId}/files`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(body.message ?? body.error ?? `Upload failed: ${res.status}`)
    }
    return res.json() as Promise<{ file: JobStoredFile }>
  },

  updateJobFile: (workspaceId: string, jobId: string, fileId: string, data: { folderId?: string | null; filename?: string }) =>
    request<{ file: JobStoredFile }>(`/workspaces/${workspaceId}/jobs/${jobId}/files/${fileId}`, {
      method: 'PATCH', body: JSON.stringify(data)
    }),

  deleteJobFile: async (workspaceId: string, jobId: string, fileId: string) => {
    const res = await fetch(`${BASE}/workspaces/${workspaceId}/jobs/${jobId}/files/${fileId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`)
    }
  },

  getJobFileDownloadUrl: (workspaceId: string, jobId: string, fileId: string) =>
    `${BASE}/workspaces/${workspaceId}/jobs/${jobId}/files/${fileId}/download`,

  getJobActivity: (workspaceId: string, jobId: string, page = 1) =>
    request<{ activity: JobActivity[]; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number } }>(
      `/workspaces/${workspaceId}/jobs/${jobId}/activity?page=${page}&pageSize=50`
    ),

  addJobMember: (workspaceId: string, jobId: string, userId: string, role?: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/members`, {
      method: 'POST', body: JSON.stringify({ userId, role })
    }),

  removeJobMember: (workspaceId: string, jobId: string, userId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/members/${userId}`, {
      method: 'DELETE'
    }),

  addJobAlias: (workspaceId: string, jobId: string, alias: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/aliases`, {
      method: 'POST', body: JSON.stringify({ alias })
    }),

  removeJobAlias: (workspaceId: string, jobId: string, aliasId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/jobs/${jobId}/aliases/${aliasId}`, {
      method: 'DELETE'
    }),

  getEmailAttachments: (workspaceId: string, emailId: string) =>
    request<{ attachments: StoredAttachment[] }>(`/workspaces/${workspaceId}/emails/${emailId}/attachments`),

  getStoredAttachmentDownloadUrl: (workspaceId: string, attachmentId: string, inline = false) =>
    `${BASE}/workspaces/${workspaceId}/attachments/${attachmentId}/download${inline ? '?inline=true' : ''}`,

  getCustomers: (workspaceId: string) =>
    request<{ customers: CustomerSummary[] }>(`/workspaces/${workspaceId}/reference/customers`),

  getWorkspaceMembers: (workspaceId: string) =>
    request<{ members: WorkspaceMemberSummary[] }>(`/admin/workspaces/${workspaceId}/members`),

  // Discovered Folders
  getDiscoveredFolders: (workspaceId: string, params?: {
    status?: string; mailboxEmail?: string; connectionId?: string; search?: string; hasMatch?: boolean;
    root?: string; page?: number; pageSize?: number;
  }) => {
    const p = new URLSearchParams();
    if (params?.status) p.set('status', params.status);
    if (params?.mailboxEmail) p.set('mailboxEmail', params.mailboxEmail);
    if (params?.connectionId) p.set('connectionId', params.connectionId);
    if (params?.search) p.set('search', params.search);
    if (params?.hasMatch !== undefined) p.set('hasMatch', String(params.hasMatch));
    if (params?.root) p.set('root', params.root);
    if (params?.page) p.set('page', String(params.page));
    if (params?.pageSize) p.set('pageSize', String(params.pageSize));
    return request<{
      folders: DiscoveredFolderItem[];
      pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
      summary: FolderSummaryMetrics;
    }>(
      `/workspaces/${workspaceId}/discovered-folders?${p.toString()}`
    );
  },

  getDiscoveredFolderDetail: (workspaceId: string, folderId: string) =>
    request<FolderDetailResponse>(`/workspaces/${workspaceId}/discovered-folders/${folderId}`),

  matchDiscoveredFolder: (workspaceId: string, folderId: string, jobId: string) =>
    request<{ status: string; matchStatus?: string; matchedJobId: string }>(
      `/workspaces/${workspaceId}/discovered-folders/${folderId}/match`,
      { method: 'POST', body: JSON.stringify({ jobId }) }
    ),

  unmatchDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string; matchStatus?: string; matchedJobId: null }>(
      `/workspaces/${workspaceId}/discovered-folders/${folderId}/unmatch`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  scanProjectFolders: (workspaceId: string, connectionId: string) =>
    request<ProjectFolderScanSummary>(`/workspaces/${workspaceId}/project-folders/scan`, {
      method: 'POST',
      body: JSON.stringify({ connectionId }),
    }),

  analyzeProjectFolderEmails: (
    workspaceId: string,
    connectionId: string,
    folderIds?: string[]
  ) =>
    request<{ status: string; runId: string }>(
      `/workspaces/${workspaceId}/project-folders/analyze-emails`,
      {
        method: 'POST',
        body: JSON.stringify({
          connectionId,
          ...(folderIds && folderIds.length > 0 ? { folderIds } : {}),
        }),
      }
    ),

  getProjectFolderEmailAnalyzeRun: (workspaceId: string, runId: string) =>
    request<{
      run: {
        id: string;
        status: string;
        progress: {
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
        };
        errorMessage: string | null;
        startedAt: string | null;
        completedAt: string | null;
      };
    }>(`/workspaces/${workspaceId}/project-folders/analyze-emails/${runId}`),

  getVerifiedProjectFolders: (
    workspaceId: string,
    params?: { connectionId?: string; mailboxEmail?: string }
  ) => {
    const p = new URLSearchParams();
    if (params?.connectionId) p.set('connectionId', params.connectionId);
    if (params?.mailboxEmail) p.set('mailboxEmail', params.mailboxEmail);
    const q = p.toString();
    return request<{ folders: DiscoveredFolderItem[] }>(
      `/workspaces/${workspaceId}/project-folders/verified${q ? `?${q}` : ''}`
    );
  },

  /** Active Jobs with no SUGGESTED/VERIFIED DiscoveredFolder for this mailbox. */
  getJobsWithoutProjectFolder: (
    workspaceId: string,
    connectionId: string,
    pageSize = 200
  ) => {
    const p = new URLSearchParams({
      connectionId,
      pageSize: String(pageSize),
    });
    return request<{ total: number; jobsTotal?: number; jobs: JobLookup[] }>(
      `/workspaces/${workspaceId}/project-folders/jobs-without-folder?${p.toString()}`
    );
  },

  approveDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/approve`, {
      method: 'POST', body: JSON.stringify({})
    }),

  createJobFromFolder: (workspaceId: string, folderId: string, jobData?: {
    jobNumber?: string; name?: string; status?: string; customerId?: string;
    description?: string; startDate?: string; targetCompletionDate?: string;
  }) =>
    request<{ status: string; job: { id: string; name: string; jobNumber: string | null } }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/create-job`, {
      method: 'POST', body: JSON.stringify(jobData ?? {})
    }),

  ignoreDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/ignore`, {
      method: 'POST', body: JSON.stringify({})
    }),

  restoreDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/restore`, {
      method: 'POST', body: JSON.stringify({})
    }),

  archiveDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/archive`, {
      method: 'POST', body: JSON.stringify({})
    }),

  deleteDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}`, {
      method: 'DELETE'
    }),

  clearDiscoveredFolders: (workspaceId: string) =>
    request<{ status: string; deletedFolders: number; deletedAliases: number }>(
      `/workspaces/${workspaceId}/discovered-folders`,
      { method: 'DELETE' }
    ),

  // Job Folder Roots
  getJobFolderRoots: (workspaceId: string) =>
    request<{ roots: JobFolderRootItem[] }>(`/workspaces/${workspaceId}/job-folder-roots`),

  addJobFolderRoot: (workspaceId: string, data: { rootName: string; mailboxEmail?: string; providerFolderId?: string; folderPath?: string; folderName?: string }) =>
    request<{ root: JobFolderRootItem }>(`/workspaces/${workspaceId}/job-folder-roots`, {
      method: 'POST', body: JSON.stringify(data)
    }),

  removeJobFolderRoot: (workspaceId: string, rootId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/job-folder-roots/${rootId}`, {
      method: 'DELETE'
    }),
};

export interface ImportResult {
  status: string;
  entity: string;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

export interface ExtractedRecord {
  name: string;
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
  company?: string | null;
  jobNumber?: string | null;
  notes?: string | null;
}

export interface ExtractionResult {
  inferredType: 'customer' | 'vendor' | 'contact' | 'job' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  records: ExtractedRecord[];
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  createdAt: string;
  counts: { members: number; connections: number; messages: number };
}

export interface AdminMailbox {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  provider: string;
  email: string;
  displayName: string | null;
  status: string;
  ingestionMode: string;
  nativeListeningEnabled?: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  lastError: string | null;
  counts: { messages: number; threads: number };
}

export interface AdminMember {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isPlatformAdmin: boolean;
  lastLoginAt: string | null;
  memberSince: string;
}

export interface JobLookup {
  id: string;
  jobNumber: string | null;
  name: string;
  status: string;
  customerName?: string | null;
}

export interface JobLibraryFile {
  id: string;
  filename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  date: string;
  sourceType: 'EMAIL_ATTACHMENT' | 'JOB_UPLOAD';
  fileType: 'IMAGES' | 'PDF' | 'SPREADSHEETS' | 'DOCUMENTS' | 'OTHER';
  emailId: string | null;
  emailSubject: string | null;
  sender: string | null;
  folderId: string | null;
  previewable: boolean;
}

export interface JobSummary {
  id: string;
  jobNumber: string | null;
  name: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  description: string | null;
  startDate: string | null;
  targetCompletionDate: string | null;
  archivedAt: string | null;
  createdAt: string;
  emailCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  lastActivityAt: string | null;
  nextDueDate: string | null;
  assignedMembers: Array<{ userId: string; name: string | null; email: string; role: string | null }>;
}

export interface JobDetail extends JobSummary {
  notes: string | null;
  externalRef: string | null;
  completedTaskCount: number;
  recentEmails7d: number;
  recentEmails30d: number;
  attachmentCount: number;
  members: Array<{ id: string; userId: string; name: string | null; email: string; role: string | null; createdAt: string }>;
  aliases: Array<{ id: string; alias: string; normalizedAlias: string }>;
}

export interface JobImportPreviewRow {
  rowIndex: number;
  date: string | null;
  jobNumber: string;
  name: string;
  rawCustomerName: string | null;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  customerStatus: 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'EMPTY';
  customerCandidates: Array<{ id: string; name: string; score: number }>;
  status: 'READY' | 'EXISTING' | 'CONFLICT' | 'CUSTOMER_NOT_FOUND' | 'CUSTOMER_AMBIGUOUS' | 'INVALID';
  selected: boolean;
  existingJobId: string | null;
  existingJobName: string | null;
  errors: string[];
  warnings: string[];
  lowConfidence: boolean;
}

export interface JobImportPreviewResponse {
  filename: string;
  sheetName: string | null;
  warnings: string[];
  dateFieldMapping: string;
  summary: {
    total: number;
    ready: number;
    existing: number;
    conflict: number;
    customerReview: number;
    invalid: number;
  };
  rows: JobImportPreviewRow[];
  customers: Array<{ id: string; name: string }>;
}

export interface JobEmail {
  id: string;
  threadId: string;
  inboxConnectionId: string;
  subject: string | null;
  senderName: string | null;
  senderEmail: string;
  sentAt: string;
  receivedAt: string | null;
  snippet?: string | null;
  hasAttachments?: boolean;
  isRead?: boolean;
  mailboxCategory: string;
  jobAssignmentSource: string | null;
  jobAssignmentIsManual: boolean;
  classification?: Classification | null;
}

export interface JobFileFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  childFolderCount: number;
  fileCount: number;
}

export interface JobStoredFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
  uploadStatus: string;
  createdAt: string;
  createdByUserId: string | null;
}

export interface JobTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  assigneeGuess: string | null;
  createdAt: string;
}

export interface JobDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  emailSubject: string | null;
  emailSenderEmail: string;
  emailMessageId?: string;
  source?: 'email';
  createdAt: string;
}

export interface JobActivity {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  previousValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface StoredAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  isInline: boolean;
  contentId: string | null;
  uploadStatus: 'PENDING' | 'UPLOADED' | 'FAILED' | 'REJECTED';
  createdAt: string;
}

export interface CustomerSummary {
  id: string;
  name: string;
  normalizedName: string;
  primaryEmail: string | null;
  domain: string | null;
}

export interface WorkspaceMemberSummary {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
}
