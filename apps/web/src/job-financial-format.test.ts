import { describe, expect, it } from 'vitest'
import type { JobFinancialSnapshot } from './api'
import {
  buildFinancialOverviewRows,
  formatFinancialMoney,
  formatMarginPercent,
  formatSignedFinancialMoney,
} from './job-financial-format'

function snap(partial: Partial<JobFinancialSnapshot> = {}): JobFinancialSnapshot {
  return {
    originalContractValue: null,
    approvedChangeOrderValue: '0.00',
    approvedChangeOrderKnownCount: 0,
    approvedChangeOrderUnknownCount: 0,
    revisedContractValue: null,
    revisedContractValueComplete: false,
    pendingProposedSellValue: null,
    pendingProposedSellUnknownCount: 0,
    pendingChangeOrderValue: null,
    pendingChangeOrderUnknownCount: 0,
    originalEstimatedCost: null,
    approvedChangeEstimatedCost: '0.00',
    approvedChangeCostKnownCount: 0,
    approvedChangeCostUnknownCount: 0,
    currentEstimatedCost: null,
    currentEstimatedCostComplete: false,
    purchaseOrderCommittedValue: '0.00',
    purchaseOrderCommittedKnownCount: 0,
    purchaseOrderUnknownCount: 0,
    knownProcurementActualCost: null,
    knownProcurementActualCount: 0,
    estimatedGrossProfit: null,
    estimatedGrossMarginPercent: null,
    estimatedFabricationHours: 0,
    legacyEnteredTotal: null,
    ...partial,
  }
}

describe('job financial format', () => {
  it('distinguishes Unknown from $0', () => {
    expect(formatFinancialMoney(null)).toBe('Unknown')
    expect(formatFinancialMoney('0.00')).toBe('$0')
    expect(formatSignedFinancialMoney('45000')).toBe('+$45,000')
    expect(formatSignedFinancialMoney('-8500')).toBe('-$8,500')
    expect(formatMarginPercent('25.50')).toBe('25.5%')
    expect(formatMarginPercent(null)).toBe('Unknown')
  })

  it('builds overview rows with incomplete flags and no legacy total', () => {
    const rows = buildFinancialOverviewRows(
      snap({
        originalContractValue: '1200000.00',
        approvedChangeOrderValue: '45000.00',
        approvedChangeOrderUnknownCount: 1,
        revisedContractValue: '1245000.00',
        revisedContractValueComplete: false,
        originalEstimatedCost: '900000.00',
        approvedChangeEstimatedCost: '28000.00',
        currentEstimatedCost: '928000.00',
        currentEstimatedCostComplete: true,
        purchaseOrderCommittedValue: '410000.00',
        knownProcurementActualCost: '200000.00',
        knownProcurementActualCount: 2,
        estimatedGrossProfit: null,
        estimatedFabricationHours: 144,
      })
    )
    expect(rows.contract[0].value).toBe('$1,200,000')
    expect(rows.contract[1].incomplete).toBe(true)
    expect(rows.contract[2].incomplete).toBe(true)
    expect(rows.commitments.some((r) => r.label === 'Known Procurement Actual')).toBe(true)
    expect(rows.fabricationHours).toBe('144')
    expect(JSON.stringify(rows)).not.toContain('Legacy')
    expect(JSON.stringify(rows)).not.toContain('Entered total')
  })
})
