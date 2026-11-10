import {
  asBoolean,
  asString,
  clearWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
} from './storage'

export const JOBS_STATE_VERSION = 1
export const JOBS_SURFACE = 'jobs-filters'

export type JobsPersistedState = {
  search: string
  statusFilter: string
  customerFilter: string
  assignedUserFilter: string
  hasOverdueTasks: boolean
  showArchived: boolean
  sortBy: string
  sortDir: 'asc' | 'desc'
}

export function validateJobsState(raw: unknown): JobsPersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const search = typeof o.search === 'string' ? o.search : null
  if (search == null || search.length > 200) return null
  const statusFilter = asString(o.statusFilter, 40)
  if (!statusFilter) return null
  const customerFilter = typeof o.customerFilter === 'string' ? o.customerFilter : null
  if (customerFilter == null || customerFilter.length > 80) return null
  const assignedUserFilter =
    typeof o.assignedUserFilter === 'string' ? o.assignedUserFilter : null
  if (assignedUserFilter == null || assignedUserFilter.length > 80) return null
  const hasOverdueTasks = asBoolean(o.hasOverdueTasks)
  const showArchived = asBoolean(o.showArchived)
  if (hasOverdueTasks == null || showArchived == null) return null
  const sortBy = asString(o.sortBy, 40)
  if (!sortBy) return null
  const sortDir = o.sortDir === 'asc' || o.sortDir === 'desc' ? o.sortDir : null
  if (!sortDir) return null
  return {
    search,
    statusFilter,
    customerFilter,
    assignedUserFilter,
    hasOverdueTasks,
    showArchived,
    sortBy,
    sortDir,
  }
}

export function loadJobsState(input: {
  workspaceId: string
  userId: string
}): JobsPersistedState | null {
  return loadWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: JOBS_SURFACE,
    version: JOBS_STATE_VERSION,
    validate: validateJobsState,
  })
}

export function persistJobsState(input: {
  workspaceId: string
  userId: string
  state: JobsPersistedState
}): void {
  saveWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: JOBS_SURFACE,
    version: JOBS_STATE_VERSION,
    data: input.state,
  })
}

export function clearJobsState(input: { workspaceId: string; userId: string }): void {
  clearWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: JOBS_SURFACE,
  })
}
