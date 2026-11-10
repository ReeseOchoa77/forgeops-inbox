import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  api,
  type OperationalBidCandidate,
  type OperationalBidCandidateDetail,
} from '../api'
import {
  hasQuotedPrice,
  quotedCandidateRowStyle,
} from '../bid-candidate-quoted'
import { QuotedBadge } from '../components/Badges'
import { BidCandidateDetail, lifecycleLabel } from '../components/BidCandidateDetail'
import { CustomerSelectOrCreate } from '../components/CustomerSelectOrCreate'
import type { CustomerSummary } from '../api'
import { formatBidDue } from '../bidding-display'
import type { Breakpoint } from '../hooks/useBreakpoint'
import { loadBiddingState, persistBiddingState } from '../workspace-state'

type Props = {
  workspaceId: string
  userId?: string
  breakpoint?: Breakpoint
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
  onOpenJob?: (jobId: string) => void
  /** Open a specific Bid Candidate (e.g. from Customer detail). */
  initialSelectedId?: string | null
}

type QuoteFilter = 'all' | 'with' | 'without'

export function BiddingView({
  workspaceId,
  userId,
  breakpoint,
  onOpenMessage,
  onOpenJob,
  initialSelectedId = null,
}: Props) {
  const isPhone = breakpoint === 'phone'
  const restored = userId ? loadBiddingState({ workspaceId, userId }) : null
  const restoredQuote: QuoteFilter =
    restored?.quoteFilter === 'with' || restored?.quoteFilter === 'without' || restored?.quoteFilter === 'all'
      ? restored.quoteFilter
      : 'all'
  const [search, setSearch] = useState(() => restored?.search ?? '')
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>(() => restoredQuote)
  const [dueSoon, setDueSoon] = useState(() => restored?.dueSoon ?? false)
  const [includeArchived, setIncludeArchived] = useState(() => restored?.includeArchived ?? false)
  const [rows, setRows] = useState<OperationalBidCandidate[]>([])
  const [summary, setSummary] = useState({
    total: 0,
    withQuote: 0,
    withoutQuote: 0,
    dueSoon: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [detail, setDetail] = useState<OperationalBidCandidateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createCustomerId, setCreateCustomerId] = useState<string | null>(null)
  const [createCustomerName, setCreateCustomerName] = useState<string | null>(null)
  const [createCustomers, setCreateCustomers] = useState<CustomerSummary[]>([])
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId)
  }, [initialSelectedId])

  useEffect(() => {
    if (!userId) return
    persistBiddingState({
      workspaceId,
      userId,
      state: { search, quoteFilter, dueSoon, includeArchived },
    })
  }, [workspaceId, userId, search, quoteFilter, dueSoon, includeArchived])

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
        setError(e instanceof Error ? e.message : 'Could not load Active Bids')
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

  const openCreate = () => {
    setCreateName('')
    setCreateCustomerId(null)
    setCreateCustomerName(null)
    setCreateError(null)
    setCreateBusy(false)
    setShowCreate(true)
    api.getCustomers(workspaceId).then((r) => setCreateCustomers(r.customers)).catch(() => setCreateCustomers([]))
  }

  const closeCreate = () => {
    if (createBusy) return
    setShowCreate(false)
    setCreateError(null)
  }

  const createCandidate = async () => {
    if (!createName.trim() || createBusy) return
    if (createCustomerName && !createCustomerId) {
      setCreateError('Select an existing Customer or Create one before saving the Bid.')
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    try {
      const res = await api.createOperationalBidCandidate(workspaceId, {
        projectName: createName.trim(),
        customerId: createCustomerId,
        customerName: createCustomerName,
      })
      setShowCreate(false)
      setCreateName('')
      setCreateCustomerId(null)
      setCreateCustomerName(null)
      setCreateError(null)
      setSelectedId(res.candidateId)
      reload()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Create failed')
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
            ← Active Bids
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
              hasQuotedPrice({ quotes: detail.quotes }) && <QuotedBadge />}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            Permanent opportunity — not a Job until Convert to Job.
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: isPhone ? '0 14px 16px' : '0 22px 18px' }}>
          {detailLoading && <div style={{ color: '#6b7280', fontSize: 13 }}>Loading…</div>}
          {!detailLoading && detail && (
            <BidCandidateDetail
              workspaceId={workspaceId}
              detail={detail}
              onOpenMessage={onOpenMessage}
              onOpenJob={onOpenJob}
              onUpdated={(next) => {
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
            <div style={{ fontSize: 20, fontWeight: 680, color: '#111827' }}>Active Bids</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              Permanent opportunities before they become Jobs. No Job number until Convert to Job.
            </div>
          </div>
          <button type="button" onClick={openCreate} style={primaryBtn}>
            New Bid
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
      {showCreate && (
        <CreateBidModal
          workspaceId={workspaceId}
          name={createName}
          customerId={createCustomerId}
          customerName={createCustomerName}
          customers={createCustomers}
          busy={createBusy}
          error={createError}
          onName={setCreateName}
          onCustomerChange={(next) => {
            setCreateCustomerId(next.customerId)
            setCreateCustomerName(next.customerName)
          }}
          onCustomersUpdated={setCreateCustomers}
          onClose={closeCreate}
          onSubmit={() => void createCandidate()}
        />
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: isPhone ? '0 14px 16px' : '0 22px 18px' }}>
        {error && <div style={{ color: '#b42318', fontSize: 13, marginBottom: 8 }}>{error}</div>}
        {loading && rows.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13 }}>Loading Active Bids…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0' }}>
            No Active Bids yet. Create one manually or run Bidding Analysis under Email Analysis.
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
              const isQuoted = hasQuotedPrice({ quoteAmount: row.quoteAmount })
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
                        {row.quoteCount > 0
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

function CreateBidModal({
  workspaceId,
  name,
  customerId,
  customerName,
  customers,
  busy,
  error,
  onName,
  onCustomerChange,
  onCustomersUpdated,
  onClose,
  onSubmit,
}: {
  workspaceId: string
  name: string
  customerId: string | null
  customerName: string | null
  customers: CustomerSummary[]
  busy: boolean
  error: string | null
  onName: (v: string) => void
  onCustomerChange: (next: { customerId: string | null; customerName: string | null }) => void
  onCustomersUpdated: (customers: CustomerSummary[]) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 40,
        padding: 16,
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Create Bid"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
        style={{
          width: 'min(400px, 100%)',
          background: '#fff',
          borderRadius: 10,
          border: '1px solid #e5e7eb',
          padding: 18,
          boxShadow: '0 16px 40px rgba(15,23,42,0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 650, color: '#111827' }}>Create Bid</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
            style={{
              border: 'none',
              background: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              color: '#6b7280',
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>
        <label style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 10 }}>
          Project name
          <input
            ref={nameRef}
            autoFocus
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Project name"
            disabled={busy}
            style={{ ...selectStyle, width: '100%', marginTop: 4, boxSizing: 'border-box' }}
          />
        </label>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>Customer / GC (optional)</div>
          <CustomerSelectOrCreate
            workspaceId={workspaceId}
            customers={customers}
            value={{ customerId, customerName }}
            onChange={onCustomerChange}
            onCustomersUpdated={onCustomersUpdated}
            disabled={busy}
            placeholder="Customer / GC (optional)"
          />
        </div>
        {error && (
          <div role="alert" style={{ color: '#b42318', fontSize: 13, marginBottom: 10 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
          <button type="button" style={linkBtn} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            style={{
              ...primaryBtn,
              opacity: busy || !name.trim() ? 0.65 : 1,
              cursor: busy || !name.trim() ? 'not-allowed' : 'pointer',
            }}
            disabled={busy || !name.trim()}
          >
            {busy ? 'Creating…' : 'Create Bid'}
          </button>
        </div>
      </form>
    </div>
  )
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
