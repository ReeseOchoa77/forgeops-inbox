import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BUSINESS_SUBTYPE_FILTER_OPTIONS } from '@forgeops/shared/business-subtypes'
import { api, type TaskListFilters, type TaskListItem } from '../api'
import { TaskListRow, taskFilterSelectStyle } from '../components/TaskListRow'
import {
  getCachedTasksList,
  invalidateTasksListCache,
  patchCachedTasksListPin,
  setCachedTasksList,
  sortTasksPinnedFirst,
  TASKS_LIST_FRESH_MS,
} from '../tasks-list-cache'

interface Props {
  workspaceId: string
  connectionId: string
  connections?: Array<{ email: string }>
  onSelectMessage?: (id: string) => void
  userRole?: string
  currentUserId?: string
}

const selectStyle = taskFilterSelectStyle()

export function TasksView({
  workspaceId,
  connectionId,
  onSelectMessage,
  userRole,
  currentUserId,
}: Props) {
  const isViewer = userRole === 'VIEWER'
  const canViewWorkspaceTasks = userRole === 'OWNER' || userRole === 'ADMIN'
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState<number | null>(0)
  const [totalCount, setTotalCount] = useState<number | null>(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadGen, setLoadGen] = useState(0)

  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'COMPLETED' | 'ALL'>('OPEN')
  const [due, setDue] = useState<TaskListFilters['due']>('ALL')
  const [priority, setPriority] = useState<TaskListFilters['priority']>('ALL')
  const [source, setSource] = useState<TaskListFilters['source']>('ALL')
  const [businessTypeKey, setBusinessTypeKey] = useState('')
  const [sender, setSender] = useState('')
  const [senderDraft, setSenderDraft] = useState('')
  /** Canonical ownership: My Tasks vs Requests (requester≠assignee). */
  const [ownershipView, setOwnershipView] = useState<'MY' | 'REQUESTS' | 'ALL'>('MY')
  /** Email direction filter (Incoming / Sent) — separate from Requests. */
  const [direction, setDirection] = useState<TaskListFilters['direction']>('ALL')
  /** Admin/Owner: ALL | UNASSIGNED | userId */
  const [tasksFor, setTasksFor] = useState<string>('ALL')
  const [jobId, setJobId] = useState('')
  const [sort, setSort] = useState<TaskListFilters['sort']>('DUE_DATE')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [jobs, setJobs] = useState<Array<{ id: string; name: string; jobNumber: string | null }>>([])
  const [members, setMembers] = useState<
    Array<{ id: string; name: string | null; email: string; role: string }>
  >([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createAssignee, setCreateAssignee] = useState('')
  const [createJobId, setCreateJobId] = useState('')
  const [createDueAt, setCreateDueAt] = useState('')
  const [createPriority, setCreatePriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMoreRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const requestIdRef = useRef(0)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBefore, setBulkBefore] = useState('')
  const [bulkPreview, setBulkPreview] = useState<{ count: number; before: string } | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const browserTimeZone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC'

  const effectiveView: TaskListFilters['view'] =
    canViewWorkspaceTasks && ownershipView === 'ALL' ? 'ALL' : ownershipView === 'REQUESTS' ? 'REQUESTS' : 'MY'

  const filters: TaskListFilters = useMemo(
    () => ({
      view: effectiveView,
      ...(effectiveView === 'ALL' && tasksFor !== 'ALL' ? { assigneeUserId: tasksFor } : {}),
      statusFilter,
      due,
      priority,
      source,
      ...(businessTypeKey ? { businessTypeKey } : {}),
      ...(sender ? { sender } : {}),
      direction,
      ...(jobId ? { jobId } : {}),
      sort,
      timezone: browserTimeZone,
      ...(pinnedOnly ? { pinnedOnly: true } : {}),
    }),
    [
      effectiveView,
      tasksFor,
      statusFilter,
      due,
      priority,
      source,
      businessTypeKey,
      sender,
      direction,
      jobId,
      sort,
      browserTimeZone,
      pinnedOnly,
    ]
  )

  useEffect(() => {
    api
      .getJobsLookup(workspaceId, { showArchived: false })
      .then((r) =>
        setJobs(
          r.jobs.map((j) => ({
            id: j.id,
            name: j.name,
            jobNumber: j.jobNumber,
          }))
        )
      )
      .catch(() => setJobs([]))
  }, [workspaceId])

  useEffect(() => {
    api
      .getTaskAssignees(workspaceId)
      .then((r) => {
        setMembers(r.members)
        if (!createAssignee && currentUserId) {
          setCreateAssignee(currentUserId)
        } else if (!createAssignee && r.members[0]) {
          setCreateAssignee(r.members[0].id)
        }
      })
      .catch(() => setMembers([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init assignee once
  }, [workspaceId, currentUserId])

  const fetchPage = (pageNum: number, mode: 'replace' | 'append' | 'soft') => {
    const reqId = ++requestIdRef.current
    if (mode === 'replace') {
      setError(null)
      setTasks([])
      setLoading(true)
      setRefreshing(false)
      setPage(1)
      setTotalPages(0)
      setTotalCount(0)
      setHasMore(false)
      hasMoreRef.current = false
    } else if (mode === 'soft') {
      setError(null)
      setRefreshing(true)
    } else {
      setLoadingMore(true)
      loadingMoreRef.current = true
    }

    api
      .getTasks(workspaceId, connectionId, pageNum, 25, filters)
      .then((r) => {
        if (reqId !== requestIdRef.current) return
        const more =
          r.pagination.hasMore ??
          (r.pagination.totalPages != null && pageNum < r.pagination.totalPages)
        setTasks((prev) => (mode === 'append' ? [...prev, ...r.tasks] : r.tasks))
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
        setHasMore(more)
        hasMoreRef.current = more
        setPage(pageNum)
        if (pageNum === 1 && mode !== 'append') {
          setCachedTasksList(
            workspaceId,
            connectionId,
            1,
            {
              tasks: r.tasks,
              page: 1,
              totalCount: r.pagination.totalCount,
              totalPages: r.pagination.totalPages,
              hasMore: more,
            },
            filters
          )
        }
        setError(null)
      })
      .catch((e) => {
        if (reqId !== requestIdRef.current) return
        if (mode !== 'append') {
          setTasks([])
          setTotalCount(0)
          setTotalPages(0)
          setHasMore(false)
        }
        setError(e instanceof Error ? e.message : 'Failed to load tasks')
      })
      .finally(() => {
        if (reqId !== requestIdRef.current) return
        setLoading(false)
        setRefreshing(false)
        setLoadingMore(false)
        loadingMoreRef.current = false
      })
  }

  useEffect(() => {
    const cached = getCachedTasksList(workspaceId, connectionId, 1, filters)
    if (cached) {
      setTasks(cached.tasks)
      setTotalPages(cached.totalPages)
      setTotalCount(cached.totalCount)
      setHasMore(cached.hasMore)
      hasMoreRef.current = cached.hasMore
      setLoading(false)
      setError(null)
      if (Date.now() - cached.cachedAt < TASKS_LIST_FRESH_MS) {
        setRefreshing(false)
        return
      }
      fetchPage(1, 'soft')
    } else {
      fetchPage(1, 'replace')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters fingerprint drives reload
  }, [workspaceId, connectionId, loadGen, filters])

  useEffect(() => {
    const sentinel = sentinelRef.current
    const container = scrollRef.current
    if (!sentinel || !container) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          !loadingMoreRef.current &&
          hasMoreRef.current &&
          !loading &&
          !error
        ) {
          fetchPage(page + 1, 'append')
        }
      },
      { root: container, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, page, filters])

  const reloadTasks = () => {
    invalidateTasksListCache(workspaceId, connectionId)
    setLoadGen((n) => n + 1)
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

  const handleComplete = async (taskId: string) => {
    try {
      const updated = await api.setTaskStatus(workspaceId, taskId, 'DONE')
      setTasks((prev) =>
        prev.map((t) => (t.task.id === taskId ? { ...t, task: { ...t.task, ...updated.task } } : t))
      )
    } catch {
      /* */
    }
  }

  const handleReopen = async (taskId: string) => {
    try {
      const updated = await api.setTaskStatus(workspaceId, taskId, 'OPEN')
      setTasks((prev) =>
        prev.map((t) => (t.task.id === taskId ? { ...t, task: { ...t.task, ...updated.task } } : t))
      )
    } catch {
      /* */
    }
  }

  const handleRemove = async (taskId: string) => {
    if (!confirm('Remove this task? It will be dismissed permanently.')) return
    try {
      await api.reviewTask(workspaceId, taskId, 'REJECTED')
      setTasks((prev) => prev.filter((t) => t.task.id !== taskId))
      setTotalCount((prev) => (prev == null ? prev : Math.max(0, prev - 1)))
    } catch {
      /* */
    }
  }

  const handlePin = async (taskId: string, currentlyPinned: boolean) => {
    const newPinned = !currentlyPinned
    const applyLocal = (pinned: boolean) => {
      setTasks((prev) => {
        let next = prev.map((t) =>
          t.task.id === taskId
            ? { ...t, task: { ...t.task, isPinned: pinned } }
            : t
        )
        if (!pinned && pinnedOnly) {
          next = next.filter((t) => t.task.id !== taskId)
        }
        return sortTasksPinnedFirst(next)
      })
      patchCachedTasksListPin({
        workspaceId,
        connectionId,
        taskId,
        isPinned: pinned,
      })
    }
    applyLocal(newPinned)
    try {
      await api.pinTask(workspaceId, taskId, newPinned)
    } catch {
      applyLocal(currentlyPinned)
    }
  }

  const submitCreate = async () => {
    if (!createTitle.trim() || !createAssignee) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      await api.createTask(workspaceId, {
        title: createTitle.trim(),
        description: createDescription.trim() || null,
        assigneeUserId: createAssignee,
        jobId: createJobId || null,
        dueAt: createDueAt ? new Date(`${createDueAt}T12:00:00`).toISOString() : null,
        priority: createPriority,
      })
      setCreateOpen(false)
      setCreateTitle('')
      setCreateDescription('')
      setCreateJobId('')
      setCreateDueAt('')
      setCreatePriority('NORMAL')
      invalidateTasksListCache(workspaceId)
      reloadTasks()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create task')
    } finally {
      setCreateBusy(false)
    }
  }

  const openEmail = (emailId: string) => {
    onSelectMessage?.(emailId)
  }

  const btnStyle = (danger = false): CSSProperties => ({
    padding: '4px 8px',
    fontSize: 11,
    borderRadius: 4,
    border: `1px solid ${danger ? '#ef9a9a' : '#ddd'}`,
    background: '#fff',
    color: danger ? '#c62828' : '#555',
    cursor: 'pointer',
  })

  const memberLabel = (m: { name: string | null; email: string }) =>
    m.name?.trim() ? `${m.name} (${m.email})` : m.email

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>Tasks</h2>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
              {loading
                ? 'Loading…'
                : totalCount != null
                  ? `${totalCount} task${totalCount === 1 ? '' : 's'}`
                  : `${tasks.length}${hasMore ? '+' : ''} task${tasks.length === 1 && !hasMore ? '' : 's'}`}
              {refreshing ? ' · Updating…' : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isViewer && (
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(true)
                  setCreateError(null)
                  if (currentUserId) setCreateAssignee(currentUserId)
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid #1a1a2e',
                  background: '#1a1a2e',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Create Task
              </button>
            )}
            {!isViewer && (
              <button
                type="button"
                onClick={() => {
                  setBulkOpen(true)
                  setBulkError(null)
                  setBulkPreview(null)
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid #ef9a9a',
                  background: '#fff',
                  color: '#c62828',
                  cursor: 'pointer',
                }}
              >
                Delete tasks before date…
              </button>
            )}
          </div>
        </div>

        {createOpen && (
          <div
            style={{
              marginBottom: 12,
              padding: 14,
              border: '1px solid #ddd',
              borderRadius: 8,
              background: '#fafafa',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Create Task</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
              <input
                aria-label="Task title"
                placeholder="Task title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                style={{ ...selectStyle, width: '100%', maxWidth: '100%' }}
              />
              <textarea
                aria-label="Description"
                placeholder="Description / notes (optional)"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                rows={3}
                style={{ ...selectStyle, width: '100%', maxWidth: '100%', resize: 'vertical' }}
              />
              <select
                aria-label="Assigned to"
                value={createAssignee}
                onChange={(e) => setCreateAssignee(e.target.value)}
                style={{ ...selectStyle, maxWidth: '100%' }}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Job"
                value={createJobId}
                onChange={(e) => setCreateJobId(e.target.value)}
                style={{ ...selectStyle, maxWidth: '100%' }}
              >
                <option value="">No Job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobNumber ? `#${j.jobNumber} · ` : ''}
                    {j.name}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="date"
                  aria-label="Due date"
                  value={createDueAt}
                  onChange={(e) => setCreateDueAt(e.target.value)}
                  style={selectStyle}
                />
                <select
                  aria-label="Priority"
                  value={createPriority}
                  onChange={(e) =>
                    setCreatePriority(e.target.value as typeof createPriority)
                  }
                  style={selectStyle}
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              {createError && (
                <div style={{ fontSize: 12, color: '#c62828' }}>{createError}</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={!createTitle.trim() || !createAssignee || createBusy}
                  onClick={() => void submitCreate()}
                  style={{
                    ...btnStyle(),
                    background: '#1a1a2e',
                    color: '#fff',
                    borderColor: '#1a1a2e',
                    fontWeight: 600,
                  }}
                >
                  {createBusy ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  style={btnStyle()}
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {bulkOpen && (
          <div
            style={{
              marginBottom: 12,
              padding: 14,
              border: '1px solid #ffcdd2',
              borderRadius: 8,
              background: '#fff8f8',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#b71c1c' }}>
              Delete tasks before a cutoff date
            </div>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 10px' }}>
              Uses each task&apos;s <strong>source date</strong> (email date for email-sourced tasks).
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
              <button type="button" disabled={!bulkBefore || bulkBusy} onClick={() => void runBulkPreview()}>
                Preview count
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkOpen(false)
                  setBulkPreview(null)
                  setBulkError(null)
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
                  <strong>{bulkPreview.before}</strong>?
                </div>
                <button
                  type="button"
                  disabled={bulkBusy || bulkPreview.count === 0}
                  onClick={() => void runBulkDelete()}
                >
                  {bulkBusy ? 'Deleting…' : `Delete ${bulkPreview.count} tasks`}
                </button>
              </div>
            )}
          </div>
        )}

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
          <div
            role="group"
            aria-label="My Tasks or Requests"
            data-testid="tasks-requests-toggle"
            style={{
              display: 'inline-flex',
              border: '1px solid #ddd',
              borderRadius: 6,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            {(
              [
                { key: 'MY' as const, label: 'My Tasks' },
                { key: 'REQUESTS' as const, label: 'Requests' },
                ...(canViewWorkspaceTasks
                  ? [{ key: 'ALL' as const, label: 'All tasks' }]
                  : []),
              ] as const
            ).map(({ key, label }, i) => {
              const active = ownershipView === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setOwnershipView(key)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    border: 'none',
                    borderLeft: i === 0 ? 'none' : '1px solid #ddd',
                    background: active ? '#1a1a2e' : '#fff',
                    color: active ? '#fff' : '#374151',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {canViewWorkspaceTasks && ownershipView === 'ALL' && (
            <select
              aria-label="Tasks for"
              value={tasksFor}
              onChange={(e) => setTasksFor(e.target.value)}
              style={{ ...selectStyle, maxWidth: 220 }}
            >
              <option value="ALL">Tasks for: All users</option>
              <option value="UNASSIGNED">Tasks for: Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  Tasks for: {m.name?.trim() || m.email}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            data-testid="tasks-pinned-filter"
            aria-pressed={pinnedOnly}
            title="Show only pinned tasks (composes with other filters)"
            onClick={() => setPinnedOnly((prev) => !prev)}
            style={{
              ...selectStyle,
              fontWeight: pinnedOnly ? 600 : 500,
              border: pinnedOnly ? '1px solid #e09400' : selectStyle.border,
              background: pinnedOnly ? '#fff8e1' : '#fff',
              color: pinnedOnly ? '#e09400' : '#374151',
              cursor: 'pointer',
            }}
          >
            Pinned
          </button>
          <select
            aria-label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            style={selectStyle}
          >
            <option value="OPEN">Open</option>
            <option value="COMPLETED">Completed</option>
            <option value="ALL">All statuses</option>
          </select>
          <select
            aria-label="Due date"
            value={due}
            onChange={(e) => setDue(e.target.value as typeof due)}
            style={selectStyle}
          >
            <option value="ALL">All dates</option>
            <option value="OVERDUE">Overdue</option>
            <option value="TODAY">Today</option>
            <option value="WEEK">This week</option>
            <option value="MONTH">This month</option>
            <option value="NONE">No due date</option>
          </select>
          <select
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
            style={selectStyle}
          >
            <option value="ALL">All priorities</option>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
          <select
            aria-label="Job"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            style={{ ...selectStyle, maxWidth: 220 }}
          >
            <option value="">All Jobs</option>
            <option value="NONE">No Job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.jobNumber ? `#${j.jobNumber} · ` : ''}
                {j.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Source"
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
            style={selectStyle}
          >
            <option value="ALL">All sources</option>
            <option value="EMAIL">Email-generated</option>
            <option value="MANUAL">Manual</option>
          </select>
          <select
            aria-label="Email direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
            style={selectStyle}
          >
            <option value="ALL">Direction: All</option>
            <option value="INCOMING">Incoming</option>
            <option value="SENT">Sent</option>
          </select>
          <select
            aria-label="Business subtype"
            value={businessTypeKey}
            onChange={(e) => setBusinessTypeKey(e.target.value)}
            style={{ ...selectStyle, maxWidth: 220 }}
          >
            <option value="">All subtypes</option>
            {BUSINESS_SUBTYPE_FILTER_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            style={selectStyle}
          >
            <option value="DUE_DATE">Sort: Due date</option>
            <option value="PRIORITY">Sort: Priority</option>
            <option value="NEWEST">Sort: Newest</option>
            <option value="OLDEST">Sort: Oldest</option>
          </select>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setSender(senderDraft.trim())
            }}
            style={{ display: 'flex', gap: 4 }}
          >
            <input
              aria-label="Sender"
              placeholder="Sender…"
              value={senderDraft}
              onChange={(e) => setSenderDraft(e.target.value)}
              style={{ ...selectStyle, width: 140 }}
            />
            <button type="submit" style={btnStyle()}>
              Search
            </button>
            {sender ? (
              <button
                type="button"
                style={btnStyle()}
                onClick={() => {
                  setSender('')
                  setSenderDraft('')
                }}
              >
                Clear
              </button>
            ) : null}
          </form>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
        {loading && (
          <div style={{ padding: 48, textAlign: 'center', color: '#888' }}>Loading tasks…</div>
        )}
        {!loading && error && (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ color: '#c62828', marginBottom: 12 }}>{error}</div>
            <button type="button" onClick={() => reloadTasks()} style={btnStyle()}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && tasks.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: '#888', fontSize: 14 }}>
            {ownershipView === 'REQUESTS'
              ? 'No requests match these filters.'
              : 'No tasks match these filters.'}
          </div>
        )}
        {!loading &&
          !error &&
          tasks.map((item) => {
            const sourceEmail =
              item.sourceEmail ??
              (item.sourceMessage
                ? {
                    id: item.sourceMessage.id,
                    subject: item.sourceMessage.subject,
                    senderName: null,
                    senderAddress: item.sourceMessage.senderEmail,
                    sentAt: null,
                    receivedAt: item.sourceMessage.receivedAt,
                    mailboxCategory: null,
                    businessSubtype: null,
                    priority: null,
                    jobId: null,
                    jobNumber: null,
                    jobName: null,
                  }
                : null)
            return (
              <TaskListRow
                key={item.task.id}
                title={item.task.title}
                status={item.task.status}
                priority={item.task.priority}
                dueAt={item.task.dueAt}
                sourceEmail={sourceEmail}
                assignee={item.task.assignee}
                requester={item.task.requester}
                isPinned={item.task.isPinned}
                onOpenEmail={onSelectMessage ? openEmail : undefined}
                actions={
                  !isViewer ? (
                    <>
                      {item.task.status === 'DONE' ? (
                        <button type="button" style={btnStyle()} onClick={() => void handleReopen(item.task.id)}>
                          Reopen
                        </button>
                      ) : (
                        <button type="button" style={btnStyle()} onClick={() => void handleComplete(item.task.id)}>
                          Complete
                        </button>
                      )}
                      <button
                        type="button"
                        style={btnStyle()}
                        onClick={() => void handlePin(item.task.id, !!item.task.isPinned)}
                      >
                        {item.task.isPinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button type="button" style={btnStyle(true)} onClick={() => void handleRemove(item.task.id)}>
                        Remove
                      </button>
                    </>
                  ) : null
                }
              />
            )
          })}
        <div ref={sentinelRef} style={{ height: 1 }} />
        {loadingMore && (
          <div style={{ padding: 16, textAlign: 'center', color: '#888', fontSize: 12 }}>
            Loading more…
          </div>
        )}
      </div>
      {!loading && !error && totalPages != null && totalPages > 1 && (
        <div style={{ fontSize: 11, color: '#aaa', padding: '6px 0', textAlign: 'center' }}>
          Page {page} of {totalPages}
        </div>
      )}
    </div>
  )
}
