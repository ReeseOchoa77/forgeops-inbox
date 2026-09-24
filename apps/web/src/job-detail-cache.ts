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

/**
 * PUT /jobs/:id returns a Prisma job (scalars + nested customer), not the GET detail
 * shape. Overlay those fields onto the loaded detail so members/aliases/counts stay.
 */
export function mergeJobDetailAfterUpdate(
  prev: JobDetail,
  updated: Partial<JobDetail> & { customer?: { name?: string | null } | null }
): JobDetail {
  return {
    ...prev,
    name: updated.name ?? prev.name,
    jobNumber: updated.jobNumber !== undefined ? updated.jobNumber : prev.jobNumber,
    status: updated.status ?? prev.status,
    description: updated.description !== undefined ? updated.description : prev.description,
    notes: updated.notes !== undefined ? updated.notes : prev.notes,
    startDate: updated.startDate !== undefined ? updated.startDate : prev.startDate,
    targetCompletionDate:
      updated.targetCompletionDate !== undefined
        ? updated.targetCompletionDate
        : prev.targetCompletionDate,
    customerId: updated.customerId !== undefined ? updated.customerId : prev.customerId,
    customerName: updated.customerName ?? updated.customer?.name ?? prev.customerName,
    archivedAt: updated.archivedAt !== undefined ? updated.archivedAt : prev.archivedAt,
    members: Array.isArray(updated.members) ? updated.members : prev.members ?? [],
    aliases: Array.isArray(updated.aliases) ? updated.aliases : prev.aliases ?? [],
    assignedMembers: Array.isArray(updated.assignedMembers)
      ? updated.assignedMembers
      : prev.assignedMembers ?? [],
  }
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
