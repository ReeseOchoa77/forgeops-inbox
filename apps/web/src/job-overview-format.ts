export const OVERVIEW_METRIC_LABELS = ["Emails", "Open Tasks", "Estimated Hours"] as const
export const OVERVIEW_PARTY_LABELS = ["Estimator", "Project Manager", "Customer"] as const
/**
 * Job Overview section order under the tab nav.
 * Headline metrics must be first — see JobDetailView overview tab.
 */
export const JOB_OVERVIEW_SECTION_ORDER = [
  "headline_metrics",
  "attention",
  "project_summary",
  "work_packages",
  "schedule",
  "changes",
  "procurement",
  "deliveries",
  "financial",
  "parties",
] as const
export const OVERVIEW_REMOVED_LABELS = [
  "Entered total",
  "Emails (7d)",
  "Emails (30d)",
  "Completed Tasks",
  "Last Activity",
  "Created",
] as const

/**
 * Conservative label — Job.totalCost semantics are ambiguous (not proven sell or cost).
 * Prefer canonical Financial snapshot fields on Overview.
 */
export const TOTAL_COST_DISPLAY_LABEL = "Legacy entered total"

export function formatJobCost(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Not set"
  const amount = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(amount)) return "Not set"
  const hasCents = Math.round(amount * 100) % 100 !== 0
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(amount)
}

/** Unknown (null) vs explicit $0.00 — never treat null as zero. */
export function formatFinancialMoney(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Unknown"
  return formatJobCost(value)
}

export function formatFinancialSignedMoney(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Unknown"
  const amount = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(amount)) return "Unknown"
  const formatted = formatJobCost(Math.abs(amount))
  if (amount > 0) return `+${formatted}`
  if (amount < 0) return `−${formatted.replace("$", "$")}`
  return formatted
}

export function formatMarginPercent(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Unknown"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "Unknown"
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
}

export function formatOverviewDate(iso: string | null | undefined): string {
  if (!iso) return "Not set"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "Not set"
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatHoursNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10
  if (Number.isInteger(rounded)) return rounded.toLocaleString("en-US")
  return rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString("en-US")
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

export function partyLabel(name: string | null | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : "Not set"
}

export function lineEstimatedHours(quantity: number, hoursPerPiece: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(hoursPerPiece)) return 0
  return Math.round(quantity * hoursPerPiece * 100) / 100
}

export function totalEstimatedHours(
  items: Array<{ quantity: number; estimatedHoursPerPiece: number }>,
): number {
  const sum = items.reduce((acc, item) => acc + lineEstimatedHours(item.quantity, item.estimatedHoursPerPiece), 0)
  return Math.round(sum * 100) / 100
}
