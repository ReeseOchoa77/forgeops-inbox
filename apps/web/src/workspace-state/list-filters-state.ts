import {
  asBoolean,
  clearWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
} from './storage'

export const BIDDING_STATE_VERSION = 1
export const BIDDING_SURFACE = 'bidding-filters'

export type BiddingPersistedState = {
  search: string
  quoteFilter: string
  dueSoon: boolean
  includeArchived: boolean
}

export function validateBiddingState(raw: unknown): BiddingPersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.search !== 'string' || o.search.length > 200) return null
  if (typeof o.quoteFilter !== 'string' || o.quoteFilter.length > 40) return null
  const dueSoon = asBoolean(o.dueSoon)
  const includeArchived = asBoolean(o.includeArchived)
  if (dueSoon == null || includeArchived == null) return null
  return {
    search: o.search,
    quoteFilter: o.quoteFilter,
    dueSoon,
    includeArchived,
  }
}

export function loadBiddingState(input: {
  workspaceId: string
  userId: string
}): BiddingPersistedState | null {
  return loadWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: BIDDING_SURFACE,
    version: BIDDING_STATE_VERSION,
    validate: validateBiddingState,
  })
}

export function persistBiddingState(input: {
  workspaceId: string
  userId: string
  state: BiddingPersistedState
}): void {
  saveWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: BIDDING_SURFACE,
    version: BIDDING_STATE_VERSION,
    data: input.state,
  })
}

export function clearBiddingState(input: { workspaceId: string; userId: string }): void {
  clearWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: BIDDING_SURFACE,
  })
}

export const TASKS_STATE_VERSION = 1
export const TASKS_SURFACE = 'tasks-filters'

export type TasksPersistedState = {
  statusFilter: string
  due: string
  priority: string
  source: string
  ownershipView: string
  direction: string
  pinnedOnly: boolean
  sort: string
  jobId: string
}

export function validateTasksState(raw: unknown): TasksPersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const str = (k: string, max: number) =>
    typeof o[k] === 'string' && (o[k] as string).length <= max ? (o[k] as string) : null
  const statusFilter = str('statusFilter', 20)
  const due = str('due', 20)
  const priority = str('priority', 20)
  const source = str('source', 40)
  const ownershipView = str('ownershipView', 20)
  const direction = str('direction', 20)
  const sort = str('sort', 40)
  const jobId = str('jobId', 80)
  const pinnedOnly = asBoolean(o.pinnedOnly)
  if (
    !statusFilter ||
    !due ||
    !priority ||
    !source ||
    !ownershipView ||
    !direction ||
    !sort ||
    jobId == null ||
    pinnedOnly == null
  ) {
    return null
  }
  return {
    statusFilter,
    due,
    priority,
    source,
    ownershipView,
    direction,
    pinnedOnly,
    sort,
    jobId,
  }
}

export function loadTasksState(input: {
  workspaceId: string
  userId: string
}): TasksPersistedState | null {
  return loadWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: TASKS_SURFACE,
    version: TASKS_STATE_VERSION,
    validate: validateTasksState,
  })
}

export function persistTasksState(input: {
  workspaceId: string
  userId: string
  state: TasksPersistedState
}): void {
  saveWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: TASKS_SURFACE,
    version: TASKS_STATE_VERSION,
    data: input.state,
  })
}

export function clearTasksState(input: { workspaceId: string; userId: string }): void {
  clearWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: TASKS_SURFACE,
  })
}
