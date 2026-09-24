export function jobSettingsUpdateBody(input: {
  name: string
  jobNumber: string
  status: string
  description: string
  notes: string
  startDate: string
  targetCompletionDate: string
}): {
  name: string
  jobNumber: string
  status: string
  description: string
  notes: string
  startDate: string | null
  targetCompletionDate: string | null
} {
  return {
    name: input.name,
    jobNumber: input.jobNumber,
    status: input.status,
    description: input.description,
    notes: input.notes,
    startDate: calendarDateToIso(input.startDate),
    targetCompletionDate: calendarDateToIso(input.targetCompletionDate),
  }
}

function calendarDateToIso(value: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}
