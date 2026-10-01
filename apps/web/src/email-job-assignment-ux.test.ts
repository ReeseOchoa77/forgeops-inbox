import { describe, expect, it } from 'vitest'
import { EmailJobAssignmentDialog } from './components/EmailJobAssignmentDialog'
import { AddToBiddingDialog } from './components/AddToBiddingDialog'
import { isBidsEstimatingSubtype } from './bidding-display'

describe('unified email Job assignment UX', () => {
  it('exports the unified dialog; AddToBiddingDialog is a compatibility alias', () => {
    expect(typeof EmailJobAssignmentDialog).toBe('function')
    expect(AddToBiddingDialog).toBe(EmailJobAssignmentDialog)
  })
})

describe('Bid Opportunity badge remains informational', () => {
  it('keeps BID_OPPORTUNITY as bidding subtype without creating Jobs', () => {
    expect(isBidsEstimatingSubtype('BID_OPPORTUNITY')).toBe(true)
    expect(isBidsEstimatingSubtype('BID_UPDATE')).toBe(true)
  })
})
