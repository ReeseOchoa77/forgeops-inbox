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

const TTL_MS = 60_000
/** Soft-revalidate but skip network when entry is newer than this. */
export const INBOX_LIST_FRESH_MS = 12_000
const MAX_ENTRIES = 24

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

/** Pinned-first then newest received/sent — matches Inbox server orderBy secondary. */
export function sortInboxMessagesPinnedFirst(
  messages: MessageSummary[]
): MessageSummary[] {
  return [...messages].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    const dateA = new Date(a.receivedAt ?? a.sentAt ?? 0).getTime()
    const dateB = new Date(b.receivedAt ?? b.sentAt ?? 0).getTime()
    return dateB - dateA
  })
}

/**
 * Patch canonical pin state for one message across every cached filter for this
 * mailbox. When unpinning from a pinnedOnly cache, remove the row.
 * Returns the sorted messages for the active filter key (if present).
 */
export function patchCachedInboxMessagePin(input: {
  workspaceId: string
  connectionId: string
  messageId: string
  isPinned: boolean
  /** When set, also refresh this filter entry's cachedAt after patch. */
  activeFilterKey?: string
}): MessageSummary[] | null {
  const prefix = `${input.workspaceId}:${input.connectionId}:`
  const now = Date.now()
  let activeMessages: MessageSummary[] | null = null

  for (const [key, entry] of [...cache.entries()]) {
    if (!key.startsWith(prefix)) continue
    const filterKey = key.slice(prefix.length)
    // Query key segment for pinnedOnly is literally "pinned" (see inboxListQueryKey).
    const segments = filterKey.split('|')
    const pinnedOnlyFilter = segments.includes('pinned')
    let nextMessages = entry.messages.map((m) =>
      m.id === input.messageId ? { ...m, isPinned: input.isPinned } : m
    )
    if (!input.isPinned && pinnedOnlyFilter) {
      nextMessages = nextMessages.filter((m) => m.id !== input.messageId)
    }
    nextMessages = sortInboxMessagesPinnedFirst(nextMessages)
    cache.set(key, { ...entry, messages: nextMessages, cachedAt: now })
    if (input.activeFilterKey && filterKey === input.activeFilterKey) {
      activeMessages = nextMessages
    }
  }

  return activeMessages
}

export function invalidateInboxListCache(
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
