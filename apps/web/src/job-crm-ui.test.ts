import { describe, expect, it } from 'vitest'
import {
  activityActionTab,
  ACTIVE_JOB_TABS,
  BIDDING_HIDDEN_TABS,
  BIDDING_JOB_TABS,
  buildJobAttentionItems,
  formatJobActivityAction,
  formatStatusLabel,
  isBiddingJobStatus,
  isJobCrmTabAvailable,
  jobCrmTabsForStatus,
  JOB_CRM_MORE_TABS,
  JOB_CRM_TABS,
  parseNullableMoneyInput,
  readJobTabFromUrl,
  resolveJobTabForStatus,
} from './job-crm-ui'

describe('job CRM UI helpers', () => {
  it('defines BIDDING vs ACTIVE tab registries', () => {
    expect(BIDDING_JOB_TABS).toEqual([
      'overview',
      'emails',
      'documents',
      'scope',
      'rfqs',
      'changes',
      'tasks',
      'activity',
      'settings',
    ])
    expect(BIDDING_HIDDEN_TABS).toEqual([
      'schedule',
      'procurement',
      'deliveries',
      'billing',
    ])
    for (const t of BIDDING_HIDDEN_TABS) {
      expect(BIDDING_JOB_TABS).not.toContain(t)
      expect(ACTIVE_JOB_TABS).toContain(t)
    }
    expect(ACTIVE_JOB_TABS).toContain('schedule')
    expect(ACTIVE_JOB_TABS).not.toContain('rfqs')
    expect(JOB_CRM_MORE_TABS).toEqual([])
  })

  it('resolves lifecycle tab strip from Job.status', () => {
    expect(jobCrmTabsForStatus('BIDDING').map((t) => t.key)).toEqual(BIDDING_JOB_TABS)
    expect(jobCrmTabsForStatus('ACTIVE').map((t) => t.key)).toEqual(ACTIVE_JOB_TABS)
    expect(isBiddingJobStatus('BIDDING')).toBe(true)
    expect(isJobCrmTabAvailable('deliveries', 'BIDDING')).toBe(false)
    expect(isJobCrmTabAvailable('deliveries', 'ACTIVE')).toBe(true)
    expect(isJobCrmTabAvailable('rfqs', 'BIDDING')).toBe(true)
  })

  it('falls back invalid deep-links on BIDDING Jobs', () => {
    expect(resolveJobTabForStatus('deliveries', 'BIDDING')).toBe('overview')
    expect(resolveJobTabForStatus('billing', 'BIDDING')).toBe('overview')
    expect(resolveJobTabForStatus('rfqs', 'BIDDING')).toBe('rfqs')
    expect(resolveJobTabForStatus('billing', 'ACTIVE')).toBe('billing')
    expect(resolveJobTabForStatus(null, 'BIDDING')).toBe('overview')
  })

  it('maps activity enums to readable labels', () => {
    expect(formatJobActivityAction('WORK_PACKAGE_CREATED')).toBe('Work package created')
    expect(formatJobActivityAction('RFQ_CREATED')).toBe('RFQ created')
    expect(formatJobActivityAction('INVOICE_SUBMITTED')).toBe('Invoice submitted')
  })

  it('routes activity actions to modules', () => {
    expect(activityActionTab('RFI_ANSWERED')).toBe('changes')
    expect(activityActionTab('RFQ_CREATED')).toBe('rfqs')
    expect(activityActionTab('PURCHASE_ORDER_ISSUED')).toBe('procurement')
    expect(activityActionTab('DELIVERY_SHIPPED')).toBe('deliveries')
  })

  it('builds BIDDING attention without operational schedule/procurement', () => {
    const items = buildJobAttentionItems({
      status: 'BIDDING',
      outstandingRfqCount: 2,
      overdueRfiCount: 1,
      overdueMilestoneCount: 9,
      procurementAtRiskCount: 9,
      lateDeliveryCount: 9,
      billingExceedsKnownContract: true,
    })
    expect(items.map((i) => i.id)).toEqual(['rfqs-outstanding', 'rfis-overdue'])
  })

  it('builds ACTIVE attention items', () => {
    const items = buildJobAttentionItems({
      status: 'ACTIVE',
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
  })

  it('formats status labels without changing enums', () => {
    expect(formatStatusLabel('READY_FOR_FABRICATION')).toBe('Ready For Fabrication')
  })

  it('parses nullable money without converting blank to zero', () => {
    expect(parseNullableMoneyInput('')).toBeNull()
    expect(parseNullableMoneyInput('0')).toBe(0)
    expect(parseNullableMoneyInput('$1,250.50')).toBe(1250.5)
  })

  it('reads jobTab from URL search including rfqs', () => {
    expect(readJobTabFromUrl('?jobTab=billing')).toBe('billing')
    expect(readJobTabFromUrl('?jobTab=rfqs')).toBe('rfqs')
    expect(readJobTabFromUrl('?jobTab=nope')).toBeNull()
    expect(JOB_CRM_TABS.some((t) => t.key === 'rfqs')).toBe(true)
  })
})
