import { useEffect, useState, useCallback, useRef } from 'react'
import { api, ApiRequestError, type JobSummary, type CustomerSummary } from '../api'
import type { Breakpoint } from '../hooks/useBreakpoint'
import { JobImportView } from './JobImportView'
import { CustomerSelectOrCreate } from '../components/CustomerSelectOrCreate'
import { JobsInlineFieldCell } from '../components/JobsInlineField'
import {
  getCachedJobsList,
  invalidateJobsListCache,
  jobsListCacheKey,
  setCachedJobsList,
} from '../jobs-list-cache'
import { isCurrentJobsRequest, JOBS_SEARCH_DEBOUNCE_MS } from '../jobs-search'
import {
  getJobListSort,
  JOB_LIST_SORT_OPTIONS,
  jobListSortFromValue,
  jobListSortValue,
  setJobListSort,
  type JobListSortDir,
} from '../job-list-sort'
import {
  applyJobInlineUpdateToSummary,
  buildJobInlineFieldUpdate,
  isJobsInlineCell,
  jobInlineFieldChanged,
  jobInlineFieldDisplay,
  jobInlineFieldDraft,
  jobsInlineCellKey,
  type JobsInlineActiveCell,
  type JobsInlineField,
} from '../jobs-inline-edit'
import { loadJobsState, persistJobsState } from '../workspace-state'

interface Props {
  workspaceId: string
  userId?: string
  userRole: string
  onSelectJob: (jobId: string, summary?: JobSummary) => void
  breakpoint?: Breakpoint
}

