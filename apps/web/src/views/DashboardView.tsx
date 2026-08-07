import { useEffect, useState } from 'react'
import { api, type TaskListItem, type MessageSummary } from '../api'
import { PriorityBadge, StatusBadge, TypeBadge } from '../components/Badges'
import type { Breakpoint } from '../hooks/useBreakpoint'

interface Props {
  workspaceId: string
  connectionId: string
  onNavigate: (page: 'dashboard' | 'inbox' | 'message-detail' | 'review' | 'tasks' | 'documents' | 'reference' | 'workspace' | 'settings' | 'admin') => void
  breakpoint?: Breakpoint
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return iso ?? '—' }
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function isOverdue(dueAt: string | null, status: string): boolean {
  if (!dueAt || status === 'DONE' || status === 'CANCELLED') return false
  return new Date(dueAt) < new Date()
}

const card = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #eaedf0',
  overflow: 'hidden' as const,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}

export function DashboardView({ workspaceId, connectionId, onNavigate, breakpoint = 'desktop' }: Props) {
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [recentEmails, setRecentEmails] = useState<MessageSummary[]>([])
  const [loading, setLoading] = useState(true)

  const isPhone = breakpoint === 'phone'

  useEffect(() => {
    if (!workspaceId || !connectionId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      api.getTasks(workspaceId, connectionId, 1).catch(() => ({ tasks: [], pagination: { totalCount: 0, totalPages: 0 } })),
      api.getMessages(workspaceId, connectionId, 1, 5, { businessCategory: 'BUSINESS' }).catch(() => ({ messages: [], pagination: { totalCount: 0, totalPages: 0, page: 1, pageSize: 5 } })),
    ]).then(([t, m]) => {
      setTasks(t.tasks)
      setRecentEmails(m.messages)
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

  const pinnedTasks = tasks.filter(t => t.task.isPinned && t.task.status !== 'DONE')
  const overdueTasks = tasks.filter(t => isOverdue(t.task.dueAt, t.task.status) && !t.task.isPinned)
  const highPriorityTasks = tasks.filter(t =>
    (t.task.priority === 'HIGH' || t.task.priority === 'URGENT') &&
    t.task.status !== 'DONE' &&
    !t.task.isPinned &&
    !isOverdue(t.task.dueAt, t.task.status)
  )
  const openCount = tasks.filter(t => t.task.status === 'OPEN' || t.task.status === 'IN_PROGRESS').length
  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.task.createdAt).getTime() - new Date(a.task.createdAt).getTime())
    .slice(0, 5)

  const priorityTotal = pinnedTasks.length + overdueTasks.length + highPriorityTasks.length

  const taskRow = ({ task, sourceMessage }: TaskListItem) => (
    <div key={task.id} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
      borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
      transition: 'background 0.15s',
    }}
      onClick={() => onNavigate('tasks')}
      onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
      onMouseOut={e => (e.currentTarget.style.background = '')}
    >
      <div style={{
        width: 3, height: 28, borderRadius: 2, flexShrink: 0,
        background: task.isPinned ? '#f5a623' : isOverdue(task.dueAt, task.status) ? '#c62828' : task.priority === 'HIGH' || task.priority === 'URGENT' ? '#e65100' : '#1565c0'
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {task.isPinned && <span style={{ color: '#e09400', marginRight: 4, fontSize: 9 }}>●</span>}
          {task.title}
        </div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
          {sourceMessage?.senderEmail ?? '—'}
          {task.dueAt && (
            <span style={{ marginLeft: 8, color: isOverdue(task.dueAt, task.status) ? '#c62828' : '#aaa', fontWeight: isOverdue(task.dueAt, task.status) ? 600 : 400 }}>
              Due {formatDate(task.dueAt)}
            </span>
          )}
        </div>
      </div>
      <PriorityBadge priority={task.priority} />
    </div>
  )

  const subHeader = (label: string, color: string, bg: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.8, padding: '8px 16px 4px', background: bg }}>{label}</div>
  )

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 4px', fontWeight: 700, color: '#1a1a2e', letterSpacing: '-0.3px' }}>Dashboard</h2>
        <p style={{ fontSize: 13, color: '#999', margin: 0 }}>Your workspace at a glance.</p>
      </div>

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: 12, marginBottom: 24
      }}>
        {[
          { label: 'Open Tasks', value: openCount, color: '#1565c0', bg: '#e3f2fd', nav: 'tasks' as const },
          { label: 'High Priority', value: priorityTotal, color: '#e65100', bg: '#fff3e0', nav: 'tasks' as const },
          { label: 'Overdue', value: overdueTasks.length, color: '#c62828', bg: '#ffebee', nav: 'tasks' as const },
          { label: 'Recent Emails', value: recentEmails.length, color: '#1565c0', bg: '#e3f2fd', nav: 'inbox' as const },
        ].map((stat, i) => (
          <div key={i} onClick={() => onNavigate(stat.nav)} style={{
            cursor: 'pointer', textAlign: 'center', padding: isPhone ? '14px 8px' : '18px 12px',
            borderRadius: 12, border: '1px solid #eaedf0',
            background: stat.value > 0 ? stat.bg : '#fafafa',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)' }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)' }}
          >
            <div style={{ fontSize: isPhone ? 28 : 34, fontWeight: 800, color: stat.value > 0 ? stat.color : '#d0d0d0', lineHeight: 1 }}>{stat.value}</div>
            <div style={{ fontSize: 10, color: '#999', marginTop: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr',
        gap: 16
      }}>
        {/* Container 1: Priority Tasks */}
        <div style={card}>
          <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Priority Tasks</span>
              {priorityTotal > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#c62828', color: '#fff' }}>{priorityTotal}</span>
              )}
            </div>
            <button onClick={() => onNavigate('tasks')} style={{ background: 'none', border: 'none', fontSize: 11, color: '#1565c0', cursor: 'pointer', fontWeight: 600 }}>View all →</button>
          </div>

          {priorityTotal === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 6 }}>✓</div>
              <p style={{ color: '#bbb', fontSize: 12, margin: 0 }}>No priority tasks right now</p>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {pinnedTasks.length > 0 && (
                <>
                  {subHeader('Pinned', '#e09400', '#fffde7')}
                  {pinnedTasks.slice(0, 5).map(t => taskRow(t))}
                </>
              )}
              {overdueTasks.length > 0 && (
                <>
                  {subHeader('Overdue', '#c62828', '#ffebee')}
                  {overdueTasks.slice(0, 5).map(t => taskRow(t))}
                </>
              )}
              {highPriorityTasks.length > 0 && (
                <>
                  {subHeader('High Priority', '#e65100', '#fff3e0')}
                  {highPriorityTasks.slice(0, 5).map(t => taskRow(t))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Container 2: 5 Most Recent Tasks */}
        <div style={card}>
          <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Recent Tasks</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#e3f2fd', color: '#1565c0' }}>{recentTasks.length}</span>
            </div>
            <button onClick={() => onNavigate('tasks')} style={{ background: 'none', border: 'none', fontSize: 11, color: '#1565c0', cursor: 'pointer', fontWeight: 600 }}>View all →</button>
          </div>

          {recentTasks.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 6 }}>📋</div>
              <p style={{ color: '#bbb', fontSize: 12, margin: 0 }}>No tasks yet</p>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {recentTasks.map(({ task, sourceMessage }) => (
                <div key={task.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                  borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                  onClick={() => onNavigate('tasks')}
                  onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
                  onMouseOut={e => (e.currentTarget.style.background = '')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: task.status === 'DONE' ? '#4caf50' : '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {task.status === 'DONE' && <span style={{ marginRight: 4 }}>✓</span>}
                      {task.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                      {sourceMessage?.senderEmail ?? '—'}
                      <span style={{ marginLeft: 8, color: '#ccc' }}>{timeAgo(task.createdAt)}</span>
                    </div>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Container 3: Recent Business Emails */}
        <div style={{ ...card, gridColumn: isPhone ? undefined : '1 / -1' }}>
          <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Recent Business Emails</span>
              {recentEmails.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#e3f2fd', color: '#1565c0' }}>{recentEmails.length}</span>
              )}
            </div>
            <button onClick={() => onNavigate('inbox')} style={{ background: 'none', border: 'none', fontSize: 11, color: '#1565c0', cursor: 'pointer', fontWeight: 600 }}>View all →</button>
          </div>

          {recentEmails.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 6 }}>✉</div>
              <p style={{ color: '#bbb', fontSize: 12, margin: 0 }}>No recent business emails</p>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {recentEmails.map(message => (
                <div key={message.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                  borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
                  transition: 'background 0.15s',
                  fontWeight: message.isRead ? 400 : 600,
                }}
                  onClick={() => onNavigate('inbox')}
                  onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
                  onMouseOut={e => (e.currentTarget.style.background = '')}
                >
                  <div style={{
                    width: 3, height: 28, borderRadius: 2, flexShrink: 0,
                    background: message.classification?.priority === 'HIGH' || message.classification?.priority === 'URGENT' ? '#e65100' : '#1565c0'
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: message.isRead ? 500 : 700, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {message.subject ?? '(no subject)'}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, fontWeight: 400 }}>
                      {message.senderName ?? message.senderEmail}
                      <span style={{ marginLeft: 8, color: '#ccc' }}>{timeAgo(message.receivedAt ?? message.sentAt)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    {message.classification && (
                      <TypeBadge type={message.classification.emailType} businessTypeKey={message.classification.businessTypeKey} />
                    )}
                    <PriorityBadge priority={message.classification?.priority ?? null} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
