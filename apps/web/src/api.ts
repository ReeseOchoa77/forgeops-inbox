const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options?.headers as Record<string, string> ?? {}) },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SessionResponse {
  authenticated: boolean;
  accessRevoked?: boolean;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null } | null;
  memberships: Array<{ id: string; role: string; workspace: { id: string; name: string; slug: string } }>;
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
  emailType: string;
  priority: string | null;
  summary: string | null;
  confidence: number;
  requiresReview: boolean;
  reviewStatus: string;
  containsActionRequest: boolean;
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
  classification: Classification | null;
  taskCandidate: TaskSummary | null;
}

export interface Participant { name: string | null; email: string; role: string }

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
    sentAt: string;
    receivedAt: string | null;
    priority: string | null;
    itemStatus: string;
    hasAttachments: boolean;
    labelIds: string[];
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

export const api = {
  getSession: () => request<SessionResponse>('/auth/session'),

  logout: () => request<{ status: string }>('/auth/logout', { method: 'POST' }),

  getConnections: (workspaceId: string) =>
    request<{ connections: ConnectionSummary[] }>(`/workspaces/${workspaceId}/inbox-connections`),

  getMessages: (workspaceId: string, connectionId: string, page = 1, pageSize = 25) =>
    request<{ messages: MessageSummary[]; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number } }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages?page=${page}&pageSize=${pageSize}`
    ),

  getMessageDetail: (workspaceId: string, connectionId: string, messageId: string) =>
    request<{ data: MessageDetail }>(
      `/workspaces/${workspaceId}/inbox-connections/${connectionId}/messages/${messageId}`
    ),

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

  disconnectConnection: (workspaceId: string, connectionId: string) =>
    request<{ status: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}`, {
      method: 'DELETE'
    }),

  syncConnection: (workspaceId: string, connectionId: string, wait = true) =>
    request<{ status: string; jobId: string; sync?: unknown }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/sync?wait=${wait}`, {
      method: 'POST',
      body: '{}'
    }),

  analyzeConnection: (workspaceId: string, connectionId: string, wait = true) =>
    request<{ status: string; jobId: string; analysis?: unknown }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/analyze?wait=${wait}`, {
      method: 'POST',
      body: '{}'
    }),

  reconnectConnection: (workspaceId: string, connectionId: string) =>
    request<{ status: string; authorizationUrl: string }>(`/workspaces/${workspaceId}/inbox-connections/${connectionId}/reconnect`, {
      method: 'POST',
      body: '{}'
    }),

  startInboxConnection: (workspaceId: string, provider: 'google' | 'outlook') =>
    request<{ status: string; authorizationUrl: string }>(`/workspaces/${workspaceId}/inbox-connections/${provider}/start`, {
      method: 'POST',
      body: '{}'
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
    })
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
