import { describe, expect, it } from 'vitest'
import { moneyLabel, rebuildSummary } from './views/JobChangesView'
import type { JobChange, JobChangeOrder, JobRfi } from './api'
import { jobTabShouldShowLoadError, jobTabViewState } from './job-tab-async-state'

describe('job changes UX helpers', () => {
  it('zero records rebuild empty success summary', () => {
    expect(rebuildSummary([], [], [])).toEqual({
      openRfiCount: 0,
      overdueRfiCount: 0,
      proposedChangeCount: 0,
      proposedSellImpact: null,
      pendingChangeOrderCount: 0,
    })
    expect(jobTabViewState(false, null)).toBe('success')
    expect(jobTabShouldShowLoadError(false, 'Failed to load changes', false)).toBe(true)
  })

  it('shows Not priced for unknown money and currency for zero/amounts', () => {
    expect(moneyLabel(null)).toBe('Not priced')
    expect(moneyLabel(undefined)).toBe('Not priced')
    expect(moneyLabel('0.00')).toMatch(/\$0/)
    expect(moneyLabel('1250.00')).toMatch(/1,250/)
  })

  it('rebuilds Overview aggregates from register rows', () => {
    const rfis = [
      { status: 'OPEN', overdue: true },
      { status: 'DRAFT', overdue: false },
      { status: 'CLOSED', overdue: false },
    ] as JobRfi[]
    const changes = [
      { status: 'PROPOSED', sellImpact: '1000.00' },
      { status: 'PRICING', sellImpact: null },
      { status: 'APPROVED', sellImpact: '500.00' },
    ] as JobChange[]
    const cos = [
      { status: 'DRAFT' },
      { status: 'APPROVED' },
    ] as JobChangeOrder[]
    expect(rebuildSummary(rfis, changes, cos)).toEqual({
      openRfiCount: 2,
      overdueRfiCount: 1,
      proposedChangeCount: 2,
      proposedSellImpact: '1000.00',
      pendingChangeOrderCount: 1,
    })
  })
})
