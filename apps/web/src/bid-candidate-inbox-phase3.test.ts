import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUSINESS_SUBTYPE_LABELS } from '@forgeops/shared/business-subtypes'
import { buildInboxMessageListFilters } from './inbox-message-list-filters'
import { inboxListQueryKey } from './inbox-list-query'

const here = dirname(fileURLToPath(import.meta.url))

describe('Phase 3 — web Bid Candidate Inbox', () => {
  it('label is Bid Candidate for BID_OPPORTUNITY', () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe('Bid Candidate')
  })

  it('F) Bid Candidate filter composes with Incoming (no sentOnly)', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
    })
    expect(f.businessCategory).toBe('BUSINESS')
    expect(f.businessTypeKey).toBe('BID_OPPORTUNITY')
    expect(f.sentOnly).toBeUndefined()
  })

  it('G) Bid Candidate + sender search', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
      activeSearch: 'mortenson',
      searchIn: 'sender',
    })
    expect(f).toMatchObject({
      businessTypeKey: 'BID_OPPORTUNITY',
      search: 'mortenson',
      searchIn: 'sender',
    })
  })

  it('H) Bid Candidate + content search', () => {
    const f = buildInboxMessageListFilters({
      inboxTab: 'ALL_BUSINESS',
      readFilter: '',
      businessTypeKey: 'BID_OPPORTUNITY',
      activeSearch: 'falcon',
      searchIn: 'all',
    })
    expect(f.businessTypeKey).toBe('BID_OPPORTUNITY')
    expect(f.search).toBe('falcon')
    expect(f.searchIn).toBeUndefined()
  })

  it('I) Bid Candidate + pinned + unread + date', () => {
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

  it('Incoming direction is default (not sent) with Bid Candidate', () => {
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

  it('MessagesView wires Bid Candidate subtype filter server-side', () => {
    const src = readFileSync(join(here, 'views/MessagesView.tsx'), 'utf8')
    expect(src).toContain('data-testid="inbox-subtype-filter"')
    expect(src).toContain('Bid Candidate')
    expect(src).toContain('BID_OPPORTUNITY')
    expect(src).toContain('businessTypeKey')
  })

  it('Create / Assign Bid Candidate actions (no Create Job)', () => {
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
