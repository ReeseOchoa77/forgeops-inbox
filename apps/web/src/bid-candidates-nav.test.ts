import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appSrc = readFileSync(join(import.meta.dirname, 'App.tsx'), 'utf8')
const viewSrc = readFileSync(join(import.meta.dirname, 'views/BiddingView.tsx'), 'utf8')

describe('Bid Candidates nav / page', () => {
  it('nav label is Bid Candidates (not Job BIDDING bidding)', () => {
    expect(appSrc).toContain("label: 'Bid Candidates'")
    expect(appSrc).toContain("bidding: 'Bid Candidates'")
  })

  it('BiddingView lists operational Bid Candidates API', () => {
    expect(viewSrc).toContain('listOperationalBidCandidates')
    expect(viewSrc).toContain('createOperationalBidCandidate')
    expect(viewSrc).not.toContain('getBidding(')
    expect(viewSrc).not.toContain('onOpenBid')
  })

  it('exposes Convert to Job review (not legacy promote/from-email)', () => {
    expect(viewSrc).toContain('Convert to Job')
    expect(viewSrc).toContain('convertBidCandidateToJob')
    expect(viewSrc).toContain('previewConvertBidCandidateToJob')
    expect(viewSrc).not.toContain('promoteBidCandidate')
    expect(viewSrc).not.toContain('createBidFromEmail')
    expect(viewSrc).not.toContain('Convert to Job comes in a later phase')
  })
})
