import { useEffect, useState } from 'react'
import { api, type TaskListItem, type MessageSummary, type ReviewItem } from '../api'

interface Props {
  workspaceId: string
  connectionId: string
  onNavigate: (page: string) => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return iso ?? '—' }
}

export function DashboardView({ workspaceId, connectionId, onNavigate }: Props) {
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [recentMessages, setRecentMessages] = useState<MessageSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId || !connectionId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      api.getTasks(workspaceId, connectionId, 1).catch(() => ({ tasks: [], pagination: { totalCount: 0, totalPages: 0 } })),
      api.getReviewQueue(workspaceId, connectionId, 1).catch(() => ({ items: [], pagination: { totalCount: 0, totalPages: 0 }, thresholds: { classification: 0, task: 0 } })),
      api.getMessages(workspaceId, connectionId, 1, 5, { businessCategory: 'BUSINESS' }).catch(() => ({ messages: [], pagination: { totalCount: 0, totalPages: 0, page: 1, pageSize: 5 } }))
    ]).then(([t, r, m]) => {
      setTasks(t.tasks.slice(0, 10))
      setReviewItems(r.items.slice(0, 5))
      setRecentMessages(m.messages)
    }).finally(() => setLoading(false))
  }, [workspaceId, connectionId])

  if (!workspaceId) {
    return (
      <div className="empty-state" style={{ padding: 48 }}>
        <h3>Welcome to ForgeOps Inbox</h3>
        <p>Select a workspace to get started.</p>
      </div>
    )
  }

  if (loading) return <p style={{ color: '#888', padding: 8, fontSize: 13 }}>Loading dashboard...</p>

  const urgentTasks = tasks.filter(t => t.task.priority === 'URGENT' || t.task.priority === 'HIGH')
  const overdueTasks = tasks.filter(t => t.task.dueAt && new Date(t.task.dueAt) < new Date() && t.task.status === 'OPEN')
  const openTasks = tasks.filter(t => t.task.status === 'OPEN')

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Dashboard</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>Operational overview for your workspace.</p>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Open Tasks', value: openTasks.length, color: '#1565c0', onClick: () => onNavigate('tasks') },
          { label: 'Urgent / High', value: urgentTasks.length, color: '#c62828', onClick: () => onNavigate('tasks') },
          { label: 'Overdue', value: overdueTasks.length, color: '#e65100', onClick: () => onNavigate('tasks') },
          { label: 'Needs Review', value: reviewItems.length, color: '#f57f17', onClick: () => onNavigate('review') },
        ].map((stat, i) => (
          <div key={i} onClick={stat.onClick} className="card" style={{ cursor: 'pointer', textAlign: 'center', padding: '14px 12px' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: stat.value > 0 ? stat.color : '#ccc' }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Urgent tasks */}
        <div className="card">
          <h3 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>Urgent Tasks</h3>
          {urgentTasks.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 12, margin: 0 }}>No urgent tasks</p>
          ) : (
            urgentTasks.slice(0, 5).map(({ task, sourceMessage }) => (
              <div key={task.id} style={{ padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 12 }}>
                <div style={{ fontWeight: 500 }}>{task.title}</div>
                <div style={{ color: '#999', fontSize: 11 }}>
                  {sourceMessage?.senderEmail ?? '—'} &middot; Due: {formatDate(task.dueAt)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Review queue */}
        <div className="card">
          <h3 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>Needs Review</h3>
          {reviewItems.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 12, margin: 0 }}>No items need review</p>
          ) : (
            reviewItems.map(({ message }) => (
              <div key={message.id} style={{ padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 12 }}>
                <div style={{ fontWeight: 500 }}>{message.subject ?? '(no subject)'}</div>
                <div style={{ color: '#999', fontSize: 11 }}>{message.senderEmail}</div>
              </div>
            ))
          )}
        </div>

        {/* Recent business emails */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>Recent Business Emails</h3>
          {recentMessages.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 12, margin: 0 }}>No business emails synced yet</p>
          ) : (
            recentMessages.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 12 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500 }}>{m.senderName ?? m.senderEmail}</span>
                  <span style={{ color: '#888', marginLeft: 8 }}>{m.subject ?? '(no subject)'}</span>
                </div>
                <div style={{ color: '#aaa', fontSize: 11, flexShrink: 0 }}>{formatDate(m.receivedAt ?? m.sentAt)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
