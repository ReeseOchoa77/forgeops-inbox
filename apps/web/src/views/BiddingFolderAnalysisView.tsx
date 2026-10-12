import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type BidCandidateDetail,
  type BidCandidateSummary,
  type BidEmailAnalyzeProgressView,
  type BidFolderDiscoveryItem,
  type ConnectionSummary,
} from '../api'

const RANGE_OPTIONS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '180d', label: 'Last 6 months' },
  { value: '365d', label: 'Last 12 months' },
  { value: 'all', label: 'All history' },
  { value: 'custom', label: 'Custom range' },
] as const

const DEFAULT_RANGE = '90d'

type ListRole = 'BID_INVITE' | 'QUOTE'
type SortDir = 'newest' | 'oldest'
type RunKind = 'scan' | 'analyze'

function isOutlookConnection(c: ConnectionSummary): boolean {
  return c.provider.toLowerCase() === 'outlook' && c.status !== 'DISCONNECTED'
}

function isProjectFolderEligible(c: ConnectionSummary): boolean {
  return (
    isOutlookConnection(c) &&
    c.authorizationStatus === 'CONNECTED' &&
    c.capabilities.directProviderAccess
  )
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'READY':
      return 'Ready'
    case 'NEEDS_REVIEW':
      return 'Review'
    case 'DISCOVERED':
      return 'Discovered'
    case 'CONFIRMED':
      return 'Created'
    case 'REJECTED':
      return 'Rejected'
    default:
      return status
  }
}

function attachmentNames(meta: unknown): string[] {
  if (!Array.isArray(meta)) return []
  return meta
    .map((item) => {
      if (item && typeof item === 'object' && 'name' in item) {
        const name = (item as { name?: unknown }).name
        return typeof name === 'string' ? name : null
      }
      if (typeof item === 'string') return item
      return null
    })
    .filter((n): n is string => Boolean(n))
}

function matchLabelsFromEvidence(matchEvidence: unknown): string[] {
  if (!matchEvidence || typeof matchEvidence !== 'object') return []
  const labels = (matchEvidence as { labels?: unknown }).labels
  return Array.isArray(labels)
    ? labels.filter((l): l is string => typeof l === 'string')
    : []
}

function matchCheck(
  labels: string[],
  keys: string[]
): 'yes' | 'no' | 'partial' {
  if (labels.some((l) => keys.includes(l))) return 'yes'
  if (labels.some((l) => keys.some((k) => l.startsWith(k)))) return 'partial'
  return 'no'
}

function mark(state: 'yes' | 'no' | 'partial'): string {
  if (state === 'yes') return '✓'
  if (state === 'partial') return '~'
  return '—'
}

interface Props {
  workspaceId: string
  connectionId: string
  userRole?: string
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
}

/**
 * Systems → Email Analysis → Bidding Folder Analysis
 * Scan → discovery lists → Analyze → Bid Candidates → Create Bid.
 * Never auto-creates operational BIDDING Jobs.
 */
