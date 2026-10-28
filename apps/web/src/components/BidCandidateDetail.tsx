import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  api,
  type BidCandidateLifecycle,
  type CustomerSummary,
  type MessageSummary,
  type OperationalBidCandidateDetail,
  type StoredAttachment,
} from '../api'
import { formatBidDue } from '../bidding-display'
import {
  isScopeReviewPlaceholder,
  parseDetailedScope,
  type DetailedScope,
} from '@forgeops/shared/bidding/scope-detail'

type Props = {
  workspaceId: string
  detail: OperationalBidCandidateDetail
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
  onOpenJob?: (jobId: string) => void
  onUpdated: (next: OperationalBidCandidateDetail) => void
}

const EDITABLE_LIFECYCLES: Array<Exclude<BidCandidateLifecycle, 'CONVERTED'>> = [
  'OPEN',
  'QUOTED',
  'LOST',
  'ARCHIVED',
]

export function BidCandidateDetail({
  workspaceId,
  detail,
  onOpenMessage,
  onOpenJob,
  onUpdated,
}: Props) {
  const canConvert =
    detail.lifecycle === 'OPEN' || detail.lifecycle === 'QUOTED'
  const [showConvert, setShowConvert] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [customers, setCustomers] = useState<CustomerSummary[]>([])

  const [projectName, setProjectName] = useState(detail.projectName ?? '')
  const [customerId, setCustomerId] = useState(detail.customerId ?? '')
  const [bidDue, setBidDue] = useState(dateInputValue(detail.bidDueAt))
  const [startDate, setStartDate] = useState(
    dateInputValue(detail.anticipatedStartAt)
  )
  const [externalNumber, setExternalNumber] = useState(
    detail.externalProjectNumber ?? ''
  )
  const [lifecycle, setLifecycle] = useState<BidCandidateLifecycle>(
    detail.lifecycle
  )
  const [notes, setNotes] = useState(detail.notes ?? '')
  const [tradeCategory, setTradeCategory] = useState('')
  const [scopeSummary, setScopeSummary] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [work, setWork] = useState<string[]>([])
  const [exclusions, setExclusions] = useState<string[]>([])
  const [qualifications, setQualifications] = useState<string[]>([])

  const hydrateFromDetail = (next: OperationalBidCandidateDetail) => {
    setProjectName(next.projectName ?? '')
    setCustomerId(next.customerId ?? '')
    setBidDue(dateInputValue(next.bidDueAt))
    setStartDate(dateInputValue(next.anticipatedStartAt))
    setExternalNumber(next.externalProjectNumber ?? '')
    setLifecycle(next.lifecycle)
    setNotes(next.notes ?? '')
    const parsed = parseDetailedScope(next.scopeDetail)
    setTradeCategory(parsed?.tradeCategory ?? '')
    setScopeSummary(
      (next.scopeSummary && !isScopeReviewPlaceholder(next.scopeSummary)
        ? next.scopeSummary
        : parsed?.summary && !isScopeReviewPlaceholder(parsed.summary)
          ? parsed.summary
          : '') ?? ''
    )
    setItems(namesOf(parsed?.items))
    setWork(namesOf(parsed?.work))
    setExclusions(namesOf(parsed?.exclusions))
    setQualifications(namesOf(parsed?.qualifications))
  }

  useEffect(() => {
    hydrateFromDetail(detail)
    setEditing(false)
    setSaveError(null)
    setSaveOk(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id, detail.updatedAt])

  useEffect(() => {
    api
      .getCustomers(workspaceId)
      .then((res) => setCustomers(res.customers))
      .catch(() => setCustomers([]))
  }, [workspaceId])

  const refetch = async () => {
    const res = await api.getOperationalBidCandidate(workspaceId, detail.id)
    onUpdated(res.candidate)
    return res.candidate
  }

  const cancelEdit = () => {
    hydrateFromDetail(detail)
    setEditing(false)
    setSaveError(null)
    setSaveOk(false)
  }

  const saveEdits = async () => {
    const name = projectName.trim()
    if (!name) {
      setSaveError('Project name is required')
      setSaveOk(false)
      return
    }
    if (saving) return
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
    const customerPayload = customerId
      ? selectedCustomer
        ? { customerId, customerName: selectedCustomer.name }
        : { customerId }
      : { customerId: null, customerName: null }
    try {
      await api.patchOperationalBidCandidate(workspaceId, detail.id, {
        projectName: name,
        ...customerPayload,
        bidDueAt: isoFromDateInput(bidDue),
        anticipatedStartAt: isoFromDateInput(startDate),
        notes: notes.trim() || null,
        externalProjectNumber: externalNumber.trim() || null,
        scopeDetail: {
          tradeCategory: tradeCategory.trim() || null,
          summary: scopeSummary.trim() || null,
          items,
          work,
          exclusions,
          qualifications,
        },
        ...(detail.lifecycle === 'CONVERTED' || lifecycle === 'CONVERTED'
          ? {}
          : {
              lifecycle: lifecycle as Exclude<BidCandidateLifecycle, 'CONVERTED'>,
            }),
      })
      const next = await refetch()
      hydrateFromDetail(next)
      setEditing(false)
      setSaveOk(true)
    } catch (e) {
      setSaveOk(false)
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const due = formatBidDue(detail.bidDueAt)
  const start = formatBidDue(detail.anticipatedStartAt)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {detail.lifecycle === 'CONVERTED' && detail.canonicalJob && (
        <Section title="Converted to Job">
          <div style={{ fontSize: 14, fontWeight: 650, color: '#111827' }}>
            {detail.canonicalJob.jobNumber
              ? `${detail.canonicalJob.jobNumber} — ${detail.canonicalJob.name}`
              : detail.canonicalJob.name}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
            Job remains canonical. Candidate edits do not update the Job.
          </div>
          {onOpenJob && detail.canonicalJobId && (
            <button
              type="button"
              style={{ ...primaryBtn, marginTop: 10 }}
              onClick={() => onOpenJob(detail.canonicalJobId!)}
            >
              Open Job
            </button>
          )}
        </Section>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {canConvert && (
          <button type="button" style={primaryBtn} onClick={() => setShowConvert(true)}>
            Convert to Job
          </button>
        )}
        {!editing ? (
          <button type="button" style={secondaryBtn} onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : (
          <>
            <button
              type="button"
              style={primaryBtn}
              disabled={saving}
              onClick={() => void saveEdits()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" style={linkBtn} disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          </>
        )}
        {editing && (
          <span style={{ fontSize: 12, color: '#b45309' }}>Unsaved changes</span>
        )}
        {saveOk && !editing && (
          <span style={{ fontSize: 12, color: '#2e7d32' }}>Saved</span>
        )}
      </div>
      {saveError && (
        <div role="alert" style={{ color: '#b42318', fontSize: 13 }}>
          {saveError}
        </div>
      )}

      {showConvert && (
        <ConvertToJobDialog
          workspaceId={workspaceId}
          candidateId={detail.id}
          onClose={() => setShowConvert(false)}
          onSuccess={async (jobId) => {
            setShowConvert(false)
            await refetch()
            onOpenJob?.(jobId)
          }}
        />
      )}

      <Section title="Overview">
        {editing ? (
          <>
            <Field label="Project">
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Customer / GC">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                style={inputStyle}
              >
                <option value="">No customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bid due">
              <input
                type="date"
                value={bidDue}
                onChange={(e) => setBidDue(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Anticipated start">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <KV
              label="Estimator"
              value={
                detail.estimator
                  ? detail.estimator.name || detail.estimator.email
                  : '—'
              }
            />
            <Field label="External project / bid #">
              <input
                value={externalNumber}
                onChange={(e) => setExternalNumber(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Lifecycle">
              {detail.lifecycle === 'CONVERTED' ? (
                <div style={{ color: '#111827' }}>
                  {lifecycleLabel(detail.lifecycle)} — Convert to Job only
                </div>
              ) : (
                <select
                  value={lifecycle}
                  onChange={(e) =>
                    setLifecycle(e.target.value as BidCandidateLifecycle)
                  }
                  style={inputStyle}
                >
                  {EDITABLE_LIFECYCLES.map((l) => (
                    <option key={l} value={l}>
                      {lifecycleLabel(l)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
          </>
        ) : (
          <>
            <KV label="Project" value={detail.projectName || '—'} />
            <KV label="Customer / GC" value={detail.customerName || '—'} />
            <KV label="Bid due" value={due.label} />
            <KV label="Anticipated start" value={start.label} />
            <KV
              label="Estimator"
              value={
                detail.estimator
                  ? detail.estimator.name || detail.estimator.email
                  : '—'
              }
            />
            <KV
              label="External project / bid #"
              value={detail.externalProjectNumber || '—'}
            />
            <KV label="Lifecycle" value={lifecycleLabel(detail.lifecycle)} />
            <KV label="Notes" value={detail.notes || '—'} />
          </>
        )}
      </Section>

      <Section title="Scope">
        {editing ? (
          <CandidateScopeEditor
            tradeCategory={tradeCategory}
            summary={scopeSummary}
            items={items}
            work={work}
            exclusions={exclusions}
            qualifications={qualifications}
            onTradeCategory={setTradeCategory}
            onSummary={setScopeSummary}
            onItems={setItems}
            onWork={setWork}
            onExclusions={setExclusions}
            onQualifications={setQualifications}
          />
        ) : (
          <CandidateScopePanel
            scopeSummary={detail.scopeSummary}
            scopeDetail={detail.scopeDetail}
          />
        )}
      </Section>

      <EmailsPanel
        workspaceId={workspaceId}
        candidateId={detail.id}
        emails={detail.emails}
        onOpenMessage={onOpenMessage}
        onChanged={() => void refetch()}
      />

      <QuotesPanel
        workspaceId={workspaceId}
        quotes={detail.quotes}
        onOpenMessage={onOpenMessage}
        onChanged={() => void refetch()}
      />

      <DocumentsPanel workspaceId={workspaceId} detail={detail} />
    </div>
  )
}

function CandidateScopeEditor({
  tradeCategory,
  summary,
  items,
  work,
  exclusions,
  qualifications,
  onTradeCategory,
  onSummary,
  onItems,
  onWork,
  onExclusions,
  onQualifications,
}: {
  tradeCategory: string
  summary: string
  items: string[]
  work: string[]
  exclusions: string[]
  qualifications: string[]
  onTradeCategory: (v: string) => void
  onSummary: (v: string) => void
  onItems: (v: string[]) => void
  onWork: (v: string[]) => void
  onExclusions: (v: string[]) => void
  onQualifications: (v: string[]) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Candidate scope is requested / anticipated project scope — not Quote scope.
      </div>
      <Field label="Trade / category">
        <input
          value={tradeCategory}
          onChange={(e) => onTradeCategory(e.target.value)}
          style={inputStyle}
        />
      </Field>
      <Field label="Summary">
        <textarea
          value={summary}
          onChange={(e) => onSummary(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>
      <ChipList
        label="Items"
        values={items}
        onChange={onItems}
        placeholder="Beams, columns, stairs…"
      />
      <ChipList
        label="Work"
        values={work}
        onChange={onWork}
        placeholder="Furnish, fabricate, install…"
      />
      <ChipList
        label="Exclusions"
        values={exclusions}
        onChange={onExclusions}
        placeholder="Add exclusion"
      />
      <ChipList
        label="Qualifications / notes"
        values={qualifications}
        onChange={onQualifications}
        placeholder="Add qualification"
      />
    </div>
  )
}

function ChipList({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChange([...values, v])
    }
    setDraft('')
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {values.map((v) => (
          <span key={`${label}-${v}`} style={chipStyle}>
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              style={chipRemove}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" style={secondaryBtn} onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}

function EmailsPanel({
  workspaceId,
  candidateId,
  emails,
  onOpenMessage,
  onChanged,
}: {
  workspaceId: string
  candidateId: string
  emails: OperationalBidCandidateDetail['emails']
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
  onChanged: () => void
}) {
  const [linking, setLinking] = useState(false)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<'BID_INVITE' | 'QUOTE' | 'SUPPORTING' | 'ADDENDUM'>(
    'BID_INVITE'
  )
  const [results, setResults] = useState<MessageSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)

  const runSearch = async () => {
    const q = search.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    try {
      const conns = await api.getConnections(workspaceId)
      const connectionId = conns.connections[0]?.id
      if (!connectionId) {
        setError('No mailbox connected')
        setResults([])
        return
      }
      const res = await api.getMessages(workspaceId, connectionId, 1, 15, {
        search: q,
      })
      const linked = new Set(emails.map((e) => e.message.id))
      setResults(res.messages.filter((m) => !linked.has(m.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  const linkMessage = async (messageId: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.assignEmailToBidCandidate(workspaceId, candidateId, {
        messageId,
        role,
        forceReassign: true,
      })
      setSearch('')
      setResults([])
      setLinking(false)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link email')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (emailMessageId: string) => {
    if (unlinkingId) return
    setUnlinkingId(emailMessageId)
    setError(null)
    try {
      await api.unlinkEmailFromBidCandidate(
        workspaceId,
        candidateId,
        emailMessageId
      )
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unlink email')
    } finally {
      setUnlinkingId(null)
    }
  }

  return (
    <Section title="Emails">
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        Linking and unlinking changes Active Bid membership only. The email itself is
        not deleted.
      </div>
      {emails.length === 0 && (
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
          No emails linked yet.
        </div>
      )}
      {emails.map((e) => (
        <div
          key={e.id}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            padding: '8px 0',
            borderBottom: '1px solid #f3f4f6',
          }}
        >
          <button
            type="button"
            onClick={() =>
              onOpenMessage?.(e.message.id, e.message.inboxConnectionId)
            }
            style={{
              flex: 1,
              textAlign: 'left',
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: onOpenMessage ? 'pointer' : 'default',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 650, color: '#1d4ed8' }}>
              {e.role}
              {e.isPrimary ? ' · primary' : ''}
            </div>
            <div style={{ fontSize: 13, color: '#111827' }}>
              {e.message.subject || '(no subject)'}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {e.message.senderName || e.message.senderEmail}
            </div>
          </button>
          <button
            type="button"
            style={linkBtn}
            disabled={unlinkingId === e.message.id}
            onClick={() => void unlink(e.message.id)}
          >
            {unlinkingId === e.message.id ? 'Unlinking…' : 'Unlink'}
          </button>
        </div>
      ))}
      {!linking ? (
        <button
          type="button"
          style={{ ...secondaryBtn, marginTop: 10 }}
          onClick={() => setLinking(true)}
        >
          Link email
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject or sender"
              style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            />
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as typeof role)
              }
              style={inputStyle}
            >
              <option value="BID_INVITE">Bid invite</option>
              <option value="QUOTE">Quote</option>
              <option value="SUPPORTING">Supporting</option>
              <option value="ADDENDUM">Addendum</option>
            </select>
            <button
              type="button"
              style={secondaryBtn}
              disabled={busy || !search.trim()}
              onClick={() => void runSearch()}
            >
              {busy ? 'Searching…' : 'Search'}
            </button>
            <button type="button" style={linkBtn} onClick={() => setLinking(false)}>
              Close
            </button>
          </div>
          {results.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                gap: 8,
                padding: '8px 0',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: '#111827' }}>
                  {m.subject || '(no subject)'}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {m.senderName || m.senderEmail}
                </div>
              </div>
              <button
                type="button"
                style={linkBtn}
                disabled={busy}
                onClick={() => void linkMessage(m.id)}
              >
                Link
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}
    </Section>
  )
}

function QuotesPanel({
  workspaceId,
  quotes,
  onOpenMessage,
  onChanged,
}: {
  workspaceId: string
  quotes: OperationalBidCandidateDetail['quotes']
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
  onChanged: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [scope, setScope] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = (q: OperationalBidCandidateDetail['quotes'][number]) => {
    setEditingId(q.id)
    setName(q.displayName || '')
    setAmount(q.amount != null ? String(q.amount) : '')
    setScope(q.scopeSummary || '')
    setNotes(q.notes || '')
    setError(null)
  }

  const saveQuote = async (quoteId: string) => {
    if (saving) return
    const raw = amount.trim()
    let extractedAmount: number | null = null
    if (raw) {
      const n = Number(raw.replace(/[$,\s]/g, ''))
      if (!Number.isFinite(n)) {
        setError('Quote amount must be a number')
        return
      }
      extractedAmount = n
    }
    setSaving(true)
    setError(null)
    try {
      await api.updateBidQuote(workspaceId, quoteId, {
        displayName: name.trim() || null,
        extractedAmount,
        extractedScope: scope.trim() || null,
        extractedNotes: notes.trim() || null,
      })
      setEditingId(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quote save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Quotes">
      {quotes.length === 0 && (
        <div style={{ fontSize: 13, color: '#6b7280' }}>No quotes linked yet.</div>
      )}
      {quotes.map((q, idx) => (
        <div
          key={q.id}
          style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}
        >
          {editingId === q.id ? (
            <>
              <Field label={`Rev ${idx + 1} name`}>
                <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Price">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  style={inputStyle}
                />
              </Field>
              <Field label="Quote scope">
                <textarea
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={primaryBtn}
                  disabled={saving}
                  onClick={() => void saveQuote(q.id)}
                >
                  {saving ? 'Saving…' : 'Save quote'}
                </button>
                <button
                  type="button"
                  style={linkBtn}
                  disabled={saving}
                  onClick={() => {
                    setEditingId(null)
                    setError(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 650 }}>
                Rev {idx + 1}: {q.displayName || q.message.subject || 'Quote'}
              </div>
              <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>
                {q.amount != null ? formatMoney(q.amount, q.currency) : 'No amount'}
                {q.isDurable ? ' · durable' : ''}
              </div>
              {q.scopeSummary && (
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  {q.scopeSummary}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                <button type="button" style={linkBtn} onClick={() => startEdit(q)}>
                  Edit quote
                </button>
                {onOpenMessage && (
                  <button
                    type="button"
                    style={linkBtn}
                    onClick={() =>
                      onOpenMessage(q.message.id, q.message.inboxConnectionId)
                    }
                  >
                    Open email
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
      {error && (
        <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}
    </Section>
  )
}

function DocumentsPanel({
  workspaceId,
  detail,
}: {
  workspaceId: string
  detail: OperationalBidCandidateDetail
}) {
  const emailIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of detail.emails) ids.add(e.message.id)
    for (const q of detail.quotes) ids.add(q.message.id)
    return [...ids]
  }, [detail.emails, detail.quotes])

  const [rows, setRows] = useState<
    Array<StoredAttachment & { emailMessageId: string }>
  >([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (emailIds.length === 0) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      emailIds.map((id) =>
        api
          .getEmailAttachments(workspaceId, id)
          .then((res) =>
            res.attachments
              .filter((a) => !a.isInline)
              .map((a) => ({ ...a, emailMessageId: id }))
          )
          .catch(() => [])
      )
    )
      .then((groups) => {
        if (!cancelled) setRows(groups.flat())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, emailIds])

  return (
    <Section title="Documents">
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
        From linked emails (canonical attachments — not duplicated). Direct
        Candidate-owned uploads are not available without a document schema.
      </div>
      {loading && <div style={{ fontSize: 13, color: '#6b7280' }}>Loading files…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ fontSize: 13, color: '#6b7280' }}>No email attachments.</div>
      )}
      {rows.map((att) => (
        <div
          key={att.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 0',
            fontSize: 13,
          }}
        >
          <span style={{ color: '#111827' }}>{att.filename}</span>
          <a
            href={api.getStoredAttachmentDownloadUrl(workspaceId, att.id)}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'none' }}
          >
            Open
          </a>
        </div>
      ))}
    </Section>
  )
}

function CandidateScopePanel({
  scopeSummary,
  scopeDetail,
}: {
  scopeSummary: string | null
  scopeDetail: unknown
}) {
  const parsed: DetailedScope | null = parseDetailedScope(scopeDetail)
  const items = parsed?.items ?? []
  const work = parsed?.work ?? []
  const exclusions = parsed?.exclusions ?? []
  const qualifications = parsed?.qualifications ?? []
  const complete = Boolean(parsed?.detailedComplete && items.length > 0)
  const summaryText =
    scopeSummary && !isScopeReviewPlaceholder(scopeSummary)
      ? scopeSummary
      : parsed?.summary && !isScopeReviewPlaceholder(parsed.summary)
        ? parsed.summary
        : null

  return (
    <div style={{ fontSize: 13 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 650,
          color: complete ? '#2e7d32' : '#b45309',
          marginBottom: 8,
        }}
      >
        {complete ? 'Complete' : 'Needs review'}
      </div>
      {!complete && items.length === 0 && (
        <div style={{ color: '#6b7280', marginBottom: 10 }}>
          Specific scope items were not identified in the available evidence.
        </div>
      )}
      {summaryText && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Summary</div>
          <div style={{ color: '#111827', whiteSpace: 'pre-wrap' }}>{summaryText}</div>
        </div>
      )}
      {parsed?.tradeCategory && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
          Trade / category: {parsed.tradeCategory}
        </div>
      )}
      {items.length > 0 && (
        <ScopeList title="Items" rows={items.map((i) => i.name)} />
      )}
      {work.length > 0 && (
        <ScopeList
          title={items.length === 0 ? 'Work identified' : 'Work'}
          rows={work.map((w) => w.name)}
        />
      )}
      {exclusions.length > 0 && (
        <ScopeList title="Exclusions" rows={exclusions.map((e) => e.name)} />
      )}
      {qualifications.length > 0 && (
        <ScopeList
          title="Qualifications / Notes"
          rows={qualifications.map((q) =>
            q.details ? `${q.name} — ${q.details}` : q.name
          )}
        />
      )}
      {!parsed && !summaryText && items.length === 0 && work.length === 0 && (
        <div style={{ color: '#6b7280' }}>No scope extracted yet.</div>
      )}
    </div>
  )
}

function ScopeList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: '#111827' }}>
        {rows.map((name) => (
          <li key={`${title}-${name}`}>{name}</li>
        ))}
      </ul>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 14,
        background: '#fff',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 680, marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 13 }}>
      <div style={{ width: 140, color: '#6b7280', flexShrink: 0 }}>{label}</div>
      <div style={{ color: '#111827', whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
      <div style={{ width: 140, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

function ConvertToJobDialog({
  workspaceId,
  candidateId,
  onClose,
  onSuccess,
}: {
  workspaceId: string
  candidateId: string
  onClose: () => void
  onSuccess: (jobId: string) => void | Promise<void>
}) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [jobNumber, setJobNumber] = useState('')
  const [startDate, setStartDate] = useState('')
  const [bidDueAt, setBidDueAt] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [carry, setCarry] = useState<{
    emailCount: number
    quoteCount: number
    externalProjectNumber: string | null
  } | null>(null)

  const loadPreview = () => {
    setLoading(true)
    setError(null)
    api
      .previewConvertBidCandidateToJob(workspaceId, candidateId)
      .then((res) => {
        const p = res.preview
        if (p.alreadyConverted && p.existingJobId) {
          void onSuccess(p.existingJobId)
          return
        }
        if (!p.convertible) {
          setError(`This Candidate (${p.lifecycle}) cannot be converted.`)
          return
        }
        setProjectName(p.projectName)
        setCustomerName(p.customerName || '')
        setCustomerId(p.customerId)
        setJobNumber(p.suggestedJobNumber || '')
        setStartDate(p.startDate ? p.startDate.slice(0, 10) : '')
        setBidDueAt(p.bidDueAt ? p.bidDueAt.slice(0, 10) : '')
        setDescription(p.scopeSummary || '')
        setNotes(p.notes || '')
        setCarry({
          emailCount: p.emailCount,
          quoteCount: p.quoteCount,
          externalProjectNumber: p.externalProjectNumber,
        })
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Could not load conversion preview')
      )
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, candidateId])

  const confirm = async () => {
    if (!projectName.trim() || !jobNumber.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.convertBidCandidateToJob(workspaceId, candidateId, {
        projectName: projectName.trim(),
        customerName: customerName.trim() || null,
        customerId,
        jobNumber: jobNumber.trim(),
        startDate: startDate
          ? new Date(`${startDate}T12:00:00.000Z`).toISOString()
          : null,
        bidDueAt: bidDueAt
          ? new Date(`${bidDueAt}T12:00:00.000Z`).toISOString()
          : null,
        description: description.trim() || null,
        notes: notes.trim() || null,
      })
      await onSuccess(result.job.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Conversion failed'
      setError(msg)
      if (/already in use|Job number/i.test(msg)) {
        try {
          const res = await api.previewConvertBidCandidateToJob(
            workspaceId,
            candidateId
          )
          setJobNumber(res.preview.suggestedJobNumber || '')
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        border: '1px solid #bfdbfe',
        borderRadius: 8,
        padding: 14,
        background: '#f8fafc',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 680, marginBottom: 8 }}>
        Convert to Job — review
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        Opening this dialog does not create a Job or reserve a number. Confirm to
        assign the Job number and create an ACTIVE Job.
      </div>
      {loading && <div style={{ fontSize: 13, color: '#6b7280' }}>Loading preview…</div>}
      {error && (
        <div style={{ color: '#b42318', fontSize: 13, marginBottom: 8 }}>{error}</div>
      )}
      {!loading && (
        <>
          <label style={fieldLabel}>
            Project name
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Customer / GC
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Job number
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button type="button" style={linkBtn} onClick={loadPreview} disabled={busy}>
                Refresh #
              </button>
            </div>
          </label>
          <label style={fieldLabel}>
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Bid due (history only — not start date)
            <input
              type="date"
              value={bidDueAt}
              onChange={(e) => setBidDueAt(e.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Scope / description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, marginTop: 4, resize: 'vertical' }}
            />
          </label>
          <label style={fieldLabel}>
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle, marginTop: 4, resize: 'vertical' }}
            />
          </label>
          {carry && (
            <div style={{ fontSize: 12, color: '#374151', margin: '8px 0 12px' }}>
              Will carry forward: {carry.emailCount} email
              {carry.emailCount === 1 ? '' : 's'}, {carry.quoteCount} quote
              {carry.quoteCount === 1 ? '' : 's'}, attachments via emails, aliases
              {carry.externalProjectNumber
                ? `, external # ${carry.externalProjectNumber}`
                : ''}
              . Quote revisions stay on this Candidate.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={primaryBtn}
              disabled={busy || !projectName.trim() || !jobNumber.trim()}
              onClick={() => void confirm()}
            >
              {busy ? 'Converting…' : 'Confirm Convert to Job'}
            </button>
            <button type="button" style={linkBtn} disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function lifecycleLabel(l: BidCandidateLifecycle): string {
  switch (l) {
    case 'OPEN':
      return 'Open'
    case 'QUOTED':
      return 'Quoted'
    case 'CONVERTED':
      return 'Converted'
    case 'LOST':
      return 'Lost'
    case 'ARCHIVED':
      return 'Archived'
    default:
      return l
  }
}

function formatMoney(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return String(amount)
  }
}

function namesOf(
  rows: Array<{ name: string }> | null | undefined
): string[] {
  return (rows ?? []).map((r) => r.name).filter(Boolean)
}

function dateInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function isoFromDateInput(value: string): string | null {
  if (!value.trim()) return null
  return new Date(`${value}T12:00:00.000Z`).toISOString()
}

const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#374151',
  marginBottom: 8,
}

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
}

const primaryBtn: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #1d4ed8',
  background: '#1d4ed8',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const secondaryBtn: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #d0d5dd',
  background: '#fff',
  color: '#111827',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const linkBtn: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: '#1d4ed8',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  background: '#eff6ff',
  color: '#1e3a8a',
  fontSize: 12,
}

const chipRemove: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#1e3a8a',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
}
