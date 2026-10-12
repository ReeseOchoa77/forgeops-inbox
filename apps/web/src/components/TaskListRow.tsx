import type { CSSProperties } from 'react'
import { businessSubtypeLabel } from '@forgeops/shared/business-subtypes'
import type { TaskSourceEmail, TaskUserLite } from '../api'
import { PriorityBadge, StatusBadge } from './Badges'

function displayUserName(user: TaskUserLite | null | undefined): string | null {
  if (!user) return null
  const name = user.name?.trim()
  return name || user.email || null
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function isOverdue(dueAt: string | null, status: string): boolean {
  if (!dueAt || status === 'DONE' || status === 'CANCELLED') return false
  return new Date(dueAt) < new Date()
}

const selectStyle: CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fff',
  color: '#333',
  maxWidth: 180,
}

export function taskFilterSelectStyle(): CSSProperties {
  return selectStyle
}

export function TaskProvenanceLine({
  sourceEmail,
  onOpenEmail,
}: {
  sourceEmail: TaskSourceEmail | null | undefined
  onOpenEmail?: (emailId: string) => void
}) {
  if (!sourceEmail) {
    return <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Manual task</div>
  }
  const subtype = businessSubtypeLabel(sourceEmail.businessSubtype)
  const sender =
    sourceEmail.senderName?.trim() ||
    sourceEmail.senderAddress ||
    'Unknown sender'
  return (
    <div style={{ marginTop: 2 }}>
      <button
        type="button"
        onClick={() => onOpenEmail?.(sourceEmail.id)}
        style={{
          display: 'block',
          padding: 0,
          border: 'none',
          background: 'none',
          color: '#1565c0',
          fontSize: 12,
          fontWeight: 500,
          cursor: onOpenEmail ? 'pointer' : 'default',
          textAlign: 'left',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={sourceEmail.subject ?? undefined}
      >
        {sourceEmail.subject?.trim() || '(no subject)'}
      </button>
      <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
        {sender}
        {subtype ? ` · ${subtype}` : ''}
      </div>
    </div>
  )
}

export function TaskListRow({
  title,
  status,
  priority,
  dueAt,
  sourceEmail,
  assignee,
  requester,
  isPinned,
  onOpenEmail,
  actions,
}: {
  title: string
  status: string
  priority: string
  dueAt: string | null
  sourceEmail?: TaskSourceEmail | null
  assignee?: TaskUserLite | null
  requester?: TaskUserLite | null
  isPinned?: boolean
  onOpenEmail?: (emailId: string) => void
  actions?: React.ReactNode
}) {
  const overdue = isOverdue(dueAt, status)
  const assigneeLabel = displayUserName(assignee)
  const requesterLabel = displayUserName(requester)
  const ownershipBits: string[] = []
  if (assigneeLabel) ownershipBits.push(`Assigned to ${assigneeLabel}`)
  if (requesterLabel) ownershipBits.push(`Requested by ${requesterLabel}`)
  else if (sourceEmail && !requester) ownershipBits.push('Requested via email')

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 14px',
        borderBottom: '1px solid #f0f0f0',
        borderLeft: isPinned ? '3px solid #f5a623' : 'none',
        alignItems: 'flex-start',
        background: isPinned ? '#fffde7' : '#fff',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>
          {isPinned ? '📌 ' : ''}
          {title}
        </div>
        <TaskProvenanceLine sourceEmail={sourceEmail} onOpenEmail={onOpenEmail} />
        {ownershipBits.length > 0 ? (
          <div style={{ fontSize: 11, color: '#777', marginTop: 3 }}>
            {ownershipBits.join(' · ')}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 8,
            fontSize: 12,
            color: '#666',
            alignItems: 'center',
          }}
        >
          <span style={{ color: overdue ? '#c62828' : '#666', fontWeight: overdue ? 600 : 400 }}>
            Due {formatDate(dueAt)}
          </span>
          <PriorityBadge priority={priority} />
          <StatusBadge status={status} />
        </div>
      </div>
      {actions ? <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>{actions}</div> : null}
    </div>
  )
}
