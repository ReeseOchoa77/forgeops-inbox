/**
 * In-memory SPA session memory for navigation away/back.
 * Survives remount within the same browser tab session.
 * Does NOT survive full page reload (use localStorage helpers for that).
 * Never store email bodies or secrets here.
 */

const MAX_SCROLL_ENTRIES = 48
const MAX_EVAL_ENTRIES = 4

const scrolls = new Map<string, number>()

export function sessionScrollKey(parts: {
  workspaceId: string
  userId: string
  surface: string
  context?: string
}): string {
  return `scroll:${parts.workspaceId}:${parts.userId}:${parts.surface}:${parts.context ?? ''}`
}

export function saveSessionScroll(key: string, scrollTop: number): void {
  if (!key) return
  scrolls.set(key, Math.max(0, Math.round(scrollTop)))
  while (scrolls.size > MAX_SCROLL_ENTRIES) {
    const oldest = scrolls.keys().next().value
    if (oldest == null) break
    scrolls.delete(oldest)
  }
}

export function getSessionScroll(key: string): number | null {
  const v = scrolls.get(key)
  return typeof v === 'number' ? v : null
}

export function clearSessionScroll(key: string): void {
  scrolls.delete(key)
}

export function clearSessionScrollForWorkspace(workspaceId: string): void {
  for (const key of [...scrolls.keys()]) {
    if (key.includes(`:${workspaceId}:`) || key.startsWith(`scroll:${workspaceId}:`)) {
      scrolls.delete(key)
    }
  }
}

/** Job Matcher completed evaluation — session only (not localStorage). */
export type JobMatcherEvalSession = {
  workspaceId: string
  userId: string
  result: import('../api').JobMatcherEvalResult
  jobFilterId: string | null
  updatedAt: number
}

type PendingEval = {
  workspaceId: string
  userId: string
  promise: Promise<import('../api').JobMatcherEvalResult>
  startedAt: number
}

const evalResults = new Map<string, JobMatcherEvalSession>()
const evalPending = new Map<string, PendingEval>()

function evalKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`
}

export function getJobMatcherEvalSession(
  workspaceId: string,
  userId: string
): JobMatcherEvalSession | null {
  if (!workspaceId || !userId) return null
  return evalResults.get(evalKey(workspaceId, userId)) ?? null
}

export function setJobMatcherEvalSession(input: {
  workspaceId: string
  userId: string
  result: import('../api').JobMatcherEvalResult
  jobFilterId?: string | null
}): void {
  if (!input.workspaceId || !input.userId) return
  const key = evalKey(input.workspaceId, input.userId)
  evalResults.set(key, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    result: input.result,
    jobFilterId: input.jobFilterId ?? null,
    updatedAt: Date.now(),
  })
  evalPending.delete(key)
  while (evalResults.size > MAX_EVAL_ENTRIES) {
    let oldestKey: string | null = null
    let oldestAt = Infinity
    for (const [k, v] of evalResults) {
      if (v.updatedAt < oldestAt) {
        oldestAt = v.updatedAt
        oldestKey = k
      }
    }
    if (!oldestKey) break
    evalResults.delete(oldestKey)
  }
}

export function patchJobMatcherEvalSessionUi(input: {
  workspaceId: string
  userId: string
  jobFilterId: string | null
}): void {
  const existing = getJobMatcherEvalSession(input.workspaceId, input.userId)
  if (!existing) return
  evalResults.set(evalKey(input.workspaceId, input.userId), {
    ...existing,
    jobFilterId: input.jobFilterId,
    updatedAt: Date.now(),
  })
}

export function clearJobMatcherEvalSession(workspaceId: string, userId: string): void {
  const key = evalKey(workspaceId, userId)
  evalResults.delete(key)
  evalPending.delete(key)
}

export function clearJobMatcherEvalSessionsForWorkspace(workspaceId: string): void {
  for (const key of [...evalResults.keys()]) {
    if (key.startsWith(`${workspaceId}:`)) evalResults.delete(key)
  }
  for (const key of [...evalPending.keys()]) {
    if (key.startsWith(`${workspaceId}:`)) evalPending.delete(key)
  }
}

/**
 * Track an in-flight sync evaluation so navigating away and back can still
 * attach to the same Promise (SPA session only — not a server run id).
 */
export function setJobMatcherEvalPending(input: {
  workspaceId: string
  userId: string
  promise: Promise<import('../api').JobMatcherEvalResult>
}): void {
  if (!input.workspaceId || !input.userId) return
  const key = evalKey(input.workspaceId, input.userId)
  evalPending.set(key, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    promise: input.promise,
    startedAt: Date.now(),
  })
}

export function getJobMatcherEvalPending(
  workspaceId: string,
  userId: string
): PendingEval | null {
  if (!workspaceId || !userId) return null
  return evalPending.get(evalKey(workspaceId, userId)) ?? null
}

export function clearJobMatcherEvalPending(workspaceId: string, userId: string): void {
  evalPending.delete(evalKey(workspaceId, userId))
}

/** Test / logout helpers */
export function resetSessionMemoryForTests(): void {
  scrolls.clear()
  evalResults.clear()
  evalPending.clear()
}
