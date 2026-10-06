import { useEffect, useState, useCallback, useRef } from 'react'
import {
  api,
  type JobDetail,
  type JobEmail,
  type JobTask,
  type JobDocument,
  type JobActivity,
  type JobLookup,
  type JobFileFolder,
  type JobStoredFile,
  type JobLibraryFile,
  type JobSummary,
  type InlineImageRelevanceInfo,
  type JobWorkPackage,
  type JobDocumentControl,
} from '../api'
import type { Breakpoint } from '../hooks/useBreakpoint'
import {
  getCachedJobDetail,
  invalidateJobDetailCache,
  jobDetailShellFromSummary,
  mergeJobDetailAfterUpdate,
  setCachedJobDetail,
} from '../job-detail-cache'
import { invalidateJobsListCache } from '../jobs-list-cache'
import { jobSettingsUpdateBody } from '../job-settings-payload'
import { formatHoursNumber, formatOverviewDate, partyLabel, TOTAL_COST_DISPLAY_LABEL } from '../job-overview-format'
import {
  activityActionTab,
  buildJobAttentionItems,
  formatJobActivityAction,
  formatStatusLabel,
  JOB_CRM_TABS,
  readJobTabFromUrl,
  writeJobTabToUrl,
  type JobCrmTab,
} from '../job-crm-ui'
import { JobConfirmDialog } from '../components/JobCrmModal'
import { FinancialOverviewSummary } from '../components/FinancialOverviewSummary'
import { JobScopeView, WorkPackageOverviewSummary } from './JobScopeView'
import { JobScheduleView, ScheduleOverviewSummary } from './JobScheduleView'
import { JobChangesView, ChangesOverviewSummary } from './JobChangesView'
import { JobProcurementView, ProcurementOverviewSummary } from './JobProcurementView'
import { JobDeliveriesView, DeliveryOverviewSummary } from './JobDeliveriesView'
import { JobBillingView } from './JobBillingView'
import { JobDocumentControlForm, DocumentControlSummary } from '../components/JobDocumentControlForm'
import { FilePreviewModal } from '../components/FilePreviewModal'
import {
  InlineImageRelevanceActions,
  InlineImageRelevanceBadge,
  InlineImageRelevanceDetails,
} from '../components/InlineImageRelevanceMark'
import { JobProjectParties } from '../components/JobProjectParties'
import {
  imageCardBackground,
  imageCardBorder,
  type ImageRelevanceFilter,
  type InlineImageNoiseReason,
} from '../inline-image-relevance'
import {
  canPreviewFile,
  previewFilesFrom,
  previewIndexFor,
  previewKind,
  toPreviewFile,
  type PreviewFile,
} from '../file-preview'

interface Props {
  workspaceId: string
  jobId: string
  userRole: string
  onBack: () => void
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
  breakpoint?: Breakpoint
  /** Optional list-row shell for instant paint before getJob returns. */
  initialJob?: JobSummary | null
}

type Tab = JobCrmTab

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  LEAD: { bg: '#e9ecef', color: '#495057' },
  BIDDING: { bg: '#dbeafe', color: '#1d4ed8' },
  AWARDED: { bg: '#ede9fe', color: '#7c3aed' },
  ACTIVE: { bg: '#dcfce7', color: '#16a34a' },
  ON_HOLD: { bg: '#fef9c3', color: '#a16207' },
  COMPLETE: { bg: '#ccfbf1', color: '#0d9488' },
  ARCHIVED: { bg: '#e9ecef', color: '#6b7280' },
}

