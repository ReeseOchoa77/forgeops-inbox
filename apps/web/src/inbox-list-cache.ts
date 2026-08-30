import type { MessageSummary } from './api'

export type InboxListCacheEntry = {
  messages: MessageSummary[]
  hasMore: boolean
  totalCount: number | null
  page: number
  cachedAt: number
}

/** Default first-page Inbox (Business tab) — matches MessagesView initial filters. */
export const INBOX_DEFAULT_LIST_FILTER_KEY = 'BUSINESS'

const TTL_MS = 45_000
const MAX_ENTRIES = 12

const cache = new Map<string, InboxListCacheEntry>()
const inflight = new Map<string, Promise<InboxListCacheEntry>>()

export function inboxListCacheKey(
  workspaceId: string,
  connectionId: string,
  filterKey: string = INBOX_DEFAULT_LIST_FILTER_KEY
): string {
  return `${workspaceId}:${connectionId}:${filterKey}`
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

export function getCachedInboxList(
  workspaceId: string,
  connectionId: string,
  filterKey: string = INBOX_DEFAULT_LIST_FILTER_KEY
): InboxListCacheEntry | null {
  const key = inboxListCacheKey(workspaceId, connectionId, filterKey)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry
}

export function setCachedInboxList(
  workspaceId: string,
  connectionId: string,
  filterKey: string,
  entry: Omit<InboxListCacheEntry, 'cachedAt'>
): void {
  const now = Date.now()
  prune(now)
  cache.set(inboxListCacheKey(workspaceId, connectionId, filterKey), {
    ...entry,
    cachedAt: now,
  })
}

export function prefetchInboxList(
  workspaceId: string,
  connectionId: string,
  fetcher: () => Promise<Omit<InboxListCacheEntry, 'cachedAt'>>
): void {
  if (!workspaceId || !connectionId) return
  if (getCachedInboxList(workspaceId, connectionId)) return
  const key = inboxListCacheKey(workspaceId, connectionId)
  if (inflight.has(key)) return
  const promise = fetcher()
    .then((data) => {
      setCachedInboxList(workspaceId, connectionId, INBOX_DEFAULT_LIST_FILTER_KEY, data)
      return { ...data, cachedAt: Date.now() }
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, promise)
}

/** Test helper — clear module cache between contract tests. */
export function clearInboxListCacheForTests(): void {
  cache.clear()
  inflight.clear()
}
