import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type BidCandidateDetail,
  type BidCandidateSummary,
  type BidEmailAnalyzeProgressView,
  type BidFolderDiscoveryItem,
  type BidQuoteStagingSummary,
  type ConnectionSummary,
} from '../api'
import {
  appendBidFolderDiscoveryItems,
  BID_FOLDER_DISCOVERY_PAGE_SIZE,
  bidFolderDiscoveryHasMore,
  bidFolderDiscoveryQueryKey,
} from '../bid-folder-discovery-list'

const RANGE_OPTIONS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '180d', label: 'Last 6 months' },
  { value: '365d', label: 'Last 12 months' },
  { value: 'all', label: 'All history' },
  { value: 'custom', label: 'Custom range' },
] as const

const DEFAULT_RANGE = '90d'

const PIPELINE_STAGES = [
  { phase: 'SCANNING_BID_INVITES', label: 'Scan Bid Invites' },
  { phase: 'EXTRACTING_BID_CANDIDATES', label: 'Extract Bid Candidates' },
  { phase: 'SCANNING_QUOTES', label: 'Scan Quotes' },
  { phase: 'EXTRACTING_QUOTES', label: 'Extract Quotes' },
  { phase: 'MATCHING_QUOTES', label: 'Match Quotes' },
  { phase: 'MATCHING_EXISTING_JOBS', label: 'Match Existing Jobs' },
  { phase: 'READY_FOR_REVIEW', label: 'Ready for Review' },
] as const

type ListRole = 'BID_INVITE' | 'QUOTE'
type SortDir = 'newest' | 'oldest'
type MainTab = 'candidates' | 'quotes' | 'source'
type RunKind = 'scan_bids' | 'scan' | 'analyze'

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

function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return 'No Quote'
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

function existingJobLabel(status: string | undefined): string {
  switch (status) {
    case 'NONE':
      return 'None'
    case 'POSSIBLE':
      return 'Possible'
    case 'STRONG':
      return 'Strong'
    case 'NEEDS_REVIEW':
      return 'Needs review'
    case 'RESOLVED_SAME':
      return 'Same Job'
    case 'RESOLVED_DIFFERENT':
      return 'Different'
    default:
      return status || '—'
  }
}

function stageState(
  currentPhase: string | null | undefined,
  stagePhase: string,
  runDone: boolean
): 'done' | 'active' | 'pending' {
  if (runDone || currentPhase === 'DONE' || currentPhase === 'READY_FOR_REVIEW') {
    return 'done'
  }
  const order = PIPELINE_STAGES.map((s) => s.phase)
  // Legacy phases map into nearby stages
  const normalized =
    currentPhase === 'BID_INVITES'
      ? 'SCANNING_BID_INVITES'
      : currentPhase === 'QUOTES'
        ? 'SCANNING_QUOTES'
        : currentPhase === 'ANALYZE_CANDIDATES'
          ? 'EXTRACTING_BID_CANDIDATES'
          : currentPhase === 'RESOLVE_FOLDERS'
            ? 'SCANNING_BID_INVITES'
            : currentPhase
  const curIdx = normalized ? order.indexOf(normalized as (typeof order)[number]) : -1
  const stageIdx = order.indexOf(stagePhase as (typeof order)[number])
  if (curIdx < 0) return 'pending'
  if (stageIdx < curIdx) return 'done'
  if (stageIdx === curIdx) return 'active'
  return 'pending'
}

function isImportEligible(c: BidCandidateSummary): boolean {
  if (['CONFIRMED', 'REJECTED'].includes(c.status)) return false
  if (c.importBlockedReason) return false
  if (!c.proposedProjectName?.trim()) return false
  if (
    c.existingJobMatchStatus === 'POSSIBLE' ||
    c.existingJobMatchStatus === 'STRONG' ||
    c.existingJobMatchStatus === 'NEEDS_REVIEW'
  ) {
    return false
  }
  if (c.status === 'NEEDS_REVIEW') return false
  return true
}

