import { useEffect, useState } from 'react'
import { api, type TaskListItem } from '../api'
import { PriorityBadge, StatusBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
}

type TaskFilter = 'all' | 'open' | 'completed' | 'overdue' | 'due_today' | 'high_priority'

const FILTERS: Array<{ key: TaskFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'completed', label: 'Completed' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_today', label: 'Due Today' },
  { key: 'high_priority', label: 'High Priority' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function isOverdue(dueAt: string | null, status: string): boolean {
  if (!dueAt || status === 'DONE' || status === 'CANCELLED') return false
  return new Date(dueAt) < new Date()
}

function isDueToday(dueAt: string | null): boolean {
  if (!dueAt) return false
  return new Date(dueAt).toDateString() === new Date().toDateString()
}

export function TasksView({ workspaceId, connectionId }: Props) {
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<TaskFilter>('open')

  useEffect(() => { setPage(1) }, [connectionId, filter])

  useEffect(() => {
    setLoading(true)
    api.getTasks(workspaceId, connectionId, page)
      .then(r => {
        setTasks(r.tasks)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
      })
      .finally(() => setLoading(false))
  }, [workspaceId, connectionId, page])

  const filteredTasks = tasks.filter(({ task }) => {
    switch (filter) {
      case 'open': return task.status === 'OPEN' || task.status === 'IN_PROGRESS'
      case 'completed': return task.status === 'DONE'
      case 'overdue': return isOverdue(task.dueAt, task.status)
      case 'due_today': return isDueToday(task.dueAt) && task.status !== 'DONE'
      case 'high_priority': return (task.priority === 'HIGH' || task.priority === 'URGENT') && task.status !== 'DONE'
      default: return true
    }
  })

  const handleComplete = async (taskId: string) => {
    try {
      await api.reviewTask(workspaceId, taskId, 'APPROVED')
      setTasks(prev => prev.map(t => t.task.id === taskId ? { ...t, task: { ...t.task, status: 'DONE' } } : t))
    } catch { /* */ }
  }

  const handleReopen = async (taskId: string) => {
    try {
      await api.reviewTask(workspaceId, taskId, 'REJECTED')
      setTasks(prev => prev.map(t => t.task.id === taskId ? { ...t, task: { ...t.task, status: 'OPEN' } } : t))
    } catch { /* */ }
  }

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading tasks...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Tasks</h2>
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>{totalCount} tasks extracted from your inbox.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 500, borderRadius: 12,
            border: filter === f.key ? '1px solid #1a1a2e' : '1px solid #ddd',
            background: filter === f.key ? '#1a1a2e' : '#fff',
            color: filter === f.key ? '#fff' : '#666',
            cursor: 'pointer'
          }}>{f.label}</button>
        ))}
      </div>

      {filteredTasks.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <div className="empty-icon">{'\u2611'}</div>
          <h3>No {filter === 'all' ? '' : filter.replace('_', ' ')} tasks</h3>
          <p>{filter === 'open' ? 'All tasks are completed.' : filter === 'overdue' ? 'No overdue tasks.' : 'Tasks appear here after email analysis.'}</p>
        </div>
      ) : (
        <div>
          {filteredTasks.map(({ task, sourceMessage }) => (
            <div key={task.id} className="card" style={{ borderLeft: `3px solid ${isOverdue(task.dueAt, task.status) ? '#c62828' : task.status === 'DONE' ? '#4caf50' : '#1565c0'}`, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, textDecoration: task.status === 'DONE' ? 'line-through' : 'none', color: task.status === 'DONE' ? '#999' : '#333' }}>{task.title}</div>
                  {task.summary && <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 6 }}>{task.summary}</div>}
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
                {sourceMessage && <span>From: {sourceMessage.senderEmail}</span>}
                <span>Created: {formatDate(task.createdAt)}</span>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                {task.status !== 'DONE' && (
                  <button className="btn btn-sm btn-success" onClick={() => handleComplete(task.id)}>Complete</button>
                )}
                {task.status === 'DONE' && (
                  <button className="btn btn-sm btn-outline" onClick={() => handleReopen(task.id)}>Reopen</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span style={{ fontSize: 13, color: '#888' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-sm btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
