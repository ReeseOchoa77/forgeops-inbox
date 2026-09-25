import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ApiRequestError, api, type BiddingProject, type CustomerSummary } from '../api'
import { isBidsEstimatingSubtype, suggestedBidName } from '../bidding-display'

type ExistingJob = {
  id: string
  name: string
  status: string
  jobNumber?: string | null
}

type Props = {
  workspaceId: string
  messageId: string
  subject: string | null
  businessTypeKey?: string | null
  currentJob?: ExistingJob | null
  suggestedJobName?: string | null
  onClose: () => void
  onDone: (job: { id: string; name: string; jobNumber: string | null; status: string }) => void
}

export function AddToBiddingDialog({
  workspaceId,
  messageId,
  subject,
  businessTypeKey,
  currentJob,
  suggestedJobName,
  onClose,
  onDone,
}: Props) {
  const prefill = suggestedBidName(subject, currentJob?.name ?? suggestedJobName)
  const [mode, setMode] = useState<'existing' | 'create'>(currentJob && currentJob.status !== 'BIDDING' ? 'existing' : 'existing')
  const [search, setSearch] = useState('')
  const [bids, setBids] = useState<BiddingProject[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState(prefill)
  const [jobNumber, setJobNumber] = useState(currentJob?.jobNumber ?? '')
  const [bidDue, setBidDue] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmMove, setConfirmMove] = useState(false)
  const [existingOffer, setExistingOffer] = useState<ExistingJob | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.getBidding(workspaceId, { search, sort: 'name' })
        .then((res) => setBids(res.bids))
        .catch(() => setBids([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [workspaceId, search])

  useEffect(() => {
    api.getCustomers(workspaceId).then((res) => setCustomers(res.customers)).catch(() => setCustomers([]))
  }, [workspaceId])

  const customerChoices = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    const rows = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers
    return rows.slice(0, 12)
  }, [customers, customerQuery])

  const submit = async (extra?: { action?: 'use_job' | 'create'; jobId?: string; confirmMove?: boolean }) => {
    setBusy(true)
    setError(null)
    const action = extra?.action ?? (mode === 'create' ? 'create' : 'use_job')
    const jobId = extra?.jobId ?? (mode === 'create' ? undefined : selectedId || currentJob?.id)
    try {
      const res = await api.addEmailToBidding(workspaceId, {
        messageId,
        action,
        ...(jobId ? { jobId } : {}),
        ...(action === 'create' ? {
          name: name.trim(),
          jobNumber: jobNumber.trim() || null,
          customerId: customerId || null,
          bidDueAt: bidDue || null,
        } : {}),
        ...(bidDue && action === 'use_job' ? { bidDueAt: bidDue } : {}),
        ...((extra?.confirmMove ?? confirmMove) ? { confirmMove: true } : {}),
      })
      onDone(res.job)
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'EXISTING_JOB') {
        const cause = e.causePayload as ExistingJob | undefined
        if (cause?.id || (cause as { jobId?: string } | undefined)?.jobId) {
          const jobIdFromCause = cause && 'jobId' in cause ? String((cause as { jobId: string }).jobId) : cause?.id
          setExistingOffer({
            id: jobIdFromCause ?? '',
            name: (cause as { name?: string })?.name ?? name,
            status: (cause as { status?: string })?.status ?? 'ACTIVE',
            jobNumber: (cause as { jobNumber?: string | null })?.jobNumber ?? null,
          })
        }
        setError(e.message)
      } else if (e instanceof ApiRequestError && e.code === 'THREAD_JOB_CONFLICT') {
        setConfirmMove(true)
        setError(e.message)
      } else {
        setError(e instanceof Error ? e.message : 'Could not add this thread to Bidding')
      }
    } finally {
      setBusy(false)
    }
  }

  const alreadyBidding = currentJob?.status === 'BIDDING'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(480px, 100%)', background: '#fff', borderRadius: 10,
          border: '1px solid #e5e7eb', padding: 18, boxShadow: '0 16px 40px rgba(15,23,42,0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 650, color: '#111827' }}>Add to Bidding</div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45, marginBottom: 12 }}>
          This keeps the email in the inbox and marks the project as an active bid. Classifying an email as bidding-related does not do this by itself.
        </div>
        {isBidsEstimatingSubtype(businessTypeKey) && (
          <div style={{ fontSize: 12, color: '#1d4ed8', background: '#eff6ff', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
            This email is classified as bidding-related. Add it here only if you are actively pursuing the project.
          </div>
        )}
        {alreadyBidding && currentJob && (
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            This thread is already on the active bid <strong>{currentJob.name}</strong>.
          </div>
        )}
        {currentJob && !alreadyBidding && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit({ action: 'use_job', jobId: currentJob.id })}
            style={primaryButton(busy)}
          >
            Mark {currentJob.name} as actively bidding
          </button>
        )}

        <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          <button type="button" onClick={() => setMode('existing')} style={tabButton(mode === 'existing')}>Active bid</button>
          <button type="button" onClick={() => setMode('create')} style={tabButton(mode === 'create')}>Create new bid</button>
        </div>

        {mode === 'existing' ? (
          <div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search active bids"
              style={fieldStyle}
            />
            <div style={{ maxHeight: 180, overflow: 'auto', marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              {bids.length === 0 ? (
                <div style={{ padding: 10, fontSize: 12, color: '#6b7280' }}>No active bids match.</div>
              ) : bids.map((bid) => (
                <button
                  key={bid.id}
                  type="button"
                  onClick={() => setSelectedId(bid.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                    border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                    background: selectedId === bid.id ? '#eff6ff' : '#fff',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{bid.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {[bid.customerName, bid.jobNumber ? `#${bid.jobNumber}` : ''].filter(Boolean).join(' · ') || 'Active bid'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={labelStyle}>Project name
              <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
            </label>
            <label style={labelStyle}>Customer
              <input value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search customers" style={fieldStyle} />
            </label>
            {customerChoices.length > 0 && (
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={fieldStyle}>
                <option value="">No customer yet</option>
                {customerChoices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={labelStyle}>Job number
                <input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} style={fieldStyle} />
              </label>
              <label style={labelStyle}>Bid due
                <input type="date" value={bidDue} onChange={(e) => setBidDue(e.target.value)} style={fieldStyle} />
              </label>
            </div>
          </div>
        )}

        {error && <div style={{ marginTop: 10, fontSize: 12, color: '#b42318', lineHeight: 1.4 }}>{error}</div>}
        {existingOffer && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit({ action: 'use_job', jobId: existingOffer.id, confirmMove: true })}
            style={{ ...primaryButton(busy), marginTop: 8 }}
          >
            Mark {existingOffer.name} as actively bidding
          </button>
        )}
        {confirmMove && !existingOffer && (
          <button type="button" disabled={busy} onClick={() => void submit({ confirmMove: true })} style={{ ...primaryButton(busy), marginTop: 8 }}>
            Move thread
          </button>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={quietButton}>Cancel</button>
          {!alreadyBidding && (
            <button
              type="button"
              disabled={busy || (mode === 'existing' ? !selectedId && !currentJob : !name.trim())}
              onClick={() => void submit()}
              style={primaryButton(busy)}
            >
              {busy ? 'Saving...' : 'Add to Bidding'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function primaryButton(busy: boolean): CSSProperties {
  return {
    padding: '8px 12px', borderRadius: 6, border: 'none', background: '#1a1a2e', color: '#fff',
    fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
  }
}

const quietButton: CSSProperties = {
  padding: '8px 12px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff',
  fontSize: 13, cursor: 'pointer',
}

function tabButton(active: boolean): CSSProperties {
  return {
    padding: '6px 10px', borderRadius: 6, border: '1px solid #d0d5dd',
    background: active ? '#111827' : '#fff', color: active ? '#fff' : '#374151',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}

const fieldStyle: CSSProperties = {
  width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13,
}

const labelStyle: CSSProperties = { fontSize: 12, color: '#374151', fontWeight: 600 }
