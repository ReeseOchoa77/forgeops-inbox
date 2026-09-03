import { useEffect, useRef, useState } from 'react'
import { api, type JobLookup } from '../api'

export function formatJobPrimaryLabel(job: Pick<JobLookup, 'name' | 'jobNumber'>, maxLen = 28): string {
  const name = job.name?.trim() || 'Untitled job'
  if (name.length <= maxLen) return name
  return `${name.slice(0, Math.max(1, maxLen - 1))}…`
}

export function formatJobSecondaryLabel(job: Pick<JobLookup, 'jobNumber' | 'customerName'>): string {
  const parts: string[] = []
  if (job.jobNumber) parts.push(`#${job.jobNumber}`)
  if (job.customerName) parts.push(job.customerName)
  return parts.join(' · ')
}

export function formatJobTooltip(job: Pick<JobLookup, 'name' | 'jobNumber' | 'customerName'>): string {
  const bits = [job.name]
  if (job.jobNumber) bits.push(`#${job.jobNumber}`)
  if (job.customerName) bits.push(job.customerName)
  return bits.filter(Boolean).join(' — ')
}

type Props = {
  workspaceId: string
  selectedJobId?: string | null
  onSelect: (job: JobLookup) => void
  onRemove?: () => void
  removeLabel?: string
  disabled?: boolean
  /** Compact absolute dropdown (inbox table) vs panel (detail). */
  variant?: 'dropdown' | 'panel'
  onClose?: () => void
  autoFocus?: boolean
}

/**
 * Searchable job assigner — primary label is job NAME; number/customer secondary.
 * Debounced server lookup (~280ms); does not preload thousands of jobs.
 */