export function BiddingFolderAnalysisView({
  workspaceId,
  connectionId,
  userRole = 'MEMBER',
  onOpenMessage,
}: Props) {
  const canScan = ['OWNER', 'ADMIN', 'MANAGER'].includes(userRole)
  const canPromote = ['OWNER', 'ADMIN'].includes(userRole)

  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [scanRange, setScanRange] = useState<string>(DEFAULT_RANGE)
  const [customSince, setCustomSince] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyKind, setBusyKind] = useState<RunKind | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [progress, setProgress] = useState<BidEmailAnalyzeProgressView | null>(null)
  const [error, setError] = useState('')
  const [listRole, setListRole] = useState<ListRole>('BID_INVITE')
  const [sort, setSort] = useState<SortDir>('newest')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<BidFolderDiscoveryItem[]>([])
  const [counts, setCounts] = useState({ bidInvites: 0, quotes: 0 })
  const [loadingList, setLoadingList] = useState(false)
  const [candidates, setCandidates] = useState<BidCandidateSummary[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BidCandidateDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editProject, setEditProject] = useState('')
  const [editCustomer, setEditCustomer] = useState('')
  const [editJobNumber, setEditJobNumber] = useState('')
  const [editBidDue, setEditBidDue] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const pollGenRef = useRef(0)

  const outlookConnections = useMemo(
    () => connections.filter(isOutlookConnection),
    [connections]
  )
  const selectedConn =
    outlookConnections.find((c) => c.id === selectedConnectionId) ?? null
  const mailboxReady = Boolean(selectedConn && isProjectFolderEligible(selectedConn))
  const discoveryTotal = counts.bidInvites + counts.quotes
  const activeOperation =
    progress?.operation ?? busyKind ?? (progress?.currentPhase === 'ANALYZE_CANDIDATES'
      ? 'analyze'
      : progress
        ? 'scan'
        : null)

  useEffect(() => {
    void api.getConnections(workspaceId).then((r) => {
      setConnections(r.connections)
      const outlook = r.connections.filter(isOutlookConnection)
      const preferred =
        outlook.find((c) => c.id === connectionId)?.id ??
        (outlook.length === 1 ? outlook[0]!.id : '')
      setSelectedConnectionId((prev) => prev || preferred)
    })
  }, [workspaceId, connectionId])

  const loadCounts = useCallback(
    async (connId: string) => {
      if (!connId) return
      try {
        const c = await api.getBidFolderDiscoveryCounts(workspaceId, connId)
        setCounts(c)
      } catch {
        /* non-fatal */
      }
    },
    [workspaceId]
  )

  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true)
    try {
      const res = await api.listBidCandidates(workspaceId, { limit: 100 })
      setCandidates(res.candidates)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bid candidates')
    } finally {
      setLoadingCandidates(false)
    }
  }, [workspaceId])

  const loadDetail = useCallback(
    async (candidateId: string) => {
      setLoadingDetail(true)
      try {
        const res = await api.getBidCandidate(workspaceId, candidateId)
        setDetail(res.candidate)
        setEditProject(res.candidate.proposedProjectName ?? '')
        setEditCustomer(res.candidate.proposedCustomerName ?? '')
        setEditJobNumber(res.candidate.proposedJobNumber ?? '')
        setEditBidDue(
          res.candidate.proposedBidDueAt
            ? res.candidate.proposedBidDueAt.slice(0, 10)
            : ''
        )
        setEditing(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load candidate')
        setDetail(null)
      } finally {
        setLoadingDetail(false)
      }
    },
    [workspaceId]
  )

  const loadList = useCallback(
    async (connId: string, role: ListRole, sortDir: SortDir, q: string, pageNum: number) => {
      if (!connId) return
      setLoadingList(true)
      try {
        const res = await api.listBidFolderDiscovery(workspaceId, {
          connectionId: connId,
          role,
          sort: sortDir,
          search: q || undefined,
          page: pageNum,
          pageSize: 50,
        })
        setItems(res.items)
        setTotal(res.total)
        setPage(res.page)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load discovery list')
      } finally {
        setLoadingList(false)
      }
    },
    [workspaceId]
  )

  const pollRun = useCallback(
    async (id: string, connId: string, gen: number, kind: RunKind) => {
      for (;;) {
        if (gen !== pollGenRef.current) return
        const res = await api.getBidAnalysisRun(workspaceId, id)
        if (gen !== pollGenRef.current) return
        setProgress(res.run.progress)
        setRunStatus(res.run.status)
        if (res.run.errorMessage) setError(res.run.errorMessage)
        if (!['PENDING', 'RUNNING'].includes(res.run.status)) {
          setBusy(false)
          setBusyKind(null)
          await loadCounts(connId)
          await loadList(connId, listRole, sort, search, 1)
          if (kind === 'analyze' || res.run.progress.operation === 'analyze') {
            await loadCandidates()
          }
          return
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
    },
    [listRole, loadCandidates, loadCounts, loadList, search, sort, workspaceId]
  )

  useEffect(() => {
    if (!selectedConnectionId) return
    let cancelled = false
    const gen = ++pollGenRef.current
    void api
      .getLatestBidAnalysisRun(workspaceId, selectedConnectionId)
      .then(async (res) => {
        if (cancelled || gen !== pollGenRef.current || !res.run) return
        setRunId(res.run.id)
        setProgress(res.run.progress)
        setRunStatus(res.run.status)
        if (res.run.scanRangePreset) setScanRange(res.run.scanRangePreset)
        if (['PENDING', 'RUNNING'].includes(res.run.status)) {
          const kind: RunKind =
            res.run.progress.operation === 'analyze' ? 'analyze' : 'scan'
          setBusy(true)
          setBusyKind(kind)
          await pollRun(res.run.id, selectedConnectionId, gen, kind)
        }
      })
      .catch(() => {})
    void loadCounts(selectedConnectionId)
    void loadList(selectedConnectionId, listRole, sort, search, 1)
    void loadCandidates()
    return () => {
      cancelled = true
      pollGenRef.current += 1
    }
    // Intentionally re-load when mailbox changes; list filters have own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnectionId, workspaceId])

  useEffect(() => {
    if (!selectedConnectionId) return
    void loadList(selectedConnectionId, listRole, sort, search, page)
  }, [listRole, sort, search, page, selectedConnectionId, loadList])

  useEffect(() => {
    if (!selectedCandidateId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedCandidateId)
  }, [selectedCandidateId, loadDetail])

  const startRun = async (operation: RunKind) => {
    if (!selectedConnectionId || !selectedConn) {
      setError('No Outlook mailbox selected')
      return
    }
    if (operation === 'scan' && !mailboxReady) {
      setError('Outlook authorization required')
      return
    }
    if (operation === 'scan' && scanRange === 'custom' && !customSince.trim()) {
      setError('Choose a custom start date')
      return
    }
    if (operation === 'analyze' && discoveryTotal === 0) {
      setError('No discovered emails yet — run Scan Bidding Folders first')
      return
    }
    setBusy(true)
    setBusyKind(operation)
    setError('')
    setProgress(null)
    const gen = ++pollGenRef.current
    try {
      const { runId: id } = await api.startBidAnalysis(workspaceId, selectedConnectionId, {
        operation,
        scanRangePreset: scanRange,
        customSinceAt: scanRange === 'custom' ? customSince : null,
      })
      setRunId(id)
      await pollRun(id, selectedConnectionId, gen, operation)
    } catch (e) {
      setBusy(false)
      setBusyKind(null)
      setError(e instanceof Error ? e.message : `${operation} failed`)
    }
  }

  const applySearch = () => {
    setPage(1)
    setSearch(searchInput.trim())
  }

  const saveEdits = async () => {
    if (!detail) return
    setActionBusy(true)
    setError('')
    try {
      await api.updateBidCandidate(workspaceId, detail.id, {
        projectName: editProject.trim() || null,
        customerName: editCustomer.trim() || null,
        jobNumber: editJobNumber.trim() || null,
        bidDueAt: editBidDue ? new Date(`${editBidDue}T12:00:00.000Z`).toISOString() : null,
        status: editProject.trim() && editBidDue ? 'READY' : 'NEEDS_REVIEW',
      })
      await loadDetail(detail.id)
      await loadCandidates()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update candidate')
    } finally {
      setActionBusy(false)
    }
  }

  const handleReject = async () => {
    if (!detail) return
    if (!window.confirm('Reject this bid candidate? It will stay in staging as Rejected.')) {
      return
    }
    setActionBusy(true)
    setError('')
    try {
      await api.rejectBidCandidate(workspaceId, detail.id)
      await loadCandidates()
      await loadDetail(detail.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject candidate')
    } finally {
      setActionBusy(false)
    }
  }

  const handleCreateBid = async () => {
    if (!detail) return
    if (!canPromote) {
      setError('Only OWNER/ADMIN can create bids from staging')
      return
    }
    setActionBusy(true)
    setError('')
    try {
      const result = await api.promoteBidCandidate(workspaceId, detail.id, {
        mode: 'create',
        projectName: editProject.trim() || detail.proposedProjectName || undefined,
        customerName: editCustomer.trim() || detail.proposedCustomerName,
        jobNumber: editJobNumber.trim() || detail.proposedJobNumber,
        bidDueAt: editBidDue
          ? new Date(`${editBidDue}T12:00:00.000Z`).toISOString()
          : detail.proposedBidDueAt,
      })
      await loadCandidates()
      await loadDetail(detail.id)
      setError('')
      window.alert(
        result.created
          ? `Bid created (${result.attachedEmailCount} emails linked).`
          : `Linked to existing bid (${result.attachedEmailCount} emails).`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create bid'
      if (msg.toLowerCase().includes('existing') || msg.toLowerCase().includes('already')) {
        const proceed = window.confirm(`${msg}\n\nCreate anyway?`)
        if (proceed) {
          try {
            await api.promoteBidCandidate(workspaceId, detail.id, {
              mode: 'create',
              projectName: editProject.trim() || detail.proposedProjectName || undefined,
              customerName: editCustomer.trim() || detail.proposedCustomerName,
              jobNumber: editJobNumber.trim() || detail.proposedJobNumber,
              bidDueAt: editBidDue
                ? new Date(`${editBidDue}T12:00:00.000Z`).toISOString()
                : detail.proposedBidDueAt,
              confirmCreateDespiteExisting: true,
            })
            await loadCandidates()
            await loadDetail(detail.id)
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : 'Failed to create bid')
          } finally {
            setActionBusy(false)
          }
          return
        }
      }
      setError(msg)
    } finally {
      setActionBusy(false)
    }
  }

  const inviteEmails =
    detail?.emails.filter(
      (e) => e.role === 'BID_INVITE' || e.role === 'ADDENDUM' || e.role === 'SUPPORTING'
    ) ?? []
  const quoteEmails = detail?.emails.filter((e) => e.role === 'QUOTE') ?? []
  const allMatchLabels = (detail?.emails ?? []).flatMap((e) =>
    matchLabelsFromEvidence(e.matchEvidence)
  )
  const projectMatch = matchCheck(allMatchLabels, [
    'project_name_exact',
    'project_name_partial',
    'subject_project',
    'attachment_project',
  ])
  const customerMatch = matchCheck(allMatchLabels, ['customer_exact'])
  const numberMatch = matchCheck(allMatchLabels, ['project_number'])
  const conversationMatch = matchCheck(allMatchLabels, [
    'conversation',
    'thread',
    'existing_job',
  ])

  const openCandidates = candidates.filter(
    (c) => !['CONFIRMED', 'REJECTED'].includes(c.status)
  )

  return (
    <div>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px', lineHeight: 1.45 }}>
        Scan Bid Invites / Quotes into a discovery list, then analyze into Bid Candidates.
        Staging never auto-creates operational Bids — use Create Bid after review.
      </p>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 10,
            background: '#fce4ec',
            border: '1px solid #e8a09a',
            borderRadius: 4,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12, padding: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12,
              color: '#555',
              minWidth: 220,
              flex: 1,
            }}
          >
            Connected mailbox
            <select
              value={selectedConnectionId}
              onChange={(e) => {
                setSelectedConnectionId(e.target.value)
                setError('')
                setPage(1)
                setSelectedCandidateId(null)
              }}
              style={{
                padding: '6px 8px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #ddd',
              }}
            >
              <option value="">Select Outlook mailbox…</option>
              {outlookConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email} ({c.status}
                  {c.authorizationStatus !== 'CONNECTED'
                    ? ` · ${c.authorizationStatus}`
                    : ''}
                  )
                </option>
              ))}
            </select>
          </label>

          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12,
              color: '#555',
              minWidth: 160,
            }}
          >
            Scan range
            <select
              value={scanRange}
              onChange={(e) => setScanRange(e.target.value)}
              disabled={busy}
              style={{
                padding: '6px 8px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #ddd',
              }}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {scanRange === 'custom' && (
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: 12,
                color: '#555',
              }}
            >
              Since
              <input
                type="date"
                value={customSince}
                onChange={(e) => setCustomSince(e.target.value)}
                disabled={busy}
                style={{
                  padding: '6px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid #ddd',
                }}
              />
            </label>
          )}

          {canScan && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !selectedConnectionId || !mailboxReady}
              onClick={() => void startRun('scan')}
            >
              {busy && busyKind === 'scan' ? 'Scanning…' : 'Scan Bidding Folders'}
            </button>
          )}
        </div>

        {(busy || progress || runStatus) && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#333' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {activeOperation === 'analyze' ? 'ANALYZE DISCOVERED EMAILS' : 'BIDDING FOLDER SCAN'}
              {runStatus ? ` · ${runStatus}` : ''}
              {runId && (
                <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>
                  run {runId.slice(0, 8)}…
                </span>
              )}
            </div>
            {progress?.warning && (
              <p style={{ margin: '0 0 6px', color: '#b71c1c' }}>{progress.warning}</p>
            )}
            {progress && activeOperation !== 'analyze' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <span>
                  Bid Invites scanned: {progress.bidInvitesScanned}
                  {progress.bidInvitesFolderFound ? '' : ' (folder missing)'}
                </span>
                <span>
                  Quotes scanned: {progress.quotesScanned}
                  {progress.quotesFolderFound ? '' : ' (folder missing)'}
                </span>
                <span>Bid Invites found: {progress.bidInvitesFound ?? counts.bidInvites}</span>
                <span>Quotes found: {progress.quotesFound ?? counts.quotes}</span>
                <span>
                  Emails: {progress.messagesCreated} new · {progress.messagesExisting} reused
                </span>
                {progress.currentFolderName && (
                  <span>Scanning: {progress.currentFolderName}</span>
                )}
                {progress.scanRangePreset && <span>Range: {progress.scanRangePreset}</span>}
              </div>
            )}
            {progress && activeOperation === 'analyze' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <span>Candidates created: {progress.candidatesCreated}</span>
                <span>Candidates updated: {progress.candidatesUpdated}</span>
                <span>Quotes matched: {progress.quotesMatched}</span>
                <span>Quotes unmatched: {progress.quotesUnmatched}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <button
            type="button"
            className={listRole === 'BID_INVITE' ? 'btn btn-primary' : 'btn btn-outline'}
            onClick={() => {
              setListRole('BID_INVITE')
              setPage(1)
            }}
          >
            Bid Invites ({counts.bidInvites})
          </button>
          <button
            type="button"
            className={listRole === 'QUOTE' ? 'btn btn-primary' : 'btn btn-outline'}
            onClick={() => {
              setListRole('QUOTE')
              setPage(1)
            }}
          >
            Quotes ({counts.quotes})
          </button>

          <label style={{ fontSize: 12, color: '#555', marginLeft: 'auto' }}>
            Sort{' '}
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortDir)
                setPage(1)
              }}
              style={{ padding: '4px 6px', fontSize: 12 }}
            >
              <option value="newest">Newest → Oldest</option>
              <option value="oldest">Oldest → Newest</option>
            </select>
          </label>

          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch()
              }}
              placeholder="Search subject / sender"
              style={{
                padding: '4px 8px',
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid #ddd',
                minWidth: 160,
              }}
            />
            <button type="button" className="btn btn-outline" onClick={applySearch}>
              Search
            </button>
          </div>
        </div>

        {loadingList ? (
          <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ fontSize: 13, color: '#888' }}>
            No {listRole === 'BID_INVITE' ? 'Bid Invite' : 'Quote'} emails discovered yet for this
            mailbox. Run a scan with a date range.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#666' }}>
                  <th style={{ padding: '6px 8px' }}>Date</th>
                  <th style={{ padding: '6px 8px' }}>Subject</th>
                  <th style={{ padding: '6px 8px' }}>Sender</th>
                  <th style={{ padding: '6px 8px' }}>Attachments</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const dateIso = row.email.receivedAt ?? row.email.sentAt
                  return (
                    <tr
                      key={row.discoveryId}
                      style={{
                        borderTop: '1px solid #eee',
                        cursor: onOpenMessage ? 'pointer' : undefined,
                      }}
                      onClick={() => {
                        if (onOpenMessage && selectedConnectionId) {
                          onOpenMessage(row.email.id, selectedConnectionId)
                        }
                      }}
                    >
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                        {formatWhen(dateIso)}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{row.email.subject ?? '(no subject)'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {row.email.senderName || row.email.senderEmail}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {row.email.hasAttachments
                          ? row.email.attachmentCount > 0
                            ? String(row.email.attachmentCount)
                            : 'Yes'
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > 50 && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 10,
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <button
              type="button"
              className="btn btn-outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span>
              Page {page} · {total} total
            </span>
            <button
              type="button"
              className="btn btn-outline"
              disabled={page * 50 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}

        {canScan && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 18, color: '#999', marginBottom: 8 }}>↓</div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || discoveryTotal === 0}
              onClick={() => void startRun('analyze')}
            >
              {busy && busyKind === 'analyze'
                ? 'Analyzing discovered emails…'
                : 'Analyze Discovered Emails'}
            </button>
            {discoveryTotal === 0 && (
              <p style={{ fontSize: 12, color: '#888', margin: '8px 0 0' }}>
                Scan first to populate Bid Invites / Quotes, then analyze into candidates.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Bid Candidates</h3>
        {loadingCandidates ? (
          <p style={{ fontSize: 13, color: '#888' }}>Loading candidates…</p>
        ) : openCandidates.length === 0 ? (
          <p style={{ fontSize: 13, color: '#888' }}>
            No open candidates yet. After discovery, run Analyze Discovered Emails.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#666', borderBottom: '1px solid #ddd' }}>
                  <th style={{ padding: '8px 10px' }}>Project</th>
                  <th style={{ padding: '8px 10px' }}>Customer</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                  <th style={{ padding: '8px 10px' }}>Invites</th>
                  <th style={{ padding: '8px 10px' }}>Quotes</th>
                </tr>
              </thead>
              <tbody>
                {openCandidates.map((c) => {
                  const selected = c.id === selectedCandidateId
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedCandidateId(c.id)}
                      style={{
                        borderTop: '1px solid #eee',
                        cursor: 'pointer',
                        background: selected ? '#eef5ff' : undefined,
                      }}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: selected ? 600 : 400 }}>
                        {c.proposedProjectName ?? '(unnamed project)'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {c.proposedCustomerName ?? '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{statusLabel(c.status)}</td>
                      <td style={{ padding: '8px 10px' }}>{c.inviteCount}</td>
                      <td style={{ padding: '8px 10px' }}>{c.quoteCount}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {candidates.some((c) => c.status === 'CONFIRMED' || c.status === 'REJECTED') && (
          <p style={{ fontSize: 12, color: '#888', margin: '10px 0 0' }}>
            {candidates.filter((c) => c.status === 'CONFIRMED').length} created ·{' '}
            {candidates.filter((c) => c.status === 'REJECTED').length} rejected (hidden from open
            list)
          </p>
        )}
      </div>

      {selectedCandidateId && (
        <div className="card" style={{ padding: 16 }}>
          {loadingDetail || !detail ? (
            <p style={{ fontSize: 13, color: '#888' }}>Loading candidate…</p>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: '#888', letterSpacing: 0.4 }}>PROJECT</div>
                  {editing ? (
                    <input
                      value={editProject}
                      onChange={(e) => setEditProject(e.target.value)}
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        padding: '4px 8px',
                        border: '1px solid #ddd',
                        borderRadius: 4,
                        minWidth: 260,
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {detail.proposedProjectName ?? '(unnamed project)'}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setSelectedCandidateId(null)}
                >
                  Close
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 12,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: '#888' }}>CUSTOMER</div>
                  {editing ? (
                    <input
                      value={editCustomer}
                      onChange={(e) => setEditCustomer(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        border: '1px solid #ddd',
                        borderRadius: 4,
                      }}
                    />
                  ) : (
                    <div>{detail.proposedCustomerName ?? '—'}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#888' }}>BID DUE</div>
                  {editing ? (
                    <input
                      type="date"
                      value={editBidDue}
                      onChange={(e) => setEditBidDue(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #ddd',
                        borderRadius: 4,
                      }}
                    />
                  ) : (
                    <div>{formatDateOnly(detail.proposedBidDueAt)}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#888' }}>PROJECT NUMBER</div>
                  {editing ? (
                    <input
                      value={editJobNumber}
                      onChange={(e) => setEditJobNumber(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        border: '1px solid #ddd',
                        borderRadius: 4,
                      }}
                    />
                  ) : (
                    <div>{detail.proposedJobNumber ?? '—'}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#888' }}>STATUS</div>
                  <div>{statusLabel(detail.status)}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                    SOURCE EVIDENCE · Bid Invites ({inviteEmails.length})
                  </div>
                  {inviteEmails.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#888' }}>No invite emails linked.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                      {inviteEmails.map((link) => (
                        <li key={link.id}>
                          <button
                            type="button"
                            onClick={() => {
                              if (onOpenMessage && selectedConnectionId) {
                                onOpenMessage(link.email.id, selectedConnectionId)
                              }
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: onOpenMessage ? '#1565c0' : 'inherit',
                              cursor: onOpenMessage ? 'pointer' : 'default',
                              textAlign: 'left',
                            }}
                          >
                            {link.email.subject ?? '(no subject)'}
                            {link.isPrimary ? ' · primary' : ''}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                    QUOTES ({quoteEmails.length})
                  </div>
                  {quoteEmails.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#888' }}>No quotes matched yet.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                      {quoteEmails.map((link) => {
                        const names = attachmentNames(link.email.attachmentMetadata)
                        return (
                          <li key={link.id}>
                            <button
                              type="button"
                              onClick={() => {
                                if (onOpenMessage && selectedConnectionId) {
                                  onOpenMessage(link.email.id, selectedConnectionId)
                                }
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                color: onOpenMessage ? '#1565c0' : 'inherit',
                                cursor: onOpenMessage ? 'pointer' : 'default',
                                textAlign: 'left',
                              }}
                            >
                              {names[0] ?? link.email.subject ?? '(quote)'}
                              {names.length > 1 ? ` (+${names.length - 1})` : ''}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>MATCH EVIDENCE</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 40px',
                    gap: '4px 12px',
                    fontSize: 13,
                    maxWidth: 220,
                  }}
                >
                  <span>Project name</span>
                  <span>{mark(projectMatch)}</span>
                  <span>Customer</span>
                  <span>{mark(customerMatch)}</span>
                  <span>Project number</span>
                  <span>{mark(numberMatch)}</span>
                  <span>Conversation</span>
                  <span>{mark(conversationMatch)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                {editing ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={actionBusy}
                      onClick={() => void saveEdits()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={actionBusy}
                      onClick={() => {
                        setEditing(false)
                        setEditProject(detail.proposedProjectName ?? '')
                        setEditCustomer(detail.proposedCustomerName ?? '')
                        setEditJobNumber(detail.proposedJobNumber ?? '')
                        setEditBidDue(
                          detail.proposedBidDueAt
                            ? detail.proposedBidDueAt.slice(0, 10)
                            : ''
                        )
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={
                      actionBusy ||
                      detail.status === 'CONFIRMED' ||
                      detail.status === 'REJECTED'
                    }
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={
                    actionBusy ||
                    detail.status === 'CONFIRMED' ||
                    detail.status === 'REJECTED'
                  }
                  onClick={() => void handleReject()}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    actionBusy ||
                    !canPromote ||
                    detail.status === 'CONFIRMED' ||
                    detail.status === 'REJECTED'
                  }
                  onClick={() => void handleCreateBid()}
                  title={
                    canPromote
                      ? 'Create operational BIDDING Job from this candidate'
                      : 'Only OWNER/ADMIN can create bids'
                  }
                >
                  Create Bid
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
