import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { api, type TaskListItem } from '../api'
import { PriorityBadge, StatusBadge } from '../components/Badges'
import {
  getCachedTasksList,
  invalidateTasksListCache,
  setCachedTasksList,
} from '../tasks-list-cache'

interface Props {
  workspaceId: string
  connectionId: string
  connections?: Array<{ email: string }>
  onSelectMessage?: (id: string) => void
  userRole?: string
}

type TaskFilter = 'all' | 'open' | 'completed' | 'overdue' | 'high_priority' | 'requests'
type TaskDateRange = '' | 'TODAY' | 'WEEK' | 'MONTH'

const FILTERS: Array<{ key: TaskFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'requests', label: 'Requests' },
  { key: 'completed', label: 'Completed' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'high_priority', label: 'High Priority' },
]

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function isOverdue(dueAt: string | null, status: string): boolean {
  if (!dueAt || status === 'DONE' || status === 'CANCELLED') return false
  return new Date(dueAt) < new Date()
}

/** Compact Tasks filter chip — scoped here so other ForgeOps buttons stay unchanged. */
function taskFilterChipStyle(active: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    minHeight: 34,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.2,
    borderRadius: 14,
    border: active ? '1px solid #1a1a2e' : '1px solid #ddd',
    background: active ? '#1a1a2e' : '#fff',
    color: active ? '#fff' : '#555',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

export function TasksView({ workspaceId, connectionId, connections, onSelectMessage, userRole }: Props) {
  const isViewer = userRole === 'VIEWER'
  const [allTasks, setAllTasks] = useState<TaskListItem[]>([])
  const [monitoredEmails, setMonitoredEmails] = useState<Set<string>>(() =>
    new Set((connections ?? []).map(c => c.email.toLowerCase()))
  )
  const [page, setPage] = useState(1)
  const [, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<TaskFilter>('open')
  const [dateRange, setDateRange] = useState<TaskDateRange>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMoreRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const hasPaintedRef = useRef(false)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBefore, setBulkBefore] = useState('')
  const [bulkPreview, setBulkPreview] = useState<{ count: number; before: string } | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const browserTimeZone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC'

  const taskListFilters = {
    ...(dateRange ? { dateRange, timezone: browserTimeZone } : {}),
  } as const

  const reloadTasks = () => {
    setRefreshing(true)
    setPage(1)
    api.getTasks(workspaceId, connectionId, 1, 25, taskListFilters)
      .then(r => {
        setAllTasks(r.tasks)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
        hasMoreRef.current = 1 < r.pagination.totalPages
        setCachedTasksList(workspaceId, connectionId, 1, {
          tasks: r.tasks,
          page: 1,
          totalCount: r.pagination.totalCount,
          totalPages: r.pagination.totalPages,
        }, dateRange)
      })
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }

  const runBulkPreview = async () => {
    if (!bulkBefore) return
    setBulkBusy(true)
    setBulkError(null)
    try {
      const preview = await api.previewTaskBulkDelete(
        workspaceId,
        connectionId,
        bulkBefore,
        browserTimeZone
      )
      setBulkPreview({ count: preview.count, before: preview.before })
    } catch (e) {
      setBulkPreview(null)
      setBulkError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const runBulkDelete = async () => {
    if (!bulkBefore || !bulkPreview) return
    const ok = window.confirm(
      `Delete ${bulkPreview.count} tasks before ${bulkBefore}?\n\nTasks on ${bulkBefore} and later will be kept.\nThis cannot be undone.`
    )
    if (!ok) return
    setBulkBusy(true)
    setBulkError(null)
    try {
      await api.bulkDeleteTasks(workspaceId, connectionId, bulkBefore, browserTimeZone)
      setBulkOpen(false)
      setBulkPreview(null)
      setBulkBefore('')
      invalidateTasksListCache(workspaceId, connectionId)
      reloadTasks()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  useEffect(() => {
    if (connections && connections.length > 0) {
      setMonitoredEmails(new Set(connections.map(c => c.email.toLowerCase())))
      return
    }
    // Fallback only when App did not pass connections
    api.getConnections(workspaceId)
      .then(r => setMonitoredEmails(new Set(r.connections.map(c => c.email.toLowerCase()))))
      .catch(() => setMonitoredEmails(new Set()))
  }, [workspaceId, connections])

  // Load page 1 whenever workspace/connection/dateRange changes
  useEffect(() => {
    const cached = getCachedTasksList(workspaceId, connectionId, 1, dateRange)
    const soft = hasPaintedRef.current && allTasks.length > 0
    const paintLogged = { current: false }

    if (cached) {
      setAllTasks(cached.tasks)
      setTotalPages(cached.totalPages)
      setTotalCount(cached.totalCount)
      hasMoreRef.current = 1 < cached.totalPages
      hasPaintedRef.current = true
      setLoading(false)
      setRefreshing(true)
      console.info({
        event: 'tasksInitialUsefulPaintMs',
        source: 'cache',
        ms: 0,
        rowCount: cached.tasks.length,
      })
      paintLogged.current = true
    } else if (!soft) {
      setAllTasks([])
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setPage(1)
    if (!cached) setTotalPages(0)

    const t0 = performance.now()
    api.getTasks(workspaceId, connectionId, 1, 25, {
      ...(dateRange ? { dateRange, timezone: browserTimeZone } : {}),
    })
      .then(r => {
        setAllTasks(r.tasks)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
        hasMoreRef.current = 1 < r.pagination.totalPages
        hasPaintedRef.current = true
        setCachedTasksList(workspaceId, connectionId, 1, {
          tasks: r.tasks,
          page: 1,
          totalCount: r.pagination.totalCount,
          totalPages: r.pagination.totalPages,
        }, dateRange)
        if (!paintLogged.current) {
          console.info({
            event: 'tasksInitialUsefulPaintMs',
            source: 'network',
            ms: Math.round(performance.now() - t0),
            rowCount: r.tasks.length,
          })
        }
      })
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reset on workspace/connection/dateRange
  }, [workspaceId, connectionId, dateRange, browserTimeZone])

  // Load subsequent pages
  useEffect(() => {
    if (page <= 1) return
    setLoadingMore(true)
    loadingMoreRef.current = true
    api.getTasks(workspaceId, connectionId, page, 25, {
      ...(dateRange ? { dateRange, timezone: browserTimeZone } : {}),
    })
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
  }, [page, workspaceId, connectionId, dateRange, browserTimeZone])

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>Tasks</h2>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
              {filteredTasks.length} {filter === 'all' ? 'tasks' : filter.replace('_', ' ') + ' tasks'}{filter !== 'all' ? ` of ${totalCount}` : ''}
              {refreshing ? ' · Updating…' : ''}
            </p>
          </div>
          {!isViewer && (
            <button
              type="button"
              onClick={() => {
                setBulkOpen(true)
                setBulkError(null)
                setBulkPreview(null)
              }}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: '1px solid #ef9a9a', background: '#fff', color: '#c62828', cursor: 'pointer',
              }}
            >
              Delete tasks before date…
            </button>
          )}
        </div>

        {bulkOpen && (
          <div style={{
            marginBottom: 12, padding: 14, border: '1px solid #ffcdd2', borderRadius: 8,
            background: '#fff8f8',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#b71c1c' }}>
              Delete tasks before a cutoff date
            </div>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 10px' }}>
              Uses each task&apos;s <strong>source date</strong> (email date for email-sourced tasks).
              Tasks on the selected date and later are kept. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="date"
                value={bulkBefore}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  setBulkBefore(e.target.value)
                  setBulkPreview(null)
                  setBulkError(null)
                }}
                style={{ padding: '6px 8px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
              />
              <button
                type="button"
                disabled={!bulkBefore || bulkBusy}
                onClick={() => void runBulkPreview()}
                style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  border: '1px solid #1a1a2e', background: '#1a1a2e', color: '#fff',
                  cursor: !bulkBefore || bulkBusy ? 'not-allowed' : 'pointer',
                  opacity: !bulkBefore || bulkBusy ? 0.5 : 1,
                }}
              >
                Preview count
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkOpen(false)
                  setBulkPreview(null)
                  setBulkError(null)
                }}
                style={{
                  padding: '6px 12px', fontSize: 12, borderRadius: 6,
                  border: '1px solid #ddd', background: '#fff', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
            {bulkError && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#c62828' }}>{bulkError}</div>
            )}
            {bulkPreview && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  Delete <strong>{bulkPreview.count}</strong> tasks before{' '}
                  <strong>
                    {new Date(bulkPreview.before + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </strong>
                  ? Tasks dated that day and later will be kept.
                </div>
                <button
                  type="button"
                  disabled={bulkBusy || bulkPreview.count === 0}
                  onClick={() => void runBulkDelete()}
                  style={{
                    padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                    border: 'none', background: '#c62828', color: '#fff',
                    cursor: bulkBusy || bulkPreview.count === 0 ? 'not-allowed' : 'pointer',
                    opacity: bulkBusy || bulkPreview.count === 0 ? 0.5 : 1,
                  }}
                >
                  {bulkBusy ? 'Deleting…' : `Delete ${bulkPreview.count} tasks`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Compact date + status filter toolbar (presentation only — semantics unchanged). */}
        <div
          role="toolbar"
          aria-label="Task filters"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {([['', 'All dates'], ['TODAY', 'Today'], ['WEEK', 'This week'], ['MONTH', 'This month']] as const).map(
              ([key, label]) => {
                const active = dateRange === key
                return (
                  <button
                    key={key || 'all-dates'}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDateRange(key)}
                    style={taskFilterChipStyle(active)}
                  >
                    {label}
                  </button>
                )
              }
            )}
          </div>

          <span
            aria-hidden="true"
            style={{
              width: 1,
              alignSelf: 'stretch',
              minHeight: 22,
              background: '#ddd',
              flexShrink: 0,
            }}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {FILTERS.map((f) => {
              const active = filter === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  style={taskFilterChipStyle(active)}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && allTasks.length === 0 ? (
          <p style={{ color: '#888', padding: 8 }}>Loading tasks...</p>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-icon">{'\u2611'}</div>
            <h3>No {filter === 'all' ? '' : filter.replace('_', ' ')} tasks</h3>
            <p>{
              filter === 'open' ? 'All tasks are completed.'
              : filter === 'requests' ? 'No request tasks yet. These come from emails sent by monitored inboxes.'
              : filter === 'overdue' ? 'No overdue tasks.'
              : 'Tasks appear here after email analysis.'
            }</p>
          </div>
        ) : (
          <div>
            {filteredTasks.map((item) => {
              const { task, sourceMessage } = item
              const isDone = task.status === 'DONE'
              const isRequest = isRequestTask(item)
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
                      {!isRequest && <PriorityBadge priority={task.priority} />}
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
                    <span>Date: {formatDate(task.sourceDate ?? task.createdAt)}</span>
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
