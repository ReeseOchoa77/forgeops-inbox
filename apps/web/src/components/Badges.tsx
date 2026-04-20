const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.2px'
}

const typeLabels: Record<string, string> = {
  ACTIONABLE_REQUEST: 'Action Needed',
  FYI_UPDATE: 'FYI / Update',
  SALES_MARKETING: 'Sales & Marketing',
  SUPPORT_CUSTOMER_ISSUE: 'Support Issue',
  RECRUITING_HIRING: 'Recruiting',
  INTERNAL_COORDINATION: 'Internal',
  NEEDS_REVIEW: 'Needs Review'
}

const typeColors: Record<string, { bg: string; fg: string }> = {
  ACTIONABLE_REQUEST: { bg: '#e3f2fd', fg: '#1565c0' },
  FYI_UPDATE: { bg: '#e8f5e9', fg: '#2e7d32' },
  SALES_MARKETING: { bg: '#fff3e0', fg: '#e65100' },
  SUPPORT_CUSTOMER_ISSUE: { bg: '#fce4ec', fg: '#c62828' },
  RECRUITING_HIRING: { bg: '#f3e5f5', fg: '#6a1b9a' },
  INTERNAL_COORDINATION: { bg: '#e0f2f1', fg: '#00695c' },
  NEEDS_REVIEW: { bg: '#fff9c4', fg: '#f57f17' }
}

export function TypeBadge({ type }: { type: string }) {
  const c = typeColors[type] ?? { bg: '#eee', fg: '#333' }
  const label = typeLabels[type] ?? type.replace(/_/g, ' ')
  return <span style={{ ...badgeBase, background: c.bg, color: c.fg }}>{label}</span>
}

const priorityLabels: Record<string, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span style={{ ...badgeBase, background: '#f5f5f5', color: '#aaa' }}>Not set</span>
  const colors: Record<string, { bg: string; fg: string }> = {
    URGENT: { bg: '#c62828', fg: '#fff' },
    HIGH: { bg: '#ef6c00', fg: '#fff' },
    MEDIUM: { bg: '#fdd835', fg: '#333' },
    LOW: { bg: '#e8f5e9', fg: '#2e7d32' }
  }
  const c = colors[priority] ?? { bg: '#eee', fg: '#333' }
  return <span style={{ ...badgeBase, background: c.bg, color: c.fg }}>{priorityLabels[priority] ?? priority}</span>
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  let bg = '#e8f5e9'
  let fg = '#2e7d32'
  let label = 'High'
  if (confidence < 0.5) { bg = '#fce4ec'; fg = '#c62828'; label = 'Low' }
  else if (confidence < 0.75) { bg = '#fff9c4'; fg = '#f57f17'; label = 'Medium' }
  return <span style={{ ...badgeBase, background: bg, color: fg }}>{pct}% {label}</span>
}

const reviewLabels: Record<string, { label: string; color: string }> = {
  NOT_REQUIRED: { label: 'Auto-approved', color: '#888' },
  PENDING: { label: 'Pending review', color: '#e65100' },
  IN_REVIEW: { label: 'In review', color: '#1565c0' },
  APPROVED: { label: 'Approved', color: '#2e7d32' },
  REJECTED: { label: 'Rejected', color: '#c62828' }
}

export function ReviewStatusBadge({ status }: { status: string }) {
  const r = reviewLabels[status] ?? { label: status, color: '#888' }
  return <span style={{ fontSize: 12, color: r.color, fontWeight: 500 }}>{r.label}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    OPEN: 'Open',
    IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked',
    DONE: 'Done',
    CANCELLED: 'Cancelled'
  }
  return <span style={{ ...badgeBase, background: '#f0f0f0', color: '#555' }}>{labels[status] ?? status}</span>
}
