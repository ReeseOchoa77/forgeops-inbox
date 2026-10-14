import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, type CustomerSummary, type JobLookup, type OperationalBidCandidate } from '../api'
import { suggestBidProjectNameFromSubject, suggestedBidName } from '../bidding-display'
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
  /** @deprecated unused — kept optional so callers need not change. */
  businessTypeKey?: string | null
  currentJob?: CurrentJob | null
  suggestedJobName?: string | null
  /** Open directly on create Bid Candidate form. */
  initialMode?: 'assign' | 'create' | 'assign-candidate'
  onClose: () => void
  onAssigned: (job: JobLookup) => void
  onRemoved: () => void
  /** Fired after Create Bid Candidate (no Job). */
  onCreated: (job: { id: string; name: string; jobNumber: string | null; status: string }) => void
  /** Optional: fired when email is linked to a Bid Candidate. */
  onBidCandidateLinked?: (candidateId: string) => void
}

type DialogMode = 'assign' | 'create' | 'assign-candidate'

/**
 * Unified Inbox assignment modal:
 * - assign / change / remove existing Job
 * - Create Bid Candidate (permanent opportunity — no Job / Job number)
 * - Assign to Bid Candidate (manual association is authoritative)
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
  onBidCandidateLinked,
}: Props) {
  const [mode, setMode] = useState<DialogMode>(
    initialMode === 'create' ? 'create' : initialMode === 'assign-candidate' ? 'assign-candidate' : 'assign'
  )
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const immediateName = suggestedBidName(subject, currentJob?.name ?? suggestedJobName)
  const [name, setName] = useState(immediateName)
  const [bidDue, setBidDue] = useState('')
  const [anticipatedStart, setAnticipatedStart] = useState('')
  const [scope, setScope] = useState('')
  const [notes, setNotes] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [proposedCustomerName, setProposedCustomerName] = useState('')
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [nameHint, setNameHint] = useState<string | null>(
    immediateName && !currentJob?.name ? 'Suggested from email' : null
  )
  const [bidDueHint, setBidDueHint] = useState<string | null>(null)
  const [customerHint, setCustomerHint] = useState<string | null>(null)

  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidates, setCandidates] = useState<OperationalBidCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidateBusy, setCandidateBusy] = useState(false)
  const [candidateError, setCandidateError] = useState<string | null>(null)

  const nameDirty = useRef(false)
  const bidDueDirty = useRef(false)
  const customerDirty = useRef(false)
  const suggestionsLoadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (mode !== 'create') return
    api.getCustomers(workspaceId).then((res) => setCustomers(res.customers)).catch(() => setCustomers([]))
  }, [mode, workspaceId])

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
          setNameHint(
            s.projectNameSource === 'attachment'
              ? 'Suggested from drawing filename'
              : 'Suggested from email'
          )
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

  useEffect(() => {
    if (mode !== 'assign-candidate') return
    let cancelled = false
    setCandidatesLoading(true)
    setCandidateError(null)
    const q = candidateSearch.trim()
    const timer = setTimeout(() => {
      api
        .listOperationalBidCandidates(workspaceId, {
          search: q || undefined,
          includeArchived: false,
        })
        .then((res) => {
          if (!cancelled) setCandidates(res.candidates)
        })
        .catch((e) => {
          if (!cancelled) {
            setCandidateError(e instanceof Error ? e.message : 'Could not load Bid Candidates')
            setCandidates([])
          }
        })
        .finally(() => {
          if (!cancelled) setCandidatesLoading(false)
        })
    }, q ? 200 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [mode, workspaceId, candidateSearch])

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

  const submitCreateCandidate = async () => {
    setCreateBusy(true)
    setCreateError(null)
    const createCustomerId = customerId || null
    const createCustomerName = createCustomerId
      ? null
      : (proposedCustomerName.trim() || customerQuery.trim() || null)
    try {
      const res = await api.createBidCandidateFromEmail(workspaceId, {
        messageId,
        projectName: name.trim(),
        customerId: createCustomerId,
        customerName: createCustomerName,
        resolveCreateCustomer: Boolean(createCustomerName) && !createCustomerId,
        bidDueAt: bidDue ? new Date(`${bidDue}T12:00:00.000Z`).toISOString() : null,
        anticipatedStartAt: anticipatedStart
          ? new Date(`${anticipatedStart}T12:00:00.000Z`).toISOString()
          : null,
        scope: scope.trim() || null,
        notes: notes.trim() || null,
        // Quote emails become durable QUOTE evidence on the new Candidate.
        ...(businessTypeKey === 'ESTIMATE_QUOTE'
          ? { role: 'QUOTE' as const }
          : {}),
      })
      onBidCandidateLinked?.(res.candidateId)
      // Compat callback — no Job created; surface Candidate id as pseudo job id for refresh.
      onCreated({
        id: res.candidateId,
        name: name.trim(),
        jobNumber: null,
        status: 'BID_CANDIDATE',
      })
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create Bid Candidate')
    } finally {
      setCreateBusy(false)
    }
  }

  const handleAssignCandidate = async (candidateId: string) => {
    setCandidateBusy(true)
    setCandidateError(null)
    // Quote emails use QUOTE role; Bid Invites / other mail default to BID_INVITE.
    const role =
      businessTypeKey === 'ESTIMATE_QUOTE' ? 'QUOTE' : 'BID_INVITE'
    try {
      await api.assignEmailToBidCandidate(workspaceId, candidateId, {
        messageId,
        role,
        forceReassign: true,
      })
      onBidCandidateLinked?.(candidateId)
      onClose()
    } catch (e) {
      setCandidateError(e instanceof Error ? e.message : 'Could not assign Bid Candidate')
    } finally {
      setCandidateBusy(false)
    }
  }

  const title =
    mode === 'create'
      ? 'Create Bid Candidate'
      : mode === 'assign-candidate'
        ? 'Assign to Bid Candidate'
        : 'Assign to Job'
  const busy = assignBusy || createBusy || candidateBusy

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
              Assign this email to a Job, or capture it as a Bid Candidate opportunity (no Job number).
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
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('create')}
              data-testid="inbox-create-bid-candidate"
              style={{
                ...quietButton, width: '100%', textAlign: 'left', marginBottom: 8,
                fontWeight: 650, color: '#1d4ed8', borderColor: '#bfdbfe', background: '#eff6ff',
              }}
            >
              + Create Bid Candidate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('assign-candidate')}
              data-testid="inbox-assign-bid-candidate"
              style={{
                ...quietButton, width: '100%', textAlign: 'left', marginBottom: 10,
                fontWeight: 600, color: '#0f766e', borderColor: '#99f6e4', background: '#f0fdfa',
              }}
            >
              Assign to Bid Candidate
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
        ) : mode === 'assign-candidate' ? (
          <>
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45, marginBottom: 10 }}>
              Link this email to an existing Bid Candidate. Manual assignment survives analysis reruns.
            </div>
            <button
              type="button"
              onClick={() => setMode('assign')}
              style={{ ...quietButton, marginBottom: 10, alignSelf: 'flex-start' }}
            >
              ← Back
            </button>
            <input
              value={candidateSearch}
              onChange={(e) => setCandidateSearch(e.target.value)}
              placeholder="Search Bid Candidates…"
              aria-label="Search Bid Candidates"
              style={{ ...fieldStyle, marginBottom: 8 }}
            />
            <div style={{ flex: 1, minHeight: 120, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
              {candidatesLoading && (
                <div style={{ padding: 12, fontSize: 12, color: '#6b7280' }}>Loading…</div>
              )}
              {!candidatesLoading && candidates.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: '#6b7280' }}>No Bid Candidates found.</div>
              )}
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={candidateBusy}
                  onClick={() => void handleAssignCandidate(c.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                    border: 'none', borderBottom: '1px solid #f3f4f6', background: '#fff',
                    cursor: candidateBusy ? 'not-allowed' : 'pointer', fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#111827' }}>{c.projectName}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {c.customerName ?? 'No customer'}
                    {c.lifecycle ? ` · ${c.lifecycle}` : ''}
                    {typeof c.quoteCount === 'number' ? ` · ${c.quoteCount} quote${c.quoteCount === 1 ? '' : 's'}` : ''}
                  </div>
                </button>
              ))}
            </div>
            {candidateError && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#b42318', lineHeight: 1.4 }}>{candidateError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" onClick={onClose} style={quietButton}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45, marginBottom: 10 }}>
              Creates a permanent Bid Candidate and links this email as evidence. No Job and no ForgeOps Job number are created.
            </div>
            <button
              type="button"
              onClick={() => setMode('assign')}
              style={{ ...quietButton, marginBottom: 10, alignSelf: 'flex-start' }}
            >
              ← Back
            </button>
            <div style={{ display: 'grid', gap: 8, overflow: 'auto', flex: 1, minHeight: 0 }}>
              {suggestLoading && (
                <div style={{ fontSize: 11, color: '#6b7280' }}>Preparing suggestions…</div>
              )}
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Lifecycle: <strong style={{ color: '#1d4ed8' }}>OPEN</strong>
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
                Customer / GC
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
                <label style={labelStyle}>
                  Anticipated start
                  <input
                    type="date"
                    value={anticipatedStart}
                    onChange={(e) => setAnticipatedStart(e.target.value)}
                    style={fieldStyle}
                  />
                </label>
              </div>
              <label style={labelStyle}>
                Detailed scope
                <textarea
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  rows={3}
                  style={{ ...fieldStyle, resize: 'vertical' }}
                />
              </label>
              <label style={labelStyle}>
                Notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  style={{ ...fieldStyle, resize: 'vertical' }}
                />
              </label>
            </div>

            {createError && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#b42318', lineHeight: 1.4 }}>{createError}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={onClose} style={quietButton}>Cancel</button>
              <button
                type="button"
                disabled={createBusy || !name.trim()}
                onClick={() => void submitCreateCandidate()}
                data-testid="confirm-create-bid-candidate"
                style={primaryButton(createBusy)}
              >
                {createBusy ? 'Saving…' : 'Create Bid Candidate'}
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
