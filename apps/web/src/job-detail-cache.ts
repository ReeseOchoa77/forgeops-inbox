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
  updated: Partial<JobDetail> & {
    customer?: { name?: string | null } | null
    estimator?: { name?: string | null } | null
    contractor?: { name?: string | null } | null
    client?: { name?: string | null } | null
  }
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
    bidDueAt: updated.bidDueAt !== undefined ? updated.bidDueAt : prev.bidDueAt,
    totalCost: updated.totalCost !== undefined
      ? (updated.totalCost == null ? null : String(updated.totalCost))
      : prev.totalCost,
    estimatorUserId: updated.estimatorUserId !== undefined ? updated.estimatorUserId : prev.estimatorUserId,
    estimatorName: updated.estimatorName !== undefined
      ? updated.estimatorName
      : updated.estimator !== undefined
        ? (updated.estimator?.name ?? null)
        : prev.estimatorName,
    contractorCustomerId: updated.contractorCustomerId !== undefined ? updated.contractorCustomerId : prev.contractorCustomerId,
    contractorName: updated.contractorName !== undefined
      ? updated.contractorName
      : updated.contractor !== undefined
        ? (updated.contractor?.name ?? null)
        : prev.contractorName,
    clientCustomerId: updated.clientCustomerId !== undefined ? updated.clientCustomerId : prev.clientCustomerId,
    clientName: updated.clientName !== undefined
      ? updated.clientName
      : updated.client !== undefined
        ? (updated.client?.name ?? null)
        : prev.clientName,
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
    attachmentCount: 0,
    totalCost: summary.totalCost ?? null,
    estimatedHours: null,
    estimatorUserId: null,
    estimatorName: null,
    contractorCustomerId: null,
    contractorName: null,
    clientCustomerId: null,
    clientName: null,
    fabricationItems: [],
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
