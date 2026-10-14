import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type BidCandidateDetail,
  type BidCandidateSummary,
  type BidEmailAnalyzeProgressView,
  type BidFolderDiscoveryItem,
  type BidQuoteStagingSummary,
  type BiddingScopeDetailView,
  type ConnectionSummary,
} from '../api'
import {
  appendBidFolderDiscoveryItems,
  BID_FOLDER_DISCOVERY_PAGE_SIZE,
  bidFolderDiscoveryHasMore,
  bidFolderDiscoveryQueryKey,
} from '../bid-folder-discovery-list'
import {
  BID_EMAIL_SEARCH_HELPER,
  BIDDING_PIPELINE_STAGES,
  CLEAR_ALL_CONFIRM_MESSAGE,
  EMPTY_ANALYSIS_MESSAGE,
  QUOTE_FIRST_WORKFLOW_STEPS,
  SCAN_QUOTES_HELPER,
  biddingPhaseUserLabel,
  biddingPipelineStageState,
  candidateEmailRoleLabel,
  discoveryRoleLabel,
  existingJobMatchLabel,
  originalBidSourceLabel,
} from '../bidding-analysis-ui'

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

function scopeListPreview(c: BidCandidateSummary): string {
  const n = c.scopeItemCount
  if (typeof n === 'number' && n > 0 && c.proposedScopeDetail?.detailedComplete) {
    return `${n} item${n === 1 ? '' : 's'}`
  }
  if (
    c.proposedScope?.trim() &&
    c.proposedScopeDetail?.detailedComplete &&
    !/needs review/i.test(c.proposedScope)
  ) {
    return c.proposedScope
  }
  return 'Needs Review'
}

function bidEmailTableCell(c: BidCandidateSummary): string {
  const src = c.originalBidSource
  if (src === 'NONE' || !src) return 'Not Found'
  return originalBidSourceLabel(src)
}

