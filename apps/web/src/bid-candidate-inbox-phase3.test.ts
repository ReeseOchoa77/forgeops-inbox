import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_SUBTYPE_LABELS,
  INBOX_BID_INVITES_SOURCE_FILTER_LABEL,
  inboxBusinessTypeFilterOptionLabel,
} from '@forgeops/shared/business-subtypes'
import { buildInboxMessageListFilters } from './inbox-message-list-filters'
import { inboxListQueryKey } from './inbox-list-query'

const here = dirname(fileURLToPath(import.meta.url))

describe('Phase 3 — web Bid Opportunity / Bid Invites Inbox', () => {
  it('A) subtype badge label is Bid Opportunity for BID_OPPORTUNITY', () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe('Bid Opportunity')
  })

  it('Inbox source-filter option for BID_OPPORTUNITY is Bid Invites', () => {
    expect(INBOX_BID_INVITES_SOURCE_FILTER_LABEL).toBe('Bid Invites')
    expect(inboxBusinessTypeFilterOptionLabel('BID_OPPORTUNITY')).toBe('Bid Invites')
    expect(inboxBusinessTypeFilterOptionLabel('ESTIMATE_QUOTE')).toBe('Quote')
  })

  it('F) Bid Invites filter composes with Incoming (no sentOnly)', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
    })
    expect(f.businessCategory).toBe('BUSINESS')
    expect(f.businessTypeKey).toBe('BID_OPPORTUNITY')
    expect(f.sentOnly).toBeUndefined()
  })

  it('G/H) Bid Invites filter + unified search', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
      activeSearch: 'mortenson',
    })
    expect(f).toMatchObject({
      businessTypeKey: 'BID_OPPORTUNITY',
      search: 'mortenson',
    })
    expect(f.searchIn).toBeUndefined()
  })

  it('I) Bid Invites filter + pinned + unread + date', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: 'unread',
      businessTypeKey: 'BID_OPPORTUNITY',
      pinnedOnly: true,
      dateRange: 'WEEK',
      timezone: 'America/Chicago',
    })
    expect(f).toMatchObject({
      businessTypeKey: 'BID_OPPORTUNITY',
      unreadOnly: true,
      pinnedOnly: true,
      dateRange: 'WEEK',
    })
  })

  it('Incoming direction is default (not sent) with Bid Invites filter', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'BIDS_ESTIMATING',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
    })
    // Exact subtype replaces group when set.
    expect(f.businessTypeGroup).toBeUndefined()
    expect(f.businessTypeKey).toBe('BID_OPPORTUNITY')
    expect(f.sentOnly).toBeUndefined()
  })

  it('query key includes businessTypeKey', () => {
    const a = inboxListQueryKey({
      businessCategory: 'BUSINESS',
      businessTypeKey: 'BID_OPPORTUNITY',
    })
    const b = inboxListQueryKey({ businessCategory: 'BUSINESS' })
    expect(a).not.toBe(b)
    expect(a).toContain('BID_OPPORTUNITY')
  })

  it('MessagesView wires Bid Invites source filter server-side', () => {
    const src = readFileSync(join(here, 'views/MessagesView.tsx'), 'utf8')
    expect(src).toContain('data-testid="inbox-subtype-filter"')
    expect(src).toContain('inboxBusinessTypeFilterOptionLabel')
    expect(src).toContain('BID_OPPORTUNITY')
    expect(src).toContain('businessTypeKey')
  })

  it('F/G/H) Create / Assign Bid Candidate entity actions retained', () => {
    const src = readFileSync(
      join(here, 'components/EmailJobAssignmentDialog.tsx'),
      'utf8'
    )
    expect(src).toContain('Create Bid Candidate')
    expect(src).toContain('Assign to Bid Candidate')
    expect(src).toContain('createBidCandidateFromEmail')
    expect(src).toContain('assignEmailToBidCandidate')
    expect(src).not.toContain('addEmailToBidding')
    expect(src).not.toMatch(/\bCreate Job\b/)
    expect(src).toContain('no ForgeOps Job number')
  })
})
