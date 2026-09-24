export const OVERVIEW_METRIC_LABELS = ["Total Cost", "Emails", "Open Tasks", "Estimated Hours"] as const
export const OVERVIEW_PARTY_LABELS = ["Estimator", "Contractor", "Client"] as const
export const OVERVIEW_REMOVED_LABELS = [
  "Emails (7d)",
  "Emails (30d)",
  "Completed Tasks",
  "Last Activity",
] as const

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
  return trimmed ? trimmed : "Not assigned"
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
