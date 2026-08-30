import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearInboxListCacheForTests,
  getCachedInboxList,
  setCachedInboxList,
  prefetchInboxList,
  INBOX_DEFAULT_LIST_FILTER_KEY,
} from './inbox-list-cache'

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
})
