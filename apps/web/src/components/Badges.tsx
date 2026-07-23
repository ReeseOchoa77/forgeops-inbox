const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.2px'
}

export function BusinessBadge({ category }: { category: string | null }) {
  if (!category) return <span style={{ ...badgeBase, background: '#f5f5f5', color: '#aaa' }}>Unclassified</span>
  if (category === 'BUSINESS') {
    return <span style={{ ...badgeBase, background: '#e3f2fd', color: '#1565c0' }}>Business</span>
  }
  return <span style={{ ...badgeBase, background: '#f0f0f0', color: '#888' }}>Non-Business</span>
}

const businessTypeLabels: Record<string, string> = {
  BID_OPPORTUNITY: 'Bid Opportunity',
  BID_UPDATE: 'Bid Update / Addendum',
  ESTIMATE_QUOTE: 'Estimate / Quote',
  PURCHASE_ORDER_CONTRACT: 'Purchase Order / Contract',
  PROJECT_COORDINATION: 'Project Coordination',
  RFI_CLARIFICATION: 'RFI / Clarification',
  SUBMITTAL_SHOP_DRAWING: 'Submittal / Shop Drawing',
  CHANGE_ORDER_SCOPE: 'Change Order / Scope Change',
  FABRICATION_PRODUCTION: 'Fabrication / Production',
  MATERIAL_PURCHASING: 'Material / Vendor / Purchasing',
  DELIVERY_LOGISTICS: 'Delivery / Logistics',
  FIELD_INSTALLATION: 'Field Issue / Installation',
  INVOICE_PAYMENT: 'Invoice / Payment',
  COMPLIANCE_LEGAL: 'Compliance / Safety / Legal',
  INTERNAL_ADMIN: 'Internal Administration',
  OTHER_BUSINESS: 'Other Business'
}

const businessTypeColors: Record<string, { bg: string; fg: string }> = {
  BID_OPPORTUNITY: { bg: '#e3f2fd', fg: '#1565c0' },
  BID_UPDATE: { bg: '#e3f2fd', fg: '#1565c0' },
  ESTIMATE_QUOTE: { bg: '#e3f2fd', fg: '#1565c0' },
  PURCHASE_ORDER_CONTRACT: { bg: '#e8f5e9', fg: '#2e7d32' },
  PROJECT_COORDINATION: { bg: '#e0f2f1', fg: '#00695c' },
  RFI_CLARIFICATION: { bg: '#fff3e0', fg: '#e65100' },
  SUBMITTAL_SHOP_DRAWING: { bg: '#f3e5f5', fg: '#6a1b9a' },
  CHANGE_ORDER_SCOPE: { bg: '#fce4ec', fg: '#c62828' },
  FABRICATION_PRODUCTION: { bg: '#e0f2f1', fg: '#00695c' },
  MATERIAL_PURCHASING: { bg: '#e8f5e9', fg: '#2e7d32' },
  DELIVERY_LOGISTICS: { bg: '#e0f2f1', fg: '#00695c' },
  FIELD_INSTALLATION: { bg: '#fff3e0', fg: '#e65100' },
  INVOICE_PAYMENT: { bg: '#e8f5e9', fg: '#2e7d32' },
  COMPLIANCE_LEGAL: { bg: '#fce4ec', fg: '#c62828' },
  INTERNAL_ADMIN: { bg: '#f0f0f0', fg: '#555' },
  OTHER_BUSINESS: { bg: '#f0f0f0', fg: '#555' }
}

const actionLabels: Record<string, string> = {
  ACTIONABLE_REQUEST: 'Action Needed',
  FYI_UPDATE: 'FYI / Update',
  NEEDS_REVIEW: 'Needs Review'
}

export function TypeBadge({ type, businessTypeKey }: { type: string; businessTypeKey?: string | null }) {
  if (businessTypeKey && businessTypeLabels[businessTypeKey]) {
    const c = businessTypeColors[businessTypeKey] ?? { bg: '#eee', fg: '#333' }
    return <span style={{ ...badgeBase, background: c.bg, color: c.fg }}>{businessTypeLabels[businessTypeKey]}</span>
  }
  const label = businessTypeLabels[type] ?? actionLabels[type] ?? type.replace(/_/g, ' ')
  const c = businessTypeColors[type] ?? { bg: '#eee', fg: '#333' }
  return <span style={{ ...badgeBase, background: c.bg, color: c.fg }}>{label}</span>
}

export function ActionBadge({ emailType, requiresReview }: { emailType: string; requiresReview: boolean }) {
  if (requiresReview) return <span style={{ ...badgeBase, background: '#fff9c4', color: '#f57f17', fontSize: 10 }}>Review</span>
  if (emailType === 'ACTIONABLE_REQUEST') return <span style={{ ...badgeBase, background: '#e3f2fd', color: '#1565c0', fontSize: 10 }}>Action</span>
  return null
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
