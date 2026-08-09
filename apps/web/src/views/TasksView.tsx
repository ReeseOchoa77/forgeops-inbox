import { useEffect, useState, useRef } from 'react'
import { api, type TaskListItem } from '../api'
import { PriorityBadge, StatusBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage?: (id: string) => void
  userRole?: string
}

type TaskFilter = 'all' | 'open' | 'completed' | 'overdue' | 'today' | 'this_week' | 'high_priority' | 'requests'

const FILTERS: Array<{ key: TaskFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'requests', label: 'Requests' },
  { key: 'completed', label: 'Completed' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'high_priority', label: 'High Priority' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function isOverdue(dueAt: string | null, status: string): boolean {
  if (!dueAt || status === 'DONE' || status === 'CANCELLED') return false
  return new Date(dueAt) < new Date()
}

function isCreatedToday(createdAt: string): boolean {
  return new Date(createdAt).toDateString() === new Date().toDateString()
}

function isCreatedThisWeek(createdAt: string): boolean {
  const now = new Date()
  const day = now.getDay()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  const d = new Date(createdAt)
  return d >= start && d < end
}

export function TasksView({ workspaceId, connectionId, onSelectMessage, userRole }: Props) {
  const isViewer = userRole === 'VIEWER'
  const [allTasks, setAllTasks] = useState<TaskListItem[]>([])
  const [monitoredEmails, setMonitoredEmails] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<TaskFilter>('open')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMoreRef = useRef(false)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    api.getConnections(workspaceId)
      .then(r => setMonitoredEmails(new Set(r.connections.map(c => c.email.toLowerCase()))))
      .catch(() => setMonitoredEmails(new Set()))
  }, [workspaceId])

  // Load page 1 whenever workspace/connection changes
  useEffect(() => {
    setAllTasks([])
    setPage(1)
    setTotalPages(0)
    setLoading(true)
    api.getTasks(workspaceId, connectionId, 1)
      .then(r => {
        setAllTasks(r.tasks)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
        hasMoreRef.current = 1 < r.pagination.totalPages
      })
      .finally(() => setLoading(false))
  }, [workspaceId, connectionId])

  // Load subsequent pages
  useEffect(() => {
    if (page <= 1) return
    setLoadingMore(true)
    loadingMoreRef.current = true
    api.getTasks(workspaceId, connectionId, page)
      .then(r => {
        setAllTasks(prev => [...prev, ...r.tasks])
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
        hasMoreRef.current = page < r.pagination.totalPages
      })
      .finally(() => {
        setLoadingMore(false)
        loadingMoreRef.current = false
      })
  }, [page, workspaceId, connectionId])

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current
    const container = scrollRef.current
    if (!sentinel || !container) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !loadingMoreRef.current && hasMoreRef.current) {
          setPage(p => p + 1)
        }
      },
      { root: container, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loading])

  const isRequestTask = (item: TaskListItem) => {
    const sender = item.sourceMessage?.senderEmail?.toLowerCase()
    return !!sender && monitoredEmails.has(sender)
  }

  const filteredTasks = allTasks.filter((item) => {
    const { task } = item
    const fromSent = isRequestTask(item)
    switch (filter) {
      // Default views hide tasks from sent/outbound mail (from monitored inboxes)
      case 'open': return !fromSent && (task.status === 'OPEN' || task.status === 'IN_PROGRESS')
      case 'completed': return !fromSent && task.status === 'DONE'
      case 'overdue': return !fromSent && isOverdue(task.dueAt, task.status)
      case 'today': return !fromSent && isCreatedToday(task.createdAt)
      case 'this_week': return !fromSent && isCreatedThisWeek(task.createdAt)
      case 'high_priority': return !fromSent && (task.priority === 'HIGH' || task.priority === 'URGENT') && task.status !== 'DONE'
      case 'requests': return fromSent && task.status !== 'CANCELLED'
      case 'all': return !fromSent
      default: return !fromSent
    }
  }).sort((a, b) => {
    if (a.task.isPinned && !b.task.isPinned) return -1
    if (!a.task.isPinned && b.task.isPinned) return 1
    return 0
  })

  const handleComplete = async (taskId: string) => {
    try {
      await api.reviewTask(workspaceId, taskId, 'APPROVED')
      setAllTasks(prev => prev.map(t => t.task.id === taskId ? { ...t, task: { ...t.task, status: 'DONE' } } : t))
    } catch { /* */ }
  }

  const handleReopen = async (taskId: string) => {
    try {
      await api.reviewTask(workspaceId, taskId, 'REJECTED')
      setAllTasks(prev => prev.map(t => t.task.id === taskId ? { ...t, task: { ...t.task, status: 'OPEN' } } : t))
    } catch { /* */ }
  }

  const handleRemove = async (taskId: string) => {
    if (!confirm('Remove this task? It will be dismissed permanently.')) return
    try {
      await api.reviewTask(workspaceId, taskId, 'REJECTED')
      setAllTasks(prev => prev.filter(t => t.task.id !== taskId))
      setTotalCount(prev => prev - 1)
    } catch { /* */ }
  }

  const handlePin = async (taskId: string, currentlyPinned: boolean) => {
    const newPinned = !currentlyPinned
    setAllTasks(prev => prev.map(t => t.task.id === taskId ? { ...t, task: { ...t.task, isPinned: newPinned } } : t))
    try {
      await api.pinTask(workspaceId, taskId, newPinned)
    } catch {
      setAllTasks(prev => prev.map(t => t.task.id === taskId ? { ...t, task: { ...t.task, isPinned: currentlyPinned } } : t))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Tasks</h2>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>{filteredTasks.length} {filter === 'all' ? 'tasks' : filter.replace('_', ' ') + ' tasks'}{filter !== 'all' ? ` of ${totalCount}` : ''}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 12,
              border: filter === f.key ? '1px solid #1a1a2e' : '1px solid #ddd',
              background: filter === f.key ? '#1a1a2e' : '#fff',
              color: filter === f.key ? '#fff' : '#666',
              cursor: 'pointer', minHeight: 36,
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading ? (
          <p style={{ color: '#888', padding: 8 }}>Loading tasks...</p>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-icon">{'\u2611'}</div>
            <h3>No {filter === 'all' ? '' : filter.replace('_', ' ')} tasks</h3>
            <p>{
              filter === 'open' ? 'All tasks are completed.'
              : filter === 'requests' ? 'No request tasks yet. These come from emails sent by monitored inboxes.'
              : filter === 'overdue' ? 'No overdue tasks.'
              : filter === 'today' ? 'No tasks created today.'
              : filter === 'this_week' ? 'No tasks created this week.'
              : 'Tasks appear here after email analysis.'
            }</p>
          </div>
        ) : (
          <div>
            {filteredTasks.map(({ task, sourceMessage }) => {
              const isDone = task.status === 'DONE'
              return (
                <div key={task.id} className="card" style={{
                  borderLeft: `3px solid ${task.isPinned ? '#f5a623' : isDone ? '#4caf50' : isOverdue(task.dueAt, task.status) ? '#c62828' : '#1565c0'}`,
                  marginBottom: 8,
                  background: task.isPinned ? '#fffde7' : isDone ? '#f6fef6' : '#fff'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1 }}>
                      {!isViewer && (
                        <button
                          title={task.isPinned ? 'Unpin' : 'Pin'}
                          onClick={() => handlePin(task.id, !!task.isPinned)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 11,
                            color: task.isPinned ? '#e09400' : '#d0d0d0', flexShrink: 0, lineHeight: 1,
                            opacity: task.isPinned ? 1 : 0.5, transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '1' }}
                          onMouseLeave={e => { if (!task.isPinned) (e.target as HTMLElement).style.opacity = '0.5' }}
                        >●</button>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: 14, fontWeight: 600, marginBottom: 4,
                          color: isDone ? '#4caf50' : '#333'
                        }}>
                          {isDone && <span style={{ marginRight: 6 }}>{'\u2705'}</span>}
                          {task.title}
                        </div>
                        {task.summary && <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 6 }}>{task.summary}</div>}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>
                      <PriorityBadge priority={task.priority} />
                      <StatusBadge status={task.status} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#888', marginTop: 4, flexWrap: 'wrap' }}>
                    {task.dueAt && (
                      <span style={{ color: isOverdue(task.dueAt, task.status) ? '#c62828' : '#888', fontWeight: isOverdue(task.dueAt, task.status) ? 600 : 400 }}>
                        Due: {formatDate(task.dueAt)}
                      </span>
                    )}
                    {task.assigneeGuess && <span>Assignee: {task.assigneeGuess}</span>}
                    {sourceMessage && (
                      <span
                        style={{ color: '#06c', cursor: onSelectMessage ? 'pointer' : 'default' }}
                        onClick={() => sourceMessage.id && onSelectMessage?.(sourceMessage.id)}
                      >
                        Source: {sourceMessage.subject?.slice(0, 40) ?? sourceMessage.senderEmail}
                      </span>
                    )}
                    <span>Created: {formatDate(task.createdAt)}</span>
                  </div>

                  {!isViewer && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                      {!isDone && (
                        <button className="btn btn-sm btn-success" onClick={() => handleComplete(task.id)}>Complete</button>
                      )}
                      {isDone && (
                        <button className="btn btn-sm btn-outline" onClick={() => handleReopen(task.id)}>Reopen</button>
                      )}
                      <button className="btn btn-sm btn-danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handleRemove(task.id)}>Remove</button>
                    </div>
                  )}
                </div>
              )
            })}

            {loadingMore && (
              <p style={{ textAlign: 'center', color: '#888', padding: 12, fontSize: 13 }}>Loading more...</p>
            )}

            <div ref={sentinelRef} style={{ height: 1 }} />
          </div>
        )}
      </div>
    </div>
  )
}
