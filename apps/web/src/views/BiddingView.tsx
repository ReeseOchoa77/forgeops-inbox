import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  api,
  type BidCandidateLifecycle,
  type OperationalBidCandidate,
  type OperationalBidCandidateDetail,
} from '../api'
import {
  candidateHasDurableQuote,
  quotedCandidateRowStyle,
} from '../bid-candidate-quoted'
import { QuotedBadge } from '../components/Badges'
import { formatBidDue } from '../bidding-display'
import type { Breakpoint } from '../hooks/useBreakpoint'
import {
  isScopeReviewPlaceholder,
  parseDetailedScope,
  type DetailedScope,
} from '@forgeops/shared'

type Props = {
  workspaceId: string
  breakpoint?: Breakpoint
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
  onOpenJob?: (jobId: string) => void
}

type QuoteFilter = 'all' | 'with' | 'without'

export function BiddingView({
  workspaceId,
  breakpoint,
  onOpenMessage,
  onOpenJob,
}: Props) {
  const isPhone = breakpoint === 'phone'
  const [search, setSearch] = useState('')
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('all')
  const [dueSoon, setDueSoon] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [rows, setRows] = useState<OperationalBidCandidate[]>([])
  const [summary, setSummary] = useState({
    total: 0,
    withQuote: 0,
    withoutQuote: 0,
    dueSoon: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OperationalBidCandidateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createCustomer, setCreateCustomer] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const reload = () => {
    setLoading(true)
    api
      .listOperationalBidCandidates(workspaceId, {
        quote: quoteFilter,
        dueSoon: dueSoon || undefined,
        includeArchived: includeArchived || undefined,
        search: search.trim() || undefined,
      })
      .then((res) => {
        setRows(res.candidates)
        setSummary(res.summary)
        setError(null)
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Could not load Bid Candidates')
      )
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const timer = window.setTimeout(reload, search ? 250 : 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, search, quoteFilter, dueSoon, includeArchived])

  // Refetch when returning to the tab so Quote assign/match updates Quoted visuals.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !selectedId) reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, search, quoteFilter, dueSoon, includeArchived, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    api
      .getOperationalBidCandidate(workspaceId, selectedId)
      .then((res) => setDetail(res.candidate))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false))
  }, [workspaceId, selectedId])

  const createCandidate = async () => {
    if (!createName.trim()) return
    setCreateBusy(true)
    try {
      const res = await api.createOperationalBidCandidate(workspaceId, {
        projectName: createName.trim(),
        customerName: createCustomer.trim() || null,
      })
      setShowCreate(false)
      setCreateName('')
      setCreateCustomer('')
      setSelectedId(res.candidateId)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setCreateBusy(false)
    }
  }

  if (selectedId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
        <div style={{ padding: isPhone ? '14px 14px 8px' : '18px 22px 10px' }}>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null)
              reload()
            }}
            style={linkBtn}
          >
            ← Bid Candidates
          </button>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              marginTop: 8,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 680, color: '#111827' }}>
              {detail?.projectName ?? 'Bid Candidate'}
            </div>
            {detail &&
              candidateHasDurableQuote({
                quotes: detail.quotes,
                emails: detail.emails,
              }) && <QuotedBadge />}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            Permanent opportunity — not a Job until Convert to Job.
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: isPhone ? '0 14px 16px' : '0 22px 18px' }}>
          {detailLoading && <div style={{ color: '#6b7280', fontSize: 13 }}>Loading…</div>}
          {!detailLoading && detail && (
            <CandidateDetail
              workspaceId={workspaceId}
              detail={detail}
              onOpenMessage={onOpenMessage}
              onOpenJob={onOpenJob}
              onConverted={(next) => {
                setDetail(next)
                reload()
              }}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: isPhone ? '14px 14px 8px' : '18px 22px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 680, color: '#111827' }}>Bid Candidates</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              Permanent opportunities before they become Jobs. No Job number until Convert to Job.
            </div>
          </div>
          <button type="button" onClick={() => setShowCreate(true)} style={primaryBtn}>
            New Candidate
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <SummaryChip label="All" value={summary.total} />
          <SummaryChip label="With Quote" value={summary.withQuote} />
          <SummaryChip label="Without Quote" value={summary.withoutQuote} />
          <SummaryChip label="Due soon" value={summary.dueSoon} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project or customer"
            style={{ flex: 1, minWidth: 180, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
          />
          <select
            value={quoteFilter}
            onChange={(e) => setQuoteFilter(e.target.value as QuoteFilter)}
            style={selectStyle}
          >
            <option value="all">All</option>
            <option value="with">With Quote</option>
            <option value="without">Without Quote</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
            <input type="checkbox" checked={dueSoon} onChange={(e) => setDueSoon(e.target.checked)} />
            Due soon
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Include archived / converted
          </label>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: isPhone ? '0 14px 16px' : '0 22px 18px' }}>
        {error && <div style={{ color: '#b42318', fontSize: 13, marginBottom: 8 }}>{error}</div>}
        {showCreate && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 12, background: '#fff' }}>
            <div style={{ fontWeight: 650, marginBottom: 8 }}>Create Bid Candidate</div>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Project name"
              style={{ ...selectStyle, width: '100%', marginBottom: 8 }}
            />
            <input
              value={createCustomer}
              onChange={(e) => setCreateCustomer(e.target.value)}
              placeholder="Customer / GC (optional)"
              style={{ ...selectStyle, width: '100%', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={createBusy || !createName.trim()} onClick={createCandidate} style={primaryBtn}>
                Create
              </button>
              <button type="button" onClick={() => setShowCreate(false)} style={linkBtn}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {loading && rows.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13 }}>Loading Bid Candidates…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0' }}>
            No Bid Candidates yet. Create one manually or run Bidding Analysis under Email Analysis.
          </div>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
            {!isPhone && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(160px, 1.4fr) minmax(120px, 1fr) 100px 100px 70px 90px minmax(100px, 1fr) 90px',
                  gap: 8,
                  padding: '8px 14px',
                  fontSize: 11,
                  fontWeight: 650,
                  color: '#6b7280',
                  borderBottom: '1px solid #f3f4f6',
                  background: '#fafafa',
                }}
              >
                <div>Bid Candidate</div>
                <div>Customer / GC</div>
                <div>Bid Due</div>
                <div>Start</div>
                <div>Quote</div>
                <div>Amount</div>
                <div>Scope</div>
                <div>Status</div>
              </div>
            )}
            {rows.map((row) => {
              const dueLabel = formatBidDue(row.bidDueAt)
              const startLabel = formatBidDue(row.anticipatedStartAt)
              const isQuoted = candidateHasDurableQuote({ quoteCount: row.quoteCount })
              return (
                <button
                  key={row.id}
                  type="button"
                  data-testid="bid-candidate-row"
                  data-quoted={isQuoted ? 'true' : 'false'}
                  onClick={() => setSelectedId(row.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isPhone
                      ? '1fr auto'
                      : 'minmax(160px, 1.4fr) minmax(120px, 1fr) 100px 100px 70px 90px minmax(100px, 1fr) 90px',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: '1px solid #f3f4f6',
                    background: isQuoted ? quotedCandidateRowStyle.background : '#fff',
                    borderLeft: isQuoted
                      ? quotedCandidateRowStyle.borderLeft
                      : '3px solid transparent',
                    cursor: 'pointer',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 650, color: '#111827' }}>
                        {row.projectName || 'Untitled'}
                      </div>
                      {isQuoted && <QuotedBadge />}
                    </div>
                    {isPhone && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {row.customerName || 'No customer'} · {lifecycleLabel(row.lifecycle)}
                        {isQuoted && row.quoteCount > 0
                          ? ` · ${row.quoteCount} quote${row.quoteCount === 1 ? '' : 's'}`
                          : ''}
                      </div>
                    )}
                  </div>
                  {!isPhone && (
                    <div style={{ fontSize: 13, color: '#374151' }}>
                      {row.customerName || '—'}
                    </div>
                  )}
                  {!isPhone && (
                    <div style={{ fontSize: 13, color: dueLabel.past ? '#b42318' : '#111827', fontWeight: 600 }}>
                      {dueLabel.label}
                    </div>
                  )}
                  {!isPhone && (
                    <div style={{ fontSize: 12, color: '#374151' }}>{startLabel.label}</div>
                  )}
                  {!isPhone && (
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      {row.quoteCount > 0 ? row.quoteCount : '—'}
                    </div>
                  )}
                  {!isPhone && (
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      {row.quoteAmount != null
                        ? formatMoney(row.quoteAmount, row.quoteCurrency)
                        : '—'}
                    </div>
                  )}
                  {!isPhone && (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#6b7280',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.scopeSummary || '—'}
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 650, color: '#1d4ed8' }}>
                    {lifecycleLabel(row.lifecycle)}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function CandidateDetail({
  workspaceId,
  detail,
  onOpenMessage,
  onOpenJob,
  onConverted,
}: {
  workspaceId: string
  detail: OperationalBidCandidateDetail
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
  onOpenJob?: (jobId: string) => void
  onConverted: (next: OperationalBidCandidateDetail) => void
}) {
  const due = formatBidDue(detail.bidDueAt)
  const start = formatBidDue(detail.anticipatedStartAt)
  const attachments = collectAttachmentNames(detail)
  const canConvert =
    detail.lifecycle === 'OPEN' || detail.lifecycle === 'QUOTED'
  const [showConvert, setShowConvert] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {detail.lifecycle === 'CONVERTED' && detail.canonicalJob && (
        <Section title="Converted to Job">
          <div style={{ fontSize: 14, fontWeight: 650, color: '#111827' }}>
            {detail.canonicalJob.jobNumber
              ? `${detail.canonicalJob.jobNumber} — ${detail.canonicalJob.name}`
              : detail.canonicalJob.name}
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

      {canConvert && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={primaryBtn} onClick={() => setShowConvert(true)}>
            Convert to Job
          </button>
        </div>
      )}

      {showConvert && (
        <ConvertToJobDialog
          workspaceId={workspaceId}
          candidateId={detail.id}
          onClose={() => setShowConvert(false)}
          onSuccess={async (jobId) => {
            setShowConvert(false)
            const res = await api.getOperationalBidCandidate(workspaceId, detail.id)
            onConverted(res.candidate)
            onOpenJob?.(jobId)
          }}
        />
      )}

      <Section title="Overview">
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
      </Section>

      <Section title="Scope">
        <CandidateScopePanel
          scopeSummary={detail.scopeSummary}
          scopeDetail={detail.scopeDetail}
        />
      </Section>

      {detail.emails.length > 0 && (
        <Section title="Emails">
          {detail.emails.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() =>
                onOpenMessage?.(e.message.id, e.message.inboxConnectionId)
              }
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 0',
                border: 'none',
                borderBottom: '1px solid #f3f4f6',
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
          ))}
        </Section>
      )}

      {detail.quotes.length > 0 && (
        <Section title="Quotes">
          {detail.quotes.map((q, idx) => (
            <div
              key={q.id}
              style={{
                padding: '10px 0',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
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
              {onOpenMessage && (
                <button
                  type="button"
                  style={{ ...linkBtn, marginTop: 4 }}
                  onClick={() =>
                    onOpenMessage(q.message.id, q.message.inboxConnectionId)
                  }
                >
                  Open email
                </button>
              )}
            </div>
          ))}
        </Section>
      )}

      {attachments.length > 0 && (
        <Section title="Documents">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
            From linked emails (canonical attachments — not duplicated).
          </div>
          {attachments.map((name) => (
            <div key={name} style={{ fontSize: 13, color: '#111827', padding: '4px 0' }}>
              {name}
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

function collectAttachmentNames(detail: OperationalBidCandidateDetail): string[] {
  const names = new Set<string>()
  const ingest = (meta: unknown) => {
    if (!Array.isArray(meta)) return
    for (const item of meta) {
      if (item && typeof item === 'object' && 'filename' in item) {
        const fn = String((item as { filename?: string }).filename || '').trim()
        if (fn) names.add(fn)
      }
    }
  }
  for (const e of detail.emails) ingest(e.message.attachmentMetadata)
  for (const q of detail.quotes) ingest(q.message.attachmentMetadata)
  return [...names]
}

function CandidateScopePanel({
  scopeSummary,
  scopeDetail,
}: {
  scopeSummary: string | null
  scopeDetail: unknown
}) {
  const detail: DetailedScope | null = parseDetailedScope(scopeDetail)
  const items = detail?.items ?? []
  const work = detail?.work ?? []
  const exclusions = detail?.exclusions ?? []
  const qualifications = detail?.qualifications ?? []
  const complete = Boolean(detail?.detailedComplete && items.length > 0)
  const summaryText =
    scopeSummary && !isScopeReviewPlaceholder(scopeSummary)
      ? scopeSummary
      : detail?.summary && !isScopeReviewPlaceholder(detail.summary)
        ? detail.summary
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
      {detail?.tradeCategory && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
          Trade / category: {detail.tradeCategory}
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
      {!detail && !summaryText && items.length === 0 && work.length === 0 && (
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
      <div style={{ color: '#111827' }}>{value}</div>
    </div>
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
        // Refresh suggested number without creating anything.
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
              style={{ ...selectStyle, width: '100%', marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Customer / GC
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              style={{ ...selectStyle, width: '100%', marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Job number
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                style={{ ...selectStyle, flex: 1 }}
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
              style={{ ...selectStyle, width: '100%', marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Bid due (history only — not start date)
            <input
              type="date"
              value={bidDueAt}
              onChange={(e) => setBidDueAt(e.target.value)}
              style={{ ...selectStyle, width: '100%', marginTop: 4 }}
            />
          </label>
          <label style={fieldLabel}>
            Scope / description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...selectStyle, width: '100%', marginTop: 4, resize: 'vertical' }}
            />
          </label>
          <label style={fieldLabel}>
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...selectStyle, width: '100%', marginTop: 4, resize: 'vertical' }}
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

const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#374151',
  marginBottom: 8,
}

function lifecycleLabel(l: BidCandidateLifecycle): string {
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

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        background: '#f8fafc',
        border: '1px solid #e5e7eb',
        minWidth: 88,
      }}
    >
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  )
}

const selectStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
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

const linkBtn: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: '#1d4ed8',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
