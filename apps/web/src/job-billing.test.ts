import { describe, expect, it } from 'vitest'
import type { JobBillingSnapshot } from './api'
import { formatFinancialMoney, formatMarginPercent } from './job-financial-format'

describe('job billing display', () => {
  it('shows Unknown for incomplete remaining and never Paid/Balance Due labels', () => {
    const snap: JobBillingSnapshot = {
      invoiceCount: 1,
      draftInvoiceCount: 0,
      draftInvoiceValue: '0.00',
      submittedInvoiceValue: '100000.00',
      approvedInvoiceValue: '0.00',
      totalBilled: '100000.00',
      totalBilledInvoiceCount: 1,
      revisedContractValue: null,
      revisedContractValueComplete: false,
      remainingToBill: null,
      remainingToBillComplete: false,
      billingPercentOfRevisedContract: null,
      billingExceedsKnownContract: false,
      changeOrderBilled: [],
    }
    expect(formatFinancialMoney(snap.totalBilled)).toBe('$100,000')
    expect(formatFinancialMoney(snap.remainingToBill)).toBe('Unknown')
    expect(formatMarginPercent(null)).toBe('Unknown')
    expect(JSON.stringify(snap)).not.toContain('Paid')
    expect(JSON.stringify(snap)).not.toContain('Balance Due')
  })
})