const STATUSES = ['ALL', 'BIDDING', 'ACTIVE', 'ON_HOLD', 'COMPLETE', 'ARCHIVED'] as const

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  LEAD: { bg: '#e9ecef', color: '#495057' },
  BIDDING: { bg: '#dbeafe', color: '#1d4ed8' },
  AWARDED: { bg: '#ede9fe', color: '#7c3aed' },
  ACTIVE: { bg: '#dcfce7', color: '#16a34a' },
  ON_HOLD: { bg: '#fef9c3', color: '#a16207' },
  COMPLETE: { bg: '#ccfbf1', color: '#0d9488' },
  ARCHIVED: { bg: '#e9ecef', color: '#6b7280' },
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_COLORS[status] ?? { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, background: style.bg, color: style.color,
      textTransform: 'uppercase', letterSpacing: 0.3
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function relativeTime(d: string | null) {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(d)
}

interface CreateJobFormState {
  jobNumber: string
  name: string
  status: string
  customerId: string
  description: string
  startDate: string
  targetCompletionDate: string
  aliases: string
}

const EMPTY_FORM: CreateJobFormState = {
  jobNumber: '', name: '', status: 'ACTIVE', customerId: '',
  description: '', startDate: '', targetCompletionDate: '', aliases: ''
}

export function JobsView({ workspaceId, userId, userRole, onSelectJob, breakpoint = 'desktop' }: Props) {
  const restoredJobs = userId ? loadJobsState({ workspaceId, userId }) : null
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState(() => restoredJobs?.search ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(() => restoredJobs?.search ?? '')
  const [statusFilter, setStatusFilter] = useState(() => restoredJobs?.statusFilter ?? 'ALL')
  const [customerFilter, setCustomerFilter] = useState(() => restoredJobs?.customerFilter ?? '')
  const [assignedUserFilter, setAssignedUserFilter] = useState(() => restoredJobs?.assignedUserFilter ?? '')
  const [hasOverdueTasks, setHasOverdueTasks] = useState(() => restoredJobs?.hasOverdueTasks ?? false)
  const [showArchived, setShowArchived] = useState(() => restoredJobs?.showArchived ?? false)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [workspaceJobsTotal, setWorkspaceJobsTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const initialSort = restoredJobs
    ? { sortBy: restoredJobs.sortBy, sortDir: restoredJobs.sortDir }
    : getJobListSort()
  const [sortBy, setSortBy] = useState(initialSort.sortBy)
  const [sortDir, setSortDir] = useState<JobListSortDir>(initialSort.sortDir)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [form, setForm] = useState<CreateJobFormState>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  /** Page-level Edit mode. Default OFF — Jobs list stays read-only. */
  const [editMode, setEditMode] = useState(false)
  const [activeCell, setActiveCell] = useState<JobsInlineActiveCell | null>(null)
  const [activeDraft, setActiveDraft] = useState('')
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ jobId: string; field: JobsInlineField; message: string } | null>(null)

  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const hasPaintedRef = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const loadMoreLock = useRef(false)
  const requestSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const workspaceRef = useRef(workspaceId)
  const suppressBlurSaveRef = useRef(false)

  const isPhone = breakpoint === 'phone'
  const isTablet = breakpoint === 'tablet'
  const PAGE_SIZE = 50

  const canCreate = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'MEMBER'
  const canEdit = canCreate
  const canImport = userRole === 'OWNER' || userRole === 'ADMIN'
  const paintLoggedRef = useRef(false)

  // Customers for filters / create / Edit mode — do not block Jobs list paint.
  useEffect(() => {
    if (!filtersExpanded && !showCreateModal && !editMode) return
    api.getCustomers(workspaceId).then(r => setCustomers(r.customers)).catch(() => {})
  }, [workspaceId, filtersExpanded, showCreateModal, editMode])

  const refreshWorkspaceJobsTotal = useCallback(() => {
    void api
      .getJobs(workspaceId, { page: 1, pageSize: 1 })
      .then((res) => setWorkspaceJobsTotal(res.pagination.totalCount))
      .catch(() => {})
  }, [workspaceId])

  useEffect(() => {
    setWorkspaceJobsTotal(null)
    refreshWorkspaceJobsTotal()
  }, [workspaceId, refreshWorkspaceJobsTotal])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), JOBS_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    setJobListSort({ sortBy, sortDir })
  }, [sortBy, sortDir])

  // Persist Jobs list filters. Edit Mode intentionally NOT persisted (reload → OFF).
  useEffect(() => {
    if (!userId) return
    persistJobsState({
      workspaceId,
      userId,
      state: {
        search: debouncedSearch,
        statusFilter,
        customerFilter,
        assignedUserFilter,
        hasOverdueTasks,
        showArchived,
        sortBy,
        sortDir,
      },
    })
  }, [
    workspaceId,
    userId,
    debouncedSearch,
    statusFilter,
    customerFilter,
    assignedUserFilter,
    hasOverdueTasks,
    showArchived,
    sortBy,
    sortDir,
  ])

  const filterParams = {
    status: statusFilter !== 'ALL' ? statusFilter : undefined,
    search: debouncedSearch || undefined,
    showArchived: showArchived || undefined,
    customerId: customerFilter || undefined,
    assignedUserId: assignedUserFilter || undefined,
    hasOverdueTasks: hasOverdueTasks || undefined,
    sortBy,
    sortDir,
  } as const

  const loadJobs = useCallback(async (opts?: { page?: number; append?: boolean }) => {
    const nextPage = opts?.page ?? 1
    const append = opts?.append === true
    const cacheKey = jobsListCacheKey(workspaceId, { ...filterParams, page: nextPage })
    const cached = !append ? getCachedJobsList(cacheKey) : null
    const soft = hasPaintedRef.current && !append

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++requestSeqRef.current

    if (append) setLoadingMore(true)
    else if (soft || cached) setRefreshing(true)
    else setLoading(true)

    const t0 = performance.now()
    try {
      const res = await api.getJobs(workspaceId, {
        page: nextPage,
        pageSize: PAGE_SIZE,
        ...filterParams,
      }, { signal: controller.signal })
      if (!isCurrentJobsRequest(seq, requestSeqRef.current)) return
      setJobs((prev) => (append ? [...prev, ...res.jobs] : res.jobs))
      setPage(nextPage)
      setTotalCount(res.pagination.totalCount)
      const more = nextPage < res.pagination.totalPages
      setHasMore(more)
      hasPaintedRef.current = true
      if (!append) {
        setCachedJobsList(cacheKey, {
          jobs: res.jobs,
          page: nextPage,
          totalCount: res.pagination.totalCount,
          hasMore: more,
        })
      }
      const elapsed = Math.round(performance.now() - t0)
      if (!paintLoggedRef.current) {
        paintLoggedRef.current = true
        console.info({
          event: 'jobsInitialUsefulPaintMs',
          source: 'network',
          ms: elapsed,
          rowCount: res.jobs.length,
        })
      }
      if (filterParams.search) {
        console.info({
          event: 'jobsSearchResolvedMs',
          ms: elapsed,
          rowCount: res.jobs.length,
          searchLength: filterParams.search.length,
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    } finally {
      if (isCurrentJobsRequest(seq, requestSeqRef.current)) {
        setLoading(false)
        setRefreshing(false)
        setLoadingMore(false)
        loadMoreLock.current = false
      }
    }
  }, [
    workspaceId,
    statusFilter,
    debouncedSearch,
    showArchived,
    customerFilter,
    assignedUserFilter,
    hasOverdueTasks,
    sortBy,
    sortDir,
  ])

  useEffect(() => {
    paintLoggedRef.current = false
    if (workspaceRef.current !== workspaceId) {
      workspaceRef.current = workspaceId
      setJobs([])
      setPage(1)
      setTotalCount(0)
      setHasMore(false)
      hasPaintedRef.current = false
    }
    const key = jobsListCacheKey(workspaceId, {
      page: 1,
      status: statusFilter !== 'ALL' ? statusFilter : undefined,
      search: debouncedSearch || undefined,
      showArchived: showArchived || undefined,
      customerId: customerFilter || undefined,
      assignedUserId: assignedUserFilter || undefined,
      hasOverdueTasks: hasOverdueTasks || undefined,
      sortBy,
      sortDir,
    })
    const cached = getCachedJobsList(key)
    if (cached) {
      setJobs(cached.jobs)
      setPage(cached.page)
      setTotalCount(cached.totalCount)
      setHasMore(cached.hasMore)
      setLoading(false)
      hasPaintedRef.current = true
      if (!paintLoggedRef.current) {
        paintLoggedRef.current = true
        console.info({
          event: 'jobsInitialUsefulPaintMs',
          source: 'cache',
          ms: 0,
          rowCount: cached.jobs.length,
        })
      }
    }
    void loadJobs({ page: 1, append: false })
  }, [loadJobs, workspaceId, statusFilter, debouncedSearch, showArchived, customerFilter, assignedUserFilter, hasOverdueTasks, sortBy, sortDir])

  const handleListScroll = () => {
    const el = listRef.current
    if (!el || !hasMore || loadingMore || loadMoreLock.current) return
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    if (remaining < 240) {
      loadMoreLock.current = true
      void loadJobs({ page: page + 1, append: true })
    }
  }

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const handleCreateJob = async () => {
    if (!form.jobNumber.trim() || !form.name.trim()) {
      setCreateError('Job number and name are required.')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      await api.createJob(workspaceId, {
        jobNumber: form.jobNumber.trim(),
        name: form.name.trim(),
        status: form.status || 'ACTIVE',
        customerId: form.customerId || undefined,
        description: form.description || undefined,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
        targetCompletionDate: form.targetCompletionDate ? new Date(form.targetCompletionDate).toISOString() : undefined,
        aliases: form.aliases ? form.aliases.split(',').map(a => a.trim()).filter(Boolean) : undefined,
      })
      setShowCreateModal(false)
      setForm(EMPTY_FORM)
      invalidateJobsListCache(workspaceId)
      void loadJobs({ page: 1, append: false })
      refreshWorkspaceJobsTotal()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create job')
    } finally {
      setCreating(false)
    }
  }

  const cancelActiveCell = useCallback(() => {
    setActiveCell(null)
    setActiveDraft('')
    setFieldError(null)
  }, [])

  const persistInlineField = useCallback(async (
    jobId: string,
    field: JobsInlineField,
    draft: string,
    baselineJob?: JobSummary
  ): Promise<boolean> => {
    if (savingCellKey) return false
    const job = baselineJob ?? jobs.find((j) => j.id === jobId)
    if (!job) {
      cancelActiveCell()
      return true
    }
    if (!jobInlineFieldChanged(job, field, draft)) {
      cancelActiveCell()
      return true
    }
    const built = buildJobInlineFieldUpdate(field, draft)
    if (!built.ok) {
      setFieldError({ jobId, field, message: built.error })
      return false
    }
    const key = jobsInlineCellKey({ jobId, field })
    setSavingCellKey(key)
    setFieldError(null)
    try {
      const res = await api.updateJob(workspaceId, jobId, built.body)
      setJobs((prev) =>
        prev.map((row) =>
          row.id === jobId ? applyJobInlineUpdateToSummary(row, field, res.job) : row
        )
      )
      invalidateJobsListCache(workspaceId)
      cancelActiveCell()
      return true
    } catch (e) {
      const message =
        e instanceof ApiRequestError && e.code === 'JOB_NUMBER_TAKEN'
          ? (e.message || 'A job with this job number already exists in this workspace')
          : e instanceof Error
            ? e.message
            : 'Failed to update job'
      setFieldError({ jobId, field, message })
      return false
    } finally {
      setSavingCellKey(null)
      suppressBlurSaveRef.current = false
    }
  }, [cancelActiveCell, jobs, savingCellKey, workspaceId])

  const saveActiveCell = useCallback(async (opts?: { thenExitEditMode?: boolean }) => {
    if (!activeCell) {
      if (opts?.thenExitEditMode) setEditMode(false)
      return true
    }
    const ok = await persistInlineField(activeCell.jobId, activeCell.field, activeDraft)
    if (ok && opts?.thenExitEditMode) setEditMode(false)
    return ok
  }, [activeCell, activeDraft, persistInlineField])

  const activateCell = useCallback(async (job: JobSummary, field: JobsInlineField) => {
    if (!editMode || savingCellKey) return
    if (activeCell && (activeCell.jobId !== job.id || activeCell.field !== field)) {
      const ok = await saveActiveCell()
      if (!ok) return
    }
    setActiveCell({ jobId: job.id, field })
    setActiveDraft(jobInlineFieldDraft(job, field))
    setFieldError(null)
  }, [activeCell, editMode, saveActiveCell, savingCellKey])

  const toggleEditMode = async () => {
    if (editMode) {
      if (activeCell) {
        await saveActiveCell({ thenExitEditMode: true })
        return
      }
      setEditMode(false)
      return
    }
    setEditMode(true)
  }

  const handleRowActivate = (job: JobSummary) => {
    if (editMode) return
    onSelectJob(job.id, job)
  }

  const renderInlineField = (job: JobSummary, field: JobsInlineField, opts?: { mono?: boolean }) => {
    const active = isJobsInlineCell(activeCell, job.id, field)
    const saving = savingCellKey === jobsInlineCellKey({ jobId: job.id, field })
    const error =
      fieldError && fieldError.jobId === job.id && fieldError.field === field
        ? fieldError.message
        : null
    const labels: Record<JobsInlineField, string> = {
      jobNumber: `Job number for ${job.name}`,
      name: `Job name for ${job.jobNumber ?? job.name}`,
      customerId: `Customer for ${job.name}`,
      startDate: `Start date for ${job.name}`,
    }

    if (field === 'customerId' && active) {
      const selected = customers.find((c) => c.id === activeDraft)
      return (
        <JobsInlineFieldCell
          jobId={job.id}
          field={field}
          editMode={editMode}
          active
          saving={saving}
          error={error}
          display={jobInlineFieldDisplay(job, field)}
          draft={activeDraft}
          onActivate={() => { void activateCell(job, field) }}
          onDraftChange={setActiveDraft}
          onSave={() => { void saveActiveCell() }}
          onCancel={cancelActiveCell}
          suppressBlurSave
          ariaLabel={labels.customerId}
        >
          <CustomerSelectOrCreate
            workspaceId={workspaceId}
            autoFocus
            disabled={saving}
            ariaLabel={labels.customerId}
            customers={customers}
            value={{
              customerId: activeDraft || null,
              customerName: selected?.name ?? (activeDraft ? job.customerName : null),
            }}
            onCustomersUpdated={setCustomers}
            onFocusWithinChange={(focused) => {
              suppressBlurSaveRef.current = focused
            }}
            onChange={(next) => {
              const nextId = next.customerId ?? ''
              setActiveDraft(nextId)
              // Persist only when a Customer is chosen, cleared, or create completed.
              if (next.customerId || next.customerName === null) {
                void persistInlineField(job.id, 'customerId', nextId, job)
              }
            }}
          />
        </JobsInlineFieldCell>
      )
    }

    if (field === 'startDate' && active) {
      return (
        <JobsInlineFieldCell
          jobId={job.id}
          field={field}
          editMode={editMode}
          active
          saving={saving}
          error={error}
          display={jobInlineFieldDisplay(job, field)}
          draft={activeDraft}
          onActivate={() => { void activateCell(job, field) }}
          onDraftChange={setActiveDraft}
          onSave={() => { void saveActiveCell() }}
          onCancel={cancelActiveCell}
          suppressBlurSave
          ariaLabel={labels.startDate}
        >
          <input
            type="date"
            autoFocus
            aria-label={labels.startDate}
            value={activeDraft}
            disabled={saving}
            onMouseDown={() => { suppressBlurSaveRef.current = true }}
            onChange={(e) => {
              const next = e.target.value
              setActiveDraft(next)
              void persistInlineField(job.id, 'startDate', next, job)
            }}
            onBlur={() => {
              if (suppressBlurSaveRef.current || saving) return
              void saveActiveCell()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelActiveCell()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                void saveActiveCell()
              }
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '4px 6px',
              border: '1px solid #93c5fd',
              borderRadius: 4,
              fontSize: 13,
              background: '#fff',
            }}
          />
        </JobsInlineFieldCell>
      )
    }

    return (
      <JobsInlineFieldCell
        jobId={job.id}
        field={field}
        editMode={editMode}
        active={active}
        saving={saving}
        error={error}
        display={jobInlineFieldDisplay(job, field)}
        draft={activeDraft}
        onActivate={() => { void activateCell(job, field) }}
        onDraftChange={setActiveDraft}
        onSave={() => { void saveActiveCell() }}
        onCancel={cancelActiveCell}
        mono={opts?.mono}
        ariaLabel={labels[field]}
      />
    )
  }

  const sortIndicator = (col: string) => {
    if (sortBy !== col) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const thStyle = (col: string): React.CSSProperties => ({
    padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151',
    cursor: 'pointer', userSelect: 'none',
    background: sortBy === col ? '#f0f4ff' : '#f9fafb',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  })

  const sortValue = jobListSortValue({ sortBy, sortDir })
  const sortKnown = JOB_LIST_SORT_OPTIONS.some((option) => option.value === sortValue)
  const sortControl = (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
      Sort
      <select
        aria-label="Sort jobs"
        value={sortValue}
        onChange={(e) => {
          const next = jobListSortFromValue(e.target.value)
          setSortBy(next.sortBy)
          setSortDir(next.sortDir)
        }}
        style={{ padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff', minHeight: 36 }}
      >
        {!sortKnown && <option value={sortValue}>{sortBy}</option>}
        {JOB_LIST_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )

  const renderPhoneFilters = () => (
    <div>
      <div style={{ marginBottom: 10 }}>{sortControl}</div>
      <input
        type="text"
        placeholder="Search by job number, name, or customer..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid #d0d5dd',
          borderRadius: 6, fontSize: 14, outline: 'none', marginBottom: 10,
          boxSizing: 'border-box'
        }}
      />
      <button
        onClick={() => setFiltersExpanded(v => !v)}
        style={{
          width: '100%', padding: '10px 14px', border: '1px solid #d0d5dd',
          borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#f9fafb',
          cursor: 'pointer', textAlign: 'left', color: '#374151',
          minHeight: 44, boxSizing: 'border-box'
        }}
      >
        {filtersExpanded ? '▾ Filters' : '▸ Filters'}
      </button>
      {filtersExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff', minHeight: 44 }}
          >
            {STATUSES.map(s => (
              <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s.replace('_', ' ')}</option>
            ))}
          </select>
          <select
            value={customerFilter}
            onChange={e => setCustomerFilter(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff', minHeight: 44 }}
          >
            <option value="">All Customers</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter by user ID..."
            value={assignedUserFilter}
            onChange={e => setAssignedUserFilter(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, minHeight: 44 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#555', cursor: 'pointer', minHeight: 44 }}>
            <input
              type="checkbox"
              checked={hasOverdueTasks}
              onChange={e => setHasOverdueTasks(e.target.checked)}
            />
            Overdue tasks
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#555', cursor: 'pointer', minHeight: 44 }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
      )}
    </div>
  )

  const renderDesktopFilters = () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {sortControl}
      <input
        type="text"
        placeholder="Search by job number, name, or customer..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          flex: 1, minWidth: 220, padding: '8px 12px', border: '1px solid #d0d5dd',
          borderRadius: 6, fontSize: 13, outline: 'none'
        }}
      />
      <select
        value={statusFilter}
        onChange={e => setStatusFilter(e.target.value)}
        style={{ padding: '8px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}
      >
        {STATUSES.map(s => (
          <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s.replace('_', ' ')}</option>
        ))}
      </select>
      <select
        value={customerFilter}
        onChange={e => setCustomerFilter(e.target.value)}
        style={{ padding: '8px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}
      >
        <option value="">All Customers</option>
        {customers.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Filter by user ID..."
        value={assignedUserFilter}
        onChange={e => setAssignedUserFilter(e.target.value)}
        style={{ padding: '8px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, width: 140 }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={hasOverdueTasks}
          onChange={e => setHasOverdueTasks(e.target.checked)}
        />
        Overdue tasks
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={e => setShowArchived(e.target.checked)}
        />
        Show archived
      </label>
    </div>
  )

  const renderPhoneCards = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {jobs.map(job => (
        <div
          key={job.id}
          onClick={() => handleRowActivate(job)}
          style={{
            padding: 14, border: '1px solid #e5e7eb', borderRadius: 8,
            background: editMode ? '#fcfcfd' : '#fff',
            cursor: editMode ? 'default' : 'pointer',
            minHeight: 44,
            width: '100%', boxSizing: 'border-box'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {renderInlineField(job, 'jobNumber', { mono: true })}
            </div>
            <StatusBadge status={job.status} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#111', marginBottom: 4 }}>
            {renderInlineField(job, 'name')}
          </div>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
            {renderInlineField(job, 'customerId')}
          </div>
          {editMode ? (
            <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
              {renderInlineField(job, 'startDate')}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280', flexWrap: 'wrap' }}>
            <span>✉ {job.emailCount}</span>
            <span>☐ {job.openTaskCount} open</span>
            <span style={{ color: job.overdueTaskCount > 0 ? '#dc2626' : undefined, fontWeight: job.overdueTaskCount > 0 ? 600 : undefined }}>
              ⚠ {job.overdueTaskCount} overdue
            </span>
          </div>
        </div>
      ))}
    </div>
  )

  const stickyTh = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '10px 12px',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
    background: '#f9fafb',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    ...extra,
  })

  const renderTable = () => {
    const hideExtraCols = isTablet && !editMode
    const showStartCol = !isTablet || editMode

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={thStyle('jobNumber')} onClick={() => handleSort('jobNumber')}>Job #{sortIndicator('jobNumber')}</th>
            <th style={thStyle('name')} onClick={() => handleSort('name')}>Name{sortIndicator('name')}</th>
            <th style={stickyTh()}>Customer</th>
            <th style={thStyle('status')} onClick={() => handleSort('status')}>Status{sortIndicator('status')}</th>
            {showStartCol && <th style={thStyle('startDate')} onClick={() => handleSort('startDate')}>Start{sortIndicator('startDate')}</th>}
            <th style={stickyTh({ textAlign: 'center' })}>Emails</th>
            <th style={stickyTh({ textAlign: 'center' })}>Open Tasks</th>
            <th style={stickyTh({ textAlign: 'center' })}>Overdue</th>
            {!hideExtraCols && <th style={stickyTh()}>Last Activity</th>}
            {!hideExtraCols && <th style={stickyTh()}>Next Due</th>}
            {!hideExtraCols && <th style={stickyTh()}>Team</th>}
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr
              key={job.id}
              onClick={() => handleRowActivate(job)}
              style={{
                borderBottom: '1px solid #f0f0f0',
                cursor: editMode ? 'default' : 'pointer',
                transition: 'background 0.1s',
                background: editMode ? '#fcfcfd' : undefined,
              }}
              onMouseEnter={e => {
                if (!editMode) e.currentTarget.style.background = '#f8fafc'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = editMode ? '#fcfcfd' : ''
              }}
            >
              <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                {renderInlineField(job, 'jobNumber', { mono: true })}
              </td>
              <td style={{ padding: '10px 12px', fontWeight: 500, color: '#111' }}>
                {renderInlineField(job, 'name')}
              </td>
              <td style={{ padding: '10px 12px', color: '#555' }}>
                {renderInlineField(job, 'customerId')}
              </td>
              <td style={{ padding: '10px 12px' }}><StatusBadge status={job.status} /></td>
              {showStartCol && (
                <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>
                  {renderInlineField(job, 'startDate')}
                </td>
              )}
              <td style={{ padding: '10px 12px', textAlign: 'center' }}>{job.emailCount}</td>
              <td style={{ padding: '10px 12px', textAlign: 'center' }}>{job.openTaskCount}</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: job.overdueTaskCount > 0 ? '#dc2626' : undefined, fontWeight: job.overdueTaskCount > 0 ? 600 : undefined }}>
                {job.overdueTaskCount}
              </td>
              {!hideExtraCols && <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{relativeTime(job.lastActivityAt)}</td>}
              {!hideExtraCols && <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{job.nextDueDate ? formatDate(job.nextDueDate) : '—'}</td>}
              {!hideExtraCols && (
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {job.assignedMembers.slice(0, 3).map(m => (
                      <span
                        key={m.userId}
                        title={m.name ?? m.email}
                        style={{
                          width: 24, height: 24, borderRadius: '50%', background: '#e0e7ff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 600, color: '#4338ca'
                        }}
                      >
                        {(m.name ?? m.email)[0].toUpperCase()}
                      </span>
                    ))}
                    {job.assignedMembers.length > 3 && (
                      <span style={{ fontSize: 11, color: '#888', alignSelf: 'center', marginLeft: 4 }}>
                        +{job.assignedMembers.length - 3}
                      </span>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      padding: isPhone ? 14 : 24,
      boxSizing: 'border-box',
    }}>
      {/* Header — stays fixed outside the scroll container */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: isPhone ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isPhone ? 'stretch' : 'center',
        marginBottom: 16,
        gap: isPhone ? 12 : undefined
      }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
          Jobs
          {workspaceJobsTotal != null ? (
            <span style={{ marginLeft: 8, fontSize: 15, fontWeight: 600, color: '#555' }}>
              ({workspaceJobsTotal})
            </span>
          ) : null}
          {refreshing ? <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#999' }}>Updating…</span> : null}
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && (
            <button
              type="button"
              data-testid="jobs-edit-mode-toggle"
              aria-pressed={editMode}
              onClick={() => { void toggleEditMode() }}
              style={{
                padding: '8px 16px',
                background: editMode ? '#1a1a2e' : '#fff',
                color: editMode ? '#fff' : '#1a1a2e',
                border: '1px solid #1a1a2e',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                width: isPhone ? '100%' : undefined,
                minHeight: isPhone ? 44 : undefined,
              }}
            >
              {editMode ? 'Done Editing' : 'Edit'}
            </button>
          )}
          {canImport && (
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              style={{
                padding: '8px 16px', background: '#fff', color: '#1a1a2e', border: '1px solid #1a1a2e',
                borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                width: isPhone ? '100%' : undefined,
                minHeight: isPhone ? 44 : undefined
              }}
            >
              Import Jobs
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => { setShowCreateModal(true); setCreateError('') }}
              style={{
                padding: '8px 16px', background: '#1a1a2e', color: '#fff', border: 'none',
                borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                width: isPhone ? '100%' : undefined,
                minHeight: isPhone ? 44 : undefined
              }}
            >
              + Create Job
            </button>
          )}
        </div>
      </div>

      {/* Filters — stay fixed outside the scroll container */}
      <div style={{ flexShrink: 0, marginBottom: 12 }}>
        {isPhone ? renderPhoneFilters() : renderDesktopFilters()}
      </div>

      {totalCount > 0 && (
        <div style={{ flexShrink: 0, marginBottom: 8, fontSize: 13, color: '#555' }}>
          Showing {jobs.length} of {totalCount} job{totalCount !== 1 ? 's' : ''}
          {editMode ? (
            <span style={{ marginLeft: 10, color: '#1d4ed8', fontWeight: 600 }}>
              Editing — click a field to change it. Row navigation is paused.
            </span>
          ) : null}
        </div>
      )}

      {/* Scrollable jobs container */}
      <div
        ref={listRef}
        onScroll={handleListScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          border: jobs.length > 0 ? '1px solid #e5e7eb' : undefined,
          borderRadius: jobs.length > 0 ? 8 : undefined,
          background: jobs.length > 0 ? '#fff' : undefined,
        }}
      >
        {loading && jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: '#888' }}>Loading jobs...</div>
        )}

        {!loading && jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: 64, color: '#888' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔨</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: '#333' }}>No jobs found</h3>
            <p style={{ margin: 0, fontSize: 14, color: '#888' }}>
              {search || statusFilter !== 'ALL' ? 'Try adjusting your filters.' : 'Create your first job to get started.'}
            </p>
          </div>
        )}

        {jobs.length > 0 && (
          <>
            {isPhone ? (
              <div style={{ padding: 10 }}>
                {renderPhoneCards()}
              </div>
            ) : renderTable()}
            {loadingMore && (
              <div style={{ textAlign: 'center', padding: 16, fontSize: 13, color: '#888' }}>Loading more…</div>
            )}
            {!hasMore && jobs.length > 0 && (
              <div style={{ textAlign: 'center', padding: 14, fontSize: 12, color: '#aaa' }}>
                End of list
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Job Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: isPhone ? '100%' : 520,
            maxWidth: isPhone ? '100vw' : undefined,
            maxHeight: '85vh',
            background: '#fff',
            borderRadius: isPhone ? 0 : 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Create Job</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#999', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
            </div>
            <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Job Number *</label>
                    <input value={form.jobNumber} onChange={e => setForm(f => ({ ...f, jobNumber: e.target.value }))}
                      placeholder="e.g. JOB-001"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Status</label>
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }}>
                      {['BIDDING', 'ACTIVE', 'ON_HOLD', 'COMPLETE'].map(s => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Job Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Downtown Office Renovation"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Customer</label>
                  <CustomerSelectOrCreate
                    workspaceId={workspaceId}
                    customers={customers}
                    value={{
                      customerId: form.customerId || null,
                      customerName: customers.find((c) => c.id === form.customerId)?.name ?? null,
                    }}
                    onCustomersUpdated={setCustomers}
                    onChange={(next) =>
                      setForm((f) => ({ ...f, customerId: next.customerId ?? '' }))
                    }
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
                    placeholder="Also known as: Nova Academy, NOVA"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.4 }}>
                    Matching checks the email subject and body against the job name and alternate names listed here.
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Start Date</label>
                    <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Target Completion</label>
                    <input type="date" value={form.targetCompletionDate} onChange={e => setForm(f => ({ ...f, targetCompletionDate: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Aliases (comma-separated)</label>
                  <input value={form.aliases} onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))}
                    placeholder="e.g. DT Office, Downtown Reno"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                {createError && <div style={{ color: '#dc2626', fontSize: 13 }}>{createError}</div>}
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #e5e5e5', display: 'flex', flexDirection: isPhone ? 'column-reverse' : 'row', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowCreateModal(false)}
                style={{ padding: '8px 16px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', fontSize: 13, cursor: 'pointer', minHeight: isPhone ? 44 : undefined }}>
                Cancel
              </button>
              <button onClick={handleCreateJob} disabled={creating}
                style={{ padding: '8px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.6 : 1, minHeight: isPhone ? 44 : undefined }}>
                {creating ? 'Creating...' : 'Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <JobImportView
          workspaceId={workspaceId}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            invalidateJobsListCache(workspaceId)
            void loadJobs({ page: 1, append: false })
            refreshWorkspaceJobsTotal()
          }}
        />
      )}
    </div>
  )
}
