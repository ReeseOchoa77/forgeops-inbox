import type { JobSummary } from './api'

export type JobsListCacheEntry = {
  jobs: JobSummary[]
  page: number
  totalCount: number
  hasMore: boolean
  cachedAt: number
}

const TTL_MS = 45_000
const MAX_ENTRIES = 16

const cache = new Map<string, JobsListCacheEntry>()

export function jobsListCacheKey(
  workspaceId: string,
  params: {
    page?: number
    status?: string
    search?: string
    showArchived?: boolean
    customerId?: string
    assignedUserId?: string
    hasOverdueTasks?: boolean
    sortBy?: string
    sortDir?: string
  }
): string {
  return [
    workspaceId,
    params.page ?? 1,
    params.status ?? '',
    params.search ?? '',
    params.showArchived ? '1' : '0',
    params.customerId ?? '',
    params.assignedUserId ?? '',
    params.hasOverdueTasks ? '1' : '0',
    params.sortBy ?? 'createdAt',
    params.sortDir ?? 'desc',
  ].join('|')
}

function prune(now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > TTL_MS) cache.delete(key)
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest == null) break
    cache.delete(oldest)
  }
}

export function getCachedJobsList(key: string): JobsListCacheEntry | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry
}

export function setCachedJobsList(
  key: string,
  entry: Omit<JobsListCacheEntry, 'cachedAt'>
): void {
  const now = Date.now()
  prune(now)
  cache.set(key, { ...entry, cachedAt: now })
}

export function invalidateJobsListCache(workspaceId?: string): void {
  if (!workspaceId) {
    cache.clear()
    return
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${workspaceId}|`)) cache.delete(key)
  }
}

export function clearJobsListCacheForTests(): void {
  cache.clear()
}
