import type { ThreadDetail } from './api'

type CacheEntry = {
  data: ThreadDetail
  cachedAt: number
}

const TTL_MS = 60_000
const MAX_ENTRIES = 24

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<ThreadDetail>>()

function cacheKey(workspaceId: string, connectionId: string, messageId: string): string {
  return `${workspaceId}:${connectionId}:${messageId}`
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

/** Short-lived in-memory thread cache for open/prefetch (no Redis / no global store). */
export function getCachedThread(
  workspaceId: string,
  connectionId: string,
  messageId: string
): ThreadDetail | null {
  const key = cacheKey(workspaceId, connectionId, messageId)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.data
}

export function setCachedThread(
  workspaceId: string,
  connectionId: string,
  messageId: string,
  data: ThreadDetail
): void {
  const now = Date.now()
  prune(now)
  cache.set(cacheKey(workspaceId, connectionId, messageId), { data, cachedAt: now })
}

export function prefetchThread(
  workspaceId: string,
  connectionId: string,
  messageId: string,
  fetcher: () => Promise<ThreadDetail>
): void {
  if (getCachedThread(workspaceId, connectionId, messageId)) return
  const key = cacheKey(workspaceId, connectionId, messageId)
  if (inflight.has(key)) return
  const promise = fetcher()
    .then((data) => {
      setCachedThread(workspaceId, connectionId, messageId, data)
      return data
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, promise)
}

export function getInflightThread(
  workspaceId: string,
  connectionId: string,
  messageId: string
): Promise<ThreadDetail> | null {
  return inflight.get(cacheKey(workspaceId, connectionId, messageId)) ?? null
}
