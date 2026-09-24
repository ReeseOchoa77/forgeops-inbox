import { describe, expect, it } from 'vitest'
import { formatBidDue, suggestedBidName } from './bidding-display'

describe('suggestedBidName', () => {
  it('prefers an existing project name over the subject', () => {
    expect(suggestedBidName('RE: Nova Academy pricing', 'Nova Academy')).toBe('Nova Academy')
  })

  it('strips reply prefixes from the subject', () => {
    expect(suggestedBidName('RE: Fwd: Nova Academy Structural Steel')).toBe('Nova Academy Structural Steel')
  })
})

describe('formatBidDue', () => {
  const now = new Date(2026, 8, 24, 15, 0, 0)

  it('shows days remaining and past due from the calendar date', () => {
    expect(formatBidDue('2026-10-03T00:00:00.000Z', now).label).toContain('9 days')
    expect(formatBidDue('2026-09-24T00:00:00.000Z', now).today).toBe(true)
    expect(formatBidDue('2026-09-01T00:00:00.000Z', now).past).toBe(true)
    expect(formatBidDue(null, now).label).toBe('No due date')
  })
})
