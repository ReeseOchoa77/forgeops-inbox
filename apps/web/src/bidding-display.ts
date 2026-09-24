export function suggestedBidName(subject: string | null | undefined, jobName?: string | null): string {
  if (jobName?.trim()) return jobName.trim().slice(0, 300)
  let cleaned = (subject ?? '').trim()
  let previous = ''
  while (cleaned !== previous) {
    previous = cleaned
    cleaned = cleaned.replace(/^(?:re|fw|fwd)\s*:\s*/i, '').trim()
  }
  return cleaned.slice(0, 300)
}

export function formatBidDue(iso: string | null, now = new Date()): {
  label: string
  past: boolean
  today: boolean
} {
  if (!iso) return { label: 'No due date', past: false, today: false }
  const due = iso.slice(0, 10)
  const today = localDateKey(now)
  const days = Math.round((Date.parse(`${due}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000)
  const when = new Date(`${due}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  if (days < 0) return { label: `${when} · Past due`, past: true, today: false }
  if (days === 0) return { label: `${when} · Due today`, past: false, today: true }
  if (days === 1) return { label: `${when} · 1 day`, past: false, today: false }
  return { label: `${when} · ${days} days`, past: false, today: false }
}

export function formatActivityAge(iso: string | null, now = new Date()): string {
  if (!iso) return 'No email yet'
  const then = new Date(iso).getTime()
  const mins = Math.round((now.getTime() - then) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function localDateKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