function ScopeDetailBlock({
  title,
  detail,
  fallback,
}: {
  title: string
  detail?: BiddingScopeDetailView | null
  fallback?: string | null
}) {
  const items = detail?.items ?? []
  const work = detail?.work ?? []
  const exclusions = detail?.exclusions ?? []
  const qualifications = detail?.qualifications ?? []
  const hasStructured =
    items.length > 0 ||
    work.length > 0 ||
    exclusions.length > 0 ||
    qualifications.length > 0

  return (
    <div style={{ marginBottom: 12, fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {detail?.tradeCategory ? (
        <div style={{ color: '#666', marginBottom: 6, fontSize: 12 }}>
          Trade/category: {detail.tradeCategory}
          {!detail.detailedComplete ? ' · detailed scope incomplete' : ''}
        </div>
      ) : null}
      {!detail?.detailedComplete && items.length === 0 ? (
        <div style={{ color: '#b45309', fontSize: 12, marginBottom: 6 }}>
          Scope needs review — specific items were not identified in the available evidence.
        </div>
      ) : null}
      {hasStructured ? (
        <>
          {items.length > 0 ? (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#888', fontSize: 12 }}>Items</div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                {items.map((i) => (
                  <li key={`i-${i.name}`}>
                    {i.name}
                    {i.details ? (
                      <span style={{ color: '#888' }}> — {i.details}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {work.length > 0 ? (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#888', fontSize: 12 }}>
                {items.length === 0 ? 'Work identified' : 'Work'}
              </div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                {work.map((i) => (
                  <li key={`w-${i.name}`}>{i.name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {exclusions.length > 0 ? (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#888', fontSize: 12 }}>Exclusions</div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                {exclusions.map((i) => (
                  <li key={`e-${i.name}`}>
                    {i.name}
                    {i.details ? (
                      <span style={{ color: '#888' }}> — {i.details}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {qualifications.length > 0 ? (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#888', fontSize: 12 }}>Qualifications</div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                {qualifications.map((i) => (
                  <li key={`q-${i.name}`}>
                    {i.name}
                    {i.details ? (
                      <span style={{ color: '#888' }}> — {i.details}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ color: '#666' }}>
          {fallback?.trim() || 'Detailed scope unknown / needs review'}
        </div>
      )}
    </div>
  )
}

function extractionStatusLabel(input: {
  evidence?: unknown
  userEditedFields?: unknown
  matchStatus?: string
}): string | null {
  const edited = Array.isArray(input.userEditedFields)
    ? input.userEditedFields.length > 0
    : false
  if (edited) return 'User Edited'
  const ev =
    input.evidence && typeof input.evidence === 'object'
      ? (input.evidence as Record<string, unknown>)
      : null
  if (ev?.requiresOcr || ev?.pdfTextUnavailable) return 'Needs Review (PDF)'
  if (ev?.aiFailed) return 'Needs Review'
  if (ev?.extractionMethod === 'AI_ENRICHED') return 'AI Extracted'
  if (ev?.extractionMethod === 'DETERMINISTIC') return 'Extracted'
  if (input.matchStatus === 'NEEDS_REVIEW') return 'Needs Review'
  return null
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
 * Scan Quotes → find Bid emails → build Candidates → review → Import.
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
  const [listRole, setListRole] = useState<ListRole>('QUOTE')
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
  const [editScope, setEditScope] = useState('')
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null)
  const [quoteEditName, setQuoteEditName] = useState('')
  const [quoteEditScope, setQuoteEditScope] = useState('')
  const [quoteEditAmount, setQuoteEditAmount] = useState('')
  const [quoteEditNotes, setQuoteEditNotes] = useState('')
  const [quoteEditCandidateId, setQuoteEditCandidateId] = useState('')
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

  const loadCandidates = useCallback(
    async (connId?: string) => {
      const id = connId ?? selectedConnectionId
      if (!id) {
        setCandidates([])
        return
      }
      setLoadingCandidates(true)
      try {
        const res = await api.listBidCandidates(workspaceId, {
          connectionId: id,
          limit: 200,
        })
        setCandidates(res.candidates)
        setSelectedIds((prev) => {
          const next = new Set<string>()
          for (const cid of prev) {
            if (res.candidates.some((c) => c.id === cid && isImportEligible(c))) {
              next.add(cid)
            }
          }
          return next
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load bid candidates')
      } finally {
        setLoadingCandidates(false)
      }
    },
    [selectedConnectionId, workspaceId]
  )

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
        {
          const d = res.candidate.proposedScopeDetail
          const lines = [
            ...(d?.items ?? []).map((i) => i.name),
            ...(d?.work ?? []).map((i) => i.name),
          ]
          setEditScope(
            lines.length
              ? lines.join('\n')
              : res.candidate.proposedScope ?? ''
          )
        }
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
          await loadCandidates(connId)
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
    void loadCandidates(selectedConnectionId)
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

  const startScanQuotes = async () => {
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
      setError(e instanceof Error ? e.message : 'Scan Quotes failed')
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
        scope: editScope.trim() || null,
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

  const rejectQuote = async (quoteId: string) => {
    if (
      !window.confirm(
        'Remove this quote from staging? The source email is kept; Outlook is not changed.'
      )
    ) {
      return
    }
    setActionBusy(true)
    setError('')
    try {
      await api.updateBidQuote(workspaceId, quoteId, { reject: true })
      if (selectedConnectionId) await loadQuotes(selectedConnectionId)
      await loadCandidates()
      setEditingQuoteId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove quote')
    } finally {
      setActionBusy(false)
    }
  }

  const beginEditQuote = (q: BidQuoteStagingSummary) => {
    setEditingQuoteId(q.id)
    setQuoteEditName(q.displayName || q.sourceSubject || '')
    setQuoteEditScope(q.extractedScope || '')
    setQuoteEditAmount(q.extractedAmount != null ? String(q.extractedAmount) : '')
    setQuoteEditNotes(q.extractedNotes || '')
    setQuoteEditCandidateId(q.bidCandidateId || '')
  }

  const saveQuoteEdits = async () => {
    if (!editingQuoteId) return
    const amountRaw = quoteEditAmount.trim()
    let extractedAmount: number | null = null
    if (amountRaw) {
      const cleaned = amountRaw.replace(/[$,\s]/g, '')
      const n = Number(cleaned)
      if (!Number.isFinite(n)) {
        setError('Quote amount must be a valid number')
        return
      }
      extractedAmount = n
    }
    setActionBusy(true)
    setError('')
    try {
      await api.updateBidQuote(workspaceId, editingQuoteId, {
        displayName: quoteEditName.trim() || null,
        extractedScope: quoteEditScope.trim() || null,
        extractedAmount,
        extractedNotes: quoteEditNotes.trim() || null,
        ...(quoteEditCandidateId
          ? { bidCandidateId: quoteEditCandidateId }
          : { unmatch: true }),
      })
      if (selectedConnectionId) await loadQuotes(selectedConnectionId)
      await loadCandidates()
      setEditingQuoteId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update quote')
    } finally {
      setActionBusy(false)
    }
  }

  const handleClearAll = async () => {
    if (!selectedConnectionId) {
      setError('Select a mailbox first')
      return
    }
    if (!window.confirm(CLEAR_ALL_CONFIRM_MESSAGE)) {
      return
    }
    const connId = selectedConnectionId
    setActionBusy(true)
    setError('')
    try {
      // Cancel any in-flight run poll before mutating UI.
      pollGenRef.current += 1
      setBusy(false)
      setBusyKind(null)

      await api.clearBidAnalysis(workspaceId, connId)

      // Only after backend success — reset active analysis UI immediately.
      setProgress(null)
      setRunId(null)
      setRunStatus(null)
      setSelectedIds(new Set())
      setSelectedCandidateId(null)
      setDetail(null)
      setEditing(false)
      setEditingQuoteId(null)
      setItems([])
      setPage(1)
      setTotal(0)
      setHasMore(false)
      discoveryQueryKeyRef.current = ''
      loadMoreLock.current = false
      discoveryReqSeq.current += 1

      // Re-fetch so UI matches server (quotes/discovery empty; CONFIRMED retained
      // in DB but filtered out of the active Bid Candidates list).
      await Promise.all([
        loadCounts(connId),
        loadCandidates(connId),
        loadQuotes(connId),
      ])
      if (mainTab === 'source') {
        await resetAndLoadDiscovery(connId, listRole, sort, search)
      }
    } catch (e) {
      // Do not clear local lists on failure — existing data stays visible.
      setError(e instanceof Error ? e.message : 'Clear All failed')
    } finally {
      setActionBusy(false)
    }
  }

  const rejectCandidateFromRow = async (candidateId: string) => {
    if (
      !window.confirm(
        'Remove this bid candidate from import? Source emails are kept; Outlook is not changed.'
      )
    ) {
      return
    }
    setActionBusy(true)
    setError('')
    try {
      await api.rejectBidCandidate(workspaceId, candidateId)
      await loadCandidates()
      if (selectedCandidateId === candidateId) {
        setSelectedCandidateId(null)
        setDetail(null)
      }
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(candidateId)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove candidate')
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

  const analysisComplete =
    runDone &&
    (progress?.currentPhase === 'READY_FOR_REVIEW' ||
      progress?.currentPhase === 'DONE' ||
      runStatus === 'COMPLETED')

  return (
    <div>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 8px', lineHeight: 1.45 }}>
        Reconstruct historical bids from Quotes: find the original Bid email (Bid Invites
        first, Inbox fallback), build Bid Candidates, check existing Jobs, then Import
        explicitly. Clear Analysis removes reconstructable scan indexes for this
        mailbox only — permanent Bid Candidates and durable Quote links are kept.
      </p>
      <p
        style={{
          fontSize: 12,
          color: '#888',
          margin: '0 0 12px',
          letterSpacing: 0.2,
        }}
      >
        {QUOTE_FIRST_WORKFLOW_STEPS.join(' → ')}
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
            Quote Date Range
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
              Quotes since
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
              onClick={() => void startScanQuotes()}
            >
              {busy && busyKind === 'scan_bids' ? 'Scanning Quotes…' : 'Scan Quotes'}
            </button>
          )}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#888', lineHeight: 1.4 }}>
          {SCAN_QUOTES_HELPER}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888', lineHeight: 1.4 }}>
          {BID_EMAIL_SEARCH_HELPER}
        </p>

        {analysisComplete && !busy && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 10px',
              background: '#e8f5e9',
              borderRadius: 6,
              fontSize: 13,
              color: '#1b5e20',
            }}
          >
            <strong>Analysis Complete</strong>
            {' · '}
            {openCandidates.length} Candidate
            {openCandidates.length === 1 ? '' : 's'} Ready for Review
          </div>
        )}

        {(busy || (progress && !analysisComplete) || (runStatus && busy)) && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#333' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              SCAN QUOTES
              {runStatus ? ` · ${runStatus}` : ''}
              {progress?.currentPhase ? (
                <span style={{ fontWeight: 400, color: '#1565c0', marginLeft: 8 }}>
                  {biddingPhaseUserLabel(progress.currentPhase)}
                </span>
              ) : null}
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
              {BIDDING_PIPELINE_STAGES.map((stage) => {
                const state = biddingPipelineStageState(
                  progress?.currentPhase,
                  stage.phase,
                  runDone
                )
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
                  Quotes Found {progress.quotesFound ?? progress.quotesScanned ?? 0}
                </span>
                <span>
                  Quote Projects {progress.quoteProjectsIdentified ?? 0}
                </span>
                <span>
                  Bid Emails Found {progress.originalBidFromInvites ?? 0}
                </span>
                <span>Inbox Matches {progress.originalBidFromInbox ?? 0}</span>
                <span>
                  Missing Bid Emails {progress.originalBidNotFound ?? 0}
                </span>
                <span>
                  Candidates{' '}
                  {(progress.candidatesCreated ?? 0) +
                    (progress.candidatesUpdated ?? 0)}
                </span>
                <span>
                  Possible Existing Jobs{' '}
                  {(progress.existingJobsPossible ?? 0) +
                    (progress.existingJobsStrong ?? 0)}
                </span>
              </div>
            )}
          </div>
        )}

        {analysisComplete && progress && (
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              fontSize: 12,
              color: '#666',
            }}
          >
            <span>
              Quotes Found {progress.quotesFound ?? progress.quotesScanned ?? 0}
            </span>
            <span>Quote Projects {progress.quoteProjectsIdentified ?? 0}</span>
            <span>
              Bid Emails Found {progress.originalBidFromInvites ?? 0}
            </span>
            <span>Inbox Matches {progress.originalBidFromInbox ?? 0}</span>
            <span>
              Missing Bid Emails {progress.originalBidNotFound ?? 0}
            </span>
            <span>Candidates {openCandidates.length}</span>
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
              <strong style={{ fontSize: 13 }}>
                Bid Candidates ({candidates.length})
              </strong>
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
            <div
              style={{
                borderTop: '1px solid #eee',
                overflow: 'auto',
                maxHeight: 560,
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      background: '#fafafa',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    <th style={{ padding: '8px 10px', width: 36 }} />
                    <th style={{ padding: '8px 10px' }}>Project</th>
                    <th style={{ padding: '8px 10px' }}>Customer / GC</th>
                    <th style={{ padding: '8px 10px' }}>Quote(s)</th>
                    <th style={{ padding: '8px 10px' }}>Bid Email</th>
                    <th style={{ padding: '8px 10px' }}>Due</th>
                    <th style={{ padding: '8px 10px' }}>Scope</th>
                    <th style={{ padding: '8px 10px' }}>Existing Job</th>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                    <th style={{ padding: '8px 10px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.length === 0 && !loadingCandidates && (
                    <tr>
                      <td
                        colSpan={10}
                        style={{ padding: 16, color: '#888', textAlign: 'center' }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          No bidding analysis results
                        </div>
                        <div>{EMPTY_ANALYSIS_MESSAGE}</div>
                      </td>
                    </tr>
                  )}
                  {candidates.map((c) => {
                    const eligible = isImportEligible(c)
                    const selected = selectedIds.has(c.id)
                    const active = selectedCandidateId === c.id
                    const open = !['CONFIRMED', 'REJECTED'].includes(c.status)
                    return (
                      <tr
                        key={c.id}
                        style={{
                          background: active ? '#e3f2fd' : undefined,
                          borderTop: '1px solid #f0f0f0',
                          opacity: c.status === 'REJECTED' ? 0.55 : 1,
                        }}
                      >
                        <td style={{ padding: '8px 10px' }}>
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
                          {c.proposedJobNumber ? (
                            <div style={{ fontSize: 11, color: '#888' }}>
                              #{c.proposedJobNumber}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {c.proposedCustomerName || '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {formatMoney(c.quoteAmount, c.quoteCurrency)}
                          {c.quoteCount > 1 ? (
                            <div style={{ fontSize: 11, color: '#888' }}>
                              {c.quoteCount} quotes
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 12 }}>
                          {bidEmailTableCell(c)}
                          {c.originalBidSource === 'NONE' ? (
                            <div style={{ color: '#b71c1c', fontSize: 11 }}>
                              Needs Review
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {formatDateOnly(c.proposedBidDueAt)}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 12, color: '#555' }}>
                          {scopeListPreview(c)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {existingJobMatchLabel(c.existingJobMatchStatus)}
                          {c.proposedExistingJob ? (
                            <div style={{ fontSize: 11, color: '#666' }}>
                              {c.proposedExistingJob.jobNumber
                                ? `${c.proposedExistingJob.jobNumber} — `
                                : ''}
                              {c.proposedExistingJob.name}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 12 }}>
                          {c.status}
                          {c.importBlockedReason
                            ? ` · ${c.importBlockedReason}`
                            : ''}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: 11, marginRight: 4 }}
                            onClick={() => setSelectedCandidateId(c.id)}
                          >
                            View
                          </button>
                          {open && (
                            <>
                              <button
                                type="button"
                                className="btn"
                                style={{ fontSize: 11, marginRight: 4 }}
                                onClick={() => {
                                  setSelectedCandidateId(c.id)
                                  setEditing(true)
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={{ fontSize: 11 }}
                                disabled={actionBusy}
                                onClick={() => void rejectCandidateFromRow(c.id)}
                              >
                                Remove
                              </button>
                            </>
                          )}
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
                        Scope items (one per line)
                        <textarea
                          value={editScope}
                          onChange={(e) => setEditScope(e.target.value)}
                          rows={4}
                          placeholder={'Beams\nColumns\nSteel stairs\nHandrails'}
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
                      <dt style={{ color: '#888' }}>Customer / GC</dt>
                      <dd style={{ margin: 0 }}>
                        {detail.proposedCustomerName || '—'}
                      </dd>
                      <dt style={{ color: '#888' }}>Project #</dt>
                      <dd style={{ margin: 0 }}>
                        {detail.proposedJobNumber || '—'}
                      </dd>
                      <dt style={{ color: '#888' }}>Bid Due</dt>
                      <dd style={{ margin: 0 }}>
                        {formatDateOnly(detail.proposedBidDueAt)}
                      </dd>
                      <dt style={{ color: '#888' }}>Original Bid Request</dt>
                      <dd style={{ margin: 0 }}>
                        {(() => {
                          const invite = detail.emails?.find(
                            (e) => e.role === 'BID_INVITE' || e.isPrimary
                          )
                          if (!invite?.email?.subject) {
                            return detail.originalBidSource === 'NONE' ||
                              !detail.originalBidSource
                              ? 'Not Found'
                              : '—'
                          }
                          return (
                            <>
                              <div>{invite.email.subject}</div>
                              <div style={{ fontSize: 12, color: '#666' }}>
                                {[
                                  invite.email.senderName ||
                                    invite.email.senderEmail,
                                  formatWhen(
                                    invite.email.receivedAt ||
                                      invite.email.sentAt
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </>
                          )
                        })()}
                      </dd>
                      <dt style={{ color: '#888' }}>Source</dt>
                      <dd style={{ margin: 0 }}>
                        {originalBidSourceLabel(detail.originalBidSource)}
                        {detail.originalBidSource === 'NONE' ? (
                          <span style={{ color: '#b71c1c', marginLeft: 6 }}>
                            Needs Review
                          </span>
                        ) : null}
                      </dd>
                      <dt style={{ color: '#888' }}>Quotes</dt>
                      <dd style={{ margin: 0 }}>
                        {detail.quotes && detail.quotes.length > 0
                          ? detail.quotes.map((q, i) => (
                              <div key={q.id}>
                                {(q.sourceSubject || `Quote ${i + 1}`).replace(
                                  /^RE:\s*/i,
                                  ''
                                )}{' '}
                                — {formatMoney(q.extractedAmount, q.currency)}
                              </div>
                            ))
                          : formatMoney(
                              detail.quoteAmount,
                              detail.quoteCurrency
                            )}
                      </dd>
                      {detail.proposedNotes ? (
                        <>
                          <dt style={{ color: '#888' }}>Notes</dt>
                          <dd style={{ margin: 0 }}>{detail.proposedNotes}</dd>
                        </>
                      ) : null}
                    </dl>
                  )}

                  {!editing ? (
                    <ScopeDetailBlock
                      title="Scope Requested"
                      detail={detail.proposedScopeDetail}
                      fallback={detail.proposedScope}
                    />
                  ) : null}

                  {!editing && detail.quotes && detail.quotes.length > 0 ? (
                    <div style={{ marginBottom: 12 }}>
                      {detail.quotes.map((q, i) => (
                        <ScopeDetailBlock
                          key={q.id}
                          title={`Quote Scope · ${
                            q.sourceSubject || `Quote ${i + 1}`
                          }`}
                          detail={q.extractedScopeDetail}
                          fallback={q.extractedScope}
                        />
                      ))}
                    </div>
                  ) : null}

                  {!editing && detail.emails && detail.emails.length > 0 ? (
                    <div style={{ marginBottom: 12, fontSize: 13 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Source Emails
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {detail.emails.map((link) => (
                          <li key={link.id}>
                            <span style={{ color: '#888' }}>
                              {candidateEmailRoleLabel(link.role)}
                            </span>
                            {' — '}
                            {link.email.subject || '(no subject)'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

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
                      Existing ForgeOps Job ·{' '}
                      {existingJobMatchLabel(detail.existingJobMatchStatus)}
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
                        Remove
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
            <strong style={{ fontSize: 13 }}>Quotes ({quotes.length})</strong>
            {loadingQuotes && (
              <span style={{ fontSize: 12, color: '#888' }}>Loading…</span>
            )}
          </div>
          {editingQuoteId && (
            <div
              style={{
                padding: 12,
                borderBottom: '1px solid #eee',
                background: '#fafafa',
                display: 'grid',
                gap: 8,
                fontSize: 13,
              }}
            >
              <strong>Edit quote (staging only — source email unchanged)</strong>
              <label>
                Display name
                <input
                  value={quoteEditName}
                  onChange={(e) => setQuoteEditName(e.target.value)}
                  style={{ width: '100%', marginTop: 2 }}
                />
              </label>
              <label>
                Scope
                <input
                  value={quoteEditScope}
                  onChange={(e) => setQuoteEditScope(e.target.value)}
                  style={{ width: '100%', marginTop: 2 }}
                />
              </label>
              <label>
                Amount
                <input
                  value={quoteEditAmount}
                  onChange={(e) => setQuoteEditAmount(e.target.value)}
                  placeholder="184500"
                  style={{ width: '100%', marginTop: 2 }}
                />
              </label>
              <label>
                Notes
                <input
                  value={quoteEditNotes}
                  onChange={(e) => setQuoteEditNotes(e.target.value)}
                  style={{ width: '100%', marginTop: 2 }}
                />
              </label>
              <label>
                Bid candidate
                <select
                  value={quoteEditCandidateId}
                  onChange={(e) => setQuoteEditCandidateId(e.target.value)}
                  style={{ width: '100%', marginTop: 2 }}
                >
                  <option value="">Unmatched</option>
                  {openCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.proposedProjectName || c.id}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={actionBusy}
                  onClick={() => void saveQuoteEdits()}
                >
                  Save quote
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditingQuoteId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div style={{ overflow: 'auto', maxHeight: 560 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    background: '#fafafa',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  <th style={{ padding: '8px 10px' }}>Quote / Subject</th>
                  <th style={{ padding: '8px 10px' }}>Scope</th>
                  <th style={{ padding: '8px 10px' }}>Amount</th>
                  <th style={{ padding: '8px 10px' }}>Matched Candidate</th>
                  <th style={{ padding: '8px 10px' }}>Notes / Revision</th>
                  <th style={{ padding: '8px 10px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotes.length === 0 && !loadingQuotes && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ padding: 16, color: '#888', textAlign: 'center' }}
                    >
                      No Quotes yet. {EMPTY_ANALYSIS_MESSAGE}
                    </td>
                  </tr>
                )}
                {quotes.map((q) => (
                  <tr key={q.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 10px' }}>
                      {q.displayName || q.sourceSubject || '—'}
                      {q.displayName && q.sourceSubject && q.displayName !== q.sourceSubject ? (
                        <div style={{ fontSize: 11, color: '#888' }}>
                          Source: {q.sourceSubject}
                        </div>
                      ) : null}
                      {(() => {
                        const label = extractionStatusLabel({
                          evidence: q.extractionEvidence,
                          userEditedFields: q.userEditedFields,
                          matchStatus: q.matchStatus,
                        })
                        return label ? (
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                            {label}
                            {(() => {
                              const ev =
                                q.extractionEvidence &&
                                typeof q.extractionEvidence === 'object'
                                  ? (q.extractionEvidence as {
                                      amountSource?: string
                                      attachmentIds?: string[]
                                    })
                                  : null
                              if (ev?.amountSource === 'PDF_TEXT') {
                                return ' · from PDF'
                              }
                              if (ev?.attachmentIds?.length) {
                                return ` · ${ev.attachmentIds.length} attachment(s)`
                              }
                              return ''
                            })()}
                          </div>
                        ) : null
                      })()}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {(() => {
                        const n =
                          (q.extractedScopeDetail?.items?.length ?? 0) +
                          (q.extractedScopeDetail?.work?.length ?? 0)
                        if (n > 0) return `${n} item${n === 1 ? '' : 's'}`
                        return q.extractedScope || 'Needs Review'
                      })()}
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
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      {onOpenMessage && selectedConnectionId && (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 11, marginRight: 4 }}
                          onClick={() =>
                            onOpenMessage(q.emailMessageId, selectedConnectionId)
                          }
                        >
                          View Email
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11, marginRight: 4 }}
                        onClick={() => beginEditQuote(q)}
                      >
                        Edit
                      </button>
                      {q.matchStatus === 'NEEDS_REVIEW' && q.bidCandidateId ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: 11, marginRight: 4 }}
                          disabled={actionBusy}
                          onClick={() =>
                            void (async () => {
                              if (!selectedConnectionId || !q.bidCandidateId) return
                              setActionBusy(true)
                              setError('')
                              try {
                                await api.updateBidQuote(
                                  workspaceId,
                                  q.id,
                                  { bidCandidateId: q.bidCandidateId }
                                )
                                await loadQuotes(selectedConnectionId)
                                await loadCandidates()
                              } catch (e) {
                                setError(
                                  e instanceof Error ? e.message : 'Confirm failed'
                                )
                              } finally {
                                setActionBusy(false)
                              }
                            })()
                          }
                        >
                          Confirm Match
                        </button>
                      ) : null}
                      {q.bidCandidateId && (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 11, marginRight: 4 }}
                          disabled={actionBusy}
                          onClick={() => void unmatchQuote(q.id)}
                        >
                          Unmatch
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11 }}
                        disabled={actionBusy}
                        onClick={() => void rejectQuote(q.id)}
                      >
                        Remove
                      </button>
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
                  ['QUOTE', `Quotes (${counts.quotes})`],
                  ['BID_INVITE', `Bid Invites (${counts.bidInvites})`],
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
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#888' }}>
            Discovery emails used in this analysis (Quotes first; Bid Invites for
            original request matching).
          </p>
          <div
            ref={listRef}
            onScroll={handleDiscoveryScroll}
            style={{ maxHeight: 420, overflowY: 'auto', fontSize: 13 }}
          >
            {loadingList && items.length === 0 && (
              <p style={{ color: '#888' }}>Loading…</p>
            )}
            {!loadingList && items.length === 0 && (
              <p style={{ color: '#888' }}>
                No source emails yet. {EMPTY_ANALYSIS_MESSAGE}
              </p>
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
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: '#888',
                        marginRight: 6,
                      }}
                    >
                      {discoveryRoleLabel(item.role)}
                    </span>
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canScan && (
            <button
              type="button"
              className="btn"
              disabled={actionBusy || busy || !selectedConnectionId}
              onClick={() => void handleClearAll()}
            >
              Clear All
            </button>
          )}
          {canImport && (
            <div
              style={{
                fontSize: 12,
                color: '#374151',
                maxWidth: 320,
                textAlign: 'right',
                lineHeight: 1.35,
              }}
            >
              Jobs are created from{' '}
              <strong>Bid Candidates → Convert to Job</strong> (review Job
              number and fields). Bulk Import no longer creates Jobs.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
