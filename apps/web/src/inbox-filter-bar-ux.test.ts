import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_SUBTYPE_LABELS,
  INBOX_BID_INVITES_SOURCE_FILTER_LABEL,
  businessSubtypeFilterOptionsForDirection,
} from '@forgeops/shared/business-subtypes'
import { buildInboxMessageListFilters } from './inbox-message-list-filters'
import { inboxListQueryKey } from './inbox-list-query'

const here = dirname(fileURLToPath(import.meta.url))
const view = () =>
  readFileSync(join(here, 'views/MessagesView.tsx'), 'utf8')

function toolbarRows(src: string): { primary: string; secondary: string } {
  const primaryStart = src.indexOf('data-testid="inbox-filter-row-primary"')
  const secondaryStart = src.indexOf('data-testid="inbox-filter-row-secondary"')
  const toolbarEnd = src.indexOf('{/* Message list */}')
  return {
    primary: src.slice(primaryStart, secondaryStart),
    secondary: src.slice(secondaryStart, toolbarEnd > secondaryStart ? toolbarEnd : src.length),
  }
}

describe('Inbox filter bar compaction', () => {
  it('A) primary row: Business, Sent, Personal, Pinned, Unread, Active Bid/Quote, Trash — Unclassified hidden', () => {
    const src = view()
    const { primary, secondary } = toolbarRows(src)
    expect(src).toContain('data-testid="inbox-filter-row-primary"')
    expect(primary).toContain('data-testid="inbox-primary-business"')
    expect(primary).toContain('data-testid="inbox-primary-sent"')
    expect(primary).toContain('data-testid="inbox-primary-personal"')
    expect(primary).toContain('data-testid="inbox-pinned-filter"')
    expect(primary).toContain('data-testid="inbox-unread-filter"')
    expect(primary).toContain('data-testid="inbox-active-bid-filter"')
    expect(primary).toContain('data-testid="inbox-quote-filter"')
    expect(primary).toContain('data-testid="inbox-primary-trash"')
    expect(primary).toMatch(/>\s*Business\s*</)
    expect(primary).toMatch(/>\s*Sent\s*</)
    expect(primary).not.toContain('data-testid="inbox-primary-unclassified"')
    expect(primary).not.toMatch(/>\s*Unclassified\s*</)
    expect(src).not.toContain("onClick={() => selectInboxTab('UNCLASSIFIED')}")
    expect(src).toContain("tab === 'UNCLASSIFIED' ? 'ALL_BUSINESS' : tab")
    expect(primary).not.toContain('JobFilterSelect')
    expect(primary).not.toContain('InboxDateSelect')
    expect(primary).not.toContain('InboxPrioritySelect')
    expect(primary).not.toContain('InboxSubtypeSelect')
    const primaryIds = [...primary.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1])
    expect(primaryIds).toEqual([
      'inbox-filter-row-primary',
      'inbox-primary-business',
      'inbox-primary-sent',
      'inbox-primary-personal',
      'inbox-pinned-filter',
      'inbox-unread-filter',
      'inbox-active-bid-filter',
      'inbox-quote-filter',
      'inbox-primary-trash',
    ])
    expect(secondary).not.toContain('data-testid="inbox-pinned-filter"')
    expect(secondary).not.toContain('data-testid="inbox-unread-filter"')
    expect(secondary).not.toContain('data-testid="inbox-primary-trash"')
  })

  it('B) All Jobs / All Dates labels removed from Inbox filter bar', () => {
    const src = view()
    expect(src).not.toContain('All Jobs')
    expect(src).not.toContain('All dates')
    expect(src).not.toContain('All Dates')
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

  it('D) secondary row: Jobs, Dates, Priority, Subtype dropdowns only', () => {
    const src = view()
    const { primary, secondary } = toolbarRows(src)
    expect(src).toContain('data-testid="inbox-filter-row-secondary"')
    expect(secondary).toContain('JobFilterSelect')
    expect(secondary).toContain('InboxDateSelect')
    expect(secondary).toContain('InboxPrioritySelect')
    expect(secondary).toContain('InboxSubtypeSelect')
    expect(src).toContain('testId="inbox-date-filter"')
    expect(src).toContain('testId="inbox-priority-filter"')
    expect(src).toContain('testId="inbox-subtype-filter"')
    expect(primary).not.toContain('JobFilterSelect')
    expect(primary).not.toContain('InboxDateSelect')
    expect(secondary).not.toContain('data-testid="inbox-pinned-filter"')
    expect(secondary).not.toContain('data-testid="inbox-unread-filter"')
    expect(secondary).not.toContain('data-testid="inbox-active-bid-filter"')
    expect(secondary).not.toContain('data-testid="inbox-quote-filter"')
    expect(secondary.split('<JobFilterSelect').length - 1).toBe(1)
    expect(secondary.split('<InboxDateSelect').length - 1).toBe(1)
    expect(secondary.split('<InboxPrioritySelect').length - 1).toBe(1)
    expect(secondary.split('<InboxSubtypeSelect').length - 1).toBe(1)
    const order = [
      secondary.indexOf('<JobFilterSelect'),
      secondary.indexOf('<InboxDateSelect'),
      secondary.indexOf('<InboxPrioritySelect'),
      secondary.indexOf('<InboxSubtypeSelect'),
    ]
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(src).not.toContain('data-testid="inbox-read-filter"')
  })

  it('E) subtypes are not all rendered inline', () => {
    const src = view()
    expect(src).toContain('InboxSubtypeSelect')
    expect(src).toContain('businessSubtypeFilterOptionsForDirection')
    expect(src).not.toContain('data-testid={`inbox-subtype-${o.key}`}')
    expect(src).not.toContain('<option value="">Subtype</option>')
    expect(src).not.toMatch(/BUSINESS_SUBTYPE_KEYS\.map/)
    expect(src).not.toContain('inbox-filter-sep')
  })

  it('F) Active Bid uses Bid Invites provenance key BID_OPPORTUNITY', () => {
    expect(INBOX_BID_INVITES_SOURCE_FILTER_LABEL).toBe('Active Bid')
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
    expect(src).toContain('!isSentView && (')
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

  it('N) Quote hidden from Subtype dropdown; Bid Opportunity remains', () => {
    const src = view()
    expect(src).toContain("o.key !== 'ESTIMATE_QUOTE'")
    expect(src).not.toContain("o.key !== 'BID_OPPORTUNITY'")
    const incoming = businessSubtypeFilterOptionsForDirection('incoming')
    expect(incoming.some((o) => o.key === 'BID_OPPORTUNITY')).toBe(true)
    expect(incoming.find((o) => o.key === 'BID_OPPORTUNITY')?.label).toBe(
      'Bid Opportunity'
    )
    expect(incoming.some((o) => o.key === 'ESTIMATE_QUOTE')).toBe(false)
  })

  it('I) Bid Opportunity remains distinct subtype label from Active Bid', () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe('Bid Opportunity')
    expect(INBOX_BID_INVITES_SOURCE_FILTER_LABEL).toBe('Active Bid')
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).not.toBe(
      INBOX_BID_INVITES_SOURCE_FILTER_LABEL
    )
  })

  it('O–T) Jobs / Dates / Pinned / Unread / search still compose in filter builder', () => {
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

  it('unified search remains a single OR search bar', () => {
    const src = view()
    expect(src).toContain('data-testid="inbox-unified-search"')
    expect(src).toContain('placeholder="Search emails…"')
    expect(src).not.toContain('Search sender')
    expect(src).not.toContain('Search email content')
  })

  it('X) query keys distinguish Active Bid vs Quote vs Sent vs subtype', () => {
    const base = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
    })
    const bid = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
    })
    const rfi = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'RFI_CLARIFICATION',
    })
    const quoteSent = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      businessTypeKey: 'ESTIMATE_QUOTE',
    })
    const keys = [
      inboxListQueryKey(base),
      inboxListQueryKey(bid),
      inboxListQueryKey(rfi),
      inboxListQueryKey(quoteSent),
    ]
    expect(new Set(keys).size).toBe(4)
  })
})
