import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appSrc = readFileSync(join(import.meta.dirname, 'App.tsx'), 'utf8')
const viewSrc = readFileSync(join(import.meta.dirname, 'views/BiddingView.tsx'), 'utf8')
const detailSrc = readFileSync(
  join(import.meta.dirname, 'components/BidCandidateDetail.tsx'),
  'utf8'
)

describe('Active Bids nav / page', () => {
  it('nav label is Active Bids (not Job BIDDING bidding)', () => {
    expect(appSrc).toContain("label: 'Active Bids'")
    expect(appSrc).toContain("bidding: 'Active Bids'")
  })

  it('BiddingView lists operational Bid Candidates API', () => {
    expect(viewSrc).toContain('listOperationalBidCandidates')
    expect(viewSrc).toContain('createOperationalBidCandidate')
    expect(viewSrc).not.toContain('getBidding(')
    expect(viewSrc).not.toContain('onOpenBid')
  })

  it('exposes Convert to Job review (not legacy promote/from-email)', () => {
    expect(detailSrc).toContain('Convert to Job')
    expect(detailSrc).toContain('convertBidCandidateToJob')
    expect(detailSrc).toContain('previewConvertBidCandidateToJob')
    expect(viewSrc).not.toContain('promoteBidCandidate')
    expect(viewSrc).not.toContain('createBidFromEmail')
    expect(detailSrc).not.toContain('Convert to Job comes in a later phase')
  })
})
