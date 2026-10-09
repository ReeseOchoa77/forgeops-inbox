import type { TaskListFilters, TaskListItem } from './api'

export type TasksListCacheEntry = {
  tasks: TaskListItem[]
  page: number
  totalCount: number | null
  totalPages: number | null
  hasMore: boolean
  cachedAt: number
}

const TTL_MS = 60_000
/** Soft-revalidate but skip network when entry is newer than this. */
export const TASKS_LIST_FRESH_MS = 12_000
const MAX_ENTRIES = 24
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
    filters.pinnedOnly ? 'PINNED' : '',
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

/** Pinned-first then keep relative order of unpinned / among-pinned. */
export function sortTasksPinnedFirst(tasks: TaskListItem[]): TaskListItem[] {
  return [...tasks].sort((a, b) => {
    const ap = Boolean(a.task.isPinned)
    const bp = Boolean(b.task.isPinned)
    if (ap && !bp) return -1
    if (!ap && bp) return 1
    return 0
  })
}

/**
 * Patch pin state across every cached page/filter for this mailbox.
 * Unpinned items are removed from pinnedOnly caches.
 */
export function patchCachedTasksListPin(input: {
  workspaceId: string
  connectionId: string
  taskId: string
  isPinned: boolean
}): TaskListItem[] | null {
  const prefix = `${input.workspaceId}:${input.connectionId}:`
  const now = Date.now()
  let firstPageMessages: TaskListItem[] | null = null

  for (const [key, entry] of [...cache.entries()]) {
    if (!key.startsWith(prefix)) continue
    // Fingerprint ends with `|PINNED` then `:page` — e.g. `...|PINNED:1`.
    const isPinnedOnly = /\|PINNED:\d+$/.test(key)
    let next = entry.tasks.map((t) =>
      t.task.id === input.taskId
        ? { ...t, task: { ...t.task, isPinned: input.isPinned } }
        : t
    )
    if (!input.isPinned && isPinnedOnly) {
      next = next.filter((t) => t.task.id !== input.taskId)
    }
    next = sortTasksPinnedFirst(next)
    cache.set(key, { ...entry, tasks: next, cachedAt: now })
    if (key.endsWith(':1') && firstPageMessages == null) {
      firstPageMessages = next
    }
  }

  return firstPageMessages
}

export function clearTasksListCacheForTests(): void {
  cache.clear()
}
