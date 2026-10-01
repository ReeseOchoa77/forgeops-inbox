import { describe, expect, it } from 'vitest'
import { jobTabShouldShowLoadError, jobTabViewState } from './job-tab-async-state'
import { rebuildDeliverySummary } from './views/JobDeliveriesView'
import { rebuildSummary } from './views/JobChangesView'
import { rebuildProcurementSummary } from './views/JobProcurementView'

describe('job tab async view state', () => {
  it('never reports loading after a settled failure', () => {
    expect(jobTabViewState(true, null)).toBe('loading')
    expect(jobTabViewState(true, 'boom')).toBe('loading')
    expect(jobTabViewState(false, 'Failed to load deliveries')).toBe('error')
    expect(jobTabViewState(false, null)).toBe('success')
  })

  it('shows load-error UI for API failure with zero rows (not permanent loader)', () => {
    expect(jobTabShouldShowLoadError(true, null, false)).toBe(false)
    expect(jobTabShouldShowLoadError(false, 'Failed to load deliveries', false)).toBe(true)
    expect(jobTabShouldShowLoadError(false, 'Failed to load deliveries', true)).toBe(false)
    expect(jobTabShouldShowLoadError(false, null, false)).toBe(false)
  })
})

describe('empty Job module aggregates (zero records → success summaries)', () => {
  it('Deliveries empty list rebuilds zero summary', () => {
    expect(rebuildDeliverySummary([])).toEqual({
      plannedCount: 0,
      inTransitCount: 0,
      lateCount: 0,
      nextDelivery: null,
    })
  })

  it('Changes empty registers rebuild zero summary', () => {
    expect(rebuildSummary([], [], [])).toEqual({
      openRfiCount: 0,
      overdueRfiCount: 0,
      proposedChangeCount: 0,
      proposedSellImpact: null,
      pendingChangeOrderCount: 0,
    })
  })

  it('Procurement empty items/POs rebuild zero summary', () => {
    expect(rebuildProcurementSummary([], [])).toEqual({
      needsOrderingCount: 0,
      atRiskCount: 0,
      pastExpectedCount: 0,
      orderedAmount: null,
    })
  })
})
