import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ApiRequestError, api, type CustomerSummary, type JobLookup } from '../api'
import { isBidsEstimatingSubtype, suggestBidProjectNameFromSubject, suggestedBidName } from '../bidding-display'
import { JobAssignPicker } from './JobAssignPicker'

type CurrentJob = {
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
  currentJob?: CurrentJob | null
  suggestedJobName?: string | null
  /** Open directly on create-new-job form. */
  initialMode?: 'assign' | 'create'
  onClose: () => void
  onAssigned: (job: JobLookup) => void
  onRemoved: () => void
  onCreated: (job: { id: string; name: string; jobNumber: string | null; status: string }) => void
}

/**
 * Unified Inbox Job assignment modal:
 * - assign / change / remove existing Job (USER_ASSIGNED via assign APIs)
 * - create new BIDDING Job (reuses bidding intake + from-email)
 */
export function EmailJobAssignmentDialog({
  workspaceId,
  messageId,
  subject,
  businessTypeKey,
  currentJob,
  suggestedJobName,
  initialMode = 'assign',
  onClose,
  onAssigned,
  onRemoved,
  onCreated,
}: Props) {
  const [mode, setMode] = useState<'assign' | 'create'>(initialMode)
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const immediateName = suggestedBidName(subject, currentJob?.name ?? suggestedJobName)
  const [name, setName] = useState(immediateName)
  const [jobNumber, setJobNumber] = useState('')
  const [bidDue, setBidDue] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [proposedCustomerName, setProposedCustomerName] = useState('')
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [confirmMove, setConfirmMove] = useState(false)
  const [existingOffer, setExistingOffer] = useState<CurrentJob | null>(null)
  const [nameHint, setNameHint] = useState<string | null>(
    immediateName && !currentJob?.name ? 'Suggested from email' : null
  )
  const [jobNumberHint, setJobNumberHint] = useState<string | null>(null)
  const [bidDueHint, setBidDueHint] = useState<string | null>(null)
  const [customerHint, setCustomerHint] = useState<string | null>(null)

  const nameDirty = useRef(false)
  const jobNumberDirty = useRef(false)
  const bidDueDirty = useRef(false)
  const customerDirty = useRef(false)
  const suggestionsLoadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (mode !== 'create') return
    api.getCustomers(workspaceId).then((res) => setCustomers(res.customers)).catch(() => setCustomers([]))
  }, [mode, workspaceId])

  // Create form: load intake suggestions once per message. Never overwrite dirty fields.
  useEffect(() => {
    if (mode !== 'create') return
    if (suggestionsLoadedFor.current === messageId) return
    suggestionsLoadedFor.current = messageId

    if (!nameDirty.current) {
      const local = suggestBidProjectNameFromSubject(subject)
      if (local) {
        setName(local)
        setNameHint('Suggested from email')
      }
    }

    let cancelled = false
    setSuggestLoading(true)
    api.getBiddingIntakeSuggestions(workspaceId, messageId)
      .then((res) => {
        if (cancelled) return
        const s = res.suggestions
        if (!nameDirty.current && s.projectName) {
          setName(s.projectName)
          setNameHint('Suggested from email')
        }
        if (!jobNumberDirty.current && s.jobNumber) {
          setJobNumber(s.jobNumber)
          setJobNumberHint('Suggested next number')
        }
        if (!bidDueDirty.current && s.bidDueAt) {
          setBidDue(s.bidDueAt.slice(0, 10))
          setBidDueHint('Suggested from email')
        }
        if (!customerDirty.current && s.customer) {
          const c = s.customer
          if (c.status === 'EXISTING' && c.customerId) {
            setCustomerId(c.customerId)
            setProposedCustomerName('')
            setCustomerQuery(c.customerName ?? '')
            setCustomerHint('Suggested from email')
          } else if (c.status === 'NEW' && c.customerName) {
            setCustomerId('')
            setProposedCustomerName(c.customerName)
            setCustomerQuery(c.customerName)
            setCustomerHint('New customer')
          } else if (c.status === 'AMBIGUOUS') {
            setCustomerId('')
            setProposedCustomerName('')
            setCustomerQuery(c.customerName ?? '')
            setCustomerHint('Multiple matches — choose one')
          }
        }
      })
      .catch(() => {
        // AI failure must not block create / assign.
      })
      .finally(() => {
        if (!cancelled) setSuggestLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mode, workspaceId, messageId, subject])

  const customerChoices = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    const rows = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers
    return rows.slice(0, 12)
  }, [customers, customerQuery])

  const markCustomerDirty = () => {
    customerDirty.current = true
    setCustomerHint(null)
  }

  const clearCustomer = () => {
    markCustomerDirty()
    setCustomerId('')
    setProposedCustomerName('')
    setCustomerQuery('')
  }

  const selectExistingCustomer = (id: string) => {
    markCustomerDirty()
    if (!id) {
      setCustomerId('')
      setProposedCustomerName('')
      return
    }
    const row = customers.find((c) => c.id === id)
    setCustomerId(id)
    setProposedCustomerName('')
    setCustomerQuery(row?.name ?? '')
  }

  const onCustomerQueryChange = (value: string) => {
    markCustomerDirty()
    setCustomerQuery(value)
    setCustomerId('')
    const trimmed = value.trim()
    setProposedCustomerName(trimmed)
    if (trimmed) {
      const exact = customers.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
      if (exact) {
        setCustomerId(exact.id)
        setProposedCustomerName('')
        setCustomerHint(null)
      } else {
        const partial = customers.some((c) => c.name.toLowerCase().includes(trimmed.toLowerCase()))
        setCustomerHint(partial ? null : 'New customer')
      }
    } else {
      setCustomerHint(null)
    }
  }

  const handleSelectExisting = async (job: JobLookup) => {
    if (currentJob?.id === job.id) {
      onClose()
      return
    }
    setAssignBusy(true)
    setAssignError(null)
    try {
      await api.assignEmailToJob(workspaceId, job.id, { messageId })
      onAssigned(job)
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Could not assign Job')
    } finally {
      setAssignBusy(false)
    }
  }

  const handleRemove = async () => {
    if (!currentJob) return
    setAssignBusy(true)
    setAssignError(null)
    try {
      await api.removeEmailFromJob(workspaceId, currentJob.id, messageId)
      onRemoved()
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Could not remove Job assignment')
    } finally {
      setAssignBusy(false)
    }
  }

  const submitCreate = async (extra?: { confirmMove?: boolean; jobId?: string; action?: 'use_job' | 'create' }) => {
    setCreateBusy(true)
    setCreateError(null)
    const action = extra?.action ?? 'create'
    const createCustomerId = customerId || null
    const createCustomerName = createCustomerId
      ? null
      : (proposedCustomerName.trim() || customerQuery.trim() || null)
    try {
      const res = await api.addEmailToBidding(workspaceId, {
        messageId,
        action,
        ...(extra?.jobId ? { jobId: extra.jobId } : {}),
        ...(action === 'create' ? {
          name: name.trim(),
          jobNumber: jobNumber.trim() || null,
          customerId: createCustomerId,
          customerName: createCustomerName,
          bidDueAt: bidDue || null,
        } : {}),
        ...((extra?.confirmMove ?? confirmMove) ? { confirmMove: true } : {}),
      })
      onCreated(res.job)
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'EXISTING_JOB') {
        const cause = e.causePayload as CurrentJob & { jobId?: string } | undefined
        const jobIdFromCause = cause?.jobId ?? cause?.id
        if (jobIdFromCause) {
          setExistingOffer({
            id: jobIdFromCause,
            name: cause?.name ?? name,
            status: cause?.status ?? 'ACTIVE',
            jobNumber: cause?.jobNumber ?? null,
          })
        }
        setCreateError(e.message)
      } else if (e instanceof ApiRequestError && e.code === 'JOB_NUMBER_TAKEN') {
        const cause = e.causePayload as { suggestedJobNumber?: string | null } | undefined
        const next = cause?.suggestedJobNumber
        setCreateError(next ? `${e.message} Next available suggestion: ${next}` : e.message)
      } else if (e instanceof ApiRequestError && e.code === 'THREAD_JOB_CONFLICT') {
        setConfirmMove(true)
        setCreateError(e.message)
      } else {
        setCreateError(e instanceof Error ? e.message : 'Could not create Job')
      }
    } finally {
      setCreateBusy(false)
    }
  }

  const title = mode === 'create' ? 'Create new job' : 'Assign to Job'
  const busy = assignBusy || createBusy

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(480px, 100%)', background: '#fff', borderRadius: 10,
          border: '1px solid #e5e7eb', padding: 18, boxShadow: '0 16px 40px rgba(15,23,42,0.12)',
          maxHeight: 'min(90vh, 720px)', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 650, color: '#111827' }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18 }}>×</button>
        </div>

        {mode === 'assign' ? (
          <>
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45, marginBottom: 10 }}>
              Choose which Job this email belongs to. Creating a new Job from Inbox starts it as Bidding.
            </div>
            {currentJob && (
              <div style={{
                fontSize: 12, marginBottom: 10, padding: '8px 10px', borderRadius: 6,
                background: '#f8fafc', border: '1px solid #e5e7eb', color: '#374151',
              }}>
                Currently assigned to <strong>{currentJob.name}</strong>
                {currentJob.jobNumber ? ` (#${currentJob.jobNumber})` : ''}
                {currentJob.status ? ` · ${currentJob.status}` : ''}
              </div>
            )}
            {isBidsEstimatingSubtype(businessTypeKey) && (
              <div style={{ fontSize: 12, color: '#1d4ed8', background: '#eff6ff', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>
                Classified as bidding-related. You can assign an existing Job or create a new Bidding Job.
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('create')}
              style={{
                ...quietButton, width: '100%', textAlign: 'left', marginBottom: 10,
                fontWeight: 650, color: '#1d4ed8', borderColor: '#bfdbfe', background: '#eff6ff',
              }}
            >
              + Create new job
            </button>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <JobAssignPicker
                workspaceId={workspaceId}
                selectedJobId={currentJob?.id}
                disabled={assignBusy}
                variant="panel"
                onSelect={(job) => void handleSelectExisting(job)}
                onRemove={currentJob ? () => void handleRemove() : undefined}
                removeLabel={currentJob ? `Remove from ${currentJob.name}` : undefined}
              />
            </div>
            {assignError && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#b42318', lineHeight: 1.4 }}>{assignError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" onClick={onClose} style={quietButton}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45, marginBottom: 10 }}>
              Creates a Bidding Job and assigns this email thread. Suggestions prepare the form — nothing is saved until you confirm.
            </div>
            <button
              type="button"
              onClick={() => setMode('assign')}
              style={{ ...quietButton, marginBottom: 10, alignSelf: 'flex-start' }}
            >
              ← Assign existing Job
            </button>
            <div style={{ display: 'grid', gap: 8, overflow: 'auto', flex: 1, minHeight: 0 }}>
              {suggestLoading && (
                <div style={{ fontSize: 11, color: '#6b7280' }}>Preparing suggestions…</div>
              )}
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Status: <strong style={{ color: '#1d4ed8' }}>Bidding</strong>
              </div>
              <label style={labelStyle}>
                Project name
                {nameHint && <span style={hintStyle}> · {nameHint}</span>}
                <input
                  value={name}
                  onChange={(e) => {
                    nameDirty.current = true
                    setNameHint(null)
                    setName(e.target.value)
                  }}
                  style={fieldStyle}
                />
              </label>
              <label style={labelStyle}>
                Customer
                {customerHint && <span style={hintStyle}> · {customerHint}</span>}
                <input
                  value={customerQuery}
                  onChange={(e) => onCustomerQueryChange(e.target.value)}
                  placeholder="No customer yet"
                  style={fieldStyle}
                />
              </label>
              {(customerId || proposedCustomerName || customerChoices.length > 0) && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={customerId}
                    onChange={(e) => selectExistingCustomer(e.target.value)}
                    style={{ ...fieldStyle, marginTop: 0, flex: 1 }}
                  >
                    <option value="">
                      {proposedCustomerName
                        ? `New customer: ${proposedCustomerName}`
                        : 'No customer yet'}
                    </option>
                    {customerChoices.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {(customerId || proposedCustomerName || customerQuery) && (
                    <button type="button" onClick={clearCustomer} style={quietButton}>Clear</button>
                  )}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={labelStyle}>
                  Job number
                  {jobNumberHint && <span style={hintStyle}> · {jobNumberHint}</span>}
                  <input
                    value={jobNumber}
                    onChange={(e) => {
                      jobNumberDirty.current = true
                      setJobNumberHint(null)
                      setJobNumber(e.target.value)
                    }}
                    style={fieldStyle}
                  />
                </label>
                <label style={labelStyle}>
                  Bid due
                  {bidDueHint && <span style={hintStyle}> · {bidDueHint}</span>}
                  <input
                    type="date"
                    value={bidDue}
                    onChange={(e) => {
                      bidDueDirty.current = true
                      setBidDueHint(null)
                      setBidDue(e.target.value)
                    }}
                    style={fieldStyle}
                  />
                </label>
              </div>
            </div>

            {createError && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#b42318', lineHeight: 1.4 }}>{createError}</div>
            )}
            {existingOffer && (
              <button
                type="button"
                disabled={createBusy}
                onClick={() => void submitCreate({ action: 'use_job', jobId: existingOffer.id, confirmMove: true })}
                style={{ ...primaryButton(createBusy), marginTop: 8 }}
              >
                Use existing {existingOffer.name}
              </button>
            )}
            {confirmMove && !existingOffer && (
              <button
                type="button"
                disabled={createBusy}
                onClick={() => void submitCreate({ confirmMove: true })}
                style={{ ...primaryButton(createBusy), marginTop: 8 }}
              >
                Move thread
              </button>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={onClose} style={quietButton}>Cancel</button>
              <button
                type="button"
                disabled={createBusy || !name.trim()}
                onClick={() => void submitCreate()}
                style={primaryButton(createBusy)}
              >
                {createBusy ? 'Saving…' : 'Create Job'}
              </button>
            </div>
          </>
        )}
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

const fieldStyle: CSSProperties = {
  width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13,
}

const labelStyle: CSSProperties = { fontSize: 12, color: '#374151', fontWeight: 600 }

const hintStyle: CSSProperties = { fontWeight: 500, color: '#6b7280', fontSize: 11 }
