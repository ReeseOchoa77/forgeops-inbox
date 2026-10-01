/**
 * Phase J — shared Job CRM presentation helpers.
 * Display-only; does not change domain enums or financial semantics.
 */

export type JobCrmTab =
  | 'overview'
  | 'scope'
  | 'schedule'
  | 'changes'
  | 'procurement'
  | 'deliveries'
  | 'billing'
  | 'emails'
  | 'tasks'
  | 'documents'
  | 'activity'
  | 'settings'

export const JOB_CRM_TABS: Array<{ key: JobCrmTab; label: string; group: string }> = [
  { key: 'overview', label: 'Overview', group: 'core' },
  { key: 'emails', label: 'Emails', group: 'communication' },
  { key: 'documents', label: 'Documents', group: 'communication' },
  { key: 'tasks', label: 'Tasks', group: 'communication' },
  { key: 'scope', label: 'Scope', group: 'core' },
  { key: 'schedule', label: 'Schedule', group: 'core' },
  { key: 'changes', label: 'Changes', group: 'operations' },
  { key: 'procurement', label: 'Procurement', group: 'operations' },
  { key: 'deliveries', label: 'Deliveries', group: 'operations' },
  { key: 'billing', label: 'Billing', group: 'commercial' },
  { key: 'activity', label: 'Activity', group: 'system' },
  { key: 'settings', label: 'Settings', group: 'system' },
]

/** Every Job CRM tab — ACTIVE and BIDDING Jobs must reach all of these. */
export const JOB_CRM_REQUIRED_TABS: JobCrmTab[] = JOB_CRM_TABS.map((t) => t.key)

/** All tabs render in the main strip (no More overflow). */
export const JOB_CRM_PRIMARY_TABS: JobCrmTab[] = [...JOB_CRM_REQUIRED_TABS]

/** @deprecated Kept empty — Job Detail lists every tab inline. */
export const JOB_CRM_MORE_TABS: JobCrmTab[] = []

const ACTIVITY_LABELS: Record<string, string> = {
  JOB_CREATED: 'Job created',
  JOB_UPDATED: 'Job updated',
  JOB_ARCHIVED: 'Job archived',
  JOB_RESTORED: 'Job restored',
  JOB_STATUS_CHANGED: 'Job status changed',
  EMAIL_ASSIGNED: 'Email assigned',
  EMAIL_REMOVED: 'Email removed',
  EMAIL_REASSIGNED: 'Email reassigned',
  TASK_LINKED: 'Task linked',
  TASK_REMOVED: 'Task removed',
  MEMBER_ADDED: 'Member added',
  MEMBER_REMOVED: 'Member removed',
  ALIAS_ADDED: 'Alias added',
  ALIAS_REMOVED: 'Alias removed',
  CUSTOMER_CHANGED: 'Customer changed',
  FOLDER_CREATED: 'Folder created',
  FOLDER_RENAMED: 'Folder renamed',
  FOLDER_DELETED: 'Folder deleted',
  DOCUMENT_UPLOADED: 'Document uploaded',
  DOCUMENT_MOVED: 'Document moved',
  DOCUMENT_DELETED: 'Document deleted',
  PARTICIPANT_ADDED: 'Participant added',
  PARTICIPANT_UPDATED: 'Participant updated',
  PARTICIPANT_REMOVED: 'Participant removed',
  WORK_PACKAGE_CREATED: 'Work package created',
  WORK_PACKAGE_UPDATED: 'Work package updated',
  WORK_PACKAGE_DELETED: 'Work package deleted',
  FABRICATION_ITEM_MOVED: 'Fabrication item moved',
  MILESTONE_CREATED: 'Milestone created',
  MILESTONE_UPDATED: 'Milestone updated',
  MILESTONE_COMPLETED: 'Milestone completed',
  MILESTONE_REOPENED: 'Milestone reopened',
  MILESTONE_CANCELLED: 'Milestone cancelled',
  MILESTONE_DELETED: 'Milestone deleted',
  DOCUMENT_CLASSIFIED: 'Document classified',
  DOCUMENT_METADATA_UPDATED: 'Document details updated',
  DOCUMENT_SUPERSEDED: 'Document superseded',
  DOCUMENT_CONTROL_CLEARED: 'Document details cleared',
  RFI_CREATED: 'RFI created',
  RFI_UPDATED: 'RFI updated',
  RFI_ANSWERED: 'RFI answered',
  RFI_CLOSED: 'RFI closed',
  RFI_CANCELLED: 'RFI cancelled',
  DIRECTIVE_CREATED: 'Directive created',
  DIRECTIVE_UPDATED: 'Directive updated',
  DIRECTIVE_VOIDED: 'Directive voided',
  CHANGE_CREATED: 'Change created',
  CHANGE_UPDATED: 'Change updated',
  CHANGE_STATUS_CHANGED: 'Change status changed',
  CHANGE_ORDER_CREATED: 'Change order created',
  CHANGE_ORDER_UPDATED: 'Change order updated',
  CHANGE_ORDER_STATUS_CHANGED: 'Change order status changed',
  PROCUREMENT_ITEM_CREATED: 'Procurement item created',
  PROCUREMENT_ITEM_UPDATED: 'Procurement item updated',
  PROCUREMENT_ITEM_CANCELLED: 'Procurement item cancelled',
  PROCUREMENT_RECEIPT_RECORDED: 'Procurement receipt recorded',
  PROCUREMENT_ITEM_COMPLETED: 'Procurement item completed',
  PURCHASE_ORDER_CREATED: 'Purchase order created',
  PURCHASE_ORDER_UPDATED: 'Purchase order updated',
  PURCHASE_ORDER_ISSUED: 'Purchase order issued',
  PURCHASE_ORDER_CANCELLED: 'Purchase order cancelled',
  DELIVERY_CREATED: 'Delivery created',
  DELIVERY_UPDATED: 'Delivery updated',
  DELIVERY_SHIPPED: 'Delivery shipped',
  DELIVERY_DELIVERED: 'Delivery delivered',
  DELIVERY_CANCELLED: 'Delivery cancelled',
  DELIVERY_LINE_ADDED: 'Delivery line added',
  DELIVERY_LINE_REMOVED: 'Delivery line removed',
  INSTALLATION_RECORDED: 'Installation recorded',
  INSTALLATION_UPDATED: 'Installation updated',
  ORIGINAL_CONTRACT_VALUE_UPDATED: 'Original contract value updated',
  ORIGINAL_ESTIMATED_COST_UPDATED: 'Original estimated cost updated',
  INVOICE_CREATED: 'Invoice created',
  INVOICE_UPDATED: 'Invoice updated',
  INVOICE_SUBMITTED: 'Invoice submitted',
  INVOICE_APPROVED: 'Invoice approved',
  INVOICE_REJECTED: 'Invoice rejected',
  INVOICE_VOIDED: 'Invoice voided',
  INVOICE_DELETED: 'Invoice deleted',
}