export function JobAssignPicker({
  workspaceId,
  selectedJobId,
  onSelect,
  onRemove,
  removeLabel,
  disabled,
  variant = 'dropdown',
  onClose,
  autoFocus = true,
}: Props) {
  const [query, setQuery] = useState('')
  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const seq = ++seqRef.current
    const handle = setTimeout(() => {
      setLoading(true)
      setError(null)
      api
        .getJobsLookup(workspaceId, {
          showArchived: false,
          ...(query.trim() ? { search: query.trim() } : {}),
        })
        .then((r) => {
          if (seq !== seqRef.current) return
          setJobs(r.jobs)
        })
        .catch((e) => {
          if (seq !== seqRef.current) return
          setError(e instanceof Error ? e.message : 'Failed to load jobs')
          setJobs([])
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false)
        })
    }, 280)
    return () => clearTimeout(handle)
  }, [workspaceId, query])

  const shellStyle: React.CSSProperties =
    variant === 'dropdown'
      ? {
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 30,
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          width: 280,
          maxHeight: 280,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }
      : {
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fff',
          maxHeight: 320,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }

  return (
    <div style={shellStyle} onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search job name, #, or customer…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 8px',
            fontSize: 12,
            border: '1px solid #ddd',
            borderRadius: 4,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.()
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {onRemove && (
          <div
            onClick={() => {
              if (disabled) return
              onRemove()
              onClose?.()
            }}
            style={{
              padding: '8px 10px',
              fontSize: 11,
              color: '#c62828',
              cursor: disabled ? 'not-allowed' : 'pointer',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            {removeLabel ?? 'Remove job'}
          </div>
        )}
        {loading && jobs.length === 0 && (
          <div style={{ padding: '10px', fontSize: 11, color: '#999' }}>Searching…</div>
        )}
        {error && (
          <div style={{ padding: '10px', fontSize: 11, color: '#c62828' }}>{error}</div>
        )}
        {!loading && !error && jobs.length === 0 && (
          <div style={{ padding: '10px', fontSize: 11, color: '#999' }}>
            {query.trim() ? 'No matching jobs' : 'No jobs available'}
          </div>
        )}
        {jobs.map((j) => {
          const active = selectedJobId === j.id
          const secondary = formatJobSecondaryLabel(j)
          return (
            <div
              key={j.id}
              title={formatJobTooltip(j)}
              onClick={() => {
                if (disabled) return
                onSelect(j)
                onClose?.()
              }}
              style={{
                padding: '8px 10px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: active ? '#e0f2f1' : 'transparent',
                borderBottom: '1px solid #fafafa',
              }}
              onMouseOver={(e) => {
                if (!active) e.currentTarget.style.background = '#f5f5f5'
              }}
              onMouseOut={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              <div style={{ fontSize: 12, fontWeight: active ? 700 : 600, color: '#1a1a2e' }}>
                {j.name}
              </div>
              {secondary && (
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{secondary}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Inbox toolbar job filter — searchable like JobAssignPicker.
 * Values: "" (all), "unassigned", or a job id.
 */
export function JobFilterSelect({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<JobLookup | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const seq = ++seqRef.current
    const handle = window.setTimeout(() => {
      setLoading(true)
      api
        .getJobsLookup(workspaceId, {
          showArchived: false,
          ...(query.trim() ? { search: query.trim() } : {}),
        })
        .then((r) => {
          if (seq !== seqRef.current) return
          setJobs(r.jobs)
          if (value && value !== 'unassigned') {
            const hit = r.jobs.find((j) => j.id === value)
            if (hit) setSelectedJob(hit)
          }
        })
        .catch(() => {
          if (seq === seqRef.current) setJobs([])
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false)
        })
    }, 220)
    return () => window.clearTimeout(handle)
  }, [workspaceId, query, open, value])

  useEffect(() => {
    if (!value || value === 'unassigned') setSelectedJob(null)
  }, [value])

  const buttonLabel =
    value === ''
      ? 'All Jobs'
      : value === 'unassigned'
        ? 'Unassigned'
        : selectedJob
          ? `${selectedJob.name}${selectedJob.jobNumber ? ` (#${selectedJob.jobNumber})` : ''}`
          : 'Job…'

  const pick = (next: string, job?: JobLookup | null) => {
    onChange(next)
    setSelectedJob(job ?? null)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={selectedJob ? formatJobTooltip(selectedJob) : buttonLabel}
        style={{
          padding: '3px 8px',
          fontSize: 11,
          borderRadius: 6,
          border: open || value ? '1px solid #1a1a2e' : '1px solid #ddd',
          background: open || value ? '#1a1a2e' : '#fff',
          color: open || value ? '#fff' : '#444',
          cursor: 'pointer',
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {buttonLabel}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 40,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            width: 280,
            maxHeight: 300,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search job name, #, or customer…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 8px',
                fontSize: 12,
                border: '1px solid #ddd',
                borderRadius: 4,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false)
                  setQuery('')
                }
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {!query.trim() && (
              <>
                <JobFilterRow
                  label="All Jobs"
                  active={value === ''}
                  onClick={() => pick('')}
                />
                <JobFilterRow
                  label="Unassigned"
                  active={value === 'unassigned'}
                  onClick={() => pick('unassigned')}
                />
              </>
            )}
            {loading && jobs.length === 0 && (
              <div style={{ padding: 10, fontSize: 11, color: '#999' }}>Searching…</div>
            )}
            {!loading && query.trim() && jobs.length === 0 && (
              <div style={{ padding: 10, fontSize: 11, color: '#999' }}>No matching jobs</div>
            )}
            {jobs.map((j) => (
              <JobFilterRow
                key={j.id}
                label={j.name}
                secondary={formatJobSecondaryLabel(j)}
                title={formatJobTooltip(j)}
                active={value === j.id}
                onClick={() => pick(j.id, j)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function JobFilterRow({
  label,
  secondary,
  title,
  active,
  onClick,
}: {
  label: string
  secondary?: string
  title?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        padding: '8px 10px',
        cursor: 'pointer',
        background: active ? '#e8eaf6' : 'transparent',
        borderBottom: '1px solid #fafafa',
      }}
      onMouseOver={(e) => {
        if (!active) e.currentTarget.style.background = '#f5f5f5'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = active ? '#e8eaf6' : 'transparent'
      }}
    >
      <div style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: '#1a1a2e' }}>
        {active ? `✓ ${label}` : label}
      </div>
      {secondary && (
        <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{secondary}</div>
      )}
    </div>
  )
}
