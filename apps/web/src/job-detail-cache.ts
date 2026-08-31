import type { JobDetail, JobSummary } from './api'

export type JobDetailCacheEntry = {
  job: JobDetail
  cachedAt: number
}

const TTL_MS = 60_000
const MAX_ENTRIES = 20
const cache = new Map<string, JobDetailCacheEntry>()

export function jobDetailCacheKey(workspaceId: string, jobId: string): string {
  return `${workspaceId}:${jobId}`
}

export function getCachedJobDetail(
  workspaceId: string,
  jobId: string
): JobDetailCacheEntry | null {
  const key = jobDetailCacheKey(workspaceId, jobId)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry
}

export function setCachedJobDetail(
  workspaceId: string,
  jobId: string,
  job: JobDetail
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
  cache.set(jobDetailCacheKey(workspaceId, jobId), { job, cachedAt: now })
}

export function invalidateJobDetailCache(workspaceId: string, jobId?: string): void {
  if (jobId) {
    cache.delete(jobDetailCacheKey(workspaceId, jobId))
    return
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${workspaceId}:`)) cache.delete(key)
  }
}

export function clearJobDetailCacheForTests(): void {
  cache.clear()
}

/** Build a minimal JobDetail shell from a list row for instant paint. */
export function jobDetailShellFromSummary(summary: JobSummary): JobDetail {
  return {
    ...summary,
    notes: null,
    externalRef: null,
    completedTaskCount: 0,
    recentEmails7d: 0,
    recentEmails30d: 0,
    attachmentCount: 0,
    members: (summary.assignedMembers ?? []).map((m, i) => ({
      id: `shell-${m.userId}-${i}`,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      createdAt: summary.createdAt,
    })),
    aliases: [],
  }
}
