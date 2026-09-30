import { describe, expect, it } from 'vitest'
import { moneyLabel, rebuildProcurementSummary } from './views/JobProcurementView'
import type { JobProcurementItem, JobPurchaseOrder } from './api'

describe('job procurement UX helpers', () => {
  it('shows Not priced for unknown money and currency for zero', () => {
    expect(moneyLabel(null)).toBe('Not priced')
    expect(moneyLabel('0.00')).toMatch(/\$0/)
    expect(moneyLabel('42500.00')).toMatch(/42,500/)
  })

  it('rebuilds Overview aggregates from items and POs', () => {
    const items = [
      { status: 'NEEDED', risk: { overdueToOrder: true, lateExpected: false, pastExpected: false, atRisk: true } },
      { status: 'ORDERED', risk: { overdueToOrder: false, lateExpected: false, pastExpected: true, atRisk: true } },
      { status: 'RECEIVED', risk: { overdueToOrder: false, lateExpected: false, pastExpected: false, atRisk: false } },
    ] as JobProcurementItem[]
    const orders = [
      { status: 'ISSUED', amount: '40000.00' },
      { status: 'DRAFT', amount: '999.00' },
      { status: 'RECEIVED', amount: '2500.00' },
    ] as JobPurchaseOrder[]
    expect(rebuildProcurementSummary(items, orders)).toEqual({
      needsOrderingCount: 1,
      atRiskCount: 2,
      pastExpectedCount: 1,
      orderedAmount: '42500.00',
    })
  })
})
