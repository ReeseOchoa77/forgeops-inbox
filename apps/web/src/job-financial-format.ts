import type { JobFinancialSnapshot } from './api'
import { formatJobCost, formatHoursNumber } from './job-overview-format'

/** Unknown ≠ $0 — show explicit unknown label. */
export function formatFinancialMoney(value: string | number | null | undefined): string {
  if (value == null || value === '') return 'Unknown'
  return formatJobCost(value)
}

export function formatSignedFinancialMoney(value: string | number | null | undefined): string {
  if (value == null || value === '') return 'Unknown'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 'Unknown'
  if (n > 0) return `+${formatJobCost(n)}`
  return formatJobCost(n)
}

export function formatMarginPercent(value: string | null | undefined): string {
  if (value == null || value === '') return 'Unknown'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Unknown'
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`
}

export function financialRow(
  label: string,
  value: string,
  opts?: { muted?: boolean; emphasize?: boolean; incomplete?: boolean }
) {
  return { label, value, muted: opts?.muted, emphasize: opts?.emphasize, incomplete: opts?.incomplete }
}

export function buildFinancialOverviewRows(snap: JobFinancialSnapshot) {
  const contractIncomplete = !snap.revisedContractValueComplete
  const costIncomplete = !snap.currentEstimatedCostComplete
  return {
    contract: [
      financialRow('Original Contract', formatFinancialMoney(snap.originalContractValue)),
      financialRow('Approved COs', formatSignedFinancialMoney(snap.approvedChangeOrderValue), {
        incomplete: snap.approvedChangeOrderUnknownCount > 0,
      }),
      financialRow('Revised Contract', formatFinancialMoney(snap.revisedContractValue), {
        emphasize: true,
        incomplete: contractIncomplete,
      }),
    ],
    pending:
      snap.pendingProposedSellValue != null ||
      snap.pendingProposedSellUnknownCount > 0 ||
      snap.pendingChangeOrderValue != null ||
      snap.pendingChangeOrderUnknownCount > 0
        ? [
            financialRow(
              'Pending / Proposed',
              formatFinancialMoney(snap.pendingProposedSellValue ?? snap.pendingChangeOrderValue),
              { muted: true }
            ),
          ]
        : [],
    estimate: [
      financialRow('Original Estimated Cost', formatFinancialMoney(snap.originalEstimatedCost)),
      financialRow('Approved Change Cost', formatSignedFinancialMoney(snap.approvedChangeEstimatedCost), {
        incomplete: snap.approvedChangeCostUnknownCount > 0,
      }),
      financialRow('Current Estimated Cost', formatFinancialMoney(snap.currentEstimatedCost), {
        emphasize: true,
        incomplete: costIncomplete,
      }),
    ],
    margin:
      snap.estimatedGrossProfit != null
        ? [
            financialRow('Estimated Gross Profit', formatFinancialMoney(snap.estimatedGrossProfit), {
              emphasize: true,
            }),
            financialRow('Estimated Gross Margin', formatMarginPercent(snap.estimatedGrossMarginPercent)),
          ]
        : [
            financialRow('Estimated Gross Profit', 'Unknown', { muted: true }),
            financialRow('Estimated Gross Margin', 'Unknown', { muted: true }),
          ],
    commitments: [
      financialRow('PO Commitments', formatFinancialMoney(snap.purchaseOrderCommittedValue), {
        incomplete: snap.purchaseOrderUnknownCount > 0,
      }),
      ...(snap.knownProcurementActualCount > 0
        ? [
            financialRow(
              'Known Procurement Actual',
              formatFinancialMoney(snap.knownProcurementActualCost),
              { muted: true }
            ),
          ]
        : []),
    ],
    fabricationHours:
      snap.estimatedFabricationHours > 0
        ? formatHoursNumber(snap.estimatedFabricationHours)
        : null,
  }
}
