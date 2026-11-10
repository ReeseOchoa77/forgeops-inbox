import {
  asBoolean,
  asString,
  asStringArray,
  clearWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
} from './storage'

export const INBOX_STATE_VERSION = 1
export const INBOX_SURFACE = 'inbox-filters'

export type InboxPersistedState = {
  inboxTab: string
  readFilter: string
  pinnedOnly: boolean
  priorityKeys: string[]
  jobFilter: string
  businessTypeKey: string
  search: string
  dateRange: string
  /** Participant emails only — rehydrate labels from email. */
  participantEmails: string[]
}

const INBOX_TABS = new Set([
  'ALL_BUSINESS',
  'BIDS_ESTIMATING',
  'PROJECTS',
  'PURCHASING',
  'ACCOUNTING',
  'INTERNAL',
  'OTHER',
  'PERSONAL',
  'TRASH',
  // UNCLASSIFIED intentionally excluded — hidden chrome must not silently restore.
])

const READ_FILTERS = new Set(['', 'unread', 'read', 'sent'])
const DATE_RANGES = new Set(['', 'TODAY', 'WEEK', 'MONTH'])
const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH'])

export function validateInboxState(raw: unknown): InboxPersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const inboxTab = asString(o.inboxTab, 40)
  if (!inboxTab || !INBOX_TABS.has(inboxTab)) return null
  const readFilter = typeof o.readFilter === 'string' ? o.readFilter : null
  if (readFilter == null || !READ_FILTERS.has(readFilter)) return null
  const pinnedOnly = asBoolean(o.pinnedOnly)
  if (pinnedOnly == null) return null
  const priorityKeys = asStringArray(o.priorityKeys, 3, 20)
  if (!priorityKeys || !priorityKeys.every((p) => PRIORITIES.has(p))) return null
  const jobFilter = typeof o.jobFilter === 'string' ? o.jobFilter : null
  if (jobFilter == null || jobFilter.length > 120) return null
  const businessTypeKey = typeof o.businessTypeKey === 'string' ? o.businessTypeKey : null
  if (businessTypeKey == null || businessTypeKey.length > 80) return null
  // Never restore hidden Unclassified filter.
  if (businessTypeKey === 'UNCLASSIFIED') return null
  const search = typeof o.search === 'string' ? o.search : null
  if (search == null || search.length > 200) return null
  const dateRange = typeof o.dateRange === 'string' ? o.dateRange : null
  if (dateRange == null || !DATE_RANGES.has(dateRange)) return null
  const participantEmails = asStringArray(o.participantEmails, 20, 160)
  if (!participantEmails) return null
  return {
    inboxTab,
    readFilter,
    pinnedOnly,
    priorityKeys,
    jobFilter,
    businessTypeKey,
    search,
    dateRange,
    participantEmails,
  }
}

export function loadInboxState(input: {
  workspaceId: string
  userId: string
}): InboxPersistedState | null {
  return loadWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: INBOX_SURFACE,
    version: INBOX_STATE_VERSION,
    validate: validateInboxState,
  })
}

export function persistInboxState(input: {
  workspaceId: string
  userId: string
  state: InboxPersistedState
}): void {
  saveWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: INBOX_SURFACE,
    version: INBOX_STATE_VERSION,
    data: input.state,
  })
}

export function clearInboxState(input: { workspaceId: string; userId: string }): void {
  clearWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: INBOX_SURFACE,
  })
}

export const DEFAULT_INBOX_STATE: InboxPersistedState = {
  inboxTab: 'ALL_BUSINESS',
  readFilter: '',
  pinnedOnly: false,
  priorityKeys: ['LOW', 'NORMAL', 'HIGH'],
  jobFilter: '',
  businessTypeKey: '',
  search: '',
  dateRange: '',
  participantEmails: [],
}
