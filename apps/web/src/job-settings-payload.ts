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
  estimatorUserId?: string
  contractorCustomerId?: string
  clientCustomerId?: string
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
  estimatorUserId?: string | null
  contractorCustomerId?: string | null
  clientCustomerId?: string | null
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
    ...(input.totalCost !== undefined ? { totalCost: parseJobCost(input.totalCost) } : {}),
    ...(input.estimatorUserId !== undefined ? { estimatorUserId: input.estimatorUserId || null } : {}),
    ...(input.contractorCustomerId !== undefined ? { contractorCustomerId: input.contractorCustomerId || null } : {}),
    ...(input.clientCustomerId !== undefined ? { clientCustomerId: input.clientCustomerId || null } : {}),
  }
}

function parseJobCost(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "")
  if (!trimmed) return null
  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

function calendarDateToIso(value: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}