export function formatJobActivityAction(action: string): string {
  if (ACTIVITY_LABELS[action]) return ACTIVITY_LABELS[action]
  return action
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Map activity action → Job tab for deep navigation when IDs are absent. */
export function activityActionTab(action: string): JobCrmTab | null {
  if (action.startsWith('WORK_PACKAGE') || action.startsWith('FABRICATION')) return 'scope'
  if (action.startsWith('MILESTONE')) return 'schedule'
  if (
    action.startsWith('RFI_') ||
    action.startsWith('DIRECTIVE_') ||
    action.startsWith('CHANGE_')
  ) {
    return 'changes'
  }
  if (action.startsWith('PROCUREMENT') || action.startsWith('PURCHASE_ORDER')) return 'procurement'
  if (action.startsWith('DELIVERY') || action.startsWith('INSTALLATION')) return 'deliveries'
  if (action.startsWith('INVOICE') || action.includes('CONTRACT_VALUE') || action.includes('ESTIMATED_COST')) {
    return action.startsWith('INVOICE') ? 'billing' : 'settings'
  }
  if (action.startsWith('DOCUMENT') || action.startsWith('FOLDER')) return 'documents'
  if (action.startsWith('EMAIL')) return 'emails'
  if (action.startsWith('TASK')) return 'tasks'
  if (action.startsWith('PARTICIPANT') || action.startsWith('MEMBER') || action.startsWith('ALIAS')) {
    return 'settings'
  }
  return null
}

export function formatStatusLabel(status: string): string {
  if (!status) return ''
  return status
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

export type AttentionItem = {
  id: string
  label: string
  tab: JobCrmTab
  tone: 'warn' | 'danger' | 'info'
}

export function buildJobAttentionItems(input: {
  overdueMilestoneCount?: number
  overdueRfiCount?: number
  procurementAtRiskCount?: number
  lateDeliveryCount?: number
  billingExceedsKnownContract?: boolean
}): AttentionItem[] {
  const items: AttentionItem[] = []
  if ((input.overdueMilestoneCount ?? 0) > 0) {
    items.push({
      id: 'milestones-overdue',
      label: `${input.overdueMilestoneCount} overdue milestone${input.overdueMilestoneCount === 1 ? '' : 's'}`,
      tab: 'schedule',
      tone: 'danger',
    })
  }
  if ((input.overdueRfiCount ?? 0) > 0) {
    items.push({
      id: 'rfis-overdue',
      label: `${input.overdueRfiCount} overdue RFI${input.overdueRfiCount === 1 ? '' : 's'}`,
      tab: 'changes',
      tone: 'danger',
    })
  }
  if ((input.procurementAtRiskCount ?? 0) > 0) {
    items.push({
      id: 'procurement-risk',
      label: `${input.procurementAtRiskCount} procurement item${input.procurementAtRiskCount === 1 ? '' : 's'} at risk`,
      tab: 'procurement',
      tone: 'warn',
    })
  }
  const late = input.lateDeliveryCount ?? 0
  if (late > 0) {
    items.push({
      id: 'deliveries-late',
      label: late === 1 ? '1 late delivery' : `${late} late deliveries`,
      tab: 'deliveries',
      tone: 'warn',
    })
  }
  if (input.billingExceedsKnownContract) {
    items.push({
      id: 'billing-exceeds',
      label: 'Billing exceeds known revised contract',
      tab: 'billing',
      tone: 'danger',
    })
  }
  return items
}

export function parseNullableMoneyInput(raw: string): number | null | undefined {
  const trimmed = raw.trim().replace(/[$,]/g, '')
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return undefined
  return n
}

export function isJobCrmTab(value: string | null | undefined): value is JobCrmTab {
  return JOB_CRM_TABS.some((t) => t.key === value)
}

export function readJobTabFromUrl(search = typeof window !== 'undefined' ? window.location.search : ''): JobCrmTab | null {
  const params = new URLSearchParams(search)
  const tab = params.get('jobTab')
  return isJobCrmTab(tab) ? tab : null
}

export function writeJobTabToUrl(tab: JobCrmTab): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('jobTab', tab)
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}
