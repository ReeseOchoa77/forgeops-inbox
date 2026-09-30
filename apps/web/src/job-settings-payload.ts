export function jobSettingsUpdateBody(input: {
  name: string
  jobNumber: string
  status: string
  description: string
  notes: string
  startDate: string
  targetCompletionDate: string
  bidDueDate?: string
  totalCost?: string
  originalContractValue?: string
  originalEstimatedCost?: string
  estimatorUserId?: string
  contractorCustomerId?: string
  clientCustomerId?: string
  siteName?: string
  siteAddress1?: string
  siteAddress2?: string
  siteCity?: string
  siteState?: string
  sitePostalCode?: string
}): {
  name: string
  jobNumber: string
  status: string
  description: string
  notes: string
  startDate: string | null
  targetCompletionDate: string | null
  bidDueAt?: string | null
  totalCost?: number | null
  originalContractValue?: number | null
  originalEstimatedCost?: number | null
  estimatorUserId?: string | null
  contractorCustomerId?: string | null
  clientCustomerId?: string | null
  siteName?: string | null
  siteAddress1?: string | null
  siteAddress2?: string | null
  siteCity?: string | null
  siteState?: string | null
  sitePostalCode?: string | null
} {
  return {
    name: input.name,
    jobNumber: input.jobNumber,
    status: input.status,
    description: input.description,
    notes: input.notes,
    startDate: calendarDateToIso(input.startDate),
    targetCompletionDate: calendarDateToIso(input.targetCompletionDate),
    ...(input.bidDueDate !== undefined
      ? { bidDueAt: calendarDateToIso(input.bidDueDate) }
      : {}),
    ...(input.totalCost !== undefined ? { totalCost: parseNonNegativeMoney(input.totalCost) } : {}),
    ...(input.originalContractValue !== undefined
      ? { originalContractValue: parseNonNegativeMoney(input.originalContractValue) }
      : {}),
    ...(input.originalEstimatedCost !== undefined
      ? { originalEstimatedCost: parseNonNegativeMoney(input.originalEstimatedCost) }
      : {}),
    ...(input.estimatorUserId !== undefined ? { estimatorUserId: input.estimatorUserId || null } : {}),
    ...(input.contractorCustomerId !== undefined ? { contractorCustomerId: input.contractorCustomerId || null } : {}),
    ...(input.clientCustomerId !== undefined ? { clientCustomerId: input.clientCustomerId || null } : {}),
    ...(input.siteName !== undefined ? { siteName: input.siteName.trim() || null } : {}),
    ...(input.siteAddress1 !== undefined ? { siteAddress1: input.siteAddress1.trim() || null } : {}),
    ...(input.siteAddress2 !== undefined ? { siteAddress2: input.siteAddress2.trim() || null } : {}),
    ...(input.siteCity !== undefined ? { siteCity: input.siteCity.trim() || null } : {}),
    ...(input.siteState !== undefined ? { siteState: input.siteState.trim() || null } : {}),
    ...(input.sitePostalCode !== undefined ? { sitePostalCode: input.sitePostalCode.trim() || null } : {}),
  }
}

function parseNonNegativeMoney(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "")
  if (!trimmed) return null
  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

function calendarDateToIso(value: string): string | null {
  if (!value) return null
  // Date-only inputs are calendar dates — keep as UTC midnight via YYYY-MM-DD parse path.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}
