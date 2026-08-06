const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';

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
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SessionResponse {
  authenticated: boolean;
  accessRevoked?: boolean;
  microsoftAuthAvailable?: boolean;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; isPlatformAdmin?: boolean; platformRole?: string } | null;
  memberships: Array<{ id: string; role: string; workspaceRole: string; workspace: { id: string; name: string; slug: string } }>;
}

export interface ConnectionSummary {
  id: string;
  provider: string;
  email: string;
  displayName: string | null;
  status: string;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  counts: { messages: number; threads: number };
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
  classificationEvidence: {
    content?: { probability: number; weight: number; contribution: number; explanation: string };
    sender?: { probability: number; weight: number; contribution: number; explanation?: string; status?: string };
    signature?: { probability: number; weight: number; contribution: number; explanation: string };
    job?: { probability: number; weight: number; contribution: number; explanation: string };
    subject?: { probability: number; weight: number; contribution: number; explanation: string };
    finalBusinessProbability?: number;
  } | null;
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
  createdAt: string;
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
  mailboxCategory: 'BUSINESS' | 'PERSONAL' | 'SPAM' | 'TRASH';
  classification: Classification | null;
  taskCandidate: TaskSummary | null;
  job?: MessageJobSummary | null;
  jobAssignmentSource?: string | null;
  jobAssignmentIsManual?: boolean;
  jobMatchConfidence?: number | null;
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
  provider: string;
  providerFolderId: string;
  folderPath: string | null;
  rawFolderName: string;
  normalizedFolderName: string;
  detectedJobNumber: string | null;
  detectedJobName: string | null;
  matchedJobId: string | null;
  matchedJob: { id: string; name: string; jobNumber: string | null } | null;
  status: 'DISCOVERED' | 'MATCHED' | 'APPROVED' | 'IGNORED' | 'ARCHIVED';
  lastSeenAt: string;
  approvedAt: string | null;
  createdAt: string;
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

export const api = {
  getSession: () => request<SessionResponse>('/auth/session'),

  logout: () => request<{ status: string }>('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),

  getConnections: (workspaceId: string) =>
    request<{ connections: ConnectionSummary[] }>(`/workspaces/${workspaceId}/inbox-connections`),

  getMessages: (workspaceId: string, connectionId: string, page = 1, pageSize = 25, filters?: {
    search?: string;
    businessCategory?: 'BUSINESS' | 'NON_BUSINESS';
    classificationType?: string;
    hasTaskCandidate?: boolean;
    category?: 'important' | 'spam' | 'trash';
    businessTypeGroup?: string;
    businessTypeKey?: string;
    jobId?: string;
  }) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters?.search) params.set('search', filters.search);
    if (filters?.businessCategory) params.set('businessCategory', filters.businessCategory);
    if (filters?.classificationType) params.set('classificationType', filters.classificationType);
    if (filters?.hasTaskCandidate !== undefined) params.set('hasTaskCandidate', String(filters.hasTaskCandidate));
    if (filters?.category) params.set('category', filters.category);
    if (filters?.businessTypeGroup) params.set('businessTypeGroup', filters.businessTypeGroup);
    if (filters?.businessTypeKey) params.set('businessTypeKey', filters.businessTypeKey);
    if (filters?.jobId) params.set('jobId', filters.jobId);
    return request<{ messages: MessageSummary[]; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number } }>(
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

  untrashMessage: (workspaceId: string, connectionId: string, messageId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}/untrash`, {
      method: 'PATCH',
      body: JSON.stringify({})
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

  getAttachmentUrl: (workspaceId: string, connectionId: string, messageId: string, attachmentId: string) =>
    `${BASE}/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}/attachments/${attachmentId}/download`,

  getTasks: (workspaceId: string, connectionId: string, page = 1) =>
    request<{ tasks: TaskListItem[]; pagination: { page: number; totalCount: number; totalPages: number } }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/tasks?page=${page}&pageSize=25`
    ),

  getReviewQueue: (workspaceId: string, connectionId: string, page = 1) =>
    request<{ items: ReviewItem[]; pagination: { page: number; totalCount: number; totalPages: number }; thresholds: { classification: number; task: number } }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/review?page=${page}&pageSize=25`
    ),

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

  syncConnection: (workspaceId: string, connectionId: string, wait = true) =>
    request<{ status: string; jobId: string; sync?: unknown }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/sync?wait=${wait}`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  analyzeConnection: (workspaceId: string, connectionId: string, wait = true) =>
    request<{ status: string; jobId: string; analysis?: unknown }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/analyze?wait=${wait}`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  reconnectConnection: (workspaceId: string, connectionId: string) =>
    request<{ status: string; authorizationUrl: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/reconnect`, {
      method: 'POST',
      body: JSON.stringify({})
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

  sendMessage: (workspaceId: string, connectionId: string, payload: {
    action: 'reply' | 'forward' | 'new';
    originalMessageId?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    bodyFormat?: 'text' | 'html';
  }) =>
    request<{ status: string; action: string; providerMessageId: string }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/send`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

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

  adminGetWorkspaces: () =>
    request<{ workspaces: AdminWorkspace[] }>('/admin/workspaces'),

  adminCreateWorkspace: (name: string, slug: string) =>
    request<{ workspace: { id: string; name: string; slug: string } }>('/admin/workspaces', {
      method: 'POST', body: JSON.stringify({ name, slug })
    }),

  adminDeleteWorkspace: (workspaceId: string) =>
    request<{ status: string }>(`/admin/workspaces/${workspaceId}`, { method: 'DELETE' }),

  adminGetMailboxes: () =>
    request<{ mailboxes: AdminMailbox[] }>('/admin/mailboxes'),

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

  getJobEmails: (workspaceId: string, jobId: string, page = 1) =>
    request<{ emails: JobEmail[]; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number } }>(
      `/workspaces/${workspaceId}/jobs/${jobId}/emails?page=${page}&pageSize=25`
    ),

  getJobTasks: (workspaceId: string, jobId: string) =>
    request<{ tasks: JobTask[] }>(`/workspaces/${workspaceId}/jobs/${jobId}/tasks`),

  getJobDocuments: (workspaceId: string, jobId: string) =>
    request<{ documents: JobDocument[] }>(`/workspaces/${workspaceId}/jobs/${jobId}/documents`),

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
    status?: string; mailboxEmail?: string; search?: string; page?: number; pageSize?: number;
  }) => {
    const p = new URLSearchParams();
    if (params?.status) p.set('status', params.status);
    if (params?.mailboxEmail) p.set('mailboxEmail', params.mailboxEmail);
    if (params?.search) p.set('search', params.search);
    if (params?.page) p.set('page', String(params.page));
    if (params?.pageSize) p.set('pageSize', String(params.pageSize));
    return request<{ folders: DiscoveredFolderItem[]; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number } }>(
      `/workspaces/${workspaceId}/discovered-folders?${p.toString()}`
    );
  },

  matchDiscoveredFolder: (workspaceId: string, folderId: string, jobId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/match`, {
      method: 'POST', body: JSON.stringify({ jobId })
    }),

  approveDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/approve`, {
      method: 'POST', body: JSON.stringify({})
    }),

  createJobFromFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string; jobId: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/create-job`, {
      method: 'POST', body: JSON.stringify({})
    }),

  ignoreDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/ignore`, {
      method: 'POST', body: JSON.stringify({})
    }),

  restoreDiscoveredFolder: (workspaceId: string, folderId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/discovered-folders/${folderId}/restore`, {
      method: 'POST', body: JSON.stringify({})
    }),

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

export interface JobEmail {
  id: string;
  subject: string | null;
  senderName: string | null;
  senderEmail: string;
  sentAt: string;
  receivedAt: string | null;
  mailboxCategory: string;
  jobAssignmentSource: string | null;
  jobAssignmentIsManual: boolean;
  classification: Classification | null;
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
