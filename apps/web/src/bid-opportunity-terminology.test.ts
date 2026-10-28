import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_SUBTYPE_LABELS,
  INBOX_BID_INVITES_SOURCE_FILTER_LABEL,
  inboxBusinessTypeFilterOptionLabel,
} from '@forgeops/shared/business-subtypes'
import { businessTypeLabels } from './components/Badges'

const here = dirname(fileURLToPath(import.meta.url))

describe('Bid Opportunity / Bid Invites / Bid Candidate terminology', () => {
  it('A) BID_OPPORTUNITY badge = Bid Opportunity', () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe('Bid Opportunity')
    expect(businessTypeLabels.BID_OPPORTUNITY).toBe('Bid Opportunity')
  })

  it('C) Inbox source-filter option = Active Bids (not Bid Opportunity / Bid Candidate)', () => {
    expect(INBOX_BID_INVITES_SOURCE_FILTER_LABEL).toBe('Active Bids')
    expect(inboxBusinessTypeFilterOptionLabel('BID_OPPORTUNITY')).toBe(
      'Active Bids'
    )
    expect(inboxBusinessTypeFilterOptionLabel('BID_OPPORTUNITY')).not.toBe(
      BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY
    )
  })

  it('F/G/H/I) Active Bids tab + Bid Candidate entity actions retained', () => {
    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(app).toContain("label: 'Active Bids'")
    const bidding = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(bidding).toContain('Create Bid Candidate')
    expect(bidding).toContain('Active Bids')
    const dialog = readFileSync(
      join(here, 'components/EmailJobAssignmentDialog.tsx'),
      'utf8'
    )
    expect(dialog).toContain('Create Bid Candidate')
    expect(dialog).toContain('Assign to Bid Candidate')
    expect(bidding).toMatch(/Convert to Job|convertBidCandidate/)
  })

  it('J) Clear All Emails keeps Include Bid Candidates (entity)', () => {
    const panel = readFileSync(
      join(here, 'components/MonitoredMailboxesPanel.tsx'),
      'utf8'
    )
    expect(panel).toContain('Include Bid Candidates')
    expect(panel).not.toContain('Include Bid Opportunities')
  })

  it('K) Quoted status retained on Candidates', () => {
    const badges = readFileSync(join(here, 'components/Badges.tsx'), 'utf8')
    expect(badges).toContain('QuotedBadge')
    expect(badges).toContain('Quoted')
  })

  it('L) Quote subtype label unchanged', () => {
    expect(BUSINESS_SUBTYPE_LABELS.ESTIMATE_QUOTE).toBe('Quote')
  })

  it('MessagesView uses Active Bids dedicated provenance control', () => {
    const src = readFileSync(join(here, 'views/MessagesView.tsx'), 'utf8')
    expect(src).toContain('inbox-active-bid-filter')
    expect(src).toContain('INBOX_BID_INVITES_SOURCE_FILTER_LABEL')
  })

  it('manual subtype pickers use Bid Opportunity (shared labels), not Bid Candidate', () => {
    // BlindSubtypeReview / ReviewQueue iterate businessTypeLabels from Badges.
    expect(businessTypeLabels.BID_OPPORTUNITY).toBe('Bid Opportunity')
    expect(Object.values(businessTypeLabels)).not.toContain('Bid Candidate')
  })
})
