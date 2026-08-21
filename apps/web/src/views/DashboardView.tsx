import { useEffect, useState, type CSSProperties } from 'react'
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

function isDueToday(dueAt: string | null, status: string): boolean {
  if (!dueAt || status === 'DONE' || status === 'CANCELLED') return false
  const due = new Date(dueAt)
  const now = new Date()
  return due.getFullYear() === now.getFullYear()
    && due.getMonth() === now.getMonth()
    && due.getDate() === now.getDate()
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #eaedf0',
  overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
}

const cardBody: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  marginTop: 8,
  WebkitOverflowScrolling: 'touch',
}

export function DashboardView({ workspaceId, connectionId, onNavigate, breakpoint = 'desktop' }: Props) {
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [recentEmails, setRecentEmails] = useState<MessageSummary[]>([])
  const [unreadBusinessCount, setUnreadBusinessCount] = useState(0)
  const [monitoredEmails, setMonitoredEmails] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const isPhone = breakpoint === 'phone'

  useEffect(() => {
    if (!workspaceId || !connectionId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      api.getTasks(workspaceId, connectionId, 1, 100).catch(() => ({ tasks: [], pagination: { totalCount: 0, totalPages: 0 } })),
      api.getMessages(workspaceId, connectionId, 1, 6, { businessCategory: 'BUSINESS' }).catch(() => ({ messages: [], pagination: { totalCount: 0, totalPages: 0, page: 1, pageSize: 6, hasMore: false } })),
      api.getMessages(workspaceId, connectionId, 1, 1, { businessCategory: 'BUSINESS', unreadOnly: true, includeTotal: true }).catch(() => ({ messages: [], pagination: { totalCount: 0, totalPages: 0, page: 1, pageSize: 1, hasMore: false } })),
      api.getConnections(workspaceId).catch(() => ({ connections: [] })),
    ]).then(([t, m, unread, c]) => {
      setTasks(t.tasks)
      setRecentEmails(m.messages)
      const unreadTotal = unread.pagination.totalCount
      setUnreadBusinessCount(typeof unreadTotal === 'number' ? unreadTotal : 0)
      setMonitoredEmails(new Set(c.connections.map(conn => conn.email.toLowerCase())))
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

  const isRequestTask = (item: TaskListItem) => {
    const sender = item.sourceMessage?.senderEmail?.toLowerCase()
    return !!sender && monitoredEmails.has(sender)
  }

  // Inbox tasks = not from sent/outbound mail
  const inboxTasks = tasks.filter(t => !isRequestTask(t))
  const requestTasks = tasks.filter(t => isRequestTask(t) && t.task.status !== 'CANCELLED')
  const openRequests = requestTasks.filter(t => t.task.status === 'OPEN' || t.task.status === 'IN_PROGRESS')

  const pinnedTasks = inboxTasks.filter(t => t.task.isPinned && t.task.status !== 'DONE')
  const overdueTasks = inboxTasks.filter(t => isOverdue(t.task.dueAt, t.task.status))
  const highPriorityTasks = inboxTasks.filter(t =>
    (t.task.priority === 'HIGH' || t.task.priority === 'URGENT') &&
    t.task.status !== 'DONE' &&
    !t.task.isPinned &&
    !isOverdue(t.task.dueAt, t.task.status)
  )
  const openCount = inboxTasks.filter(t => t.task.status === 'OPEN' || t.task.status === 'IN_PROGRESS').length
  const dueTodayCount = inboxTasks.filter(t => isDueToday(t.task.dueAt, t.task.status)).length

  // New tasks: recently created open inbox tasks
  const newTasks = [...inboxTasks]
    .filter(t => t.task.status === 'OPEN' || t.task.status === 'IN_PROGRESS')
    .sort((a, b) => new Date(b.task.createdAt).getTime() - new Date(a.task.createdAt).getTime())

  // Requests shown: open first, then recent done
  const recentRequests = [...requestTasks]
    .sort((a, b) => {
      const aOpen = a.task.status === 'OPEN' || a.task.status === 'IN_PROGRESS' ? 0 : 1
      const bOpen = b.task.status === 'OPEN' || b.task.status === 'IN_PROGRESS' ? 0 : 1
      if (aOpen !== bOpen) return aOpen - bOpen
      return new Date(b.task.createdAt).getTime() - new Date(a.task.createdAt).getTime()
    })

  // Exclude sent/outbound mail (same rule as inbox All tab)
  const inboxBusinessEmails = recentEmails
    .filter(m => !monitoredEmails.has(m.senderEmail.toLowerCase()))
    .slice(0, 6)

  const priorityItems = [
    ...pinnedTasks,
    ...overdueTasks.filter(t => !t.task.isPinned),
    ...highPriorityTasks,
  ]
  // Dedupe by id while preserving order
  const seen = new Set<string>()
  const priorityTasks = priorityItems.filter(t => {
    if (seen.has(t.task.id)) return false
    seen.add(t.task.id)
    return true
  })

  const priorityTotal = priorityTasks.length

  const emptyState = (symbol: string, text: string) => (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 6 }}>{symbol}</div>
      <p style={{ color: '#bbb', fontSize: 12, margin: 0 }}>{text}</p>
    </div>
  )

  const sectionHeader = (title: string, count: number | null, countColor: string, countBg: string, nav: Parameters<Props['onNavigate']>[0], linkLabel = 'View all →') => (
    <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>{title}</span>
        {count !== null && count > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: countBg, color: countColor }}>{count}</span>
        )}
      </div>
      <button onClick={() => onNavigate(nav)} style={{ background: 'none', border: 'none', fontSize: 11, color: '#1565c0', cursor: 'pointer', fontWeight: 600 }}>{linkLabel}</button>
    </div>
  )

  const taskRow = ({ task, sourceMessage }: TaskListItem, opts?: { hidePriority?: boolean; subtitle?: string }) => (
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
        <div style={{ fontSize: 13, fontWeight: 600, color: task.status === 'DONE' ? '#4caf50' : '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {task.isPinned && <span style={{ color: '#e09400', marginRight: 4, fontSize: 9 }}>●</span>}
          {task.status === 'DONE' && <span style={{ marginRight: 4 }}>✓</span>}
          {task.title}
        </div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {opts?.subtitle ?? sourceMessage?.senderEmail ?? '—'}
          {task.dueAt && (
            <span style={{ marginLeft: 8, color: isOverdue(task.dueAt, task.status) ? '#c62828' : '#aaa', fontWeight: isOverdue(task.dueAt, task.status) ? 600 : 400 }}>
              Due {formatDate(task.dueAt)}
            </span>
          )}
          {!task.dueAt && (
            <span style={{ marginLeft: 8, color: '#ccc' }}>{timeAgo(task.createdAt)}</span>
          )}
        </div>
      </div>
      {opts?.hidePriority ? <StatusBadge status={task.status} /> : <PriorityBadge priority={task.priority} />}
    </div>
  )

  const subHeader = (label: string, color: string, bg: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.8, padding: '8px 16px 4px', background: bg }}>{label}</div>
  )

  const metrics = [
    { label: 'Open Tasks', value: openCount, color: '#1565c0', bg: '#e3f2fd', nav: 'tasks' as const },
    { label: 'Overdue', value: overdueTasks.length, color: '#c62828', bg: '#ffebee', nav: 'tasks' as const },
    { label: 'Unread Business', value: unreadBusinessCount, color: '#6a1b9a', bg: '#f3e5f5', nav: 'inbox' as const },
    { label: 'Requests', value: openRequests.length, color: '#00695c', bg: '#e0f2f1', nav: 'tasks' as const },
    { label: 'Due Today', value: dueTodayCount, color: '#e65100', bg: '#fff3e0', nav: 'tasks' as const },
  ]

  const phoneCard = isPhone ? { ...card, maxHeight: 280 } : card

  return (
    <div style={{
      height: '100%',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: isPhone ? 'auto' : 'hidden',
    }}>
      <div style={{ flexShrink: 0, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, margin: '0 0 2px', fontWeight: 700, color: '#1a1a2e', letterSpacing: '-0.3px' }}>Dashboard</h2>
        <p style={{ fontSize: 12, color: '#999', margin: 0 }}>Priority work, new tasks, requests, and recent business mail.</p>
      </div>

      {/* Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
        gap: 10,
        marginBottom: 12,
        flexShrink: 0,
      }}>
        {metrics.map((stat, i) => (
          <div key={i} onClick={() => onNavigate(stat.nav)} style={{
            cursor: 'pointer', textAlign: 'center', padding: isPhone ? '12px 8px' : '14px 10px',
            borderRadius: 12, border: '1px solid #eaedf0',
            background: stat.value > 0 ? stat.bg : '#fafafa',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)' }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)' }}
          >
            <div style={{ fontSize: isPhone ? 24 : 28, fontWeight: 800, color: stat.value > 0 ? stat.color : '#d0d0d0', lineHeight: 1 }}>{stat.value}</div>
            <div style={{ fontSize: 10, color: '#999', marginTop: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr',
        gridTemplateRows: isPhone ? undefined : '1fr 1fr',
        gap: 12,
        overflow: isPhone ? 'visible' : 'hidden',
      }}>
        {/* Priority Tasks */}
        <div style={phoneCard}>
          {sectionHeader('Priority Tasks', priorityTotal, '#fff', '#c62828', 'tasks')}

          {priorityTotal === 0 ? emptyState('✓', 'No priority tasks right now') : (
            <div style={cardBody}>
              {pinnedTasks.length > 0 && (
                <>
                  {subHeader('Pinned', '#e09400', '#fffde7')}
                  {pinnedTasks.map(t => taskRow(t))}
                </>
              )}
              {overdueTasks.filter(t => !t.task.isPinned).length > 0 && (
                <>
                  {subHeader('Overdue', '#c62828', '#ffebee')}
                  {overdueTasks.filter(t => !t.task.isPinned).map(t => taskRow(t))}
                </>
              )}
              {highPriorityTasks.length > 0 && (
                <>
                  {subHeader('High Priority', '#e65100', '#fff3e0')}
                  {highPriorityTasks.map(t => taskRow(t))}
                </>
              )}
            </div>
          )}
        </div>

        {/* New Tasks */}
        <div style={phoneCard}>
          {sectionHeader('New Tasks', newTasks.length, '#1565c0', '#e3f2fd', 'tasks')}

          {newTasks.length === 0 ? emptyState('📋', 'No new open tasks') : (
            <div style={cardBody}>
              {newTasks.map(item => taskRow(item, {
                subtitle: `${item.sourceMessage?.senderEmail ?? '—'} · ${timeAgo(item.task.createdAt)}`,
              }))}
            </div>
          )}
        </div>

        {/* Requests — what you've asked for / assigned via sent mail */}
        <div style={phoneCard}>
          {sectionHeader('Requests', openRequests.length, '#00695c', '#e0f2f1', 'tasks')}
          <p style={{ fontSize: 11, color: '#999', margin: '6px 16px 0', flexShrink: 0 }}>
            Reminders from your sent mail — things you've asked for or assigned.
          </p>

          {recentRequests.length === 0 ? emptyState('↗', 'No outbound requests yet') : (
            <div style={cardBody}>
              {recentRequests.map(item => taskRow(item, {
                hidePriority: true,
                subtitle: item.sourceMessage?.subject
                  ? `You asked · ${item.sourceMessage.subject}`
                  : `You asked · ${timeAgo(item.task.createdAt)}`,
              }))}
            </div>
          )}
        </div>

        {/* Recent Business Emails */}
        <div style={phoneCard}>
          {sectionHeader('Recent Business Emails', inboxBusinessEmails.length, '#1565c0', '#e3f2fd', 'inbox')}

          {inboxBusinessEmails.length === 0 ? emptyState('✉', 'No recent business emails') : (
            <div style={cardBody}>
              {inboxBusinessEmails.map(message => (
                <div key={message.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                  borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
                  transition: 'background 0.15s',
                  background: message.isRead ? undefined : '#f0f4ff',
                  fontWeight: message.isRead ? 400 : 600,
                }}
                  onClick={() => onNavigate('inbox')}
                  onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
                  onMouseOut={e => (e.currentTarget.style.background = message.isRead ? '' : '#f0f4ff')}
                >
                  <div style={{
                    width: 3, height: 28, borderRadius: 2, flexShrink: 0,
                    background: message.isRead ? '#c5cae9' : '#1565c0'
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
                  {message.classification && (
                    <div style={{ flexShrink: 0 }}>
                      <TypeBadge type={message.classification.emailType} businessTypeKey={message.classification.businessTypeKey} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
