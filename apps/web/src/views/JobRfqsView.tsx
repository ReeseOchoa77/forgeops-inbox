import { useCallback, useEffect, useState } from 'react'
import { api, type JobRfq } from '../api'
import { formatStatusLabel } from '../job-crm-ui'

const STATUSES = ['DRAFT', 'REQUESTED', 'RECEIVED', 'DECLINED', 'CANCELLED'] as const

function moneyLabel(v: string | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function JobRfqsView({
  workspaceId,
  jobId,
  canEdit,
  isPhone,
}: {
  workspaceId: string
  jobId: string
  canEdit: boolean
  isPhone?: boolean
}) {
  const [rfqs, setRfqs] = useState<JobRfq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.listJobRfqs(workspaceId, jobId)
      setRfqs(r.rfqs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load RFQs')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!title.trim() || !canEdit) return
    setCreating(true)
    setError('')
    try {
      await api.createJobRfq(workspaceId, jobId, { title: title.trim(), status: 'DRAFT' })
      setTitle('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  const setStatus = async (rfq: JobRfq, status: (typeof STATUSES)[number]) => {
    if (!canEdit) return
    try {
      await api.updateJobRfq(workspaceId, jobId, rfq.id, { status })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const remove = async (rfq: JobRfq) => {
    if (!canEdit) return
    if (!confirm(`Delete RFQ “${rfq.title}”?`)) return
    try {
      await api.deleteJobRfq(workspaceId, jobId, rfq.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>RFQs</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>
          Request for Quote — outside pricing needed before bid day. Distinct from RFI (clarification).
        </p>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fce4ec', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Joist / deck supplier quote"
            style={{
              flex: 1,
              minWidth: isPhone ? '100%' : 220,
              padding: '8px 10px',
              border: '1px solid #d0d5dd',
              borderRadius: 6,
              fontSize: 13,
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={creating || !title.trim()}
            onClick={() => void create()}
          >
            {creating ? 'Adding…' : 'Add RFQ'}
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</p>
      ) : rfqs.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
            No RFQs yet. Track supplier, galvanizing, erection, or specialty quotes here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rfqs.map((rfq) => (
            <div
              key={rfq.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{rfq.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    {rfq.vendorName ? `Vendor: ${rfq.vendorName}` : 'Vendor not set'}
                    {' · '}Due {dateLabel(rfq.dueDate)}
                    {' · '}Quote {moneyLabel(rfq.quotedAmount)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {canEdit ? (
                    <select
                      value={rfq.status}
                      onChange={(e) => void setStatus(rfq, e.target.value as (typeof STATUSES)[number])}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d0d5dd' }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {formatStatusLabel(s)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{formatStatusLabel(rfq.status)}</span>
                  )}
                  {canEdit && (
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => void remove(rfq)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {rfq.description && (
                <div style={{ fontSize: 12, color: '#4b5563', marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {rfq.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function RfqOverviewSummary({
  summary,
  onViewRfqs,
}: {
  summary?: {
    totalCount: number
    outstandingCount: number
    receivedCount: number
  } | null
  onViewRfqs?: () => void
}) {
  if (!summary || summary.totalCount === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          RFQs
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>No RFQs yet.</p>
        {onViewRfqs && (
          <button type="button" onClick={onViewRfqs} style={{ marginTop: 8, fontSize: 12, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>
            Open RFQs →
          </button>
        )}
      </div>
    )
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          RFQs
        </div>
        {onViewRfqs && (
          <button type="button" onClick={onViewRfqs} style={{ fontSize: 12, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>
            View all →
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
        <span><strong>{summary.outstandingCount}</strong> outstanding</span>
        <span><strong>{summary.receivedCount}</strong> received</span>
        <span style={{ color: '#6b7280' }}>{summary.totalCount} total</span>
      </div>
    </div>
  )
}