interface Props {
  workspaceId: string
  connectionId: string
  userRole?: string
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
}

/**
 * Systems → Email Analysis → Bidding Folder Analysis
 * Scan Bids → review staging → Import N Bids.
 * Never auto-creates operational BIDDING Jobs.
 */
export function BiddingFolderAnalysisView({
  workspaceId,
  connectionId,
  userRole = 'MEMBER',
  onOpenMessage,
}: Props) {
  const canScan = ['OWNER', 'ADMIN', 'MANAGER'].includes(userRole)
  const canImport = ['OWNER', 'ADMIN'].includes(userRole)

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
  const [mainTab, setMainTab] = useState<MainTab>('candidates')
  const [listRole, setListRole] = useState<ListRole>('BID_INVITE')
  const [sort, setSort] = useState<SortDir>('newest')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [items, setItems] = useState<BidFolderDiscoveryItem[]>([])
  const [counts, setCounts] = useState({ bidInvites: 0, quotes: 0 })
  const [loadingList, setLoadingList] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [candidates, setCandidates] = useState<BidCandidateSummary[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [quotes, setQuotes] = useState<BidQuoteStagingSummary[]>([])
  const [loadingQuotes, setLoadingQuotes] = useState(false)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BidCandidateDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editProject, setEditProject] = useState('')
  const [editCustomer, setEditCustomer] = useState('')
  const [editJobNumber, setEditJobNumber] = useState('')
  const [editBidDue, setEditBidDue] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionBusy, setActionBusy] = useState(false)
  const pollGenRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const loadMoreLock = useRef(false)
  const discoveryReqSeq = useRef(0)
  const discoveryQueryKeyRef = useRef('')

  const outlookConnections = useMemo(
    () => connections.filter(isOutlookConnection),
    [connections]
  )
  const selectedConn =
    outlookConnections.find((c) => c.id === selectedConnectionId) ?? null
  const mailboxReady = Boolean(selectedConn && isProjectFolderEligible(selectedConn))

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
      const res = await api.listBidCandidates(workspaceId, { limit: 200 })
      setCandidates(res.candidates)
      setSelectedIds((prev) => {
        const next = new Set<string>()
        for (const id of prev) {
          if (res.candidates.some((c) => c.id === id && isImportEligible(c))) {
            next.add(id)
          }
        }
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bid candidates')
    } finally {
      setLoadingCandidates(false)
    }
  }, [workspaceId])

  const loadQuotes = useCallback(
    async (connId: string) => {
      if (!connId) return
      setLoadingQuotes(true)
      try {
        const res = await api.listBidQuotes(workspaceId, {
          connectionId: connId,
          pageSize: 100,
        })
        setQuotes(res.quotes)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load quotes')
      } finally {
        setLoadingQuotes(false)
      }
    },
    [workspaceId]
  )

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
        setEditNotes(res.candidate.proposedNotes ?? '')
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

  const loadDiscovery = useCallback(
    async (opts: {
      connId: string
      role: ListRole
      sortDir: SortDir
      q: string
      pageNum: number
      append: boolean
    }) => {
      if (!opts.connId) return
      const queryKey = bidFolderDiscoveryQueryKey({
        workspaceId,
        connectionId: opts.connId,
        role: opts.role,
        sort: opts.sortDir,
        search: opts.q,
      })
      const seq = ++discoveryReqSeq.current
      if (opts.append) setLoadingMore(true)
      else setLoadingList(true)
      try {
        const res = await api.listBidFolderDiscovery(workspaceId, {
          connectionId: opts.connId,
          role: opts.role,
          sort: opts.sortDir,
          search: opts.q || undefined,
          page: opts.pageNum,
          pageSize: BID_FOLDER_DISCOVERY_PAGE_SIZE,
        })
        if (seq !== discoveryReqSeq.current) return
        if (queryKey !== discoveryQueryKeyRef.current && opts.append) return
        discoveryQueryKeyRef.current = queryKey
        setTotal(res.total)
        setPage(res.page)
        setHasMore(
          bidFolderDiscoveryHasMore({
            page: res.page,
            pageSize: res.pageSize,
            total: res.total,
          })
        )
        setItems((prev) =>
          opts.append ? appendBidFolderDiscoveryItems(prev, res.items) : res.items
        )
      } catch (e) {
        if (seq !== discoveryReqSeq.current) return
        setError(e instanceof Error ? e.message : 'Failed to load discovery list')
      } finally {
        if (seq === discoveryReqSeq.current) {
          setLoadingList(false)
          setLoadingMore(false)
          loadMoreLock.current = false
        }
      }
    },
    [workspaceId]
  )

  const resetAndLoadDiscovery = useCallback(
    async (connId: string, role: ListRole, sortDir: SortDir, q: string) => {
      discoveryQueryKeyRef.current = bidFolderDiscoveryQueryKey({
        workspaceId,
        connectionId: connId,
        role,
        sort: sortDir,
        search: q,
      })
      setItems([])
      setPage(1)
      setTotal(0)
      setHasMore(false)
      loadMoreLock.current = false
      await loadDiscovery({
        connId,
        role,
        sortDir,
        q,
        pageNum: 1,
        append: false,
      })
    },
    [loadDiscovery, workspaceId]
  )

  const pollRun = useCallback(
    async (id: string, connId: string, gen: number) => {
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
          await loadCandidates()
          await loadQuotes(connId)
          if (mainTab === 'source') {
            await resetAndLoadDiscovery(connId, listRole, sort, search)
          }
          return
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
    },
    [
      listRole,
      loadCandidates,
      loadCounts,
      loadQuotes,
      mainTab,
      resetAndLoadDiscovery,
      search,
      sort,
      workspaceId,
    ]
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
          setBusy(true)
          setBusyKind(
            res.run.progress.operation === 'analyze'
              ? 'analyze'
              : res.run.progress.operation === 'scan'
                ? 'scan'
                : 'scan_bids'
          )
          await pollRun(res.run.id, selectedConnectionId, gen)
        }
      })
      .catch(() => {})
    void loadCounts(selectedConnectionId)
    void loadCandidates()
    void loadQuotes(selectedConnectionId)
    return () => {
      cancelled = true
      pollGenRef.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnectionId, workspaceId])

  useEffect(() => {
    if (!selectedConnectionId || mainTab !== 'source') return
    void resetAndLoadDiscovery(selectedConnectionId, listRole, sort, search)
  }, [listRole, sort, search, selectedConnectionId, mainTab, resetAndLoadDiscovery])

  const requestNextDiscoveryPage = useCallback(() => {
    if (
      !selectedConnectionId ||
      !hasMore ||
      loadingList ||
      loadingMore ||
      loadMoreLock.current
    ) {
      return
    }
    loadMoreLock.current = true
    void loadDiscovery({
      connId: selectedConnectionId,
      role: listRole,
      sortDir: sort,
      q: search,
      pageNum: page + 1,
      append: true,
    })
  }, [
    hasMore,
    listRole,
    loadDiscovery,
    loadingList,
    loadingMore,
    page,
    search,
    selectedConnectionId,
    sort,
  ])

  const handleDiscoveryScroll = () => {
    const el = listRef.current
    if (!el || !hasMore || loadingMore || loadMoreLock.current) return
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    if (remaining < 160) requestNextDiscoveryPage()
  }

  useEffect(() => {
    if (!selectedCandidateId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedCandidateId)
  }, [selectedCandidateId, loadDetail])

  const startScanBids = async () => {
    if (!selectedConnectionId || !selectedConn) {
      setError('No Outlook mailbox selected')
      return
    }
    if (!mailboxReady) {
      setError('Outlook authorization required')
      return
    }
    if (scanRange === 'custom' && !customSince.trim()) {
      setError('Choose a custom start date')
      return
    }
    setBusy(true)
    setBusyKind('scan_bids')
    setError('')
    setProgress(null)
    const gen = ++pollGenRef.current
    try {
      const { runId: id } = await api.startBidAnalysis(
        workspaceId,
        selectedConnectionId,
        {
          operation: 'scan_bids',
          scanRangePreset: scanRange,
          customSinceAt: scanRange === 'custom' ? customSince : null,
        }
      )
      setRunId(id)
      await pollRun(id, selectedConnectionId, gen)
    } catch (e) {
      setBusy(false)
      setBusyKind(null)
      setError(e instanceof Error ? e.message : 'Scan Bids failed')
    }
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
        bidDueAt: editBidDue
          ? new Date(`${editBidDue}T12:00:00.000Z`).toISOString()
          : null,
        notes: editNotes.trim() || null,
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
    if (!window.confirm('Reject this bid candidate? It stays in staging as Rejected.')) {
      return
    }
    setActionBusy(true)
    setError('')
    try {
      await api.rejectBidCandidate(workspaceId, detail.id)
      await loadCandidates()
      await loadDetail(detail.id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(detail.id)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject candidate')
    } finally {
      setActionBusy(false)
    }
  }

  const resolveExisting = async (resolution: 'SAME' | 'DIFFERENT' | 'NEEDS_REVIEW') => {
    if (!detail) return
    setActionBusy(true)
    setError('')
    try {
      await api.resolveBidCandidateExistingJob(workspaceId, detail.id, {
        resolution,
        ...(resolution === 'SAME' && detail.proposedExistingJobId
          ? { existingJobId: detail.proposedExistingJobId }
          : {}),
      })
      await loadDetail(detail.id)
      await loadCandidates()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve existing Job')
    } finally {
      setActionBusy(false)
    }
  }

  const handleImport = async () => {
    if (!canImport) {
      setError('Only OWNER/ADMIN can import bids')
      return
    }
    const ids = [...selectedIds]
    if (ids.length === 0) {
      setError('Select at least one ready bid candidate')
      return
    }
    if (!window.confirm(`Import ${ids.length} bid${ids.length === 1 ? '' : 's'}?`)) {
      return
    }
    setActionBusy(true)
    setError('')
    try {
      const result = await api.importBidCandidates(workspaceId, ids)
      await loadCandidates()
      if (selectedCandidateId) await loadDetail(selectedCandidateId)
      setSelectedIds(new Set())
      const parts = [
        `${result.imported.length} imported`,
        result.skipped.length ? `${result.skipped.length} skipped` : null,
        result.failed.length ? `${result.failed.length} failed` : null,
      ].filter(Boolean)
      if (result.failed.length > 0) {
        setError(
          `${parts.join(' · ')}. ${result.failed
            .slice(0, 3)
            .map((f) => f.reason)
            .join('; ')}`
        )
      } else {
        window.alert(parts.join(' · '))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setActionBusy(false)
    }
  }

  const unmatchQuote = async (quoteId: string) => {
    setActionBusy(true)
    setError('')
    try {
      await api.updateBidQuote(workspaceId, quoteId, { unmatch: true })
      if (selectedConnectionId) await loadQuotes(selectedConnectionId)
      await loadCandidates()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unmatch quote')
    } finally {
      setActionBusy(false)
    }
  }

  const openCandidates = candidates.filter(
    (c) => !['CONFIRMED', 'REJECTED'].includes(c.status)
  )
  const readyCount = openCandidates.filter(isImportEligible).length
  const needsReviewCount = openCandidates.filter(
    (c) =>
      c.status === 'NEEDS_REVIEW' ||
      c.existingJobMatchStatus === 'NEEDS_REVIEW' ||
      c.existingJobMatchStatus === 'POSSIBLE' ||
      c.existingJobMatchStatus === 'STRONG' ||
      Boolean(c.importBlockedReason)
  ).length
  const runDone = Boolean(
    runStatus && !['PENDING', 'RUNNING'].includes(runStatus)
  )

  const toggleSelect = (id: string, eligible: boolean) => {
    if (!eligible) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllReady = () => {
    setSelectedIds(
      new Set(openCandidates.filter(isImportEligible).map((c) => c.id))
    )
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px', lineHeight: 1.45 }}>
        Scan Bids extracts Bid Candidates and Quotes into staging, proposes existing Job
        matches, then waits for your review. Jobs are created only when you Import.
        Quote amounts/scope come from email body and filenames (PDF attachment text not
        analyzed yet).
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
                setSelectedCandidateId(null)
                setSelectedIds(new Set())
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
              onClick={() => void startScanBids()}
            >
              {busy && busyKind === 'scan_bids' ? 'Scanning Bids…' : 'Scan Bids'}
            </button>
          )}
        </div>

        {(busy || progress || runStatus) && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#333' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              SCAN BIDS
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
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {PIPELINE_STAGES.map((stage) => {
                const state = stageState(progress?.currentPhase, stage.phase, runDone)
                const mark =
                  state === 'done' ? '✓' : state === 'active' ? '●' : '○'
                const color =
                  state === 'done'
                    ? '#2e7d32'
                    : state === 'active'
                      ? '#1565c0'
                      : '#999'
                return (
                  <li
                    key={stage.phase}
                    style={{
                      display: 'flex',
                      gap: 8,
                      padding: '2px 0',
                      color,
                      fontWeight: state === 'active' ? 600 : 400,
                    }}
                  >
                    <span style={{ width: 14 }}>{mark}</span>
                    <span>{stage.label}</span>
                    {state === 'active' && progress?.currentFolderName && (
                      <span style={{ color: '#888', fontWeight: 400 }}>
                        · {progress.currentFolderName}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
            {progress && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  color: '#666',
                }}
              >
                <span>
                  Invites {progress.bidInvitesFound ?? 0} / scanned{' '}
                  {progress.bidInvitesScanned}
                </span>
                <span>
                  Quotes {progress.quotesFound ?? 0} / extracted{' '}
                  {progress.quotesExtracted ?? 0}
                </span>
                <span>
                  Candidates +{progress.candidatesCreated} / ~{progress.candidatesUpdated}
                </span>
                <span>
                  Quote match {progress.quotesMatched} · review{' '}
                  {progress.quotesNeedsReview ?? 0} · unmatched{' '}
                  {progress.quotesUnmatched}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {(
          [
            ['candidates', `Bid Candidates (${openCandidates.length})`],
            ['quotes', `Quotes (${quotes.length})`],
            [
              'source',
              `Source Emails (${counts.bidInvites + counts.quotes})`,
            ],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={mainTab === id ? 'btn btn-primary' : 'btn'}
            onClick={() => setMainTab(id)}
            style={{ fontSize: 13 }}
          >
            {label}
          </button>
        ))}
      </div>

      {mainTab === 'candidates' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: detail || loadingDetail ? '1.2fr 1fr' : '1fr',
            gap: 12,
            alignItems: 'start',
          }}
        >
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <strong style={{ fontSize: 13 }}>Bid Candidates</strong>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 12 }}
                  onClick={selectAllReady}
                  disabled={readyCount === 0}
                >
                  Select ready
                </button>
                {loadingCandidates && (
                  <span style={{ fontSize: 12, color: '#888' }}>Loading…</span>
                )}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', background: '#fafafa' }}>
                    <th style={{ padding: '8px 10px', width: 36 }} />
                    <th style={{ padding: '8px 10px' }}>Project</th>
                    <th style={{ padding: '8px 10px' }}>Customer</th>
                    <th style={{ padding: '8px 10px' }}>Due</th>
                    <th style={{ padding: '8px 10px' }}>Quote</th>
                    <th style={{ padding: '8px 10px' }}>Existing Job</th>
                    <th style={{ padding: '8px 10px' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.length === 0 && !loadingCandidates && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{ padding: 16, color: '#888', textAlign: 'center' }}
                      >
                        No candidates yet — run Scan Bids.
                      </td>
                    </tr>
                  )}
                  {candidates.map((c) => {
                    const eligible = isImportEligible(c)
                    const selected = selectedIds.has(c.id)
                    const active = selectedCandidateId === c.id
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCandidateId(c.id)}
                        style={{
                          cursor: 'pointer',
                          background: active ? '#e3f2fd' : undefined,
                          borderTop: '1px solid #f0f0f0',
                          opacity: c.status === 'REJECTED' ? 0.55 : 1,
                        }}
                      >
                        <td
                          style={{ padding: '8px 10px' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!eligible || !canImport}
                            onChange={() => toggleSelect(c.id, eligible)}
                          />
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontWeight: 600 }}>
                            {c.proposedProjectName || 'Untitled'}
                          </div>
                          <div style={{ fontSize: 11, color: '#888' }}>
                            {c.status}
                            {c.importBlockedReason
                              ? ` · ${c.importBlockedReason}`
                              : ''}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {c.proposedCustomerName || '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {formatDateOnly(c.proposedBidDueAt)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {formatMoney(c.quoteAmount, c.quoteCurrency)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {existingJobLabel(c.existingJobMatchStatus)}
                          {c.proposedExistingJob ? (
                            <div style={{ fontSize: 11, color: '#666' }}>
                              {c.proposedExistingJob.jobNumber
                                ? `${c.proposedExistingJob.jobNumber} — `
                                : ''}
                              {c.proposedExistingJob.name}
                            </div>
                          ) : null}
                        </td>
                        <td
                          style={{
                            padding: '8px 10px',
                            maxWidth: 140,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.proposedNotes || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {(detail || loadingDetail) && (
            <div className="card" style={{ padding: 14 }}>
              {loadingDetail && !detail ? (
                <p style={{ margin: 0, color: '#888', fontSize: 13 }}>Loading…</p>
              ) : detail ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>
                      {detail.proposedProjectName || 'Untitled project'}
                    </strong>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 12 }}
                      onClick={() => setSelectedCandidateId(null)}
                    >
                      Close
                    </button>
                  </div>

                  {editing ? (
                    <div
                      style={{
                        display: 'grid',
                        gap: 8,
                        marginBottom: 12,
                        fontSize: 13,
                      }}
                    >
                      <label>
                        Project
                        <input
                          value={editProject}
                          onChange={(e) => setEditProject(e.target.value)}
                          style={{ width: '100%', marginTop: 2 }}
                        />
                      </label>
                      <label>
                        Customer
                        <input
                          value={editCustomer}
                          onChange={(e) => setEditCustomer(e.target.value)}
                          style={{ width: '100%', marginTop: 2 }}
                        />
                      </label>
                      <label>
                        Job #
                        <input
                          value={editJobNumber}
                          onChange={(e) => setEditJobNumber(e.target.value)}
                          style={{ width: '100%', marginTop: 2 }}
                        />
                      </label>
                      <label>
                        Due
                        <input
                          type="date"
                          value={editBidDue}
                          onChange={(e) => setEditBidDue(e.target.value)}
                          style={{ width: '100%', marginTop: 2 }}
                        />
                      </label>
                      <label>
                        Notes
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={2}
                          style={{ width: '100%', marginTop: 2 }}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
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
                          className="btn"
                          onClick={() => setEditing(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <dl
                      style={{
                        margin: '0 0 12px',
                        fontSize: 13,
                        display: 'grid',
                        gridTemplateColumns: '100px 1fr',
                        gap: '4px 8px',
                      }}
                    >
                      <dt style={{ color: '#888' }}>Customer</dt>
                      <dd style={{ margin: 0 }}>
                        {detail.proposedCustomerName || '—'}
                      </dd>
                      <dt style={{ color: '#888' }}>Due</dt>
                      <dd style={{ margin: 0 }}>
                        {formatDateOnly(detail.proposedBidDueAt)}
                      </dd>
                      <dt style={{ color: '#888' }}>Job #</dt>
                      <dd style={{ margin: 0 }}>
                        {detail.proposedJobNumber || '—'}
                      </dd>
                      <dt style={{ color: '#888' }}>Quote</dt>
                      <dd style={{ margin: 0 }}>
                        {detail.quotes && detail.quotes.length > 0
                          ? detail.quotes
                              .map((q) =>
                                formatMoney(q.extractedAmount, q.currency)
                              )
                              .join(', ')
                          : formatMoney(detail.quoteAmount, detail.quoteCurrency)}
                      </dd>
                      <dt style={{ color: '#888' }}>Notes</dt>
                      <dd style={{ margin: 0 }}>{detail.proposedNotes || '—'}</dd>
                    </dl>
                  )}

                  <div
                    style={{
                      marginBottom: 12,
                      padding: 10,
                      background: '#fafafa',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      Existing Job ·{' '}
                      {existingJobLabel(detail.existingJobMatchStatus)}
                    </div>
                    {detail.proposedExistingJob && (
                      <div style={{ marginBottom: 8, color: '#444' }}>
                        {detail.proposedExistingJob.jobNumber
                          ? `${detail.proposedExistingJob.jobNumber} — `
                          : ''}
                        {detail.proposedExistingJob.name}
                      </div>
                    )}
                    {!['CONFIRMED', 'REJECTED'].includes(detail.status) &&
                      ['POSSIBLE', 'STRONG', 'NEEDS_REVIEW'].includes(
                        detail.existingJobMatchStatus || ''
                      ) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={actionBusy || !detail.proposedExistingJobId}
                            onClick={() => void resolveExisting('SAME')}
                            style={{ fontSize: 12 }}
                          >
                            Same Job
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={actionBusy}
                            onClick={() => void resolveExisting('DIFFERENT')}
                            style={{ fontSize: 12 }}
                          >
                            Different Job
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={actionBusy}
                            onClick={() => void resolveExisting('NEEDS_REVIEW')}
                            style={{ fontSize: 12 }}
                          >
                            Needs review
                          </button>
                        </div>
                      )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {!editing &&
                      !['CONFIRMED', 'REJECTED'].includes(detail.status) && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setEditing(true)}
                        >
                          Edit
                        </button>
                      )}
                    {!['CONFIRMED', 'REJECTED'].includes(detail.status) && (
                      <button
                        type="button"
                        className="btn"
                        disabled={actionBusy}
                        onClick={() => void handleReject()}
                      >
                        Reject
                      </button>
                    )}
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
                      Source emails
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {detail.emails.map((link) => (
                        <li
                          key={link.id}
                          style={{
                            fontSize: 12,
                            padding: '4px 0',
                            borderTop: '1px solid #f0f0f0',
                          }}
                        >
                          <span style={{ color: '#888' }}>{link.role}</span>{' '}
                          {link.email.subject || '(no subject)'}
                          {onOpenMessage && selectedConnectionId && (
                            <button
                              type="button"
                              className="btn"
                              style={{
                                marginLeft: 6,
                                fontSize: 11,
                                padding: '2px 6px',
                              }}
                              onClick={() =>
                                onOpenMessage(link.email.id, selectedConnectionId)
                              }
                            >
                              Open
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {mainTab === 'quotes' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <strong style={{ fontSize: 13 }}>Quotes</strong>
            {loadingQuotes && (
              <span style={{ fontSize: 12, color: '#888' }}>Loading…</span>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#fafafa' }}>
                  <th style={{ padding: '8px 10px' }}>Name</th>
                  <th style={{ padding: '8px 10px' }}>Scope</th>
                  <th style={{ padding: '8px 10px' }}>Price</th>
                  <th style={{ padding: '8px 10px' }}>Bid Match</th>
                  <th style={{ padding: '8px 10px' }}>Notes</th>
                  <th style={{ padding: '8px 10px' }} />
                </tr>
              </thead>
              <tbody>
                {quotes.length === 0 && !loadingQuotes && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ padding: 16, color: '#888', textAlign: 'center' }}
                    >
                      No quote staging rows yet — run Scan Bids.
                    </td>
                  </tr>
                )}
                {quotes.map((q) => (
                  <tr key={q.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 10px' }}>
                      {q.sourceSubject || '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {q.extractedScope || '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {formatMoney(q.extractedAmount, q.currency)}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div>{q.matchStatus}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        {q.bidCandidateName || 'Unmatched'}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {q.extractedNotes || '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {q.bidCandidateId && (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 12 }}
                          disabled={actionBusy}
                          onClick={() => void unmatchQuote(q.id)}
                        >
                          Unmatch
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mainTab === 'source' && (
        <div className="card" style={{ padding: 14 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 10,
              alignItems: 'flex-end',
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  ['BID_INVITE', `Bid Invites (${counts.bidInvites})`],
                  ['QUOTE', `Quotes (${counts.quotes})`],
                ] as const
              ).map(([role, label]) => (
                <button
                  key={role}
                  type="button"
                  className={listRole === role ? 'btn btn-primary' : 'btn'}
                  style={{ fontSize: 12 }}
                  onClick={() => setListRole(role)}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortDir)}
              style={{ fontSize: 12, padding: '4px 6px' }}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(searchInput.trim())
              }}
              placeholder="Search subject/sender…"
              style={{ fontSize: 12, padding: '4px 8px', minWidth: 180 }}
            />
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12 }}
              onClick={() => setSearch(searchInput.trim())}
            >
              Search
            </button>
          </div>
          <div
            ref={listRef}
            onScroll={handleDiscoveryScroll}
            style={{ maxHeight: 420, overflowY: 'auto', fontSize: 13 }}
          >
            {loadingList && items.length === 0 && (
              <p style={{ color: '#888' }}>Loading…</p>
            )}
            {!loadingList && items.length === 0 && (
              <p style={{ color: '#888' }}>No source emails in discovery yet.</p>
            )}
            {items.map((item) => (
              <div
                key={item.discoveryId}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {item.email.subject || '(no subject)'}
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {item.email.senderName || item.email.senderEmail} ·{' '}
                    {formatWhen(item.email.receivedAt || item.email.sentAt)}
                    {item.email.hasAttachments
                      ? ` · ${item.email.attachmentCount} att.`
                      : ''}
                  </div>
                </div>
                {onOpenMessage && selectedConnectionId && (
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 12, alignSelf: 'center' }}
                    onClick={() =>
                      onOpenMessage(item.email.id, selectedConnectionId)
                    }
                  >
                    Open
                  </button>
                )}
              </div>
            ))}
            {loadingMore && (
              <p style={{ color: '#888', fontSize: 12 }}>Loading more…</p>
            )}
            {!hasMore && items.length > 0 && (
              <p style={{ color: '#aaa', fontSize: 12, marginTop: 8 }}>
                {total} total
              </p>
            )}
          </div>
        </div>
      )}

      <div
        className="card"
        style={{
          marginTop: 12,
          padding: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 13, color: '#444' }}>
          <strong>{readyCount}</strong> ready ·{' '}
          <strong>{needsReviewCount}</strong> needs review ·{' '}
          <strong>{selectedIds.size}</strong> selected
        </div>
        {canImport && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={actionBusy || selectedIds.size === 0 || busy}
            onClick={() => void handleImport()}
          >
            {actionBusy
              ? 'Importing…'
              : `Import ${selectedIds.size || ''} Bid${
                  selectedIds.size === 1 ? '' : 's'
                }`.replace('  ', ' ')}
          </button>
        )}
      </div>
    </div>
  )
}
