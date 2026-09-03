import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ConnectionSummary } from '../api'

type Filters = {
  category: string
  businessTypeKeys: string[]
  senderContains: string
  readStatus: string
  direction: string
  dateRange: string
  customStartYmd: string
  customEndYmd: string
  priorities: string[]
  jobScope: string
  jobId: string
  processingStatus: string
}

const DEFAULT_FILTERS: Filters = {
  category: 'ALL',
  businessTypeKeys: [],
  senderContains: '',
  readStatus: 'ANY',
  direction: 'ANY',
  dateRange: 'ALL',
  customStartYmd: '',
  customEndYmd: '',
  priorities: [],
  jobScope: 'ANY',
  jobId: '',
  processingStatus: 'ANY',
}

function filtersToApi(f: Filters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (f.category !== 'ALL') out.category = f.category
  if (f.businessTypeKeys.length) out.businessTypeKeys = f.businessTypeKeys
  if (f.senderContains.trim()) out.senderContains = f.senderContains.trim()
  if (f.readStatus !== 'ANY') out.readStatus = f.readStatus
  if (f.direction !== 'ANY') out.direction = f.direction
  if (f.dateRange === 'TODAY' || f.dateRange === 'WEEK' || f.dateRange === 'MONTH') {
    out.dateRange = f.dateRange
    out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }
  if (f.dateRange === 'CUSTOM') {
    if (f.customStartYmd) out.customStartYmd = f.customStartYmd
    if (f.customEndYmd) out.customEndYmd = f.customEndYmd
    out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }
  if (f.priorities.length) out.priorities = f.priorities
  if (f.jobScope !== 'ANY') out.jobScope = f.jobScope
  if (f.jobScope === 'SPECIFIC' && f.jobId.trim()) out.jobId = f.jobId.trim()
  if (f.processingStatus !== 'ANY') out.processingStatus = f.processingStatus
  return out
}

type Props = {
  workspaceId: string
  connection: ConnectionSummary
  onClose: () => void
}

