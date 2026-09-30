import { describe, expect, it } from 'vitest'
import {
  activityActionTab,
  buildJobAttentionItems,
  formatJobActivityAction,
  formatStatusLabel,
  parseNullableMoneyInput,
  readJobTabFromUrl,
} from './job-crm-ui'

describe('job CRM UI helpers', () => {
  it('maps activity enums to readable labels', () => {
    expect(formatJobActivityAction('WORK_PACKAGE_CREATED')).toBe('Work package created')
    expect(formatJobActivityAction('INVOICE_SUBMITTED')).toBe('Invoice submitted')
    expect(formatJobActivityAction('MILESTONE_COMPLETED')).toBe('Milestone completed')
  })

  it('routes activity actions to modules', () => {
    expect(activityActionTab('RFI_ANSWERED')).toBe('changes')
    expect(activityActionTab('PURCHASE_ORDER_ISSUED')).toBe('procurement')
    expect(activityActionTab('DELIVERY_SHIPPED')).toBe('deliveries')
    expect(activityActionTab('INVOICE_APPROVED')).toBe('billing')
  })

  it('builds deterministic attention items only', () => {
    expect(buildJobAttentionItems({})).toEqual([])
    const items = buildJobAttentionItems({
      overdueMilestoneCount: 2,
      overdueRfiCount: 1,
      procurementAtRiskCount: 3,
      lateDeliveryCount: 1,
      billingExceedsKnownContract: true,
    })
    expect(items.map((i) => i.id)).toEqual([
      'milestones-overdue',
      'rfis-overdue',
      'procurement-risk',
      'deliveries-late',
      'billing-exceeds',
    ])
    expect(items[3]?.label).toBe('1 late delivery')
  })

  it('formats status labels without changing enums', () => {
    expect(formatStatusLabel('READY_FOR_FABRICATION')).toBe('Ready For Fabrication')
    expect(formatStatusLabel('PARTIALLY_RECEIVED')).toBe('Partially Received')
  })

  it('parses nullable money without converting blank to zero', () => {
    expect(parseNullableMoneyInput('')).toBeNull()
    expect(parseNullableMoneyInput('  ')).toBeNull()
    expect(parseNullableMoneyInput('0')).toBe(0)
    expect(parseNullableMoneyInput('$1,250.50')).toBe(1250.5)
    expect(parseNullableMoneyInput('abc')).toBeUndefined()
  })

  it('reads jobTab from URL search', () => {
    expect(readJobTabFromUrl('?jobTab=billing')).toBe('billing')
    expect(readJobTabFromUrl('?jobTab=nope')).toBeNull()
  })
})
