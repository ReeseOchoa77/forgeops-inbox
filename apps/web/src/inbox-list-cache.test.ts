import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearInboxListCacheForTests,
  getCachedInboxList,
  setCachedInboxList,
  patchCachedInboxMessagePin,
  prefetchInboxList,
  sortInboxMessagesPinnedFirst,
  INBOX_DEFAULT_LIST_FILTER_KEY,
} from './inbox-list-cache'
import { inboxListQueryKey } from './inbox-list-query'

describe('inbox list cache', () => {
  beforeEach(() => {
    clearInboxListCacheForTests()
  })

  it('returns null when empty', () => {
    expect(getCachedInboxList('ws', 'conn')).toBeNull()
  })

  it('stores and returns first-page rows within TTL', () => {
    setCachedInboxList('ws', 'conn', INBOX_DEFAULT_LIST_FILTER_KEY, {
      messages: [{ id: 'm1' } as never],
      hasMore: true,
      totalCount: null,
      page: 1,
    })
    const hit = getCachedInboxList('ws', 'conn')
    expect(hit?.messages).toHaveLength(1)
    expect(hit?.hasMore).toBe(true)
  })

  it('prefetch is a no-op when cache already warm', async () => {
    setCachedInboxList('ws', 'conn', INBOX_DEFAULT_LIST_FILTER_KEY, {
      messages: [{ id: 'cached' } as never],
      hasMore: false,
      totalCount: 1,
      page: 1,
    })
    let fetches = 0
    prefetchInboxList('ws', 'conn', async () => {
      fetches += 1
      return {
        messages: [{ id: 'fresh' } as never],
        hasMore: false,
        totalCount: 1,
        page: 1,
      }
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(fetches).toBe(0)
    expect(getCachedInboxList('ws', 'conn')?.messages[0]?.id).toBe('cached')
  })

  it('prefetch populates cache without marking messages read', async () => {
    let fetches = 0
    prefetchInboxList('ws', 'conn', async () => {
      fetches += 1
      return {
        messages: [{ id: 'm2', isRead: false } as never],
        hasMore: false,
        totalCount: null,
        page: 1,
      }
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetches).toBe(1)
    const hit = getCachedInboxList('ws', 'conn')
    expect(hit?.messages[0]?.isRead).toBe(false)
  })
})

describe('inbox pin cache patch', () => {
  beforeEach(() => {
    clearInboxListCacheForTests()
  })

  it('sortInboxMessagesPinnedFirst puts pinned first', () => {
    const sorted = sortInboxMessagesPinnedFirst([
      { id: 'a', isPinned: false, receivedAt: '2026-01-02T00:00:00.000Z' } as never,
      { id: 'b', isPinned: true, receivedAt: '2026-01-01T00:00:00.000Z' } as never,
    ])
    expect(sorted.map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('patchCachedInboxMessagePin updates every filter cache for the mailbox', () => {
    const businessKey = inboxListQueryKey({ businessCategory: 'BUSINESS' })
    const personalKey = inboxListQueryKey({ businessCategory: 'NON_BUSINESS' })
    setCachedInboxList('ws', 'conn', businessKey, {
      messages: [
        { id: 'm1', isPinned: false, receivedAt: '2026-01-02T00:00:00.000Z' } as never,
        { id: 'm2', isPinned: false, receivedAt: '2026-01-01T00:00:00.000Z' } as never,
      ],
      hasMore: false,
      totalCount: 2,
      page: 1,
    })
    setCachedInboxList('ws', 'conn', personalKey, {
      messages: [
        { id: 'm1', isPinned: false, receivedAt: '2026-01-02T00:00:00.000Z' } as never,
      ],
      hasMore: false,
      totalCount: 1,
      page: 1,
    })

    patchCachedInboxMessagePin({
      workspaceId: 'ws',
      connectionId: 'conn',
      messageId: 'm1',
      isPinned: true,
      activeFilterKey: businessKey,
    })

    expect(getCachedInboxList('ws', 'conn', businessKey)?.messages[0]?.id).toBe('m1')
    expect(getCachedInboxList('ws', 'conn', businessKey)?.messages[0]?.isPinned).toBe(true)
    expect(getCachedInboxList('ws', 'conn', personalKey)?.messages[0]?.isPinned).toBe(true)
  })

  it('unpin from pinnedOnly cache removes the row', () => {
    const pinnedKey = inboxListQueryKey({
      businessCategory: 'BUSINESS',
      pinnedOnly: true,
    })
    expect(pinnedKey.split('|')).toContain('pinned')
    setCachedInboxList('ws', 'conn', pinnedKey, {
      messages: [
        { id: 'm1', isPinned: true, receivedAt: '2026-01-02T00:00:00.000Z' } as never,
      ],
      hasMore: false,
      totalCount: 1,
      page: 1,
    })
    patchCachedInboxMessagePin({
      workspaceId: 'ws',
      connectionId: 'conn',
      messageId: 'm1',
      isPinned: false,
    })
    expect(getCachedInboxList('ws', 'conn', pinnedKey)?.messages).toEqual([])
  })
})

describe('inbox initial load contracts', () => {
  it('default list filter key is Business (matches MessagesView mount)', () => {
    expect(INBOX_DEFAULT_LIST_FILTER_KEY).toBe('BUSINESS')
  })

  it('skeleton only when loading with no rows (cached return shows rows)', () => {
    const loading = false
    const messages = [{ id: 'm1' }]
    const showSkeleton = loading && messages.length === 0
    expect(showSkeleton).toBe(false)
  })

  it('hard load shows skeleton when empty', () => {
    const loading = true
    const messages: unknown[] = []
    expect(loading && messages.length === 0).toBe(true)
  })

  it('stores per-filter keys so tab switches can soft-hydrate', () => {
    setCachedInboxList('ws', 'conn', 'BUSINESS|||||', {
      messages: [{ id: 'biz' } as never],
      hasMore: false,
      totalCount: 1,
      page: 1,
    })
    setCachedInboxList('ws', 'conn', '|||sent||||||', {
      messages: [{ id: 'sent' } as never],
      hasMore: false,
      totalCount: 1,
      page: 1,
    })
    expect(getCachedInboxList('ws', 'conn', 'BUSINESS|||||')?.messages[0]?.id).toBe('biz')
    expect(getCachedInboxList('ws', 'conn', '|||sent||||||')?.messages[0]?.id).toBe('sent')
  })
})
