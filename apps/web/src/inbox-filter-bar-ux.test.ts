import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_SUBTYPE_LABELS,
  INBOX_BID_INVITES_SOURCE_FILTER_LABEL,
} from '@forgeops/shared/business-subtypes'
import { buildInboxMessageListFilters } from './inbox-message-list-filters'
import { inboxListQueryKey } from './inbox-list-query'

const here = dirname(fileURLToPath(import.meta.url))
const view = () =>
  readFileSync(join(here, 'views/MessagesView.tsx'), 'utf8')

describe('Inbox filter bar compaction', () => {
  it('A) primary row: Business, Sent, Jobs, Dates, Personal, Trash', () => {
    const src = view()
    expect(src).toContain('data-testid="inbox-filter-row-primary"')
    expect(src).toContain('data-testid="inbox-primary-business"')
    expect(src).toContain('data-testid="inbox-primary-sent"')
    expect(src).toContain('data-testid="inbox-primary-personal"')
    expect(src).toContain('data-testid="inbox-primary-trash"')
    expect(src).toContain('inbox-date-filter')
    expect(src).toContain('JobFilterSelect')
    expect(src).toMatch(/>\s*Business\s*</)
    expect(src).toMatch(/>\s*Sent\s*</)
  })

  it('B) All Jobs / All Dates labels removed from Inbox filter bar', () => {
    const src = view()
    expect(src).not.toContain('All Jobs')
    expect(src).not.toContain('All dates')
    expect(src).not.toContain('All Dates')
    expect(src).toContain('<option value="">Dates</option>')
    const jobPicker = readFileSync(
      join(here, 'components/JobAssignPicker.tsx'),
      'utf8'
    )
    expect(jobPicker).toContain("? 'Jobs'")
  })

  it('C) Exclude filter absent from MessagesView', () => {
    const src = view()
    expect(src).not.toContain('InboxExcludeFilter')
    expect(src).not.toContain('excludeBusinessTypeGroups')
  })

  it('D) secondary row: Pinned, Priority, Bidding, Subtype', () => {
    const src = view()
    expect(src).toContain('data-testid="inbox-filter-row-secondary"')
    expect(src).toContain('data-testid="inbox-pinned-filter"')
    expect(src).toContain('data-testid="inbox-priority-filter"')
    expect(src).toContain('data-testid="inbox-active-bid-filter"')
    expect(src).toContain('data-testid="inbox-subtype-filter"')
    expect(src).toContain('Bidding')
  })

  it('E) subtypes not all rendered inline as chips', () => {
    const src = view()
    expect(src).toContain('inbox-subtype-filter')
    expect(src).toContain('InboxSubtypeSelect')
    expect(src).toContain('inbox-filter-menu')
    // No native <select> subtype list / per-subtype chip map.
    expect(src).not.toContain('<option value="">Subtype</option>')
    expect(src).not.toMatch(/BUSINESS_SUBTYPE_KEYS\.map/)
  })

  it('F) Bidding uses Bid Invites provenance key BID_OPPORTUNITY', () => {
    expect(INBOX_BID_INVITES_SOURCE_FILTER_LABEL).toBe('Bidding')
    const src = view()
    expect(src).toContain("prev === 'BID_OPPORTUNITY' ? '' : 'BID_OPPORTUNITY'")
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
    })
    expect(f.businessTypeKey).toBe('BID_OPPORTUNITY')
    expect(f.sentOnly).toBeUndefined()
  })

  it('J/K) Quote dedicated filter only in Sent mode', () => {
    const src = view()
    expect(src).toContain('data-testid="inbox-quote-filter"')
    expect(src).toContain('isSentView && (')
    expect(src).toContain("!isSentView && (")
    expect(src).toContain('inbox-active-bid-filter')
  })

  it('L) Sent + Quote composes sentOnly + ESTIMATE_QUOTE', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      businessTypeKey: 'ESTIMATE_QUOTE',
    })
    expect(f.sentOnly).toBe(true)
    expect(f.businessTypeKey).toBe('ESTIMATE_QUOTE')
  })

  it('M) leaving Sent clears Quote in selectDirectionFilter', () => {
    const src = view()
    expect(src).toContain("leavingSent && prev === 'ESTIMATE_QUOTE'")
    expect(src).toContain("enteringSent && prev === 'BID_OPPORTUNITY'")
  })

  it('N) Quote + Bidding keys hidden from Subtype dropdown (dedicated controls)', () => {
    const src = view()
    expect(src).toContain("o.key !== 'ESTIMATE_QUOTE'")
    expect(src).toContain("o.key !== 'BID_OPPORTUNITY'")
  })

  it('I) Bid Opportunity remains distinct subtype label from Bidding', () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe('Bid Opportunity')
    expect(INBOX_BID_INVITES_SOURCE_FILTER_LABEL).toBe('Bidding')
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).not.toBe(
      INBOX_BID_INVITES_SOURCE_FILTER_LABEL
    )
  })

  it('O–T) Jobs / Dates / Pinned / search still compose in filter builder', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'unread',
      businessTypeKey: 'RFI_CLARIFICATION',
      jobFilter: 'job-1042',
      dateRange: 'MONTH',
      timezone: 'America/Chicago',
      pinnedOnly: true,
      activeSearch: 'mortenson',
    })
    expect(f).toMatchObject({
      businessTypeKey: 'RFI_CLARIFICATION',
      jobId: 'job-1042',
      dateRange: 'MONTH',
      pinnedOnly: true,
      unreadOnly: true,
      search: 'mortenson',
    })
    expect(f.sentOnly).toBeUndefined()
  })

  it('X) query keys distinguish Bidding vs Quote vs Sent', () => {
    const base = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
    })
    const bid = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
    })
    const quoteSent = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      businessTypeKey: 'ESTIMATE_QUOTE',
    })
    const keys = [
      inboxListQueryKey(base),
      inboxListQueryKey(bid),
      inboxListQueryKey(quoteSent),
    ]
    expect(new Set(keys).size).toBe(3)
  })
})
