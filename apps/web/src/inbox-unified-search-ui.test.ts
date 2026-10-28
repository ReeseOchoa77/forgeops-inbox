import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildInboxMessageListFilters } from './inbox-message-list-filters'
import { inboxListQueryKey } from './inbox-list-query'

const here = dirname(fileURLToPath(import.meta.url))

describe('Inbox unified search UI', () => {
  it('removes sender/content/id selector; one Search emails input', () => {
    const src = readFileSync(join(here, 'views/MessagesView.tsx'), 'utf8')
    const search = readFileSync(join(here, 'components/InboxSmartSearch.tsx'), 'utf8')
    expect(src).toContain('InboxSmartSearch')
    expect(search).toContain('data-testid="inbox-unified-search"')
    expect(search).toContain('Search emails…')
    expect(src).not.toContain("option value=\"sender\"")
    expect(src).not.toContain("option value=\"all\"")
    expect(src).not.toContain("Filter by sender name or email")
    expect(src).not.toMatch(/useState<'all' \| 'sender' \| 'id'>/)
  })

  it('clearing search omits search param', () => {
    const withSearch = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      activeSearch: 'abc',
    })
    const cleared = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      activeSearch: '',
    })
    expect(withSearch.search).toBe('abc')
    expect(cleared.search).toBeUndefined()
    expect(inboxListQueryKey(withSearch)).not.toBe(inboxListQueryKey(cleared))
  })

  it('cache keys differ by search term', () => {
    const a = inboxListQueryKey({
      businessCategory: 'BUSINESS',
      search: 'abc',
    })
    const b = inboxListQueryKey({
      businessCategory: 'BUSINESS',
      search: 'xyz',
    })
    expect(a).not.toBe(b)
  })

  it('does not send searchIn for unified search', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      activeSearch: 'john@customer.com',
    })
    expect(f.search).toBe('john@customer.com')
    expect(f.searchIn).toBeUndefined()
    expect(f.sentOnly).toBe(true)
  })
})
