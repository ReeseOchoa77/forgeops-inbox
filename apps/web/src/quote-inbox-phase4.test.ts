import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_SUBTYPE_LABELS,
  businessSubtypeFilterOptionsForDirection,
} from '@forgeops/shared/business-subtypes'
import { buildInboxMessageListFilters } from './inbox-message-list-filters'
import { inboxListQueryKey } from './inbox-list-query'

const here = dirname(fileURLToPath(import.meta.url))

describe('Phase 4 — web Sent + Quote Inbox', () => {
  it('label is Quote for ESTIMATE_QUOTE', () => {
    expect(BUSINESS_SUBTYPE_LABELS.ESTIMATE_QUOTE).toBe('Quote')
  })

  it('G) Sent + Quote filter composes', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      businessTypeKey: 'ESTIMATE_QUOTE',
    })
    expect(f).toMatchObject({
      sentOnly: true,
      businessCategory: 'BUSINESS',
      businessTypeKey: 'ESTIMATE_QUOTE',
    })
  })

  it('H) Quote + sender search', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      businessTypeKey: 'ESTIMATE_QUOTE',
      activeSearch: 'estimator@',
      searchIn: 'sender',
    })
    expect(f).toMatchObject({
      businessTypeKey: 'ESTIMATE_QUOTE',
      sentOnly: true,
      search: 'estimator@',
      searchIn: 'sender',
    })
  })

  it('I) Quote + content search', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      businessTypeKey: 'ESTIMATE_QUOTE',
      activeSearch: 'falcon quote',
      searchIn: 'all',
    })
    expect(f.businessTypeKey).toBe('ESTIMATE_QUOTE')
    expect(f.search).toBe('falcon quote')
  })

  it('J) Quote + pinned + date', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'sent',
      businessTypeKey: 'ESTIMATE_QUOTE',
      pinnedOnly: true,
      dateRange: 'MONTH',
      timezone: 'America/Chicago',
    })
    expect(f).toMatchObject({
      businessTypeKey: 'ESTIMATE_QUOTE',
      sentOnly: true,
      pinnedOnly: true,
      dateRange: 'MONTH',
    })
  })

  it('direction-aware options', () => {
    expect(
      businessSubtypeFilterOptionsForDirection('sent').some(
        (o) => o.key === 'ESTIMATE_QUOTE' && o.label === 'Quote'
      )
    ).toBe(true)
    expect(
      businessSubtypeFilterOptionsForDirection('incoming').some(
        (o) => o.key === 'BID_OPPORTUNITY'
      )
    ).toBe(true)
  })

  it('query key includes Quote subtype', () => {
    const a = inboxListQueryKey({
      businessCategory: 'BUSINESS',
      sentOnly: true,
      businessTypeKey: 'ESTIMATE_QUOTE',
    })
    expect(a).toContain('ESTIMATE_QUOTE')
    expect(a).toContain('sent')
  })

  it('MessagesView wires Quote + direction-aware subtype filter', () => {
    const src = readFileSync(join(here, 'views/MessagesView.tsx'), 'utf8')
    expect(src).toContain('businessSubtypeFilterOptionsForDirection')
    expect(src).toContain('ESTIMATE_QUOTE')
    expect(src).toContain('isSentView')
  })

  it('Assign to Bid Candidate uses QUOTE role for Quote emails', () => {
    const src = readFileSync(
      join(here, 'components/EmailJobAssignmentDialog.tsx'),
      'utf8'
    )
    expect(src).toContain("businessTypeKey === 'ESTIMATE_QUOTE'")
    expect(src).toContain("role: 'QUOTE'")
    expect(src).toContain('assignEmailToBidCandidate')
  })
})