const STATUSES = ['BIDDING', 'ACTIVE', 'ON_HOLD', 'COMPLETE']

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_COLORS[status] ?? { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, background: style.bg, color: style.color,
      letterSpacing: 0.2,
    }}>
      {formatStatusLabel(status)}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function LibraryImageThumb({
  src,
  filename,
  onOpen,
  border,
}: {
  src: string
  filename: string
  onOpen: () => void
  border?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <button type="button" onClick={onOpen} title="Preview" style={thumbFallbackStyle}>
        Image
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Preview ${filename}`}
      style={{
        padding: 0, border: border ?? '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
        background: '#f3f4f6', cursor: 'pointer', height: 140, width: '100%',
      }}
    >
      <img
        src={src}
        alt={filename}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }}
      />
    </button>
  )
}

function adjustImageCounts(
  prev: { all: number; relevant: number; noise: number; uncertain: number; notAnalyzed: number },
  before: InlineImageRelevanceInfo | null,
  after: InlineImageRelevanceInfo
) {
  const next = { ...prev }
  if (!before) next.notAnalyzed = Math.max(0, next.notAnalyzed - 1)
  else if (before.relevance === 'RELEVANT') next.relevant = Math.max(0, next.relevant - 1)
  else if (before.relevance === 'NOISE') next.noise = Math.max(0, next.noise - 1)
  else if (before.relevance === 'UNCERTAIN') next.uncertain = Math.max(0, next.uncertain - 1)

  if (after.relevance === 'RELEVANT') next.relevant += 1
  else if (after.relevance === 'NOISE') next.noise += 1
  else if (after.relevance === 'UNCERTAIN') next.uncertain += 1
  return next
}

const thumbFallbackStyle: React.CSSProperties = {
  height: 140, width: '100%', borderRadius: 6, background: '#f8fafc', border: '1px solid #e5e7eb',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 13, fontWeight: 700, color: '#475569', cursor: 'pointer', fontFamily: 'inherit',
}

function Card({ title, children, style: s }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, ...s }}>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>}
      {children}
    </div>
  )
}

function PartyCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{value}</div>
    </div>
  )
}

function MetricCard({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? '#111' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

export function JobDetailView({
  workspaceId,
  jobId,
  userRole,
  onBack,
  onOpenMessage,
  breakpoint = 'desktop',
  initialJob = null,
}: Props) {
  const isPhone = breakpoint === 'phone'
  const [job, setJob] = useState<JobDetail | null>(() => {
    const cached = getCachedJobDetail(workspaceId, jobId)
    if (cached) return cached.job
    if (initialJob && initialJob.id === jobId) return jobDetailShellFromSummary(initialJob)
    return null
  })
  const [loading, setLoading] = useState(() => {
    if (getCachedJobDetail(workspaceId, jobId)) return false
    return !(initialJob && initialJob.id === jobId)
  })
  const [refreshing, setRefreshing] = useState(false)
  const paintLoggedRef = useRef(false)
  const hasShellRef = useRef(job != null)
  const [tab, setTabState] = useState<Tab>(() => readJobTabFromUrl() ?? 'overview')
  const setTab = useCallback((next: Tab) => {
    setTabState(next)
    writeJobTabToUrl(next)
  }, [])
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    confirmPhrase?: string
    confirmPhraseHint?: string
    run: () => Promise<void>
  }>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [emails, setEmails] = useState<JobEmail[]>([])
  const [overviewEmails, setOverviewEmails] = useState<JobEmail[]>([])
  const [emailTotal, setEmailTotal] = useState(0)
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [emailsHasMore, setEmailsHasMore] = useState(false)
  const [emailSearch, setEmailSearch] = useState('')
  const emailScrollRef = useRef<HTMLDivElement | null>(null)
  const emailSentinelRef = useRef<HTMLDivElement | null>(null)
  const emailNextPageRef = useRef(1)
  const emailsLoadingRef = useRef(false)
  const emailsHasMoreRef = useRef(false)
  const emailLoadGenRef = useRef(0)
  const [tasks, setTasks] = useState<JobTask[]>([])
  const [libraryFiles, setLibraryFiles] = useState<JobLibraryFile[]>([])
  const [libraryTotal, setLibraryTotal] = useState(0)
  const [fileTypeFilter, setFileTypeFilter] = useState<
    'ALL' | 'IMAGES' | 'PDF' | 'SPREADSHEETS' | 'DOCUMENTS' | 'OTHER'
  >('ALL')
  const [imageRelevanceFilter, setImageRelevanceFilter] = useState<ImageRelevanceFilter>('ALL')
  const [imageReviewMode, setImageReviewMode] = useState(false)
  const [imageRelevanceCounts, setImageRelevanceCounts] = useState({
    all: 0,
    relevant: 0,
    noise: 0,
    uncertain: 0,
    notAnalyzed: 0,
  })
  const [correctingAttachmentId, setCorrectingAttachmentId] = useState<string | null>(null)
  const [detailsAttachmentId, setDetailsAttachmentId] = useState<string | null>(null)
  const [fileSort, setFileSort] = useState<'newest' | 'oldest' | 'name' | 'type' | 'documentDate'>('newest')
  const [docCategory, setDocCategory] = useState<
    | 'ALL'
    | 'DRAWINGS'
    | 'SHOP_SUBMITTALS'
    | 'RFIS'
    | 'ASI_BULLETIN_ADDENDUM'
    | 'CONTRACTS_POS'
    | 'CHANGE_ORDERS'
    | 'INVOICES'
    | 'DELIVERY'
    | 'OTHER'
  >('ALL')
  const [controlState, setControlState] = useState<'ALL' | 'CURRENT' | 'SUPERSEDED' | 'UNCLASSIFIED'>('ALL')
  const [docSearch, setDocSearch] = useState('')
  const [debouncedDocSearch, setDebouncedDocSearch] = useState('')
  const [classifyingKey, setClassifyingKey] = useState<string | null>(null)
  const [docPackages, setDocPackages] = useState<JobWorkPackage[]>([])
  const [fileFolders, setFileFolders] = useState<JobFileFolder[]>([])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedDocSearch(docSearch.trim()), 250)
    return () => window.clearTimeout(t)
  }, [docSearch])
  const [jobFiles, setJobFiles] = useState<JobStoredFile[]>([])
  const [filePreview, setFilePreview] = useState<{ files: PreviewFile[]; index: number } | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [folderBreadcrumb, setFolderBreadcrumb] = useState<Array<{ id: string; name: string }>>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [activity, setActivity] = useState<JobActivity[]>([])
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotalPages, setActivityTotalPages] = useState(1)

  const [editName, setEditName] = useState('')
  const [editJobNumber, setEditJobNumber] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editTargetDate, setEditTargetDate] = useState('')
  const [editBidDue, setEditBidDue] = useState('')
  const [editTotalCost, setEditTotalCost] = useState('')
  const [editOriginalContractValue, setEditOriginalContractValue] = useState('')
  const [editOriginalEstimatedCost, setEditOriginalEstimatedCost] = useState('')
  const [editSiteName, setEditSiteName] = useState('')
  const [editSiteAddress1, setEditSiteAddress1] = useState('')
  const [editSiteAddress2, setEditSiteAddress2] = useState('')
  const [editSiteCity, setEditSiteCity] = useState('')
  const [editSiteState, setEditSiteState] = useState('')
  const [editSitePostalCode, setEditSitePostalCode] = useState('')
  const [editEstimatorId, setEditEstimatorId] = useState('')
  /** Single Customer UI — persists to both contractorCustomerId and clientCustomerId. */
  const [editCustomerId, setEditCustomerId] = useState('')
  const [partyMembers, setPartyMembers] = useState<Array<{ id: string; name: string | null; email: string }>>([])
  const [partyCustomers, setPartyCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [newAlias, setNewAlias] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const detailEpoch = useRef(0)

  const [moveJobId, setMoveJobId] = useState('')
  const [allJobs, setAllJobs] = useState<JobLookup[]>([])
  const [jobsLookupLoading, setJobsLookupLoading] = useState(false)
  const [showMoveModal, setShowMoveModal] = useState<string | null>(null)

  const canEdit = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'MEMBER'
  const canDeleteJob = userRole === 'OWNER'

  const patchCachedJob = useCallback((patch: Partial<JobDetail>) => {
    setJob((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      setCachedJobDetail(workspaceId, jobId, next)
      return next
    })
  }, [workspaceId, jobId])

  const onScopeEstimatedHoursChange = useCallback((estimatedHours: number) => {
    patchCachedJob({ estimatedHours })
  }, [patchCachedJob])

  const onWorkPackageSummaryChange = useCallback((workPackageSummary: NonNullable<JobDetail['workPackageSummary']>) => {
    patchCachedJob({ workPackageSummary })
  }, [patchCachedJob])

  const onScheduleSummaryChange = useCallback((scheduleSummary: NonNullable<JobDetail['scheduleSummary']>) => {
    patchCachedJob({ scheduleSummary })
  }, [patchCachedJob])

  const onChangesSummaryChange = useCallback((changesSummary: NonNullable<JobDetail['changesSummary']>) => {
    patchCachedJob({ changesSummary })
  }, [patchCachedJob])

  const onProcurementSummaryChange = useCallback((procurementSummary: NonNullable<JobDetail['procurementSummary']>) => {
    patchCachedJob({ procurementSummary })
  }, [patchCachedJob])

  const onDeliverySummaryChange = useCallback((deliverySummary: NonNullable<JobDetail['deliverySummary']>) => {
    patchCachedJob({ deliverySummary })
  }, [patchCachedJob])

  const onBillingSnapshotChange = useCallback((billingSnapshot: JobDetail['billingSnapshot']) => {
    patchCachedJob({ billingSnapshot })
  }, [patchCachedJob])

  const applyJobToEditForm = (j: JobDetail) => {
    setEditName(j.name)
    setEditJobNumber(j.jobNumber ?? '')
    setEditStatus(j.status)
    setEditDescription(j.description ?? '')
    setEditNotes(j.notes ?? '')
    setEditStartDate(j.startDate?.split('T')[0] ?? '')
    setEditTargetDate(j.targetCompletionDate?.split('T')[0] ?? '')
    setEditBidDue(j.bidDueAt?.split('T')[0] ?? '')
    setEditTotalCost(j.totalCost ?? '')
    setEditOriginalContractValue(j.originalContractValue ?? '')
    setEditOriginalEstimatedCost(j.originalEstimatedCost ?? '')
    setEditSiteName(j.siteName ?? '')
    setEditSiteAddress1(j.siteAddress1 ?? '')
    setEditSiteAddress2(j.siteAddress2 ?? '')
    setEditSiteCity(j.siteCity ?? '')
    setEditSiteState(j.siteState ?? '')
    setEditSitePostalCode(j.sitePostalCode ?? '')
    setEditEstimatorId(j.estimatorUserId ?? '')
    setEditCustomerId(j.contractorCustomerId ?? j.clientCustomerId ?? '')
  }

  const loadJob = useCallback(async () => {
    const epoch = detailEpoch.current
    const soft = hasShellRef.current
    if (soft) setRefreshing(true)
    else setLoading(true)
    const t0 = performance.now()
    try {
      const res = await api.getJob(workspaceId, jobId)
      if (epoch !== detailEpoch.current) return
      setJob(res.job)
      setCachedJobDetail(workspaceId, jobId, res.job)
      applyJobToEditForm(res.job)
      hasShellRef.current = true
      if (!paintLoggedRef.current) {
        paintLoggedRef.current = true
        console.info({
          event: 'jobDetailInitialUsefulPaintMs',
          source: 'network',
          ms: Math.round(performance.now() - t0),
        })
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [workspaceId, jobId])

  useEffect(() => {
    const cached = getCachedJobDetail(workspaceId, jobId)
    const shell =
      cached?.job ??
      (initialJob && initialJob.id === jobId ? jobDetailShellFromSummary(initialJob) : null)
    paintLoggedRef.current = false
    hasShellRef.current = shell != null
    setJob(shell)
    setLoading(shell == null)
    setTab('overview')
    if (shell) {
      applyJobToEditForm(shell)
      paintLoggedRef.current = true
      console.info({
        event: 'jobDetailInitialUsefulPaintMs',
        source: cached ? 'cache' : 'shell',
        ms: 0,
      })
    }
    void loadJob()
    // initialJob read on navigate; omit from deps to avoid re-fetch loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, jobId, loadJob])

  // Defer jobs lookup until move-email modal opens
  useEffect(() => {
    if (!showMoveModal) return
    if (allJobs.length > 0 || jobsLookupLoading) return
    setJobsLookupLoading(true)
    api.getJobsLookup(workspaceId, { showArchived: false })
      .then(r => setAllJobs(r.jobs))
      .catch(() => {})
      .finally(() => setJobsLookupLoading(false))
  }, [showMoveModal, workspaceId, allJobs.length, jobsLookupLoading])

  useEffect(() => {
    if (tab === 'documents') {
      api.getJobEmails(workspaceId, jobId, 1, 20)
        .then(r => setOverviewEmails(r.emails))
        .catch(() => setOverviewEmails([]))
    }
  }, [tab, workspaceId, jobId])

  useEffect(() => {
    if (tab !== 'settings') return
    api.getJobPartyOptions(workspaceId)
      .then(r => {
        setPartyMembers(r.members)
        setPartyCustomers(r.customers)
      })
      .catch(() => {})
  }, [tab, workspaceId])

  const applyEmailPage = useCallback((page: number, incoming: JobEmail[], totalPages: number, totalCount: number, replace: boolean) => {
    setEmails(prev => {
      if (replace) return incoming
      const seen = new Set(prev.map(email => email.id))
      return [...prev, ...incoming.filter(email => !seen.has(email.id))]
    })
    setEmailTotal(totalCount)
    emailNextPageRef.current = page + 1
    const more = page < totalPages
    emailsHasMoreRef.current = more
    setEmailsHasMore(more)
  }, [])

  const loadMoreEmails = useCallback(async () => {
    if (emailsLoadingRef.current || !emailsHasMoreRef.current) return
    const gen = emailLoadGenRef.current
    const page = emailNextPageRef.current
    emailsLoadingRef.current = true
    setEmailsLoading(true)
    try {
      const result = await api.getJobEmails(workspaceId, jobId, page, 25)
      if (gen !== emailLoadGenRef.current) return
      applyEmailPage(page, result.emails, result.pagination.totalPages, result.pagination.totalCount, false)
    } catch {
      /* keep the rows already shown */
    } finally {
      if (gen === emailLoadGenRef.current) {
        emailsLoadingRef.current = false
        setEmailsLoading(false)
      }
    }
  }, [applyEmailPage, workspaceId, jobId])

  useEffect(() => {
    if (tab !== 'emails') return
    const gen = ++emailLoadGenRef.current
    emailsLoadingRef.current = true
    emailsHasMoreRef.current = false
    emailNextPageRef.current = 1
    setEmails([])
    setEmailTotal(0)
    setEmailsHasMore(false)
    setEmailsLoading(true)
    let cancelled = false
    api.getJobEmails(workspaceId, jobId, 1, 25)
      .then(result => {
        if (cancelled || gen !== emailLoadGenRef.current) return
        applyEmailPage(1, result.emails, result.pagination.totalPages, result.pagination.totalCount, true)
      })
      .catch(() => {
        if (cancelled || gen !== emailLoadGenRef.current) return
        setEmails([])
        setEmailsHasMore(false)
        emailsHasMoreRef.current = false
      })
      .finally(() => {
        if (cancelled || gen !== emailLoadGenRef.current) return
        emailsLoadingRef.current = false
        setEmailsLoading(false)
      })
    return () => { cancelled = true }
  }, [tab, workspaceId, jobId, applyEmailPage])

  useEffect(() => {
    if (tab !== 'emails') return
    const root = emailScrollRef.current
    const sentinel = emailSentinelRef.current
    if (!root || !sentinel) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreEmails()
    }, { root, rootMargin: '160px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [tab, emails.length, emailsHasMore, loadMoreEmails])

  useEffect(() => {
    if (tab === 'tasks') {
      api.getJobTasks(workspaceId, jobId).then(r => setTasks(r.tasks)).catch(() => {})
    }
  }, [tab, workspaceId, jobId])

  const loadJobFiles = useCallback(async (folderId: string | null = null) => {
    setFilesLoading(true)
    setFileError(null)
    try {
      const [filesRes, emailDocs] = await Promise.all([
        api.getJobFiles(workspaceId, jobId, folderId),
        folderId
          ? Promise.resolve({
              files: [] as JobLibraryFile[],
              documents: [] as JobDocument[],
              pagination: { page: 1, pageSize: 100, totalCount: 0, totalPages: 1 },
              filters: { type: 'ALL', sort: 'newest', imageRelevance: 'ALL' },
              imageRelevanceCounts: {
                all: 0,
                relevant: 0,
                noise: 0,
                uncertain: 0,
                notAnalyzed: 0,
              },
            })
          : api
              .getJobDocuments(workspaceId, jobId, {
                type: fileTypeFilter,
                sort: fileSort,
                pageSize: 200,
                imageRelevance: imageRelevanceFilter,
                docCategory,
                controlState,
                q: debouncedDocSearch || undefined,
              })
              .catch(() => ({
                files: [] as JobLibraryFile[],
                documents: [] as JobDocument[],
                pagination: { page: 1, pageSize: 100, totalCount: 0, totalPages: 1 },
                filters: { type: 'ALL', sort: 'newest', imageRelevance: 'ALL' },
                imageRelevanceCounts: {
                  all: 0,
                  relevant: 0,
                  noise: 0,
                  uncertain: 0,
                  notAnalyzed: 0,
                },
              })),
      ])
      setFileFolders(filesRes.folders)
      setJobFiles(filesRes.files)
      setFolderBreadcrumb(filesRes.breadcrumb)
      setCurrentFolderId(filesRes.folderId)
      if (!folderId) {
        setLibraryFiles(emailDocs.files ?? [])
        setLibraryTotal(emailDocs.pagination?.totalCount ?? emailDocs.files?.length ?? 0)
        if (emailDocs.imageRelevanceCounts) {
          setImageRelevanceCounts(emailDocs.imageRelevanceCounts)
        }
        void api.getJobScope(workspaceId, jobId).then((scope) => {
          setDocPackages(scope.packages)
        }).catch(() => {
          setDocPackages([])
        })
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      setFilesLoading(false)
    }
  }, [workspaceId, jobId, fileTypeFilter, fileSort, imageRelevanceFilter, docCategory, controlState, debouncedDocSearch])

  const correctLibraryImageRelevance = useCallback(async (
    attachmentId: string,
    body: { relevance: 'RELEVANT' | 'NOISE'; noiseReason?: InlineImageNoiseReason | null }
  ) => {
    const before =
      libraryFiles.find((f) => f.id === attachmentId)?.imageRelevance ?? null
    setCorrectingAttachmentId(attachmentId)
    setFileError(null)
    try {
      const res = await api.correctInlineImageRelevance(workspaceId, attachmentId, body)
      const next = res.classification
      setLibraryFiles((prev) =>
        prev.map((file) =>
          file.id === attachmentId && file.sourceType === 'EMAIL_ATTACHMENT'
            ? { ...file, imageRelevance: next }
            : file
        )
      )
      setImageRelevanceCounts((counts) => adjustImageCounts(counts, before, next))
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Failed to save image review')
    } finally {
      setCorrectingAttachmentId(null)
    }
  }, [workspaceId, libraryFiles])

  useEffect(() => {
    if (tab === 'documents') {
      void loadJobFiles(null)
    }
  }, [tab, workspaceId, jobId, loadJobFiles])

  useEffect(() => {
    if (tab === 'activity') {
      api.getJobActivity(workspaceId, jobId, activityPage).then(r => {
        setActivity(r.activity)
        setActivityTotalPages(r.pagination.totalPages)
      }).catch(() => {})
    }
  }, [tab, workspaceId, jobId, activityPage])

  const handleSave = async () => {
    if (!canEdit) return
    detailEpoch.current += 1
    setSaving(true)
    setSaveError(null)
    try {
      const res = await api.updateJob(workspaceId, jobId, jobSettingsUpdateBody({
        name: editName,
        jobNumber: editJobNumber,
        status: editStatus,
        description: editDescription,
        notes: editNotes,
        startDate: editStartDate,
        targetCompletionDate: editTargetDate,
        bidDueDate: editBidDue,
        totalCost: editTotalCost,
        originalContractValue: editOriginalContractValue,
        originalEstimatedCost: editOriginalEstimatedCost,
        estimatorUserId: editEstimatorId,
        contractorCustomerId: editCustomerId,
        clientCustomerId: editCustomerId,
        siteName: editSiteName,
        siteAddress1: editSiteAddress1,
        siteAddress2: editSiteAddress2,
        siteCity: editSiteCity,
        siteState: editSiteState,
        sitePostalCode: editSitePostalCode,
      }))
      setJob((prev) => {
        if (!prev) return prev
        const next = mergeJobDetailAfterUpdate(prev, res.job)
        setCachedJobDetail(workspaceId, jobId, next)
        return next
      })
      invalidateJobsListCache(workspaceId)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save job')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveFromBidding = () => {
    setConfirmAction({
      title: 'Remove from bidding',
      message: 'Remove this project from active bidding? The project, emails, and tasks stay. The status becomes Lead.',
      confirmLabel: 'Remove from bidding',
      danger: true,
      run: async () => {
        await api.removeJobFromBidding(workspaceId, jobId)
        invalidateJobDetailCache(workspaceId, jobId)
        loadJob()
      },
    })
  }

  const handleArchive = async () => {
    if (!job) return
    if (job.archivedAt) {
      await api.restoreJob(workspaceId, jobId)
    } else {
      await api.archiveJob(workspaceId, jobId)
    }
    invalidateJobDetailCache(workspaceId, jobId)
    invalidateJobsListCache(workspaceId)
    loadJob()
  }

  const handleDeleteJob = () => {
    if (!job || !canDeleteJob) return
    setDeleteError(null)
    const jobLabel = [job.jobNumber, job.name].filter(Boolean).join(' · ') || job.name
    setConfirmAction({
      title: 'Delete Job',
      message:
        `Permanently delete ${jobLabel}?\n\n` +
        'This removes Job-owned project records (scope, schedule, changes, procurement, deliveries, billing, uploaded files, activity).\n\n' +
        'Emails, Customers, Vendors, and other shared records are not deleted. Assigned emails become Unassigned.',
      confirmLabel: 'Delete Job',
      danger: true,
      confirmPhrase: 'DELETE',
      confirmPhraseHint: 'Type DELETE to confirm permanent deletion',
      run: async () => {
        try {
          await api.deleteJob(workspaceId, jobId)
          invalidateJobDetailCache(workspaceId, jobId)
          invalidateJobsListCache(workspaceId)
          onBack()
        } catch (e) {
          setDeleteError(e instanceof Error ? e.message : 'Could not delete Job')
          throw e
        }
      },
    })
  }

  const handleAddAlias = async () => {
    if (!newAlias.trim()) return
    await api.addJobAlias(workspaceId, jobId, newAlias.trim())
    setNewAlias('')
    invalidateJobDetailCache(workspaceId, jobId)
    loadJob()
  }

  const handleRemoveAlias = async (aliasId: string) => {
    await api.removeJobAlias(workspaceId, jobId, aliasId)
    invalidateJobDetailCache(workspaceId, jobId)
    loadJob()
  }

  const handleRemoveMember = async (userId: string) => {
    await api.removeJobMember(workspaceId, jobId, userId)
    invalidateJobDetailCache(workspaceId, jobId)
    loadJob()
  }

  const handleRemoveEmail = async (messageId: string) => {
    await api.removeEmailFromJob(workspaceId, jobId, messageId)
    setEmails(prev => prev.filter(e => e.id !== messageId))
    setEmailTotal(total => Math.max(0, total - 1))
  }

  const handleDeleteEmail = (messageId: string) => {
    setConfirmAction({
      title: 'Delete email from ForgeOps',
      message:
        'Delete this email from ForgeOps? The job stays. Other emails on this job stay. This does not delete the message from Outlook.',
      confirmLabel: 'Delete email',
      danger: true,
      run: async () => {
        await api.deleteJobEmail(workspaceId, jobId, messageId)
        setEmails((prev) => prev.filter((e) => e.id !== messageId))
        setOverviewEmails((prev) => prev.filter((e) => e.id !== messageId))
        setEmailTotal((total) => Math.max(0, total - 1))
      },
    })
  }

  const handleMoveEmail = async (messageId: string) => {
    if (!moveJobId) return
    try {
      await api.moveEmailToJob(workspaceId, jobId, { messageId, targetJobId: moveJobId })
      setEmails(prev => prev.filter(e => e.id !== messageId))
      setEmailTotal(total => Math.max(0, total - 1))
      setShowMoveModal(null)
      setMoveJobId('')
    } catch { /* ignore */ }
  }

  const openThread = (messageId: string, inboxConnectionId: string) => {
    if (!inboxConnectionId || !onOpenMessage) return
    onOpenMessage(messageId, inboxConnectionId)
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !canEdit) return
    setFileBusy(true)
    setFileError(null)
    try {
      await api.createJobFolder(workspaceId, jobId, {
        name: newFolderName.trim(),
        parentFolderId: currentFolderId,
      })
      setNewFolderName('')
      setShowNewFolder(false)
      await loadJobFiles(currentFolderId)
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Failed to create folder')
    } finally {
      setFileBusy(false)
    }
  }

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !canEdit) return
    setFileBusy(true)
    setFileError(null)
    try {
      for (const file of Array.from(fileList)) {
        await api.uploadJobFile(workspaceId, jobId, file, currentFolderId)
      }
      await loadJobFiles(currentFolderId)
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setFileBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteFolder = (folderId: string, name: string) => {
    if (!canEdit) return
    setConfirmAction({
      title: 'Delete folder',
      message: `Delete folder “${name}” and everything inside it? Files in this folder will be removed from the job library.`,
      confirmLabel: 'Delete folder',
      danger: true,
      run: async () => {
        setFileBusy(true)
        try {
          await api.deleteJobFolder(workspaceId, jobId, folderId)
          await loadJobFiles(currentFolderId)
        } catch (e) {
          setFileError(e instanceof Error ? e.message : 'Failed to delete folder')
        } finally {
          setFileBusy(false)
        }
      },
    })
  }

  const handleDeleteFile = (fileId: string, filename: string) => {
    if (!canEdit) return
    setConfirmAction({
      title: 'Delete file',
      message: `Delete “${filename}” from this job’s document library? Structured document control metadata for this file will also be removed.`,
      confirmLabel: 'Delete file',
      danger: true,
      run: async () => {
        setFileBusy(true)
        try {
          await api.deleteJobFile(workspaceId, jobId, fileId)
          await loadJobFiles(currentFolderId)
        } catch (e) {
          setFileError(e instanceof Error ? e.message : 'Failed to delete file')
        } finally {
          setFileBusy(false)
        }
      },
    })
  }

  const handleMoveFileToRoot = async (fileId: string) => {
    if (!canEdit || !currentFolderId) return
    setFileBusy(true)
    try {
      await api.updateJobFile(workspaceId, jobId, fileId, { folderId: null })
      await loadJobFiles(currentFolderId)
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Failed to move file')
    } finally {
      setFileBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#888' }}>Loading job...</div>
  }

  if (!job) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#888' }}>Job not found.</div>
  }

  const attentionItems = buildJobAttentionItems({
    overdueMilestoneCount: job.scheduleSummary?.overdueCount,
    overdueRfiCount: job.changesSummary?.overdueRfiCount,
    procurementAtRiskCount: job.procurementSummary?.atRiskCount,
    lateDeliveryCount: job.deliverySummary?.lateCount,
    billingExceedsKnownContract: job.billingSnapshot?.billingExceedsKnownContract,
  })

  const filteredEmails = emailSearch
    ? emails.filter(e =>
        (e.subject ?? '').toLowerCase().includes(emailSearch.toLowerCase()) ||
        (e.senderName ?? '').toLowerCase().includes(emailSearch.toLowerCase()) ||
        e.senderEmail.toLowerCase().includes(emailSearch.toLowerCase())
      )
    : emails

  const members = job.members ?? []
  const aliases = job.aliases ?? []
  const openTasks = tasks.filter(t => t.status === 'OPEN' || t.status === 'IN_PROGRESS' || t.status === 'BLOCKED')
  const completedTasks = tasks.filter(t => t.status === 'DONE')
  const cancelledTasks = tasks.filter(t => t.status === 'CANCELLED')

  return (
    <div style={{ padding: isPhone ? 12 : 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', marginBottom: 8, padding: 0, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
          &larr; Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {job.jobNumber && (
            <span style={{ fontSize: 13, color: '#6b7280', fontFamily: 'monospace', fontWeight: 600 }}>
              #{job.jobNumber}
            </span>
          )}
          <h2 style={{ margin: 0, fontSize: isPhone ? 18 : 22, fontWeight: 700 }}>{job.name}</h2>
          <StatusBadge status={job.status} />
          {job.status === 'BIDDING' && canEdit && (
            <button
              type="button"
              onClick={() => void handleRemoveFromBidding()}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
            >
              Remove from Bidding
            </button>
          )}
          {job.archivedAt && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>ARCHIVED</span>}
          {refreshing && <span style={{ fontSize: 11, color: '#9ca3af' }}>Updating…</span>}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: isPhone ? 10 : 20, flexWrap: 'wrap', fontSize: 13, color: '#374151' }}>
          <span>
            <span style={{ color: '#6b7280' }}>Start</span>{' '}
            <strong>{formatOverviewDate(job.startDate)}</strong>
          </span>
          <span>
            <span style={{ color: '#6b7280' }}>Target</span>{' '}
            <strong>{formatOverviewDate(job.targetCompletionDate)}</strong>
          </span>
          {job.status === 'BIDDING' && (
            <span>
              <span style={{ color: '#6b7280' }}>Bid due</span>{' '}
              <strong>{formatOverviewDate(job.bidDueAt)}</strong>
            </span>
          )}
        </div>
        <div style={{
          marginTop: 12,
          display: 'grid',
          gridTemplateColumns: isPhone ? '1fr 1fr' : 'repeat(3, minmax(0, 1fr))',
          gap: 8,
        }}>
          <PartyCard label="Estimator" value={partyLabel(job.estimatorName)} />
          <PartyCard
            label="Project Manager"
            value={partyLabel(job.projectManager?.name ?? null)}
          />
          <PartyCard
            label="Customer"
            value={partyLabel(job.contractorName ?? job.clientName)}
          />
        </div>
      </div>

      {/* Tabs — full Job module strip (scrolls horizontally when needed) */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 20, overflowX: 'auto', WebkitOverflowScrolling: 'touch' as never, flexShrink: 0 }}>
        {JOB_CRM_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: isPhone ? '10px 12px' : '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#1a1a2e' : '#6b7280',
              borderBottom: tab === t.key ? '2px solid #1a1a2e' : '2px solid transparent',
              marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab — headline metrics → attention → ops → commercial → parties */}
      {tab === 'overview' && (
        <div>
          <div
            data-testid="job-overview-headline-metrics"
            style={{
              display: 'grid',
              gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(3, minmax(0, 1fr))',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <MetricCard label="Emails" value={job.emailCount.toLocaleString('en-US')} />
            <MetricCard
              label="Open Tasks"
              value={job.openTaskCount.toLocaleString('en-US')}
              hint={job.overdueTaskCount > 0 ? `${job.overdueTaskCount} overdue` : undefined}
              accent={job.openTaskCount > 0 ? '#2563eb' : undefined}
            />
            <MetricCard
              label="Estimated Hours"
              value={job.estimatedHours == null ? 'Not set' : formatHoursNumber(job.estimatedHours)}
            />
          </div>

          {attentionItems.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Needs attention ({attentionItems.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {attentionItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.tab)}
                    style={{
                      textAlign: 'left',
                      background: item.tone === 'danger' ? '#fef2f2' : '#fffbeb',
                      border: '1px solid #f3f4f6',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 13,
                      color: item.tone === 'danger' ? '#b91c1c' : '#92400e',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {item.label} →
                  </button>
                ))}
              </div>
            </div>
          )}

          {(job.description || job.externalRef || job.notes) && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Project summary
              </div>
              {job.description && (
                <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', marginBottom: job.externalRef || job.notes ? 10 : 0 }}>
                  {job.description}
                </div>
              )}
              {job.externalRef && (
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: job.notes ? 6 : 0 }}>
                  External ref: <strong style={{ color: '#111' }}>{job.externalRef}</strong>
                </div>
              )}
              {job.notes && (
                <div style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'pre-wrap' }}>
                  Notes: {job.notes}
                </div>
              )}
            </div>
          )}

          <WorkPackageOverviewSummary summary={job.workPackageSummary} />

          <ScheduleOverviewSummary
            summary={job.scheduleSummary}
            onViewSchedule={() => setTab('schedule')}
          />

          <ChangesOverviewSummary
            summary={job.changesSummary}
            onViewChanges={() => setTab('changes')}
          />

          <ProcurementOverviewSummary
            summary={job.procurementSummary}
            onViewProcurement={() => setTab('procurement')}
          />

          <DeliveryOverviewSummary
            summary={job.deliverySummary}
            onViewDeliveries={() => setTab('deliveries')}
          />

          <FinancialOverviewSummary
            snapshot={job.financialSnapshot}
            billingSnapshot={job.billingSnapshot}
            onViewChanges={() => setTab('changes')}
            onViewProcurement={() => setTab('procurement')}
            onViewBilling={() => setTab('billing')}
          />

          <JobProjectParties
            workspaceId={workspaceId}
            jobId={jobId}
            participants={job.participants ?? []}
            canEdit={canEdit}
            isPhone={isPhone}
            onChange={(participants) => {
              setJob((prev) => {
                if (!prev) return prev
                const projectManager =
                  participants.find((p) => p.role === 'PROJECT_MANAGER' && p.isPrimary) ??
                  participants.find((p) => p.role === 'PROJECT_MANAGER') ??
                  null
                const next = { ...prev, participants, projectManager }
                setCachedJobDetail(workspaceId, jobId, next)
                return next
              })
            }}
          />
        </div>
      )}

      {tab === 'scope' && (
        <JobScopeView
          workspaceId={workspaceId}
          jobId={jobId}
          canEdit={canEdit}
          isPhone={isPhone}
          onEstimatedHoursChange={onScopeEstimatedHoursChange}
          onSummaryChange={onWorkPackageSummaryChange}
        />
      )}

      {tab === 'schedule' && (
        <JobScheduleView
          workspaceId={workspaceId}
          jobId={jobId}
          canEdit={canEdit}
          isPhone={isPhone}
          onSummaryChange={onScheduleSummaryChange}
        />
      )}

      {tab === 'changes' && (
        <JobChangesView
          workspaceId={workspaceId}
          jobId={jobId}
          canEdit={canEdit}
          isPhone={isPhone}
          onSummaryChange={onChangesSummaryChange}
        />
      )}

      {tab === 'procurement' && (
        <JobProcurementView
          workspaceId={workspaceId}
          jobId={jobId}
          canEdit={canEdit}
          isPhone={isPhone}
          onSummaryChange={onProcurementSummaryChange}
        />
      )}

      {tab === 'deliveries' && (
        <JobDeliveriesView
          workspaceId={workspaceId}
          jobId={jobId}
          canEdit={canEdit}
          isPhone={isPhone}
          onSummaryChange={onDeliverySummaryChange}
        />
      )}

      {tab === 'billing' && (
        <JobBillingView
          workspaceId={workspaceId}
          jobId={jobId}
          canEdit={canEdit}
          isPhone={isPhone}
          onSnapshotChange={onBillingSnapshotChange}
        />
      )}

      {/* Emails Tab */}
      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search emails..."
              value={emailSearch}
              onChange={e => setEmailSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
            />
          </div>
          {emailTotal > 0 && (
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              {emails.length} loaded · {emailTotal} on this job
            </div>
          )}
          {emails.length === 0 && !emailsLoading ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 14 }}>No emails assigned to this job.</div>
          ) : (
            <>
              <div
                ref={emailScrollRef}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  maxHeight: isPhone ? '62vh' : 'min(640px, calc(100vh - 280px))',
                  overflowY: 'auto',
                }}
              >
                {emails.length === 0 && emailsLoading && (
                  <div style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>Loading emails…</div>
                )}
                {emails.length > 0 && filteredEmails.length === 0 && !emailsHasMore && (
                  <div style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>No emails match that search.</div>
                )}
                {filteredEmails.map((email, i) => (
                  <div
                    key={email.id}
                    onClick={() => openThread(email.id, email.inboxConnectionId)}
                    style={{
                      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                      borderBottom: i < filteredEmails.length - 1 ? '1px solid #f0f0f0' : undefined,
                      cursor: onOpenMessage ? 'pointer' : 'default',
                    }}
                    onMouseOver={e => { if (onOpenMessage) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseOut={e => { e.currentTarget.style.background = '' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {email.subject ?? '(no subject)'}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {email.senderName ?? email.senderEmail} &middot; {formatDateTime(email.sentAt)}
                      </div>
                    </div>
                    {email.jobAssignmentSource && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: email.jobAssignmentIsManual ? '#dbeafe' : '#f3f4f6',
                        color: email.jobAssignmentIsManual ? '#1d4ed8' : '#6b7280'
                      }}>
                        {email.jobAssignmentSource}
                      </span>
                    )}
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setShowMoveModal(email.id); setMoveJobId('') }}
                          style={{ background: 'none', border: '1px solid #d0d5dd', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#555', padding: '3px 8px' }}
                          title="Move to another job"
                        >
                          Move
                        </button>
                        <button
                          onClick={() => handleRemoveEmail(email.id)}
                          style={{ background: 'none', border: '1px solid #d0d5dd', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#555', padding: '3px 8px' }}
                          title="Unassign this email. It stays in ForgeOps."
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => void handleDeleteEmail(email.id)}
                          style={{ background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#c62828', padding: '3px 8px', fontWeight: 600 }}
                          title="Delete this email from ForgeOps. The job and Outlook message stay."
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={emailSentinelRef} style={{ height: 1 }} />
                {emailsLoading && emails.length > 0 && (
                  <div style={{ textAlign: 'center', padding: 12, color: '#9ca3af', fontSize: 12 }}>Loading more…</div>
                )}
              </div>
            </>
          )}

          {/* Move email modal */}
          {showMoveModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isPhone ? 16 : 0 }}>
              <div style={{ width: isPhone ? '100%' : 400, maxWidth: '100vw', background: '#fff', borderRadius: isPhone ? 8 : 10, padding: isPhone ? 16 : 24, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
                <h4 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600 }}>Move Email to Another Job</h4>
                <select
                  value={moveJobId}
                  onChange={e => setMoveJobId(e.target.value)}
                  disabled={jobsLookupLoading}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, marginBottom: 14 }}
                >
                  <option value="">
                    {jobsLookupLoading ? 'Loading jobs…' : 'Select target job...'}
                  </option>
                  {allJobs.filter(j => j.id !== jobId).map(j => (
                    <option key={j.id} value={j.id}>
                      {j.jobNumber ? `${j.jobNumber} — ${j.name}` : j.name}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setShowMoveModal(null)} style={{ padding: '6px 14px', border: '1px solid #d0d5dd', borderRadius: 5, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={() => handleMoveEmail(showMoveModal)} disabled={!moveJobId} style={{ padding: '6px 14px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: moveJobId ? 1 : 0.5 }}>Move</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tasks Tab */}
      {tab === 'tasks' && (
        <div>
          {tasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 14 }}>No tasks linked to this job.</div>
          ) : (
            <div>
              {openTasks.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Open ({openTasks.length})</div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Title</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Priority</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openTasks.map(task => (
                          <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500 }}>{task.title}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                                background: task.status === 'IN_PROGRESS' ? '#dbeafe' : task.status === 'BLOCKED' ? '#fef9c3' : '#f3f4f6',
                                color: task.status === 'IN_PROGRESS' ? '#1d4ed8' : task.status === 'BLOCKED' ? '#a16207' : '#374151'
                              }}>
                                {task.status}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {/* TEMP: hide priority tag visually */}
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: task.dueAt && new Date(task.dueAt) < new Date() ? '#dc2626' : '#6b7280' }}>
                              {formatDate(task.dueAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {completedTasks.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>Completed ({completedTasks.length})</div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {completedTasks.map(task => (
                          <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500, color: '#6b7280', textDecoration: 'line-through' }}>{task.title}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: '#dcfce7', color: '#16a34a' }}>DONE</span>
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: '#6b7280' }}>{formatDate(task.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {cancelledTasks.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>Cancelled ({cancelledTasks.length})</div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {cancelledTasks.map(task => (
                          <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500, color: '#9ca3af', textDecoration: 'line-through' }}>{task.title}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: '#f3f4f6', color: '#6b7280' }}>CANCELLED</span>
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>{formatDate(task.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => loadJobFiles(null)}
              style={{
                background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: currentFolderId ? 500 : 700,
                color: currentFolderId ? '#1565c0' : '#111', cursor: 'pointer',
              }}
            >
              Job files
            </button>
            {folderBreadcrumb.map(crumb => (
              <span key={crumb.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: '#d1d5db' }}>/</span>
                <button
                  type="button"
                  onClick={() => loadJobFiles(crumb.id)}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontWeight: currentFolderId === crumb.id ? 700 : 500,
                    color: currentFolderId === crumb.id ? '#111' : '#1565c0',
                  }}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
            <div style={{ flex: 1 }} />
            {canEdit && (
              <>
                <button
                  type="button"
                  disabled={fileBusy}
                  onClick={() => setShowNewFolder(v => !v)}
                  style={{
                    padding: '6px 12px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff',
                    fontSize: 12, fontWeight: 600, cursor: fileBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  New folder
                </button>
                <button
                  type="button"
                  disabled={fileBusy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '6px 12px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#1a1a2e',
                    color: '#fff', fontSize: 12, fontWeight: 600, cursor: fileBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  Upload
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.pptx,.rtf,.xml,.zip"
                  style={{ display: 'none' }}
                  onChange={e => handleUploadFiles(e.target.files)}
                />
              </>
            )}
          </div>
          {canEdit && (
            <p style={{ fontSize: 11, color: '#999', margin: '0 0 12px' }}>
              Supported office files are stored and parsed for text/tables; ZIP is kept as a container only.
            </p>
          )}

          {showNewFolder && canEdit && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <input
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') void handleCreateFolder() }}
                style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
              />
              <button
                type="button"
                disabled={fileBusy || !newFolderName.trim()}
                onClick={() => void handleCreateFolder()}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: 'none', background: '#1565c0', color: '#fff',
                  fontSize: 12, fontWeight: 600, cursor: fileBusy || !newFolderName.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => { setShowNewFolder(false); setNewFolderName('') }}
                style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}

          {fileError && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: '#fce4ec', color: '#c62828', fontSize: 13 }}>
              {fileError}
            </div>
          )}

          {filesLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading files…</div>
          ) : (
            <>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
                {fileFolders.length === 0 && jobFiles.length === 0 ? (
                  <div style={{ padding: 36, textAlign: 'center', color: '#888', fontSize: 13 }}>
                    {canEdit
                      ? 'No files here yet. Upload documents or create a folder to organize them.'
                      : 'No files in this folder.'}
                  </div>
                ) : (
                  <>
                    {fileFolders.map((folder, i) => (
                      <div
                        key={folder.id}
                        style={{
                          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                          borderBottom: (i < fileFolders.length - 1 || jobFiles.length > 0) ? '1px solid #f0f0f0' : undefined,
                          cursor: 'pointer',
                        }}
                        onClick={() => void loadJobFiles(folder.id)}
                        onMouseOver={e => { e.currentTarget.style.background = '#f8fafc' }}
                        onMouseOut={e => { e.currentTarget.style.background = '' }}
                      >
                        <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>📁</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{folder.name}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                            {folder.fileCount} file{folder.fileCount !== 1 ? 's' : ''}
                            {folder.childFolderCount > 0 && ` · ${folder.childFolderCount} folder${folder.childFolderCount !== 1 ? 's' : ''}`}
                          </div>
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            disabled={fileBusy}
                            onClick={e => { e.stopPropagation(); void handleDeleteFolder(folder.id, folder.name) }}
                            style={{
                              background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11,
                              color: '#b91c1c', padding: '3px 8px', cursor: fileBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ))}
                    {jobFiles.map((file, i) => (
                      <div
                        key={file.id}
                        style={{
                          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                          borderBottom: i < jobFiles.length - 1 ? '1px solid #f0f0f0' : undefined,
                        }}
                      >
                        <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>📄</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {canPreviewFile({ filename: file.filename, contentType: file.mimeType }) ? (
                              <button
                                type="button"
                                title="Preview"
                                onClick={() => {
                                  const files = previewFilesFrom(jobFiles, (row) => toPreviewFile({
                                    id: row.id,
                                    filename: row.filename,
                                    contentType: row.mimeType,
                                    sizeBytes: row.sizeBytes,
                                    available: row.uploadStatus === 'UPLOADED',
                                    previewUrl: api.getJobFileDownloadUrl(workspaceId, jobId, row.id, true),
                                    downloadUrl: api.getJobFileDownloadUrl(workspaceId, jobId, row.id),
                                  }))
                                  if (!files.some((item) => item.id === file.id)) return
                                  setFilePreview({ files, index: previewIndexFor(files, file.id) })
                                }}
                                style={{
                                  background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 500,
                                  cursor: 'pointer', textAlign: 'left', color: 'inherit',
                                }}
                              >
                                {file.filename}
                              </button>
                            ) : file.filename}
                          </div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                            {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
                            {file.uploadStatus !== 'UPLOADED' && ` · ${file.uploadStatus}`}
                          </div>
                        </div>
                        {file.uploadStatus === 'UPLOADED' && (
                          <a
                            href={api.getJobFileDownloadUrl(workspaceId, jobId, file.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: 11, color: '#1565c0', textDecoration: 'none', fontWeight: 600,
                              padding: '3px 8px', border: '1px solid #1565c0', borderRadius: 4,
                            }}
                          >
                            Download
                          </a>
                        )}
                        {canEdit && currentFolderId && (
                          <button
                            type="button"
                            disabled={fileBusy}
                            onClick={() => void handleMoveFileToRoot(file.id)}
                            style={{
                              background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11,
                              color: '#555', padding: '3px 8px', cursor: fileBusy ? 'not-allowed' : 'pointer',
                            }}
                            title="Move to job root"
                          >
                            To root
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            disabled={fileBusy}
                            onClick={() => void handleDeleteFile(file.id, file.filename)}
                            style={{
                              background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11,
                              color: '#b91c1c', padding: '3px 8px', cursor: fileBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>

              {!currentFolderId && (
                <Card title={`All files (${libraryTotal})`}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                    {([
                      ['ALL', 'All'],
                      ['IMAGES', 'Images'],
                      ['PDF', 'PDF'],
                      ['SPREADSHEETS', 'Spreadsheets'],
                      ['DOCUMENTS', 'Documents'],
                      ['OTHER', 'Other'],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setFileTypeFilter(key)
                          if (key !== 'IMAGES' && key !== 'ALL') setImageRelevanceFilter('ALL')
                        }}
                        style={{
                          padding: '3px 10px', fontSize: 11, fontWeight: 500, borderRadius: 12,
                          border: fileTypeFilter === key ? '1px solid #1a1a2e' : '1px solid #ddd',
                          background: fileTypeFilter === key ? '#1a1a2e' : '#fff',
                          color: fileTypeFilter === key ? '#fff' : '#666', cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <select
                      value={docCategory}
                      onChange={(e) => setDocCategory(e.target.value as typeof docCategory)}
                      style={{ padding: '3px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #ddd' }}
                    >
                      <option value="ALL">All document types</option>
                      <option value="DRAWINGS">Drawings / Specs</option>
                      <option value="SHOP_SUBMITTALS">Shop drawings / Submittals</option>
                      <option value="RFIS">RFIs</option>
                      <option value="ASI_BULLETIN_ADDENDUM">ASI / Bulletins / Addenda</option>
                      <option value="CONTRACTS_POS">Contracts / POs</option>
                      <option value="CHANGE_ORDERS">Change orders</option>
                      <option value="INVOICES">Invoices</option>
                      <option value="DELIVERY">Delivery</option>
                      <option value="OTHER">Other</option>
                    </select>
                    <select
                      value={controlState}
                      onChange={(e) => setControlState(e.target.value as typeof controlState)}
                      style={{ padding: '3px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #ddd' }}
                    >
                      <option value="ALL">All versions</option>
                      <option value="CURRENT">Current</option>
                      <option value="SUPERSEDED">Superseded</option>
                      <option value="UNCLASSIFIED">Unclassified</option>
                    </select>
                    <input
                      value={docSearch}
                      onChange={(e) => setDocSearch(e.target.value)}
                      placeholder="Search filename, number, title…"
                      style={{ padding: '3px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #ddd', minWidth: 160 }}
                    />
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={() => setImageReviewMode((v) => !v)}
                      style={{
                        padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                        border: imageReviewMode ? '1px solid #1a1a2e' : '1px solid #ddd',
                        background: imageReviewMode ? '#1a1a2e' : '#fff',
                        color: imageReviewMode ? '#fff' : '#555', cursor: 'pointer',
                      }}
                    >
                      {imageReviewMode ? 'Review on' : 'Review images'}
                    </button>
                    <select
                      value={fileSort}
                      onChange={(e) => setFileSort(e.target.value as typeof fileSort)}
                      style={{ padding: '3px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #ddd' }}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="name">Name</option>
                      <option value="type">Document type</option>
                      <option value="documentDate">Document date</option>
                    </select>
                  </div>

                  {(fileTypeFilter === 'ALL' || fileTypeFilter === 'IMAGES') && imageRelevanceCounts.all > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                      {([
                        ['ALL', `All images (${imageRelevanceCounts.all})`],
                        ['RELEVANT', `Relevant (${imageRelevanceCounts.relevant})`],
                        ['NOISE', `Likely irrelevant (${imageRelevanceCounts.noise})`],
                        ['UNCERTAIN', `Unsure (${imageRelevanceCounts.uncertain})`],
                        ['NOT_ANALYZED', `Not analyzed (${imageRelevanceCounts.notAnalyzed})`],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setImageRelevanceFilter(key)}
                          style={{
                            padding: '2px 8px', fontSize: 11, fontWeight: 500, borderRadius: 10,
                            border: imageRelevanceFilter === key ? '1px solid #9ca3af' : '1px solid #e5e7eb',
                            background: imageRelevanceFilter === key ? '#f3f4f6' : '#fff',
                            color: '#555', cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>
                        View filter only — nothing is deleted or hidden from storage
                      </span>
                    </div>
                  )}

                  {libraryFiles.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#888' }}>
                      No files linked to this job yet. Email attachments and uploads will appear here.
                    </div>
                  ) : (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: isPhone ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: 10,
                    }}>
                      {libraryFiles.map((file) => {
                        const downloadUrl =
                          file.sourceType === 'EMAIL_ATTACHMENT'
                            ? api.getStoredAttachmentDownloadUrl(workspaceId, file.id)
                            : api.getJobFileDownloadUrl(workspaceId, jobId, file.id)
                        const kind = previewKind({ filename: file.filename, contentType: file.mimeType })
                        const previewable = kind !== null
                        const relevance = file.sourceType === 'EMAIL_ATTACHMENT' && file.fileType === 'IMAGES'
                          ? (file.imageRelevance ?? null)
                          : null
                        const showRelevanceChrome = file.fileType === 'IMAGES' && file.sourceType === 'EMAIL_ATTACHMENT'
                        const thumbUrl = kind === 'image'
                          ? (file.sourceType === 'EMAIL_ATTACHMENT'
                            ? api.getStoredAttachmentDownloadUrl(workspaceId, file.id, true)
                            : api.getJobFileDownloadUrl(workspaceId, jobId, file.id, true))
                          : null
                        const openPreview = () => {
                          const files = previewFilesFrom(libraryFiles, (row) => {
                            const rowDownload = row.sourceType === 'EMAIL_ATTACHMENT'
                              ? api.getStoredAttachmentDownloadUrl(workspaceId, row.id)
                              : api.getJobFileDownloadUrl(workspaceId, jobId, row.id)
                            const rowPreview = row.sourceType === 'EMAIL_ATTACHMENT'
                              ? api.getStoredAttachmentDownloadUrl(workspaceId, row.id, true)
                              : api.getJobFileDownloadUrl(workspaceId, jobId, row.id, true)
                            return toPreviewFile({
                              id: `${row.sourceType}:${row.id}`,
                              filename: row.filename,
                              contentType: row.mimeType,
                              sizeBytes: row.sizeBytes,
                              available: true,
                              previewUrl: rowPreview,
                              downloadUrl: rowDownload,
                            })
                          })
                          const previewId = `${file.sourceType}:${file.id}`
                          if (!files.some((item) => item.id === previewId)) return
                          setFilePreview({ files, index: previewIndexFor(files, previewId) })
                        }
                        return (
                          <div
                            key={`${file.sourceType}-${file.id}`}
                            style={{
                              border: showRelevanceChrome ? imageCardBorder(relevance) : '1px solid #e5e7eb',
                              borderRadius: 8,
                              padding: 10,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              background: showRelevanceChrome ? imageCardBackground(relevance) : '#fff',
                            }}
                          >
                            {thumbUrl ? (
                              <LibraryImageThumb
                                src={thumbUrl}
                                filename={file.filename}
                                onOpen={openPreview}
                                border={showRelevanceChrome && relevance?.relevance === 'NOISE'
                                  ? '2px solid #f5b5b5'
                                  : showRelevanceChrome && relevance?.relevance === 'UNCERTAIN'
                                    ? '2px solid #d1d5db'
                                    : undefined}
                              />
                            ) : previewable ? (
                              <button
                                type="button"
                                onClick={openPreview}
                                title="Preview"
                                style={{
                                  height: 140, borderRadius: 6, background: '#f8fafc', border: '1px solid #e5e7eb',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 13, fontWeight: 700, color: '#475569', cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                              >
                                PDF
                              </button>
                            ) : (
                              <div style={{
                                height: 72, borderRadius: 6, background: '#f8fafc',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 28, color: '#94a3b8',
                              }}>
                                {file.extension || 'FILE'}
                              </div>
                            )}
                            {showRelevanceChrome && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <InlineImageRelevanceBadge info={relevance} reviewMode={imageReviewMode} />
                                {(imageReviewMode || relevance?.relevance === 'NOISE' || relevance?.relevance === 'UNCERTAIN') && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDetailsAttachmentId((id) => (id === file.id ? null : file.id))
                                    }
                                    style={{
                                      background: 'none', border: 'none', padding: 0, fontSize: 10,
                                      color: '#6b7280', cursor: 'pointer', textDecoration: 'underline',
                                      fontFamily: 'inherit',
                                    }}
                                  >
                                    {detailsAttachmentId === file.id ? 'Hide details' : 'Details'}
                                  </button>
                                )}
                              </div>
                            )}
                            {showRelevanceChrome && detailsAttachmentId === file.id && (
                              <InlineImageRelevanceDetails info={relevance} />
                            )}
                            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.filename}>
                              {previewable ? (
                                <button
                                  type="button"
                                  onClick={openPreview}
                                  title="Preview"
                                  style={{
                                    background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600,
                                    cursor: 'pointer', textAlign: 'left', color: 'inherit', maxWidth: '100%',
                                  }}
                                >
                                  {file.filename}
                                </button>
                              ) : file.filename}
                            </div>
                            {file.control ? (
                              <DocumentControlSummary control={file.control} />
                            ) : (
                              <div style={{ fontSize: 11, color: '#9ca3af' }}>Unclassified</div>
                            )}
                            <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
                              {formatBytes(file.sizeBytes)} · {formatDate(file.date)}
                              <br />
                              {file.sourceType === 'EMAIL_ATTACHMENT' ? 'Email attachment' : 'Job upload'}
                              {file.extension ? ` · ${file.extension}` : ''}
                              {file.sender ? (
                                <>
                                  <br />
                                  From {file.sender}
                                </>
                              ) : null}
                              {file.emailSubject ? (
                                <>
                                  <br />
                                  <span title={file.emailSubject}>
                                    {file.emailSubject.length > 40
                                      ? `${file.emailSubject.slice(0, 40)}…`
                                      : file.emailSubject}
                                  </span>
                                </>
                              ) : null}
                            </div>
                            {classifyingKey === `${file.sourceType}:${file.id}` && (
                              <JobDocumentControlForm
                                workspaceId={workspaceId}
                                jobId={jobId}
                                file={file}
                                packages={docPackages}
                                classifiedPeers={libraryFiles}
                                canEdit={canEdit}
                                onClose={() => setClassifyingKey(null)}
                                onSaved={(control: JobDocumentControl | null) => {
                                  setLibraryFiles((prev) =>
                                    prev.map((row) =>
                                      row.id === file.id && row.sourceType === file.sourceType
                                        ? { ...row, control }
                                        : row.control && control?.supersedesId === row.control.id
                                          ? { ...row, control: { ...row.control, isCurrent: false } }
                                          : row
                                    )
                                  )
                                }}
                              />
                            )}
                            {showRelevanceChrome && (imageReviewMode || relevance?.relevance === 'NOISE' || relevance?.relevance === 'UNCERTAIN') && (
                              <InlineImageRelevanceActions
                                info={relevance}
                                canCorrect={canEdit}
                                busy={correctingAttachmentId === file.id}
                                onCorrect={(body) => correctLibraryImageRelevance(file.id, body)}
                              />
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                              <a
                                href={downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: 11, color: '#1565c0', fontWeight: 600, textDecoration: 'none',
                                }}
                              >
                                Download
                              </a>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setClassifyingKey((key) =>
                                      key === `${file.sourceType}:${file.id}` ? null : `${file.sourceType}:${file.id}`
                                    )
                                  }
                                  style={{
                                    background: 'none', border: 'none', padding: 0, fontSize: 11,
                                    color: '#6b7280', cursor: 'pointer', textDecoration: 'underline',
                                  }}
                                >
                                  {file.control ? 'Edit details' : 'Add document details'}
                                </button>
                              )}
                              {file.emailId && onOpenMessage && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Job emails endpoint includes connection; fall back to empty if unknown.
                                    const email = [...emails, ...overviewEmails].find(e => e.id === file.emailId)
                                    if (email?.inboxConnectionId) {
                                      onOpenMessage(file.emailId!, email.inboxConnectionId)
                                    }
                                  }}
                                  style={{
                                    background: 'none', border: 'none', padding: 0, fontSize: 11,
                                    color: '#6b7280', cursor: 'pointer', textDecoration: 'underline',
                                  }}
                                >
                                  Open email
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {tab === 'activity' && (
        <div>
          {activity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 14 }}>No activity recorded.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {activity.map((entry, i) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: '12px 0', borderBottom: i < activity.length - 1 ? '1px solid #f0f0f0' : undefined,
                      display: 'flex', gap: 12, alignItems: 'flex-start'
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', background: '#c7d2fe',
                      marginTop: 6, flexShrink: 0
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{entry.actorName ?? entry.actorEmail ?? 'System'}</strong>{' '}
                        {(() => {
                          const targetTab = activityActionTab(entry.action)
                          const label = formatJobActivityAction(entry.action)
                          if (!targetTab || targetTab === 'activity') {
                            return <span style={{ color: '#374151' }}>{label}</span>
                          }
                          return (
                            <button
                              type="button"
                              onClick={() => setTab(targetTab)}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                color: '#1565c0',
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontSize: 13,
                              }}
                            >
                              {label}
                            </button>
                          )
                        })()}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{formatDateTime(entry.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
              {activityTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button disabled={activityPage <= 1} onClick={() => setActivityPage(p => p - 1)} style={{ padding: '4px 10px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: activityPage > 1 ? 'pointer' : 'not-allowed', opacity: activityPage <= 1 ? 0.5 : 1 }}>Prev</button>
                  <span style={{ fontSize: 12, alignSelf: 'center', color: '#6b7280' }}>Page {activityPage} of {activityTotalPages}</span>
                  <button disabled={activityPage >= activityTotalPages} onClick={() => setActivityPage(p => p + 1)} style={{ padding: '4px 10px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: activityPage < activityTotalPages ? 'pointer' : 'not-allowed', opacity: activityPage >= activityTotalPages ? 0.5 : 1 }}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <div style={{ maxWidth: isPhone ? '100%' : 640 }}>
          <Card title="Job Details" style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} disabled={!canEdit}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Job Number</label>
                  <input value={editJobNumber} onChange={e => setEditJobNumber(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Status</label>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    { (STATUSES.includes(editStatus) ? STATUSES : [editStatus, ...STATUSES]).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>) }
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Start Date</label>
                  <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Target Completion</label>
                  <input type="date" value={editTargetDate} onChange={e => setEditTargetDate(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Bid due</label>
                <input type="date" value={editBidDue} onChange={e => setEditBidDue(e.target.value)} disabled={!canEdit}
                  style={{ width: '100%', maxWidth: 240, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
              </div>
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Project site
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, lineHeight: 1.4 }}>
                  Default delivery destination. New deliveries can copy these fields; shipment destinations remain historical snapshots.
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Site name</label>
                    <input value={editSiteName} onChange={e => setEditSiteName(e.target.value)} disabled={!canEdit} placeholder="Project / site"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Address</label>
                    <input value={editSiteAddress1} onChange={e => setEditSiteAddress1(e.target.value)} disabled={!canEdit} placeholder="Address line 1"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, marginBottom: 6 }} />
                    <input value={editSiteAddress2} onChange={e => setEditSiteAddress2(e.target.value)} disabled={!canEdit} placeholder="Address line 2"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '2fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>City</label>
                      <input value={editSiteCity} onChange={e => setEditSiteCity(e.target.value)} disabled={!canEdit}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>State</label>
                      <input value={editSiteState} onChange={e => setEditSiteState(e.target.value)} disabled={!canEdit}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Postal</label>
                      <input value={editSitePostalCode} onChange={e => setEditSitePostalCode(e.target.value)} disabled={!canEdit}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Financial baselines
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Original Contract Value</label>
                    <input value={editOriginalContractValue} onChange={e => setEditOriginalContractValue(e.target.value)} disabled={!canEdit} placeholder="Unknown"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Original Estimated Cost</label>
                    <input value={editOriginalEstimatedCost} onChange={e => setEditOriginalEstimatedCost(e.target.value)} disabled={!canEdit} placeholder="Unknown"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.4 }}>
                  Revised contract, approved CO totals, and estimated margin are calculated — not editable here. Empty means unknown (not zero).
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af', display: 'block', marginBottom: 4 }}>{TOTAL_COST_DISPLAY_LABEL}</label>
                <input value={editTotalCost} onChange={e => setEditTotalCost(e.target.value)} disabled={!canEdit} placeholder="Not set"
                  style={{ width: '100%', maxWidth: 240, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, color: '#6b7280' }} />
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.4 }}>
                  Ambiguous historical field — not used in the Financial snapshot.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Estimator</label>
                  <select value={editEstimatorId} onChange={e => setEditEstimatorId(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    <option value="">Not assigned</option>
                    {partyMembers.map(member => (
                      <option key={member.id} value={member.id}>{member.name || member.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Customer</label>
                  <select value={editCustomerId} onChange={e => setEditCustomerId(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    <option value="">Not assigned</option>
                    {partyCustomers.map(customer => (
                      <option key={customer.id} value={customer.id}>{customer.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} disabled={!canEdit} rows={3}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, resize: 'vertical' }} />
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.4 }}>
                  Used to match emails to this job. Matching checks the email subject and body against the job name and any alternate names listed here. Example: Also known as: Nova Academy, NOVA
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} disabled={!canEdit} rows={3}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, resize: 'vertical' }} />
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={handleSave} disabled={saving}
                    style={{ padding: '8px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  {saveError && <span style={{ fontSize: 12, color: '#b42318' }}>{saveError}</span>}
                </div>
              )}
            </div>
          </Card>

          {/* Aliases */}
          <Card title="Email Aliases" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: aliases.length > 0 ? 12 : 0 }}>
              {aliases.map(a => (
                <span key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#f3f4f6', borderRadius: 12, fontSize: 12 }}>
                  {a.alias}
                  {canEdit && (
                    <button onClick={() => handleRemoveAlias(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999', padding: 0, marginLeft: 4 }}>&times;</button>
                  )}
                </span>
              ))}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={newAlias} onChange={e => setNewAlias(e.target.value)} placeholder="Add alias (e.g. job-123@company.com)"
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
                  onKeyDown={e => e.key === 'Enter' && handleAddAlias()} />
                <button onClick={handleAddAlias}
                  style={{ padding: '6px 14px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Add
                </button>
              </div>
            )}
          </Card>

          {/* Members */}
          <Card title="Members" style={{ marginBottom: 16 }}>
            {members.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13 }}>No members assigned.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#e0e7ff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, color: '#4338ca'
                      }}>
                        {(m.name ?? m.email)[0].toUpperCase()}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name ?? m.email}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{m.email}{m.role ? ` · ${m.role}` : ''}</div>
                      </div>
                    </div>
                    {canEdit && (
                      <button onClick={() => handleRemoveMember(m.userId)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999' }}>
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Archive / Delete */}
          {(canEdit || canDeleteJob) && (
            <Card title="Danger Zone">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {canEdit && (
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, lineHeight: 1.45 }}>
                      Archive hides the Job from active workflow but keeps history. Delete is permanent.
                    </div>
                    <button type="button" onClick={handleArchive}
                      style={{
                        padding: '8px 16px', border: '1px solid #dc2626', borderRadius: 6,
                        background: job.archivedAt ? '#fff' : '#fef2f2', color: '#dc2626',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer'
                      }}>
                      {job.archivedAt ? 'Restore Job' : 'Archive Job'}
                    </button>
                  </div>
                )}
                {canDeleteJob && (
                  <div style={{ borderTop: canEdit ? '1px solid #fee2e2' : undefined, paddingTop: canEdit ? 14 : 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: '#991b1b', marginBottom: 6 }}>
                      Delete Job
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.45 }}>
                      Permanently deletes this Job and its Job-owned project records. Emails, Customers,
                      Vendors, and other shared records are not deleted.
                    </div>
                    {deleteError && (
                      <div style={{ fontSize: 12, color: '#b42318', marginBottom: 8 }}>{deleteError}</div>
                    )}
                    <button
                      type="button"
                      data-testid="job-settings-delete"
                      onClick={handleDeleteJob}
                      style={{
                        padding: '8px 16px', border: '1px solid #991b1b', borderRadius: 6,
                        background: '#991b1b', color: '#fff',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer'
                      }}
                    >
                      Delete Job
                    </button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      )}
      {filePreview && (
        <FilePreviewModal
          files={filePreview.files}
          index={filePreview.index}
          onIndexChange={(index) => setFilePreview((current) => current ? { ...current, index } : current)}
          onClose={() => setFilePreview(null)}
        />
      )}
      <JobConfirmDialog
        open={confirmAction != null}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel={confirmAction?.confirmLabel ?? 'Confirm'}
        danger={confirmAction?.danger}
        busy={confirmBusy}
        confirmPhrase={confirmAction?.confirmPhrase}
        confirmPhraseHint={confirmAction?.confirmPhraseHint}
        onCancel={() => {
          if (!confirmBusy) setConfirmAction(null)
        }}
        onConfirm={() => {
          if (!confirmAction) return
          setConfirmBusy(true)
          void confirmAction
            .run()
            .catch(() => {
              /* error surfaced via deleteError / caller */
            })
            .finally(() => {
              setConfirmBusy(false)
              setConfirmAction(null)
            })
        }}
      />
    </div>
  )
}
