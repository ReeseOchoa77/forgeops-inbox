import { useEffect, useState, useCallback } from 'react'
import { api, type JobSummary } from '../api'

interface Props {
  workspaceId: string
  userRole: string
  onSelectJob: (jobId: string) => void
}

const STATUSES = ['ALL', 'LEAD', 'BIDDING', 'AWARDED', 'ACTIVE', 'ON_HOLD', 'COMPLETE', 'ARCHIVED'] as const

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

export function JobsView({ workspaceId, userRole, onSelectJob }: Props) {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const canCreate = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'MEMBER'

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getJobs(workspaceId, {
        page,
        pageSize: 25,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        search: search || undefined,
        showArchived: showArchived || undefined,
      })
      setJobs(res.jobs)
      setTotalPages(res.pagination.totalPages)
      setTotalCount(res.pagination.totalCount)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [workspaceId, page, statusFilter, search, showArchived])

  useEffect(() => { loadJobs() }, [loadJobs])

  useEffect(() => { setPage(1) }, [statusFilter, search, showArchived])

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Jobs</h2>
        {canCreate && (
          <button
            onClick={() => { /* placeholder for create modal */ }}
            style={{
              padding: '8px 16px', background: '#1a1a2e', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer'
            }}
          >
            + Create Job
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: '#888' }}>Loading jobs...</div>
      )}

      {/* Empty state */}
      {!loading && jobs.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: '#888' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔨</div>
          <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: '#333' }}>No jobs found</h3>
          <p style={{ margin: 0, fontSize: 14, color: '#888' }}>
            {search || statusFilter !== 'ALL' ? 'Try adjusting your filters.' : 'Create your first job to get started.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && jobs.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Job #</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Name</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Customer</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Emails</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Open Tasks</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Overdue</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Last Activity</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Team</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr
                    key={job.id}
                    onClick={() => onSelectJob(job.id)}
                    style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                      {job.jobNumber ?? '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 500, color: '#111' }}>{job.name}</td>
                    <td style={{ padding: '10px 12px', color: '#555' }}>{job.customerName ?? '—'}</td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={job.status} /></td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{job.emailCount}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{job.openTaskCount}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: job.overdueTaskCount > 0 ? '#dc2626' : undefined, fontWeight: job.overdueTaskCount > 0 ? 600 : undefined }}>
                      {job.overdueTaskCount}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{relativeTime(job.lastActivityAt)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13, color: '#555' }}>
            <span>{totalCount} job{totalCount !== 1 ? 's' : ''} total</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                style={{ padding: '6px 12px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: page > 1 ? 'pointer' : 'not-allowed', opacity: page <= 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                style={{ padding: '6px 12px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: page < totalPages ? 'pointer' : 'not-allowed', opacity: page >= totalPages ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