export function ReclassifyEmailsModal({ workspaceId, connection, onClose }: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [taskMode, setTaskMode] = useState<'REMOVE_ONLY' | 'REGENERATE'>('REMOVE_ONLY')
  const [subtypeKeys, setSubtypeKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.reclassifyPreview>
  > | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<{
    status: string
    taskMode?: string
    totalMatched: number
    queued: number
    completed: number
    failed: number
    skipped: number
    tasksRemoved?: number
    tasksGenerated?: number
    taskPersistFailures?: number
    errorMessage: string | null
  } | null>(null)
  const pollRef = useRef<number | null>(null)

  const [jobQuery, setJobQuery] = useState('')
  const [jobHits, setJobHits] = useState<Array<{ id: string; jobNumber: string; name: string }>>(
    []
  )
  const [senderHits, setSenderHits] = useState<Array<{ senderEmail: string; count: number }>>(
    []
  )

  const [metaLoaded, setMetaLoaded] = useState(false)
  const [metaRetry, setMetaRetry] = useState(0)

  const loadMeta = useCallback(() => {
    setError(null)
    void api
      .reclassifyMeta(workspaceId, connection.id)
      .then((r) => {
        setSubtypeKeys(r.businessSubtypeKeys)
        setMetaLoaded(true)
      })
      .catch((e) => {
        setMetaLoaded(false)
        setError(
          e instanceof Error
            ? e.message
            : 'Could not load reclassification options.'
        )
      })
  }, [workspaceId, connection.id])

  useEffect(() => {
    loadMeta()
  }, [loadMeta, metaRetry])

  useEffect(() => {
    if (filters.jobScope !== 'SPECIFIC' || jobQuery.trim().length < 2) {
      setJobHits([])
      return
    }
    const t = window.setTimeout(() => {
      void api
        .getJobsLookup(workspaceId, { search: jobQuery.trim() })
        .then((r) =>
          setJobHits(
            r.jobs.slice(0, 8).map((j) => ({
              id: j.id,
              jobNumber: j.jobNumber ?? '',
              name: j.name,
            }))
          )
        )
        .catch(() => setJobHits([]))
    }, 300)
    return () => window.clearTimeout(t)
  }, [workspaceId, filters.jobScope, jobQuery])

  useEffect(() => {
    const q = filters.senderContains.trim()
    if (q.length < 2) {
      setSenderHits([])
      return
    }
    const t = window.setTimeout(() => {
      void api
        .reclassifySearchSenders(workspaceId, connection.id, q)
        .then((r) => setSenderHits(r.senders.slice(0, 8)))
        .catch(() => setSenderHits([]))
    }, 300)
    return () => window.clearTimeout(t)
  }, [workspaceId, connection.id, filters.senderContains])

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  const runPreview = async () => {
    setBusy(true)
    setError(null)
    setSelected(new Set())
    try {
      const r = await api.reclassifyPreview(workspaceId, connection.id, {
        filters: filtersToApi(filters),
        taskMode,
      })
      setPreview(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  const startRun = async (messageIds?: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.reclassifyStart(workspaceId, connection.id, {
        filters: filtersToApi(filters),
        ...(messageIds?.length ? { messageIds } : {}),
        taskMode,
        confirm: true,
      })
      setRunId(r.run.id)
      setRun({
        status: r.run.status,
        taskMode: r.run.taskMode,
        totalMatched: r.run.totalMatched,
        queued: r.run.queued,
        completed: r.run.completed,
        failed: r.run.failed,
        skipped: r.run.skipped,
        tasksRemoved: r.run.tasksRemoved,
        tasksGenerated: r.run.tasksGenerated,
        taskPersistFailures: r.run.taskPersistFailures,
        errorMessage: null,
      })
      setConfirmOpen(false)
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(() => {
        void api
          .reclassifyGetRun(workspaceId, connection.id, r.run.id)
          .then((res) => {
            setRun(res.run)
            if (
              res.run.status === 'COMPLETED' ||
              res.run.status === 'CANCELLED' ||
              res.run.status === 'FAILED'
            ) {
              if (pollRef.current) window.clearInterval(pollRef.current)
              pollRef.current = null
            }
          })
          .catch(() => {})
      }, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setBusy(false)
    }
  }

  const cancelRun = async () => {
    if (!runId) return
    setBusy(true)
    try {
      const r = await api.reclassifyCancel(workspaceId, connection.id, runId)
      setRun((prev) => (prev ? { ...prev, status: r.run.status } : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleSubtype = (key: string) => {
    setFilters((f) => ({
      ...f,
      businessTypeKeys: f.businessTypeKeys.includes(key)
        ? f.businessTypeKeys.filter((k) => k !== key)
        : [...f.businessTypeKeys, key],
    }))
  }

  const togglePriority = (p: string) => {
    setFilters((f) => ({
      ...f,
      priorities: f.priorities.includes(p)
        ? f.priorities.filter((x) => x !== p)
        : [...f.priorities, p],
    }))
  }

  const matchCount = selected.size > 0 ? selected.size : preview?.totalMatched ?? 0
  const pct =
    run && run.totalMatched > 0
      ? Math.min(
          100,
          Math.round(
            ((run.completed + run.failed + run.skipped) / Math.max(run.queued || run.totalMatched, 1)) *
              100
          )
        )
      : 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflow: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 10,
          width: 'min(920px, 100%)',
          padding: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Reclassify Emails</h2>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
              {connection.email} · {connection.provider} · {connection.ingestionSource} ·{' '}
              {connection.status}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18 }}>
            ×
          </button>
        </div>

        <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
          Uses the canonical classification queue. Does not re-import or delete mail. Protected
          USER_ASSIGNED / VERIFIED_PROJECT_FOLDER Jobs are preserved. Preview does not enqueue.
        </p>

        {error && (
          <div style={{ background: '#ffebee', color: '#c62828', padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
            <div style={{ marginBottom: 6 }}>
              {!metaLoaded
                ? 'Could not load reclassification options.'
                : null}{' '}
              {error}
            </div>
            {!metaLoaded && (
              <button type="button" onClick={() => setMetaRetry((n) => n + 1)}>
                Retry
              </button>
            )}
          </div>
        )}

        {!runId && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <label style={{ fontSize: 12 }}>
                Classification
                <select
                  value={filters.category}
                  onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  <option value="ALL">All</option>
                  <option value="BUSINESS">Business</option>
                  <option value="PERSONAL">Personal</option>
                  <option value="UNCLASSIFIED">Unclassified (no Classification row)</option>
                  <option value="FAILED">Failed (processing status)</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Read
                <select
                  value={filters.readStatus}
                  onChange={(e) => setFilters((f) => ({ ...f, readStatus: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  <option value="ANY">Any</option>
                  <option value="READ">Read</option>
                  <option value="UNREAD">Unread</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Direction
                <select
                  value={filters.direction}
                  onChange={(e) => setFilters((f) => ({ ...f, direction: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  <option value="ANY">Any</option>
                  <option value="RECEIVED">Received</option>
                  <option value="SENT">Sent</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Date
                <select
                  value={filters.dateRange}
                  onChange={(e) => setFilters((f) => ({ ...f, dateRange: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  <option value="ALL">All</option>
                  <option value="TODAY">Today</option>
                  <option value="WEEK">This week</option>
                  <option value="MONTH">This month</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Job
                <select
                  value={filters.jobScope}
                  onChange={(e) => setFilters((f) => ({ ...f, jobScope: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  <option value="ANY">Any</option>
                  <option value="HAS_JOB">Has Job</option>
                  <option value="NO_JOB">No Job</option>
                  <option value="SPECIFIC">Specific Job id</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Processing status
                <select
                  value={filters.processingStatus}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, processingStatus: e.target.value }))
                  }
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  <option value="ANY">Any</option>
                  <option value="NULL">Never processed (NULL)</option>
                  <option value="PENDING">PENDING</option>
                  <option value="PROCESSING">PROCESSING</option>
                  <option value="CLASSIFIED">CLASSIFIED</option>
                  <option value="FAILED">FAILED</option>
                </select>
              </label>
              <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>
                Sender contains
                <input
                  value={filters.senderContains}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, senderContains: e.target.value }))
                  }
                  placeholder="e.g. @customer.com"
                  style={{ display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box' }}
                />
                {senderHits.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {senderHits.map((s) => (
                      <button
                        key={s.senderEmail}
                        type="button"
                        onClick={() =>
                          setFilters((f) => ({
                            ...f,
                            senderContains: s.senderEmail,
                          }))
                        }
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          border: '1px solid #ddd',
                          borderRadius: 8,
                          background: '#fafafa',
                          cursor: 'pointer',
                        }}
                      >
                        {s.senderEmail} ({s.count})
                      </button>
                    ))}
                  </div>
                )}
              </label>
              {filters.jobScope === 'SPECIFIC' && (
                <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>
                  Job search
                  <input
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                    placeholder="Name, number, or customer…"
                    style={{ display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box' }}
                  />
                  {filters.jobId && (
                    <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                      Selected job id: {filters.jobId}
                    </div>
                  )}
                  {jobHits.length > 0 && (
                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {jobHits.map((j) => (
                        <button
                          key={j.id}
                          type="button"
                          onClick={() => {
                            setFilters((f) => ({ ...f, jobId: j.id }))
                            setJobQuery(`${j.jobNumber} — ${j.name}`)
                          }}
                          style={{
                            textAlign: 'left',
                            fontSize: 11,
                            padding: '4px 6px',
                            border: '1px solid #eee',
                            background: filters.jobId === j.id ? '#e3f2fd' : '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          {j.jobNumber} — {j.name}
                        </button>
                      ))}
                    </div>
                  )}
                </label>
              )}
              {filters.dateRange === 'CUSTOM' && (
                <>
                  <label style={{ fontSize: 12 }}>
                    Start (YYYY-MM-DD)
                    <input
                      value={filters.customStartYmd}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, customStartYmd: e.target.value }))
                      }
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                    />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    End (YYYY-MM-DD)
                    <input
                      value={filters.customEndYmd}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, customEndYmd: e.target.value }))
                      }
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                    />
                  </label>
                </>
              )}
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Priority</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePriority(p)}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 12,
                      border: '1px solid #ccc',
                      background: filters.priorities.includes(p) ? '#e3f2fd' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {p === 'NORMAL' ? 'Normal' : p.charAt(0) + p.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {filters.category === 'BUSINESS' && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Subtype</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 90, overflow: 'auto' }}>
                  {subtypeKeys.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleSubtype(k)}
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 10,
                        border: '1px solid #ddd',
                        background: filters.businessTypeKeys.includes(k) ? '#e8f5e9' : '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                marginBottom: 12,
                padding: 10,
                border: '1px solid #ffe0b2',
                borderRadius: 8,
                background: '#fffaf0',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>TASKS</div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginBottom: 6 }}>
                <input
                  type="radio"
                  name="taskMode"
                  checked={taskMode === 'REMOVE_ONLY'}
                  onChange={() => setTaskMode('REMOVE_ONLY')}
                />
                <span>
                  <strong>Remove old tasks; do not regenerate</strong> (default)
                  <div style={{ color: '#666', marginTop: 2 }}>
                    Classifier-generated tasks for matching emails are removed after successful
                    reclassification. No replacement tasks are created.
                  </div>
                </span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
                <input
                  type="radio"
                  name="taskMode"
                  checked={taskMode === 'REGENERATE'}
                  onChange={() => setTaskMode('REGENERATE')}
                />
                <span>
                  <strong>Remove old tasks and regenerate</strong>
                  <div style={{ color: '#666', marginTop: 2 }}>
                    After successful reclassification, run canonical task extraction and replace the
                    previous classifier-generated task set. Manual tasks are preserved.
                  </div>
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button type="button" disabled={busy} onClick={() => void runPreview()}>
                {busy ? 'Working…' : 'Preview matching emails'}
              </button>
            </div>
          </>
        )}

        {preview && !runId && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Matching emails: {preview.totalMatched}
            </div>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
              Existing classifier-generated tasks that will be removed:{' '}
              {preview.classifierTasksToRemove}
            </div>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
              Task behavior:{' '}
              {preview.taskMode === 'REGENERATE'
                ? 'Remove and regenerate tasks'
                : 'Remove old tasks only'}
              {' · '}
              Processing:{' '}
              {Object.entries(preview.breakdown.byProcessingStatus)
                .map(([k, v]) => `${k}=${v}`)
                .join(' · ') || '—'}
              {' · '}
              Read {preview.breakdown.read} / Unread {preview.breakdown.unread}
            </div>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                    <th style={{ padding: 6 }} />
                    <th style={{ padding: 6 }}>Date</th>
                    <th style={{ padding: 6 }}>Sender</th>
                    <th style={{ padding: 6 }}>Subject</th>
                    <th style={{ padding: 6 }}>Cat</th>
                    <th style={{ padding: 6 }}>Subtype</th>
                    <th style={{ padding: 6 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row) => (
                    <tr key={row.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: 6 }}>
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(row.id)) next.delete(row.id)
                              else next.add(row.id)
                              return next
                            })
                          }}
                        />
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {(row.receivedAt ?? row.sentAt).slice(0, 10)}
                      </td>
                      <td style={{ padding: 6 }}>{row.senderEmail}</td>
                      <td style={{ padding: 6 }}>{row.subject ?? '(no subject)'}</td>
                      <td style={{ padding: 6 }}>{row.mailboxCategory}</td>
                      <td style={{ padding: 6 }}>{row.businessTypeKey ?? '—'}</td>
                      <td style={{ padding: 6 }}>{row.classificationStatus ?? 'NULL'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                disabled={busy || preview.totalMatched === 0}
                onClick={() => setConfirmOpen(true)}
              >
                Reclassify {selected.size > 0 ? `${selected.size} selected` : `all ${preview.totalMatched}`}
              </button>
            </div>
          </div>
        )}

        {confirmOpen && (
          <div
            style={{
              background: '#fff8e1',
              border: '1px solid #ffe082',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Reclassify {matchCount} emails from {connection.email}?
            </div>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
              Existing classifier-generated tasks associated with these emails will be removed
              {preview ? ` (${preview.classifierTasksToRemove} currently matched)` : ''}.
              Manual tasks are not deleted. Provider mail is not deleted or re-imported. Protected
              Jobs stay protected.
            </div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              Task generation:{' '}
              <strong>
                {taskMode === 'REGENERATE'
                  ? 'ON — replacement tasks will be generated after reclassification'
                  : 'OFF'}
              </strong>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void startRun(selected.size > 0 ? [...selected] : undefined)
                }
              >
                Confirm reclassify
              </button>
              <button type="button" onClick={() => setConfirmOpen(false)}>
                Back
              </button>
            </div>
          </div>
        )}

        {run && (
          <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Status: {run.status}
            </div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              Matched {run.totalMatched} · Queued {run.queued} · Completed {run.completed} · Failed{' '}
              {run.failed} · Skipped {run.skipped} · ~{pct}%
            </div>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
              Task mode: {run.taskMode ?? taskMode}
              {' · '}
              Tasks removed {run.tasksRemoved ?? 0}
              {' · '}
              Generated {run.tasksGenerated ?? 0}
              {' · '}
              Task persist failures {run.taskPersistFailures ?? 0}
            </div>
            <div
              style={{
                height: 8,
                background: '#eee',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 10,
              }}
            >
              <div style={{ width: `${pct}%`, height: '100%', background: '#1565c0' }} />
            </div>
            {run.errorMessage && (
              <div style={{ fontSize: 12, color: '#c62828', marginBottom: 8 }}>{run.errorMessage}</div>
            )}
            {(run.status === 'RUNNING' ||
              run.status === 'PENDING' ||
              run.status === 'CANCELLING') && (
              <button type="button" disabled={busy} onClick={() => void cancelRun()}>
                Cancel reclassification
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
