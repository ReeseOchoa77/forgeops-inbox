import type { TaskListFilters, TaskListItem } from './api'

export type TasksListCacheEntry = {
  tasks: TaskListItem[]
  page: number
  totalCount: number
  totalPages: number
  cachedAt: number
}

const TTL_MS = 45_000
const MAX_ENTRIES = 12
const cache = new Map<string, TasksListCacheEntry>()

export function tasksListFilterFingerprint(filters: TaskListFilters = {}): string {
  return [
    filters.statusFilter ?? 'OPEN',
    filters.due ?? 'ALL',
    filters.priority ?? 'ALL',
    filters.source ?? 'ALL',
    filters.emailClassification ?? 'ALL',
    filters.businessTypeKey ?? '',
    filters.sender ?? '',
    filters.direction ?? 'ALL',
    filters.jobId ?? '',
    filters.sort ?? 'DUE_DATE',
    filters.dateRange ?? '',
    filters.timezone ?? '',
  ].join('|')
}

export function tasksListCacheKey(
  workspaceId: string,
  connectionId: string,
  page = 1,
  filters: TaskListFilters = {}
): string {
  return `${workspaceId}:${connectionId}:${tasksListFilterFingerprint(filters)}:${page}`
}

export function getCachedTasksList(
  workspaceId: string,
  connectionId: string,
  page = 1,
  filters: TaskListFilters = {}
): TasksListCacheEntry | null {
  const key = tasksListCacheKey(workspaceId, connectionId, page, filters)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry
}

export function setCachedTasksList(
  workspaceId: string,
  connectionId: string,
  page: number,
  entry: Omit<TasksListCacheEntry, 'cachedAt'>,
  filters: TaskListFilters = {}
): void {
  const now = Date.now()
  for (const [k, e] of cache) {
    if (now - e.cachedAt > TTL_MS) cache.delete(k)
  }
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest == null) break
    cache.delete(oldest)
  }
  cache.set(tasksListCacheKey(workspaceId, connectionId, page, filters), {
    ...entry,
    cachedAt: now,
  })
}

export function invalidateTasksListCache(
  workspaceId: string,
  connectionId?: string
): void {
  const prefix = connectionId
    ? `${workspaceId}:${connectionId}:`
    : `${workspaceId}:`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

export function clearTasksListCacheForTests(): void {
  cache.clear()
}
