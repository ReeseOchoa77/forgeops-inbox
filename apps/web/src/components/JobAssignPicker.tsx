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
