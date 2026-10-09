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
}

const selectStyle = taskFilterSelectStyle()

export function TasksView({
  workspaceId,
  connectionId,
  onSelectMessage,
  userRole,
}: Props) {
  const isViewer = userRole === 'VIEWER'
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
  const [emailClassification, setEmailClassification] =
    useState<TaskListFilters['emailClassification']>('ALL')
  const [businessTypeKey, setBusinessTypeKey] = useState('')
  const [sender, setSender] = useState('')
  const [senderDraft, setSenderDraft] = useState('')
  const [direction, setDirection] = useState<TaskListFilters['direction']>('ALL')
  const [jobId, setJobId] = useState('')
  const [sort, setSort] = useState<TaskListFilters['sort']>('DUE_DATE')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [jobs, setJobs] = useState<Array<{ id: string; name: string; jobNumber: string | null }>>([])

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

  const filters: TaskListFilters = useMemo(
    () => ({
      statusFilter,
      due,
      priority,
      source,
      emailClassification,
      ...(businessTypeKey ? { businessTypeKey } : {}),
      ...(sender ? { sender } : {}),
      direction,
      ...(jobId ? { jobId } : {}),
      sort,
      timezone: browserTimeZone,
      ...(pinnedOnly ? { pinnedOnly: true } : {}),
    }),
    [
      statusFilter,
      due,
      priority,
      source,
      emailClassification,
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

  // Soft-cache paint for page 1; skip network when cache is fresh.
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
      await api.reviewTask(workspaceId, taskId, 'APPROVED')
      setTasks((prev) =>
        prev.map((t) =>
          t.task.id === taskId ? { ...t, task: { ...t.task, status: 'DONE' } } : t
        )
      )
    } catch {
      /* */
    }
  }

  const handleReopen = async (taskId: string) => {
    try {
      await api.reviewTask(workspaceId, taskId, 'REJECTED')
      setTasks((prev) =>
        prev.map((t) =>
          t.task.id === taskId ? { ...t, task: { ...t.task, status: 'OPEN' } } : t
        )
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
            aria-label="Email classification"
            value={emailClassification}
            onChange={(e) =>
              setEmailClassification(e.target.value as typeof emailClassification)
            }
            style={selectStyle}
          >
            <option value="ALL">All classifications</option>
            <option value="BUSINESS">Business</option>
            <option value="PERSONAL">Personal</option>
            <option value="UNCLASSIFIED">Unclassified</option>
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
            aria-label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
            style={selectStyle}
          >
            <option value="ALL">All directions</option>
            <option value="INCOMING">Incoming</option>
            <option value="SENT">Sent</option>
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
            No tasks match these filters.
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
