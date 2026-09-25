import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  api,
  type AdminWorkspace,
  type WorkerJobDetail,
  type WorkerJobRow,
  type WorkerJobsList,
} from '../api'

function dateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function clock(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function duration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${rem}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function progressText(row: WorkerJobRow): string {
  const progress = row.progress
  const stage = progress?.stage
  const counts = !progress
    ? row.displayState === 'ACTIVE' ? 'Processing…' : '—'
    : progress.total != null && progress.total > 0
      ? `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()} ${progress.unit}${progress.percent != null ? ` · ${progress.percent}%` : ''}`
      : `${progress.current.toLocaleString()} ${progress.unit}`
  return stage ? `${stage}` : counts
}

function bullLabel(row: WorkerJobRow): string {
  if (row.queueUnreadable) return 'UNAVAILABLE'
  return row.queueState ?? 'MISSING'
}

export function WorkerJobsView(props: {
  currentWorkspaceId: string
  onOpenMailbox: (workspaceId: string, connectionId: string) => void
}) {
  const [status, setStatus] = useState('all')
  const [queue, setQueue] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<WorkerJobsList | null>(null)
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([])
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<WorkerJobDetail | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [status, queue, workspaceId, search])

  useEffect(() => {
    let cancelled = false
    const load = async (silent: boolean) => {
      try {
        const next = await api.listWorkerJobs({
          status,
          ...(queue ? { queue } : {}),
          ...(search ? { q: search } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          page,
        })
        if (!cancelled) {
          setData(next)
          setError('')
        }
      } catch (err) {
        if (!silent && !cancelled) setError(err instanceof Error ? err.message : 'Failed to load worker jobs')
      }
    }
    void load(false)
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true)
    }, 4000)
    const onVis = () => {
      if (!document.hidden) void load(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [status, queue, workspaceId, search, page])

  useEffect(() => {
    void api.adminGetWorkspaces().then((result) => setWorkspaces(result.workspaces)).catch(() => {})
  }, [])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError('')
    try {
      await fn()
      const next = await api.listWorkerJobs({
        status,
        ...(queue ? { queue } : {}),
        ...(search ? { q: search } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        page,
      })
      setData(next)
      if (detail) {
        try {
          setDetail(await api.getWorkerJob(detail.job.queue, detail.job.jobId))
        } catch {
          setDetail(null)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy('')
    }
  }

  const summary = data?.summary

  return (
    <div style={{ padding: '4px 2px 24px' }}>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Worker Jobs</h2>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px', maxWidth: 760 }}>
        Platform administrators can see every workspace. Abort stops a waiting job immediately. A running import, reclassify, or folder analysis stops at its next checkpoint. Mail already saved stays saved.
      </p>
      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, fontSize: 13 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {(
          [
            ['Active', summary?.active],
            ['Queued', summary?.queued],
            ['Delayed', summary?.delayed],
            ['Failed', summary?.failed],
            ['Paused', summary?.paused],
          ] as const
        ).map(([label, value]) => (
          <div key={label} style={{ minWidth: 88, padding: '8px 10px', border: '1px solid #e6e6e6', borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
            <div style={{ fontSize: 18 }}>{value ?? '—'}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={field}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="queued">Queued</option>
          <option value="delayed">Delayed</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={queue} onChange={(e) => setQueue(e.target.value)} style={field}>
          <option value="">All queues</option>
          {(data?.queues ?? []).map((item) => (
            <option key={item.name} value={item.name}>{item.displayName}</option>
          ))}
        </select>
        <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} style={field}>
          <option value="">All workspaces</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>{ws.name}</option>
          ))}
        </select>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Job id, mailbox, resource"
          style={{ ...field, minWidth: 200 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {(data?.queues ?? []).map((item) => (
          <div key={item.name} style={{ fontSize: 12, border: '1px solid #eee', borderRadius: 6, padding: '6px 8px' }}>
            <strong>{item.displayName}</strong>
            <span style={{ color: '#777' }}> · {item.counts.active} active · {item.counts.queued} waiting</span>
            <button
              type="button"
              disabled={Boolean(busy)}
              style={{ ...btn, marginLeft: 8 }}
              onClick={() => {
                const verb = item.paused ? 'Resume' : 'Pause'
                const ok = window.confirm(
                  `${verb} queue ${item.name}? Pausing a queue prevents waiting jobs from starting. Jobs already running may finish.`
                )
                if (!ok) return
                void act(item.name, () => (item.paused ? api.resumeWorkerQueue(item.name) : api.pauseWorkerQueue(item.name)))
              }}
            >
              {item.paused ? 'Resume queue' : 'Pause queue'}
            </button>
          </div>
        ))}
      </div>
      {(data?.schedules.length ?? 0) > 0 && (
        <div style={{ marginBottom: 14, fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Repeatable schedules</div>
          {data?.schedules.map((schedule) => (
            <div key={`${schedule.id}-${schedule.connectionId}`} style={{ marginBottom: 4 }}>
              inbox-sync · {schedule.connectionId ?? schedule.id ?? 'schedule'} · next {schedule.next ? clock(new Date(schedule.next).toISOString()) : '—'}
              {schedule.canDisable && schedule.connectionId && (
                <button
                  type="button"
                  style={{ ...btn, marginLeft: 8 }}
                  onClick={() => {
                    if (!window.confirm('Disable this inbox-sync schedule? This removes the recurring definition, not one execution.')) return
                    void act(schedule.connectionId!, () => api.disableWorkerSchedule(schedule.queue, schedule.connectionId!))
                  }}
                >
                  Disable schedule
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#777' }}>
              {['Status', 'Job', 'Queue', 'Progress', 'Last progress', 'Resource', 'Queued', 'Started', 'Duration', 'Attempts', 'Actions'].map((col) => (
                <th key={col} style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.jobs ?? []).map((row) => (
              <tr key={`${row.queue}:${row.jobId}`}>
                <td style={cell}>
                  {row.displayState}
                  {row.attention === 'INCONSISTENT' && <div style={{ color: '#9b1c1c' }}>STALE / ORPHANED</div>}
                  {row.attention === 'LONG_RUNNING' && <div style={{ color: '#9a6700' }}>Running a long time</div>}
                  <div style={{ color: '#555' }}>App: {row.runState ?? '—'}</div>
                  <div style={{ color: '#555' }}>BullMQ: {bullLabel(row)}</div>
                </td>
                <td style={cell}>
                  <div>{row.displayName}</div>
                  <div style={{ color: '#888' }}>{row.origin}</div>
                </td>
                <td style={cell}>{row.queue}</td>
                <td style={cell}>{progressText(row)}</td>
                <td style={cell}>{dateTime(row.lastProgressAt)}</td>
                <td style={cell}>
                  {row.resourceLabel}
                  {row.inboxConnectionId && row.workspaceId === props.currentWorkspaceId && (
                    <button type="button" style={linkBtn} onClick={() => props.onOpenMailbox(row.workspaceId!, row.inboxConnectionId!)}>
                      Open mailbox
                    </button>
                  )}
                </td>
                <td style={cell}>{clock(row.queuedAt)}</td>
                <td style={cell}>{clock(row.startedAt)}</td>
                <td style={cell}>{duration(row.durationMs)}</td>
                <td style={cell}>{row.attemptsMade}{row.maxAttempts != null ? ` / ${row.maxAttempts}` : ''}</td>
                <td style={cell}>
                  <RowActions
                    row={row}
                    busy={busy}
                    onDetails={() => {
                      void api.getWorkerJob(row.queue, row.jobId).then(setDetail).catch((err) => {
                        setError(err instanceof Error ? err.message : 'Failed to load job')
                      })
                    }}
                    onRetry={() => void act(row.jobId, () => api.retryWorkerJob(row.queue, row.jobId))}
                    onCancel={() => {
                      if (!window.confirm('Abort this job? It stops at the next checkpoint. Mail already saved stays saved.')) return
                      void act(row.jobId, () => api.cancelWorkerJob(row.queue, row.jobId))
                    }}
                    onRemove={() => {
                      if (!window.confirm('Remove this queue record? This does not undo database changes.')) return
                      void act(row.jobId, () => api.removeWorkerJob(row.queue, row.jobId))
                    }}
                  />
                </td>
              </tr>
            ))}
            {data && data.jobs.length === 0 && (
              <tr><td style={cell} colSpan={11}>No jobs in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
        Showing {data?.jobs.length ?? 0} of {data?.total ?? 0}
        {data?.truncated ? ' · history is limited to recent jobs kept by each queue' : ''}
        <button type="button" style={btn} disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>Prev</button>
        <button type="button" style={btn} disabled={!data || page * data.pageSize >= data.total} onClick={() => setPage((n) => n + 1)}>Next</button>
      </div>
      {detail && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: 420, maxWidth: '100%', height: '100%', background: '#fff', borderLeft: '1px solid #ddd', padding: 16, overflow: 'auto', zIndex: 20 }}>
          <button type="button" style={btn} onClick={() => setDetail(null)}>Close</button>
          <h3 style={{ fontSize: 16 }}>{detail.job.displayName}</h3>
          <DetailLine label="Job ID" value={detail.job.jobId} />
          <DetailLine label="Queue" value={detail.job.queue} />
          <DetailLine label="Queue state" value={bullLabel(detail.job)} />
          <DetailLine label="ForgeOps run state" value={detail.job.runState ?? '—'} />
          <DetailLine label="Last progress" value={dateTime(detail.job.lastProgressAt)} />
          <DetailLine label="Display" value={detail.job.displayState} />
          <DetailLine label="Workspace" value={detail.job.workspaceId ?? 'System'} />
          <DetailLine label="Resource" value={detail.job.resourceLabel} />
          <DetailLine label="Origin" value={detail.job.origin} />
          <DetailLine label="Queued" value={detail.job.queuedAt ?? '—'} />
          <DetailLine label="Started" value={detail.job.startedAt ?? '—'} />
          <DetailLine label="Finished" value={detail.job.finishedAt ?? '—'} />
          <DetailLine label="Duration" value={duration(detail.job.durationMs)} />
          <DetailLine label="Progress" value={progressText(detail.job)} />
          <DetailLine label="Attempts" value={`${detail.job.attemptsMade}${detail.job.maxAttempts != null ? ` / ${detail.job.maxAttempts}` : ''}`} />
          <DetailLine label="Failure" value={detail.job.failedReason ?? '—'} />
          {detail.job.capabilities.cancel && (
            <button
              type="button"
              style={{ ...btn, color: '#9b1c1c', marginBottom: 8 }}
              disabled={Boolean(busy)}
              onClick={() => {
                if (!window.confirm('Abort this job? It stops at the next checkpoint. Mail already saved stays saved.')) return
                void act(detail.job.jobId, () => api.cancelWorkerJob(detail.job.queue, detail.job.jobId))
              }}
            >
              Abort
            </button>
          )}
          <p style={{ fontSize: 12, color: '#666' }}>Revert unavailable. {detail.job.revertReason}</p>
          <p style={{ fontSize: 12, color: '#666' }}>
            {detail.queuePaused
              ? 'This queue is paused. Waiting jobs will not start. Running jobs may finish.'
              : 'Per-job pause is unavailable. Use Pause queue above to stop new work on a queue.'}
          </p>
          {detail.stack.length > 0 && (
            <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 8 }}>{detail.stack.join('\n')}</pre>
          )}
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 8 }}>{JSON.stringify(detail.payload, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function RowActions(props: {
  row: WorkerJobRow
  busy: string
  onDetails: () => void
  onRetry: () => void
  onCancel: () => void
  onRemove: () => void
}) {
  const { row } = props
  const primary = row.capabilities.retry
    ? { label: 'Retry', run: props.onRetry }
    : row.capabilities.cancel
      ? { label: 'Abort', run: props.onCancel }
      : { label: 'Details', run: props.onDetails }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        style={{ ...btn, ...(primary.label === 'Abort' ? { color: '#9b1c1c' } : {}) }}
        disabled={Boolean(props.busy)}
        onClick={primary.run}
      >
        {primary.label}
      </button>
      {row.capabilities.cancel && primary.label !== 'Abort' && (
        <button type="button" style={{ ...btn, color: '#9b1c1c' }} disabled={Boolean(props.busy)} onClick={props.onCancel}>
          Abort
        </button>
      )}
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>More</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <button type="button" style={btn} onClick={props.onDetails}>Details</button>
          {row.capabilities.remove && (
            <button type="button" style={{ ...btn, color: '#9b1c1c' }} onClick={props.onRemove}>Remove record</button>
          )}
        </div>
      </details>
    </div>
  )
}

function DetailLine(props: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12, marginBottom: 6 }}>
      <span style={{ color: '#888' }}>{props.label}: </span>
      {props.value}
    </div>
  )
}

const field: CSSProperties = {
  padding: '5px 8px',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 13,
}

const btn: CSSProperties = {
  fontSize: 12,
  padding: '3px 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
}

const linkBtn: CSSProperties = {
  ...btn,
  display: 'block',
  marginTop: 4,
  border: 'none',
  padding: 0,
  color: '#1d4e89',
}

const cell: CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid #f2f2f2',
  verticalAlign: 'top',
}
