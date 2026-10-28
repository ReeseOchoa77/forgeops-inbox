import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import { api, type MessageSummary, type ConnectionSummary, type StoredAttachment } from '../api'
import { buildInboxMessageListFilters } from '../inbox-message-list-filters'
import {
  getCachedInboxList,
  setCachedInboxList,
  patchCachedInboxMessagePin,
  sortInboxMessagesPinnedFirst,
  INBOX_DEFAULT_LIST_FILTER_KEY,
  INBOX_LIST_FRESH_MS,
} from '../inbox-list-cache'
import { inboxListQueryKey, isSameInboxListQuery } from '../inbox-list-query'
import { PriorityBadge, TypeBadge } from '../components/Badges'
import { AttachmentActionMenu } from '../components/AttachmentActionMenu'
import { FilePreviewModal } from '../components/FilePreviewModal'
import {
  canPreviewFile,
  previewFilesFrom,
  previewIndexFor,
  toPreviewFile,
  type PreviewFile,
} from '../file-preview'
import {
  JobFilterSelect,
  formatJobPrimaryLabel,
  formatJobTooltip,
} from '../components/JobAssignPicker'
import { EmailJobAssignmentDialog } from '../components/EmailJobAssignmentDialog'
import {
  businessSubtypeFilterOptionsForDirection,
  INBOX_BID_INVITES_SOURCE_FILTER_LABEL,
} from '@forgeops/shared/business-subtypes'
import {
  INBOX_ACTIONS_COLUMN_WIDTH_PX,
  MailboxCategoryDot,
  inboxDateCellStyle,
} from '../components/MailboxCategoryDot'
import type { Breakpoint } from '../hooks/useBreakpoint'
import { isAllMailboxesConnectionId } from '../mailbox-selection'

function EmailOriginTag({ origin }: { origin: MessageSummary['emailOrigin'] }) {
  if (origin !== 'HISTORICAL_IMPORT') return null
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 10,
        whiteSpace: 'nowrap',
        background: '#f3e8ff',
        color: '#6b21a8',
      }}
    >
      Imported
    </span>
  )
}
import { prefetchThread } from '../message-thread-cache'

/** Inbox list prompt. Off until suggested responses are ready to show again. */
const SHOW_INBOX_SUGGESTED_RESPONSE = false

function formatAttachmentSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function InboxAttachmentsButton({
  workspaceId,
  messageId,
  open,
  onToggle,
}: {
  workspaceId: string
  messageId: string
  open: boolean
  onToggle: () => void
}) {
  const [attachments, setAttachments] = useState<StoredAttachment[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [preview, setPreview] = useState<{ files: PreviewFile[]; index: number } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(false)
    api.getEmailAttachments(workspaceId, messageId)
      .then(r => {
        if (!cancelled) setAttachments(r.attachments)
      })
      .catch(() => {
        if (!cancelled) {
          setAttachments([])
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, workspaceId, messageId])

  const downloadable = (attachments ?? []).filter(a => {
    const mime = (a.mimeType ?? '').toLowerCase()
    // Prefer real files; keep pure inline images out of the quick list
    return !(a.isInline && mime.startsWith('image/'))
  })

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        title="View attachments"
        onClick={onToggle}
        style={{
          background: open ? '#eef2ff' : 'none',
          border: open ? '1px solid #c7d2fe' : '1px solid transparent',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          color: open ? '#4338ca' : '#6b7280',
          padding: '2px 5px',
          lineHeight: 1,
          minHeight: 28,
        }}
      >
        📎
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 30,
            background: '#fff', border: '1px solid #ddd', borderRadius: 8,
            boxShadow: '0 6px 18px rgba(0,0,0,0.14)', width: 280, maxHeight: 240,
            overflowY: 'auto', marginTop: 4,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#555', borderBottom: '1px solid #f0f0f0' }}>
            Attachments
          </div>
          {loading && <div style={{ padding: '12px 10px', fontSize: 12, color: '#999' }}>Loading…</div>}
          {!loading && error && (
            <div style={{ padding: '12px 10px', fontSize: 12, color: '#c62828' }}>Failed to load attachments</div>
          )}
          {!loading && !error && downloadable.length === 0 && (
            <div style={{ padding: '12px 10px', fontSize: 12, color: '#999' }}>
              No downloadable files yet. Open the email for details.
            </div>
          )}
          {!loading && downloadable.map(att => (
            <div
              key={att.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderBottom: '1px solid #f5f5f5', fontSize: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {canPreviewFile({ filename: att.filename, contentType: att.mimeType }) ? (
                    <button
                      type="button"
                      title="Preview"
                      onClick={(e) => {
                        e.stopPropagation()
                        const files = previewFilesFrom(downloadable, (row) => toPreviewFile({
                          id: row.id,
                          filename: row.filename,
                          contentType: row.mimeType,
                          sizeBytes: row.sizeBytes,
                          available: row.uploadStatus === 'UPLOADED',
                          previewUrl: api.getStoredAttachmentDownloadUrl(workspaceId, row.id, true),
                          downloadUrl: api.getStoredAttachmentDownloadUrl(workspaceId, row.id),
                        }))
                        if (!files.some((file) => file.id === att.id)) return
                        setPreview({ files, index: previewIndexFor(files, att.id) })
                      }}
                      style={{
                        background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 500,
                        cursor: 'pointer', textAlign: 'left', color: 'inherit', maxWidth: '100%',
                      }}
                    >
                      {att.filename}
                    </button>
                  ) : att.filename}
                </div>
                <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>
                  {formatAttachmentSize(att.sizeBytes)}
                  {att.uploadStatus !== 'UPLOADED' ? ` · ${att.uploadStatus.toLowerCase()}` : ''}
                </div>
              </div>
              {att.uploadStatus === 'UPLOADED' ? (
                <>
                  <a
                    href={api.getStoredAttachmentDownloadUrl(workspaceId, att.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 11, color: '#1565c0', textDecoration: 'none', fontWeight: 600,
                      padding: '3px 8px', border: '1px solid #90caf9', borderRadius: 4, flexShrink: 0,
                    }}
                  >
                    Download
                  </a>
                  <AttachmentActionMenu
                    workspaceId={workspaceId}
                    attachment={att}
                    sourceEmailMessageId={messageId}
                  />
                </>
              ) : (
                <span style={{ fontSize: 10, color: '#bbb', flexShrink: 0 }}>Unavailable</span>
              )}
            </div>
          ))}
        </div>
      )}
      {preview && (
        <FilePreviewModal
          files={preview.files}
          index={preview.index}
          onIndexChange={(index) => setPreview((current) => current ? { ...current, index } : current)}
          onClose={() => setPreview(null)}
        />
      )}
    </span>
  )
}

type AutoResponseStatus = 'idle' | 'sending' | 'sent'

const AUTO_RESPONSE_YES = "Thank you for your email. We've received your message and will follow up if needed."
const AUTO_RESPONSE_NO = "Thank you for reaching out. We've reviewed your message and no further action is needed at this time."

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string, opts?: { connectionId?: string }) => void
  userRole: string
  userEmail: string
  connections: ConnectionSummary[]
  breakpoint?: Breakpoint
  /** When set (detail open from Inbox), mark that row read locally without refetch. */
  openedMessageId?: string | null
  onCompose?: () => void
}

const PAGE_SIZE = 30

type InboxTab = 'ALL_BUSINESS' | 'BIDS_ESTIMATING' | 'PROJECTS' | 'PURCHASING' | 'ACCOUNTING' | 'INTERNAL' | 'OTHER' | 'UNCLASSIFIED' | 'PERSONAL' | 'TRASH'

const INBOX_TABS: Array<{ key: InboxTab; label: string }> = [
  { key: 'ALL_BUSINESS', label: 'All Business' },
  { key: 'BIDS_ESTIMATING', label: 'Bids & Estimating' },
  { key: 'PROJECTS', label: 'Projects' },
  { key: 'PURCHASING', label: 'Purchasing' },
  { key: 'ACCOUNTING', label: 'Accounting' },
  { key: 'INTERNAL', label: 'Internal' },
  { key: 'OTHER', label: 'Other' },
  { key: 'UNCLASSIFIED', label: 'Unclassified' },
  { key: 'PERSONAL', label: 'Personal' },
  { key: 'TRASH', label: 'Trash' },
]

type ReadFilter = '' | 'unread' | 'read' | 'sent'
type PriorityKey = 'LOW' | 'NORMAL' | 'HIGH'

export function MessagesView({ workspaceId, connectionId, onSelectMessage, userRole, userEmail, connections, breakpoint = 'desktop', openedMessageId = null, onCompose }: Props) {
  const isViewer = userRole === 'VIEWER'
  const isAllMailboxes = isAllMailboxesConnectionId(connectionId)
  const canSeeAllPersonal = userRole === 'ADMIN' || userRole === 'OWNER'
  const currentConnectionEmail = connections.find(c => c.id === connectionId)?.email ?? ''
  const isOwnInbox = !isAllMailboxes && userEmail.toLowerCase() === currentConnectionEmail.toLowerCase()
  const monitoredEmails = new Set(connections.map(c => c.email.toLowerCase()))
  const resolveMessageConnectionId = (m: MessageSummary) =>
    m.inboxConnectionId || (isAllMailboxes ? '' : connectionId)
  const mailboxEmailFor = (m: MessageSummary) =>
    connections.find(c => c.id === (m.inboxConnectionId ?? connectionId))?.email ?? null
  const isSentEmail = (m: MessageSummary) => monitoredEmails.has(m.senderEmail.toLowerCase())

  const initialCache = getCachedInboxList(workspaceId, connectionId)
  const [messages, setMessages] = useState<MessageSummary[]>(() => initialCache?.messages ?? [])
  const [page, setPage] = useState(() => initialCache?.page ?? 1)
  const [totalCount, setTotalCount] = useState<number | null>(() => initialCache?.totalCount ?? null)
  const [hasMore, setHasMore] = useState(() => initialCache?.hasMore ?? true)
  const [loading, setLoading] = useState(() => !initialCache)
  const [loadingMore, setLoadingMore] = useState(false)
  /**
   * Soft refresh only for SAME query revalidation (keep rows).
   * Query-context changes clear rows and use hard loading instead.
   */
  const [refreshing, setRefreshing] = useState(false)
  const usefulPaintLoggedRef = useRef(false)
  const requestSeqRef = useRef(0)
  const listAbortRef = useRef<AbortController | null>(null)
  /** Active list query identity — rejects stale responses / decides soft vs replace. */
  const activeQueryKeyRef = useRef(
    initialCache ? inboxListQueryKey({ businessCategory: 'BUSINESS' }) : ''
  )

  const [inboxTab, setInboxTab] = useState<InboxTab>('ALL_BUSINESS')
  const [readFilter, setReadFilter] = useState<ReadFilter>('')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<Set<PriorityKey>>(new Set(['LOW', 'NORMAL', 'HIGH']))
  const [jobFilter, setJobFilter] = useState('')
  /**
   * Inbox source/subtype filter key. BID_OPPORTUNITY = Active Bid provenance
   * (Projects/Bid Invites; not subtype membership). Server-side before pagination.
   */
  const [businessTypeKey, setBusinessTypeKey] = useState('')
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [dateRange, setDateRange] = useState<'' | 'TODAY' | 'WEEK' | 'MONTH'>('')
  const browserTimeZone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC'

  const [autoResponseStatus, setAutoResponseStatus] = useState<Record<string, AutoResponseStatus>>({})
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState<string | null>(null)
  const [assignmentTarget, setAssignmentTarget] = useState<MessageSummary | null>(null)
  const [deletingAllPersonal, setDeletingAllPersonal] = useState(false)
  /** When on, clicking a list row trashes it instead of opening the email. */
  const [massDeleteMode, setMassDeleteMode] = useState(false)
  const [reclassifySelected, setReclassifySelected] = useState<Set<string>>(() => new Set())
  const [reclassifyBusy, setReclassifyBusy] = useState(false)
  const [reclassifyNotice, setReclassifyNotice] = useState<string | null>(null)
  const massDeletingIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!attachmentPickerOpen) return
    const close = () => setAttachmentPickerOpen(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [attachmentPickerOpen])

  const applyJobToMessage = (messageId: string, job: { id: string; name: string; jobNumber: string | null; status: string } | null) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              job: job
                ? { id: job.id, jobNumber: job.jobNumber, name: job.name, status: job.status }
                : undefined,
              suggestedJob: job ? null : m.suggestedJob,
            }
          : m
      )
    )
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const connectionResetRef = useRef(false)

  const isUnclassified = inboxTab === 'UNCLASSIFIED'
  const isBusiness = inboxTab !== 'PERSONAL' && inboxTab !== 'TRASH' && !isUnclassified
  const isSentView = readFilter === 'sent'
  /** Business subtype chrome (priority/job/type columns) — not on Personal, Trash, Unclassified. */
  const showBusinessChrome = isBusiness
  /** Compact status chrome for the Unclassified tab. */
  const showUnclassifiedChrome = isUnclassified

  const isPhone = breakpoint === 'phone'
  const isTablet = breakpoint === 'tablet'

  const handleAutoResponse = async (msg: MessageSummary, affirm: boolean) => {
    const cid = resolveMessageConnectionId(msg)
    if (!cid) return
    setAutoResponseStatus(prev => ({ ...prev, [msg.id]: 'sending' }))
    try {
      await api.sendMessage(workspaceId, cid, {
        action: 'reply',
        originalMessageId: msg.id,
        to: [msg.senderEmail],
        subject: `Re: ${msg.subject ?? '(no subject)'}`,
        body: affirm ? AUTO_RESPONSE_YES : AUTO_RESPONSE_NO,
        bodyFormat: 'text',
      })
      setAutoResponseStatus(prev => ({ ...prev, [msg.id]: 'sent' }))
    } catch {
      setAutoResponseStatus(prev => ({ ...prev, [msg.id]: 'idle' }))
    }
  }

  const applyClientFilter = useCallback((msgs: MessageSummary[]): MessageSummary[] => {
    let result = msgs
    // Unread is server-side (unreadOnly). Read remains client-side (no readOnly API yet).
    if (readFilter === 'read') result = result.filter(m => m.isRead)
    const allPriorities = priorityFilter.size === 3
    if (priorityFilter.size > 0 && !allPriorities) {
      result = result.filter(m => {
        const p = m.classification?.priority
        if (!p) return false
        if (priorityFilter.has('HIGH') && (p === 'HIGH' || p === 'URGENT')) return true
        if (priorityFilter.has('NORMAL') && (p === 'NORMAL' || p === 'MEDIUM')) return true
        if (priorityFilter.has('LOW') && p === 'LOW') return true
        return false
      })
    }
    return result
  }, [readFilter, priorityFilter])

  const applyRoleFilter = useCallback((msgs: MessageSummary[]): MessageSummary[] => {
    if (inboxTab !== 'PERSONAL') return msgs
    if (canSeeAllPersonal) return msgs
    if (!isOwnInbox) return []
    return msgs
  }, [inboxTab, canSeeAllPersonal, isOwnInbox])

  const filteredMessages = applyRoleFilter(applyClientFilter(messages))

  const buildFilters = useCallback(() => {
    return buildInboxMessageListFilters({
      inboxTab,
      readFilter,
      dateRange,
      timezone: browserTimeZone,
      jobFilter,
      activeSearch,
      businessTypeKey: businessTypeKey || undefined,
      pinnedOnly,
    })
  }, [inboxTab, activeSearch, jobFilter, readFilter, dateRange, browserTimeZone, businessTypeKey, pinnedOnly])

  const selectDirectionFilter = (key: ReadFilter) => {
    const leavingSent = readFilter === 'sent' && key !== 'sent'
    const enteringSent = key === 'sent' && readFilter !== 'sent'
    setReadFilter(key)
    setBusinessTypeKey((prev) => {
      // Quote is Sent-only in the UI — clear when leaving Sent (no invisible Quote).
      if (leavingSent && prev === 'ESTIMATE_QUOTE') return ''
      // Active Bid provenance filter is incoming-only in the UI — clear when entering Sent.
      if (enteringSent && prev === 'BID_OPPORTUNITY') return ''
      return prev
    })
  }

  const toggleActiveBid = () => {
    setBusinessTypeKey((prev) => (prev === 'BID_OPPORTUNITY' ? '' : 'BID_OPPORTUNITY'))
  }

  const toggleQuoteFilter = () => {
    setBusinessTypeKey((prev) => (prev === 'ESTIMATE_QUOTE' ? '' : 'ESTIMATE_QUOTE'))
  }

  const selectInboxTab = (tab: InboxTab) => {
    // Unclassified is hidden from the filter bar — never leave that filter active.
    const next: InboxTab = tab === 'UNCLASSIFIED' ? 'ALL_BUSINESS' : tab
    // Tab/classification composes with the current direction (incl. Sent).
    setInboxTab(next)
    setPriorityFilter(new Set(['LOW', 'NORMAL', 'HIGH']))
    // Exact subtype filter is independent of group tabs — clear when leaving Business.
    if (next === 'PERSONAL' || next === 'TRASH') {
      setJobFilter('')
      setBusinessTypeKey('')
    }
    if (next === 'TRASH') setMassDeleteMode(false)
    setReclassifySelected(new Set())
    setReclassifyNotice(null)
  }

  useEffect(() => {
    // Inbox has no URL tab param today; still normalize so a hidden
    // Unclassified filter cannot stay active.
    if (inboxTab === 'UNCLASSIFIED') selectInboxTab('ALL_BUSINESS')
  }, [inboxTab])

  const loadPage = useCallback(async (
    pageNum: number,
    filters: ReturnType<typeof buildFilters>,
    append: boolean,
    opts?: { soft?: boolean }
  ) => {
    const requestKey = inboxListQueryKey(filters)
    if (pageNum === 1 && !append) {
      if (opts?.soft) setRefreshing(true)
      else setLoading(true)
    } else {
      setLoadingMore(true)
    }
    const seq = ++requestSeqRef.current
    if (!append) {
      listAbortRef.current?.abort()
      listAbortRef.current = new AbortController()
    }
    const signal = append ? undefined : listAbortRef.current?.signal
    const markBase = `inbox-list-${workspaceId}-${connectionId}-${seq}`
    try {
      performance.mark(`${markBase}-messagesRequestStart`)
    } catch { /* ignore */ }
    try {
      const r = await api.getMessages(
        workspaceId,
        connectionId,
        pageNum,
        PAGE_SIZE,
        filters,
        signal ? { signal } : undefined
      )
      try {
        performance.mark(`${markBase}-messagesResponseReceived`)
        performance.measure(
          'inboxMessagesRequestMs',
          `${markBase}-messagesRequestStart`,
          `${markBase}-messagesResponseReceived`
        )
        const entries = performance.getEntriesByName('inboxMessagesRequestMs')
        const last = entries[entries.length - 1]
        if (last) {
          console.info('inboxMessagesRequestMs', {
            ms: Math.round(last.duration),
            page: pageNum,
            rows: r.messages.length,
            soft: Boolean(opts?.soft),
          })
        }
        performance.clearMeasures('inboxMessagesRequestMs')
      } catch { /* ignore */ }

      // Drop stale responses (superseded request OR query context changed).
      if (seq !== requestSeqRef.current) return
      if (requestKey !== activeQueryKeyRef.current) return

      if (append) {
        // Same query + next page only
        if (requestKey !== activeQueryKeyRef.current) return
        setMessages(prev => [...prev, ...r.messages])
      } else {
        // Empty arrays are authoritative — always replace for this query.
        setMessages(r.messages)
      }
      setTotalCount(r.pagination.totalCount)
      setHasMore(r.pagination.hasMore)
      setPage(pageNum)

      // Cache first page for any filter so tab switches can soft-hydrate.
      if (pageNum === 1 && !append) {
        setCachedInboxList(workspaceId, connectionId, requestKey, {
          messages: r.messages,
          hasMore: r.pagination.hasMore,
          totalCount: r.pagination.totalCount,
          page: pageNum,
        })
        // Also keep the legacy default Business key warm for App.tsx prefetch.
        const isDefaultBusiness =
          filters.businessCategory === 'BUSINESS' &&
          !filters.sentOnly &&
          !filters.unreadOnly &&
          !filters.unclassifiedOnly &&
          !filters.search &&
          !filters.jobId &&
          !filters.category &&
          !filters.dateRange &&
          !filters.businessTypeGroup &&
          !filters.businessTypeKey
        if (isDefaultBusiness) {
          setCachedInboxList(workspaceId, connectionId, INBOX_DEFAULT_LIST_FILTER_KEY, {
            messages: r.messages,
            hasMore: r.pagination.hasMore,
            totalCount: r.pagination.totalCount,
            page: pageNum,
          })
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Leave list empty/loading for the active query — never keep another tab's rows.
    } finally {
      if (seq === requestSeqRef.current && requestKey === activeQueryKeyRef.current) {
        setLoading(false)
        setLoadingMore(false)
        setRefreshing(false)
      }
    }
  }, [workspaceId, connectionId])

  useEffect(() => {
    try {
      performance.mark('inboxComponentMount')
    } catch { /* ignore */ }
  }, [])

  // First useful rows painted (cached or network).
  useEffect(() => {
    if (usefulPaintLoggedRef.current) return
    if (loading) return
    usefulPaintLoggedRef.current = true
    try {
      performance.mark('firstInboxRowsPainted')
      const hasNav = performance.getEntriesByName('inboxNavigationStart').length > 0
      const startMark = hasNav ? 'inboxNavigationStart' : 'inboxComponentMount'
      if (performance.getEntriesByName(startMark).length === 0) {
        performance.clearMarks('firstInboxRowsPainted')
        return
      }
      performance.measure('inboxInitialUsefulPaintMs', startMark, 'firstInboxRowsPainted')
      const entries = performance.getEntriesByName('inboxInitialUsefulPaintMs')
      const last = entries[entries.length - 1]
      if (last) {
        console.info('inboxInitialUsefulPaintMs', {
          ms: Math.round(last.duration),
          from: startMark,
          rowCount: messages.length,
        })
      }
      performance.clearMeasures('inboxInitialUsefulPaintMs')
      performance.clearMarks('firstInboxRowsPainted')
      performance.clearMarks('inboxNavigationStart')
      performance.clearMarks('inboxComponentMount')
    } catch { /* ignore */ }
  }, [loading, messages.length])

  // Opening a message from this list: mark read locally (detail also PATCHes the server).
  useEffect(() => {
    if (!openedMessageId) return
    setMessages(prev =>
      prev.map(m =>
        m.id === openedMessageId && !m.isRead ? { ...m, isRead: true } : m
      )
    )
  }, [openedMessageId])

  useEffect(() => {
    connectionResetRef.current = true
    usefulPaintLoggedRef.current = false
    setPage(1)
    setHasMore(true)
    setTotalCount(null)
    setRefreshing(false)
    setSearch('')
    setActiveSearch('')
    setInboxTab('ALL_BUSINESS')
    setReadFilter('')
    setPriorityFilter(new Set(['LOW', 'NORMAL', 'HIGH']))
    setJobFilter('')
    setBusinessTypeKey('')
    setMassDeleteMode(false)

    const defaultFilters = { businessCategory: 'BUSINESS' as const }
    activeQueryKeyRef.current = inboxListQueryKey(defaultFilters)

    const cached = getCachedInboxList(workspaceId, connectionId)
    if (cached && cached.messages.length > 0) {
      setMessages(cached.messages)
      setPage(cached.page)
      setHasMore(cached.hasMore)
      setTotalCount(cached.totalCount)
      setLoading(false)
      // Soft revalidate same Business query — keep cached rows visible.
      void loadPage(1, defaultFilters, false, { soft: true })
    } else {
      setMessages([])
      setLoading(true)
      void loadPage(1, defaultFilters, false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reset only on mailbox change
  }, [workspaceId, connectionId])

  const sentOnly = readFilter === 'sent'
  const unreadOnly = readFilter === 'unread'

  useEffect(() => {
    if (connectionResetRef.current) {
      connectionResetRef.current = false
      return
    }
    const filters = buildFilters()
    const nextKey = inboxListQueryKey(filters)
    const sameQuery = isSameInboxListQuery(activeQueryKeyRef.current, filters)
    activeQueryKeyRef.current = nextKey
    setPage(1)
    setHasMore(true)
    setTotalCount(null)

    if (sameQuery) {
      // Same identity (e.g. softRefreshList): keep rows while revalidating.
      void loadPage(1, filters, false, { soft: true })
      return
    }

    // New tab/filter: paint cached rows immediately when available.
    const cached = getCachedInboxList(workspaceId, connectionId, nextKey)
    if (cached && cached.messages.length > 0) {
      setMessages(cached.messages)
      setPage(cached.page)
      setHasMore(cached.hasMore)
      setTotalCount(cached.totalCount)
      setLoading(false)
      const age = Date.now() - cached.cachedAt
      if (age < INBOX_LIST_FRESH_MS) {
        setRefreshing(false)
        return
      }
      void loadPage(1, filters, false, { soft: true })
      return
    }

    // Cold miss — clear previous query's rows and hard-load.
    setMessages([])
    setRefreshing(false)
    void loadPage(1, filters, false, { soft: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load when query dimensions change
  }, [inboxTab, activeSearch, jobFilter, businessTypeKey, sentOnly, unreadOnly, dateRange, pinnedOnly])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setActiveSearch(search) }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loadingMore || !hasMore || loading || refreshing) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      const filters = buildFilters()
      // Only append when still on the same query identity.
      if (inboxListQueryKey(filters) !== activeQueryKeyRef.current) return
      loadPage(page + 1, filters, true)
    }
  }, [page, buildFilters, hasMore, loadingMore, loading, refreshing, loadPage])

  const handleTrash = async (messageId: string, isTrashed: boolean) => {
    const msg = messages.find(m => m.id === messageId)
    const cid = msg ? resolveMessageConnectionId(msg) : connectionId
    if (!cid || isAllMailboxesConnectionId(cid)) return
    try {
      if (isTrashed) await api.untrashMessage(workspaceId, cid, messageId)
      else await api.trashMessage(workspaceId, cid, messageId)
      setMessages(prev => prev.filter(m => m.id !== messageId))
      setTotalCount(prev => (prev == null ? prev : Math.max(0, prev - 1)))
    } catch (e) {
      // Provider-delete failures must not look like success (row stays visible).
      window.alert(e instanceof Error ? e.message : 'Failed to delete email')
    }
  }

  const handleMassDeleteClick = async (messageId: string) => {
    if (massDeletingIds.current.has(messageId)) return
    massDeletingIds.current.add(messageId)
    try {
      await handleTrash(messageId, false)
    } finally {
      massDeletingIds.current.delete(messageId)
    }
  }

  const handleMessageActivate = (messageId: string) => {
    if (massDeleteMode && inboxTab !== 'TRASH') {
      void handleMassDeleteClick(messageId)
      return
    }
    const msg = messages.find(m => m.id === messageId)
    const cid = msg ? resolveMessageConnectionId(msg) : undefined
    onSelectMessage(messageId, cid ? { connectionId: cid } : undefined)
  }

  const handleMessagePrefetch = (messageId: string) => {
    if (massDeleteMode) return
    const msg = messages.find(m => m.id === messageId)
    const cid = msg ? resolveMessageConnectionId(msg) : connectionId
    if (!cid || isAllMailboxesConnectionId(cid)) return
    prefetchThread(workspaceId, cid, messageId, () =>
      api.getMessageThread(workspaceId, cid, messageId)
    )
  }

  const handleDeleteAllPersonal = async () => {
    if (filteredMessages.length === 0 && !hasMore) return
    let countLabel = 'matching personal emails'
    try {
      const countRes = await api.getMessages(workspaceId, connectionId, 1, 1, {
        ...buildFilters(),
        includeTotal: true,
      })
      if (countRes.pagination.totalCount != null) {
        const n = countRes.pagination.totalCount
        countLabel = `${n} personal email${n !== 1 ? 's' : ''}`
      }
    } catch {
      /* generic label */
    }
    if (activeSearch) countLabel += ` matching "${activeSearch}"`
    if (!confirm(`Move ${countLabel} to trash?`)) return
    setDeletingAllPersonal(true)
    try {
      await api.trashPersonalMessages(workspaceId, connectionId, {
        ...(activeSearch ? { search: activeSearch } : {})
      })
      setMessages([])
      setTotalCount(0)
      setHasMore(false)
    } catch { /* */ } finally {
      setDeletingAllPersonal(false)
    }
  }

  const handleReclassify = async (messageId: string, category: 'BUSINESS' | 'PERSONAL') => {
    try {
      await api.reclassifyMessage(workspaceId, messageId, { mailboxCategory: category })
      setMessages(prev => prev.filter(m => m.id !== messageId))
      setTotalCount(prev => (prev == null ? prev : Math.max(0, prev - 1)))
    } catch { /* */ }
  }

  const softRefreshList = useCallback(() => {
    const filters = buildFilters()
    // Revalidate current query only — do not clear rows for same identity.
    activeQueryKeyRef.current = inboxListQueryKey(filters)
    void loadPage(1, filters, false, { soft: true })
  }, [loadPage, buildFilters])

  const formatRetryNotice = (r: {
    queued?: number
    alreadyProcessing?: number
    alreadyClassified?: number
    failed?: number
    outcome?: string
  }) => {
    if (r.outcome) {
      if (r.outcome === 'queued') return 'Classification queued'
      if (r.outcome === 'already_processing') return 'Already processing'
      if (r.outcome === 'already_classified') return 'Already classified'
      return 'Failed to enqueue'
    }
    const parts = [
      r.queued ? `${r.queued} queued` : null,
      r.alreadyProcessing ? `${r.alreadyProcessing} processing` : null,
      r.alreadyClassified ? `${r.alreadyClassified} already classified` : null,
      r.failed ? `${r.failed} failed` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : 'No messages to reclassify'
  }

  const handleRetryClassificationOne = async (messageId: string) => {
    if (reclassifyBusy) return
    setReclassifyBusy(true)
    setReclassifyNotice(null)
    try {
      const r = await api.retryClassification(workspaceId, messageId)
      setReclassifyNotice(formatRetryNotice(r))
      if (r.outcome === 'queued' || r.outcome === 'already_processing') {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? { ...m, classificationStatus: r.outcome === 'queued' ? 'PENDING' : 'PROCESSING' }
              : m
          )
        )
      }
      if (r.outcome === 'already_classified') {
        setMessages(prev => prev.filter(m => m.id !== messageId))
      }
      softRefreshList()
    } catch (e) {
      setReclassifyNotice(e instanceof Error ? e.message : 'Retry failed')
    } finally {
      setReclassifyBusy(false)
    }
  }

  const handleRetryClassificationBulk = async (mode: 'selected' | 'all') => {
    if (reclassifyBusy) return
    if (mode === 'selected' && reclassifySelected.size === 0) {
      setReclassifyNotice('Select emails first')
      return
    }
    setReclassifyBusy(true)
    setReclassifyNotice(null)
    try {
      const r = await api.retryClassificationBulk(workspaceId, {
        inboxConnectionId: connectionId,
        ...(mode === 'selected'
          ? { messageIds: [...reclassifySelected] }
          : { allUnclassified: true }),
      })
      setReclassifyNotice(formatRetryNotice(r))
      setReclassifySelected(new Set())
      softRefreshList()
    } catch (e) {
      setReclassifyNotice(e instanceof Error ? e.message : 'Reclassify failed')
    } finally {
      setReclassifyBusy(false)
    }
  }

  const toggleReclassifySelect = (messageId: string) => {
    setReclassifySelected(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  const unclassifiedStatusBadge = (m: MessageSummary) => {
    const status = m.classificationStatus
    if (status === 'PENDING') {
      return { label: 'Pending', bg: '#e3f2fd', color: '#1565c0', title: 'Queued for classification' }
    }
    if (status === 'PROCESSING') {
      return { label: 'Processing', bg: '#fff3e0', color: '#ef6c00', title: 'Classification in progress' }
    }
    if (status === 'FAILED') {
      return {
        label: 'Failed',
        bg: '#ffebee',
        color: '#c62828',
        title: m.classificationError ?? 'Classification failed',
      }
    }
    return {
      label: 'Unclassified',
      bg: '#fff8e1',
      color: '#f57f17',
      title: 'Waiting for classification, or classify job never ran',
    }
  }

  const handlePin = async (messageId: string, currentlyPinned: boolean) => {
    const newPinned = !currentlyPinned
    const applyLocal = (pinned: boolean) => {
      setMessages((prev) => {
        let next = prev.map((m) =>
          m.id === messageId ? { ...m, isPinned: pinned } : m
        )
        if (!pinned && pinnedOnly) {
          next = next.filter((m) => m.id !== messageId)
        }
        return sortInboxMessagesPinnedFirst(next)
      })
      const activeKey = activeQueryKeyRef.current
      patchCachedInboxMessagePin({
        workspaceId,
        connectionId,
        messageId,
        isPinned: pinned,
        ...(activeKey ? { activeFilterKey: activeKey } : {}),
      })
    }
    applyLocal(newPinned)
    try {
      const msg = messages.find(m => m.id === messageId)
      const cid = msg ? resolveMessageConnectionId(msg) : connectionId
      if (!cid || isAllMailboxesConnectionId(cid)) throw new Error('missing mailbox')
      await api.pinMessage(workspaceId, cid, messageId, newPinned)
    } catch {
      applyLocal(currentlyPinned)
    }
  }

  const renderPhoneCard = (m: MessageSummary) => {
    const status = autoResponseStatus[m.id] ?? 'idle'
    const cardBg = massDeleteMode
      ? (m.isRead ? '#fff5f5' : '#ffe8e8')
      : (m.isPinned ? '#fffde7' : m.isRead ? '#fff' : '#f0f4ff')
    return (
      <div
        key={m.id}
        onClick={() => handleMessageActivate(m.id)}
        onPointerDown={() => handleMessagePrefetch(m.id)}
        onMouseEnter={() => handleMessagePrefetch(m.id)}
        title={massDeleteMode ? 'Click to move to Trash' : undefined}
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          background: cardBg,
          borderLeft: massDeleteMode ? '3px solid #ef5350' : m.isPinned ? '3px solid #f5a623' : 'none',
          cursor: 'pointer',
          minHeight: 44,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1, minWidth: 0 }}>
            {!isViewer && (
              <button
                title={m.isPinned ? 'Unpin' : 'Pin'}
                onClick={e => { e.stopPropagation(); handlePin(m.id, !!m.isPinned) }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 11,
                  color: m.isPinned ? '#e09400' : '#d0d0d0', flexShrink: 0, minHeight: 28,
                  opacity: m.isPinned ? 1 : 0.4, lineHeight: 1,
                }}
              >●</button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{m.senderName ?? m.senderEmail}</div>
              {m.senderName && <div style={{ fontSize: 11, color: '#aaa' }}>{m.senderEmail}</div>}
              {isAllMailboxes && mailboxEmailFor(m) && (
                <div style={{ fontSize: 10, color: '#7c6a00', marginTop: 2 }}>{mailboxEmailFor(m)}</div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', marginLeft: 8 }}>
            {formatDate(m.receivedAt ?? m.sentAt)}
          </div>
        </div>

        <div style={{ marginTop: 4, fontWeight: m.isRead ? 400 : 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{m.subject ?? '(no subject)'}</span>
          <EmailOriginTag origin={m.emailOrigin} />
          {m.hasAttachments && (
            <InboxAttachmentsButton
              workspaceId={workspaceId}
              messageId={m.id}
              open={attachmentPickerOpen === m.id}
              onToggle={() => {
                setAttachmentPickerOpen(attachmentPickerOpen === m.id ? null : m.id)
              }}
            />
          )}
        </div>

        {m.snippet && (
          <div style={{ fontSize: 12, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.snippet.slice(0, 60)}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {showBusinessChrome && m.classification && (
            <TypeBadge type={m.classification.emailType} businessTypeKey={m.classification.businessTypeKey} />
          )}
          {showBusinessChrome && !m.classification && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 10,
                background: '#fff8e1',
                color: '#f57f17',
                whiteSpace: 'nowrap',
              }}
              title="No Classification row yet — EmailMessage.mailboxCategory alone is not trustworthy"
            >
              Unclassified
            </span>
          )}
          {showUnclassifiedChrome && (() => {
            const badge = unclassifiedStatusBadge(m)
            return (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 10,
                  background: badge.bg,
                  color: badge.color,
                  whiteSpace: 'nowrap',
                }}
                title={badge.title}
              >
                {badge.label}
              </span>
            )
          })()}
          {showBusinessChrome && m.classification && !isSentEmail(m) && (
            <PriorityBadge priority={m.classification.priority} />
          )}
          {showBusinessChrome && (
            <button
              type="button"
              disabled={isViewer}
              aria-label={m.job ? 'Change Job assignment' : 'Assign email to Job'}
              onClick={(e) => {
                e.stopPropagation()
                if (isViewer) return
                setAssignmentTarget(m)
              }}
              title={m.job ? formatJobTooltip(m.job) : 'Assign email to Job'}
              style={{
                fontSize: 10, fontWeight: m.job ? 600 : 500, padding: '1px 7px', borderRadius: 10,
                border: 'none',
                background: m.job ? '#e0f2f1' : '#f0f0f0',
                color: m.job ? '#00695c' : '#999',
                whiteSpace: 'nowrap',
                cursor: isViewer ? 'default' : 'pointer',
                maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {m.job ? formatJobPrimaryLabel(m.job, 22) : 'Unassigned'}
            </button>
          )}
        </div>

        {SHOW_INBOX_SUGGESTED_RESPONSE && showBusinessChrome && m.classification?.priority === 'LOW' && (() => {
          if (status === 'sent') return (
            <div style={{ marginTop: 6, fontSize: 11, color: '#2e7d32', fontWeight: 600 }}>Sent ✓</div>
          )
          if (status === 'sending') return (
            <div style={{ marginTop: 6, fontSize: 11, color: '#999' }}>Sending...</div>
          )
          return (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>Suggested response</span>
              <button onClick={() => handleAutoResponse(m, true)}
                style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid #4caf50', background: '#e8f5e9', color: '#2e7d32', cursor: 'pointer', fontWeight: 600, minHeight: 28 }}>Yes</button>
              <button onClick={() => handleAutoResponse(m, false)}
                style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid #ef5350', background: '#ffebee', color: '#c62828', cursor: 'pointer', fontWeight: 600, minHeight: 28 }}>No</button>
            </div>
          )
        })()}

        {!isViewer && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            {(inboxTab === 'PERSONAL' || showUnclassifiedChrome) && (
              <MailboxCategoryDot
                category="BUSINESS"
                onClick={() => void handleReclassify(m.id, 'BUSINESS')}
              />
            )}
            {(showBusinessChrome || showUnclassifiedChrome) && (
              <MailboxCategoryDot
                category="PERSONAL"
                onClick={() => void handleReclassify(m.id, 'PERSONAL')}
              />
            )}
            {showUnclassifiedChrome && (
              <button
                title="Retry classification"
                disabled={reclassifyBusy}
                onClick={() => void handleRetryClassificationOne(m.id)}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  border: '1px solid #c5cae9', background: '#e8eaf6', color: '#3949ab',
                  cursor: reclassifyBusy ? 'not-allowed' : 'pointer', minHeight: 28, opacity: reclassifyBusy ? 0.6 : 1,
                }}
              >
                Retry
              </button>
            )}
            <span style={{ flex: 1 }} />
            {inboxTab !== 'TRASH' ? (
              <button title="Trash" onClick={() => handleTrash(m.id, false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#bbb', padding: 2, minHeight: 28, fontWeight: 500 }}>✕</button>
            ) : (
              <button title="Restore" onClick={() => handleTrash(m.id, true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#888', padding: 2, minHeight: 28 }}>{'\u21A9'}</button>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderTableRow = (m: MessageSummary) => {
    const rowBg = massDeleteMode
      ? (m.isRead ? '#fff5f5' : '#ffe8e8')
      : (m.isPinned ? '#fffde7' : m.isRead ? '' : '#f0f4ff')
    const hoverBg = massDeleteMode ? '#ffebee' : '#f8f9fb'
    return (
    <tr key={m.id}
      onClick={() => handleMessageActivate(m.id)}
      onPointerDown={() => handleMessagePrefetch(m.id)}
      onMouseEnter={() => handleMessagePrefetch(m.id)}
      title={massDeleteMode ? 'Click to move to Trash' : undefined}
      style={{
        borderBottom: '1px solid #f0f0f0',
        cursor: 'pointer',
        background: rowBg,
        borderLeft: massDeleteMode ? '3px solid #ef5350' : m.isPinned ? '3px solid #f5a623' : 'none',
      }}
      onMouseOver={e => (e.currentTarget.style.background = hoverBg)}
      onMouseOut={e => (e.currentTarget.style.background = rowBg)}>
      <td style={{ padding: '7px 4px', textAlign: 'center', width: 28 }} onClick={e => e.stopPropagation()}>
        {!isViewer && (
          <button
            title={m.isPinned ? 'Unpin' : 'Pin'}
            onClick={() => handlePin(m.id, !!m.isPinned)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 10,
              color: m.isPinned ? '#e09400' : '#d0d0d0', lineHeight: 1,
              opacity: m.isPinned ? 1 : 0.35,
            }}
          >●</button>
        )}
      </td>
      {showBusinessChrome && (
        <td style={{ padding: '7px 6px', textAlign: 'center', fontSize: 14 }}>
          {m.isImportant && <span title="Important" style={{ color: '#f5a623' }}>{'\u2605'}</span>}
        </td>
      )}
      <td style={{ padding: '7px 12px' }}>
        <div style={{ fontWeight: m.isRead ? 500 : 700, fontSize: 13 }}>{m.senderName ?? m.senderEmail}</div>
        {m.senderName && <div style={{ fontSize: 11, color: '#aaa' }}>{m.senderEmail}</div>}
        {isAllMailboxes && mailboxEmailFor(m) && (
          <div style={{ fontSize: 10, color: '#7c6a00', marginTop: 2 }}>{mailboxEmailFor(m)}</div>
        )}
      </td>
      <td style={{ padding: '7px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: m.isRead ? 400 : 600 }}>{m.subject ?? '(no subject)'}</span>
          <EmailOriginTag origin={m.emailOrigin} />
          {m.hasAttachments && (
            <InboxAttachmentsButton
              workspaceId={workspaceId}
              messageId={m.id}
              open={attachmentPickerOpen === m.id}
              onToggle={() => {
                setAttachmentPickerOpen(attachmentPickerOpen === m.id ? null : m.id)
              }}
            />
          )}
        </div>
        {m.snippet && <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>{m.snippet.slice(0, 60)}</div>}
        {SHOW_INBOX_SUGGESTED_RESPONSE && showBusinessChrome && m.classification?.priority === 'LOW' && (() => {
          const status = autoResponseStatus[m.id] ?? 'idle'
          if (status === 'sent') return (
            <div style={{ marginTop: 4, fontSize: 11, color: '#2e7d32', fontWeight: 600 }}>Sent ✓</div>
          )
          if (status === 'sending') return (
            <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>Sending...</div>
          )
          return (
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>Suggested response available</span>
              <button onClick={() => handleAutoResponse(m, true)}
                style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #4caf50', background: '#e8f5e9', color: '#2e7d32', cursor: 'pointer', fontWeight: 600 }}>Yes</button>
              <button onClick={() => handleAutoResponse(m, false)}
                style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #ef5350', background: '#ffebee', color: '#c62828', cursor: 'pointer', fontWeight: 600 }}>No</button>
            </div>
          )
        })()}
      </td>
      {showBusinessChrome && !isTablet && (
        <td style={{ padding: '7px 12px' }}>
          {m.classification ? (
            <TypeBadge type={m.classification.emailType} businessTypeKey={m.classification.businessTypeKey} />
          ) : (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 10,
                background: '#fff8e1',
                color: '#f57f17',
                whiteSpace: 'nowrap',
              }}
              title="No Classification row yet"
            >
              Unclassified
            </span>
          )}
        </td>
      )}
      {showBusinessChrome && !isTablet && (
        <td style={{ padding: '7px 12px' }} onClick={e => e.stopPropagation()}>
          <button
            type="button"
            disabled={isViewer}
            aria-label={m.job ? 'Change Job assignment' : 'Assign email to Job'}
            onClick={(e) => {
              e.stopPropagation()
              if (isViewer) return
              setAssignmentTarget(m)
            }}
            title={m.job ? formatJobTooltip(m.job) : 'Assign email to Job'}
            style={{
              fontSize: 10, fontWeight: m.job ? 600 : 500, padding: '1px 7px', borderRadius: 10,
              border: 'none',
              background: m.job ? '#e0f2f1' : '#f0f0f0',
              color: m.job ? '#00695c' : '#999',
              whiteSpace: 'nowrap', cursor: isViewer ? 'default' : 'pointer',
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block',
            }}
          >
            {m.job ? formatJobPrimaryLabel(m.job, 24) : 'Unassigned'}
          </button>
        </td>
      )}
      {showUnclassifiedChrome && !isTablet && (
        <td style={{ padding: '7px 12px' }}>
          {(() => {
            const badge = unclassifiedStatusBadge(m)
            return (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 10,
                  background: badge.bg,
                  color: badge.color,
                  whiteSpace: 'nowrap',
                }}
                title={badge.title}
              >
                {badge.label}
              </span>
            )
          })()}
        </td>
      )}
      {showBusinessChrome && (
        <td style={{ padding: '7px 12px' }}>
          {m.classification && !isSentEmail(m)
            ? <PriorityBadge priority={m.classification.priority} />
            : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}
        </td>
      )}
      <td style={inboxDateCellStyle}>{formatDate(m.receivedAt ?? m.sentAt)}</td>
      <td
        style={{
          padding: '7px 4px',
          textAlign: 'right',
          width: showUnclassifiedChrome ? undefined : INBOX_ACTIONS_COLUMN_WIDTH_PX,
          whiteSpace: 'nowrap',
        }}
        onClick={e => e.stopPropagation()}
      >
        {!isViewer && (
          <div style={{ display: 'inline-flex', gap: 0, justifyContent: 'flex-end', alignItems: 'center' }}>
            {showUnclassifiedChrome && (
              <input
                type="checkbox"
                checked={reclassifySelected.has(m.id)}
                onChange={() => toggleReclassifySelect(m.id)}
                title="Select for reclassify"
                aria-label="Select for reclassify"
                style={{ marginRight: 2 }}
              />
            )}
            {(inboxTab === 'PERSONAL' || showUnclassifiedChrome) && (
              <MailboxCategoryDot
                category="BUSINESS"
                onClick={() => void handleReclassify(m.id, 'BUSINESS')}
              />
            )}
            {(showBusinessChrome || showUnclassifiedChrome) && (
              <MailboxCategoryDot
                category="PERSONAL"
                onClick={() => void handleReclassify(m.id, 'PERSONAL')}
              />
            )}
            {showUnclassifiedChrome && (
              <button
                title="Retry classification"
                disabled={reclassifyBusy}
                onClick={() => void handleRetryClassificationOne(m.id)}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  border: '1px solid #c5cae9', background: '#e8eaf6', color: '#3949ab',
                  cursor: reclassifyBusy ? 'not-allowed' : 'pointer', opacity: reclassifyBusy ? 0.6 : 1,
                }}
              >
                Retry
              </button>
            )}
            {inboxTab !== 'TRASH' ? (
              <button title="Trash" onClick={() => handleTrash(m.id, false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#bbb', padding: 2, fontWeight: 500 }}>✕</button>
            ) : (
              <button title="Restore" onClick={() => handleTrash(m.id, true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#888', padding: 2 }}>{'\u21A9'}</button>
            )}
          </div>
        )}
      </td>
    </tr>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Inbox</h2>
          <span style={{ fontSize: 12, color: '#999' }}>
            {refreshing
              ? 'Updating…'
              : totalCount != null
                ? `${totalCount} messages`
                : hasMore
                  ? `${filteredMessages.length}+ loaded`
                  : `${filteredMessages.length} loaded`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {inboxTab === 'PERSONAL' && !isViewer && filteredMessages.length > 0 && (
            <button
              onClick={handleDeleteAllPersonal}
              disabled={deletingAllPersonal}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 500, borderRadius: 5,
                border: '1px solid #fca5a5', background: '#fff', color: '#dc2626',
                cursor: deletingAllPersonal ? 'not-allowed' : 'pointer',
                opacity: deletingAllPersonal ? 0.6 : 1, whiteSpace: 'nowrap',
              }}
            >
              {deletingAllPersonal ? 'Deleting...' : 'Delete All'}
            </button>
          )}
          {showUnclassifiedChrome && !isViewer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={reclassifyBusy || reclassifySelected.size === 0}
                onClick={() => void handleRetryClassificationBulk('selected')}
                style={{
                  padding: '5px 10px', fontSize: 12, fontWeight: 500, borderRadius: 5,
                  border: '1px solid #c5cae9', background: '#e8eaf6', color: '#3949ab',
                  cursor: reclassifyBusy || reclassifySelected.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: reclassifyBusy || reclassifySelected.size === 0 ? 0.55 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                Reclassify selected{reclassifySelected.size > 0 ? ` (${reclassifySelected.size})` : ''}
              </button>
              <button
                type="button"
                disabled={reclassifyBusy}
                onClick={() => void handleRetryClassificationBulk('all')}
                style={{
                  padding: '5px 10px', fontSize: 12, fontWeight: 500, borderRadius: 5,
                  border: '1px solid #9fa8da', background: '#fff', color: '#303f9f',
                  cursor: reclassifyBusy ? 'not-allowed' : 'pointer',
                  opacity: reclassifyBusy ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                Reclassify all unclassified
              </button>
            </div>
          )}
          {!isViewer && inboxTab !== 'TRASH' && (
            <button
              type="button"
              title={massDeleteMode ? 'Exit delete mode' : 'Delete mode — click emails to trash them'}
              aria-pressed={massDeleteMode}
              onClick={() => setMassDeleteMode(prev => !prev)}
              style={{
                padding: '5px 10px', fontSize: 14, fontWeight: 600, borderRadius: 5, lineHeight: 1,
                border: massDeleteMode ? '1px solid #ef5350' : '1px solid #ddd',
                background: massDeleteMode ? '#ffebee' : '#fff',
                color: massDeleteMode ? '#c62828' : '#888',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {'\uD83D\uDDD1'}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', background: '#fff', flex: isPhone ? '1 1 180px' : '0 1 auto', minWidth: isPhone ? 0 : undefined }}>
            <input
              type="search"
              data-testid="inbox-unified-search"
              aria-label="Search emails"
              placeholder="Search emails…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '6px 12px', border: 'none', fontSize: 13, outline: 'none',
                width: isPhone ? '100%' : 320,
                minWidth: isPhone ? 120 : undefined,
                background: 'transparent',
              }}
            />
          </div>
          {onCompose && !isViewer && (
            <button
              type="button"
              onClick={onCompose}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '7px 18px',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.01em',
                borderRadius: 6,
                border: 'none',
                background: '#1a1a1a',
                color: '#fff',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                flexShrink: 0,
              }}
            >
              Compose
            </button>
          )}
        </div>
      </div>

      {massDeleteMode && inboxTab !== 'TRASH' && (
        <div
          role="status"
          style={{
            marginBottom: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: '#ffebee', color: '#b71c1c', border: '1px solid #ef9a9a',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}
        >
          <span>Delete mode — click any email to move it to Trash.</span>
          <button
            type="button"
            onClick={() => setMassDeleteMode(false)}
            style={{
              padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
              border: '1px solid #ef9a9a', background: '#fff', color: '#c62828', cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      )}

      {reclassifyNotice && showUnclassifiedChrome && (
        <div
          role="status"
          style={{
            marginBottom: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: '#e8eaf6', color: '#283593', border: '1px solid #c5cae9',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}
        >
          <span>{reclassifyNotice}</span>
          <button
            type="button"
            onClick={() => setReclassifyNotice(null)}
            style={{
              padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
              border: '1px solid #c5cae9', background: '#fff', color: '#3949ab', cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="inbox-filters" data-testid="inbox-filter-toolbar">
        {/* Row 1 — mailbox/category + quick filters. Unclassified is intentionally hidden. */}
        <div
          data-testid="inbox-filter-row-primary"
          className="inbox-filter-row is-primary"
        >
          <div className="inbox-filter-group">
            <button
              type="button"
              data-testid="inbox-primary-business"
              aria-pressed={inboxTab === 'ALL_BUSINESS'}
              onClick={() => selectInboxTab('ALL_BUSINESS')}
              className={`inbox-chip${inboxTab === 'ALL_BUSINESS' ? ' is-active' : ''}`}
            >
              Business
            </button>
            <button
              type="button"
              data-testid="inbox-primary-sent"
              aria-pressed={isSentView}
              onClick={() => selectDirectionFilter(isSentView ? '' : 'sent')}
              className={`inbox-chip${isSentView ? ' is-active' : ''}`}
            >
              Sent
            </button>
            {!(isAllMailboxes && !canSeeAllPersonal) &&
              !(!isAllMailboxes && !canSeeAllPersonal && !isOwnInbox) && (
                <button
                  type="button"
                  data-testid="inbox-primary-personal"
                  aria-pressed={inboxTab === 'PERSONAL'}
                  onClick={() => selectInboxTab('PERSONAL')}
                  className={`inbox-chip${inboxTab === 'PERSONAL' ? ' is-active' : ''}`}
                >
                  Personal
                </button>
              )}
          </div>
          <div className="inbox-filter-group inbox-filter-group-quick">
            <button
              type="button"
              data-testid="inbox-pinned-filter"
              aria-pressed={pinnedOnly}
              title="Show only pinned emails"
              onClick={() => setPinnedOnly((prev) => !prev)}
              className={`inbox-chip${pinnedOnly ? ' is-accent' : ''}`}
            >
              Pinned
            </button>
            <button
              type="button"
              data-testid="inbox-unread-filter"
              aria-pressed={readFilter === 'unread'}
              title="Show unread emails"
              onClick={() =>
                selectDirectionFilter(readFilter === 'unread' ? '' : 'unread')
              }
              className={`inbox-chip${
                readFilter === 'unread' ? ' is-soft-active' : ''
              }`}
            >
              Unread
            </button>
            {showBusinessChrome && !isSentView && (
              <button
                type="button"
                data-testid="inbox-active-bid-filter"
                aria-pressed={businessTypeKey === 'BID_OPPORTUNITY'}
                title="Emails discovered in Projects/Bid Invites"
                onClick={toggleActiveBid}
                className={`inbox-chip${
                  businessTypeKey === 'BID_OPPORTUNITY' ? ' is-soft-active' : ''
                }`}
              >
                {INBOX_BID_INVITES_SOURCE_FILTER_LABEL}
              </button>
            )}
            {showBusinessChrome && isSentView && (
              <button
                type="button"
                data-testid="inbox-quote-filter"
                aria-pressed={businessTypeKey === 'ESTIMATE_QUOTE'}
                title="Sent Quote emails"
                onClick={toggleQuoteFilter}
                className={`inbox-chip${
                  businessTypeKey === 'ESTIMATE_QUOTE' ? ' is-soft-active' : ''
                }`}
              >
                Quote
              </button>
            )}
          </div>
          <div className="inbox-filter-group inbox-filter-group-trash">
            <button
              type="button"
              data-testid="inbox-primary-trash"
              aria-pressed={inboxTab === 'TRASH'}
              onClick={() => selectInboxTab('TRASH')}
              className={`inbox-chip${inboxTab === 'TRASH' ? ' is-active' : ''}`}
            >
              Trash
            </button>
          </div>
        </div>

        {/* Row 2 — dropdown refinements */}
        {showBusinessChrome && (
          <div
            data-testid="inbox-filter-row-secondary"
            className="inbox-filter-row is-secondary"
          >
            <div className="inbox-filter-group">
              <JobFilterSelect
                workspaceId={workspaceId}
                value={jobFilter}
                onChange={setJobFilter}
                className="inbox-toolbar"
              />
              <InboxDateSelect
                value={dateRange}
                onChange={setDateRange}
              />
              <InboxPrioritySelect
                value={priorityFilter}
                onChange={setPriorityFilter}
              />
              <InboxSubtypeSelect
                direction={isSentView ? 'sent' : 'incoming'}
                value={
                  businessTypeKey === 'ESTIMATE_QUOTE' ||
                  businessTypeKey === 'BID_OPPORTUNITY'
                    ? ''
                    : businessTypeKey
                }
                onChange={setBusinessTypeKey}
              />
            </div>
          </div>
        )}
      </div>

      {/* Message list */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading && messages.length === 0 ? (
          <div className="inbox-skeleton" aria-busy="true" aria-label="Loading inbox">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="inbox-skeleton-row">
                <div className="inbox-skeleton-bar" style={{ width: '18%' }} />
                <div className="inbox-skeleton-bar" style={{ width: '42%' }} />
                <div className="inbox-skeleton-bar" style={{ width: '12%' }} />
                <div className="inbox-skeleton-bar" style={{ width: '14%' }} />
              </div>
            ))}
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <div className="empty-icon">{inboxTab === 'TRASH' ? '\uD83D\uDDD1' : isSentView ? '\uD83D\uDCE4' : inboxTab === 'PERSONAL' ? '\uD83D\uDCE8' : inboxTab === 'UNCLASSIFIED' ? '\u26A0' : '\u2709'}</div>
            <h3>{activeSearch ? 'No results' : isSentView
              ? `No sent ${INBOX_TABS.find(t => t.key === inboxTab)?.label.toLowerCase() ?? ''} emails`
              : `No ${INBOX_TABS.find(t => t.key === inboxTab)?.label.toLowerCase() ?? ''} emails`}</h3>
            <p>{activeSearch
              ? `No messages match "${activeSearch}"`
              : inboxTab === 'UNCLASSIFIED'
                ? 'Emails waiting for classification (or where classify failed) will appear here.'
                : 'Emails will appear here after syncing and classification.'}</p>
          </div>
        ) : isPhone ? (
          <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff' }}>
            {filteredMessages.map(renderPhoneCard)}
            {loadingMore && <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 13 }}>Loading more...</div>}
            {!hasMore && filteredMessages.length > 0 && <div style={{ padding: 10, textAlign: 'center', color: '#ccc', fontSize: 12 }}>End of list</div>}
          </div>
        ) : (
          <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '8px 4px', width: 28 }}></th>
                  {showBusinessChrome && <th style={{ padding: '8px 6px', width: 28 }}></th>}
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>From</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Subject</th>
                  {showBusinessChrome && !isTablet && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Type</th>}
                  {showBusinessChrome && !isTablet && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Job</th>}
                  {showUnclassifiedChrome && !isTablet && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Status</th>}
                  {showBusinessChrome && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Priority</th>}
                  <th style={{ padding: '8px 14px 8px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>Date</th>
                  <th style={{
                    padding: '8px 4px',
                    width: showUnclassifiedChrome ? undefined : INBOX_ACTIONS_COLUMN_WIDTH_PX,
                  }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredMessages.map(renderTableRow)}
              </tbody>
            </table>
            {loadingMore && <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 13 }}>Loading more...</div>}
            {!hasMore && filteredMessages.length > 0 && <div style={{ padding: 10, textAlign: 'center', color: '#ccc', fontSize: 12 }}>End of list</div>}
          </div>
        )}
      </div>
      {assignmentTarget && (
        <EmailJobAssignmentDialog
          workspaceId={workspaceId}
          messageId={assignmentTarget.id}
          subject={assignmentTarget.subject}
          businessTypeKey={assignmentTarget.classification?.businessTypeKey}
          currentJob={assignmentTarget.job ? {
            id: assignmentTarget.job.id,
            name: assignmentTarget.job.name,
            status: assignmentTarget.job.status,
            jobNumber: assignmentTarget.job.jobNumber,
          } : null}
          suggestedJobName={assignmentTarget.suggestedJob?.name ?? null}
          onClose={() => setAssignmentTarget(null)}
          onAssigned={(job) => {
            applyJobToMessage(assignmentTarget.id, job)
            setAssignmentTarget(null)
          }}
          onRemoved={() => {
            applyJobToMessage(assignmentTarget.id, null)
            setAssignmentTarget(null)
          }}
          onCreated={(job) => {
            applyJobToMessage(assignmentTarget.id, job)
            setAssignmentTarget(null)
          }}
        />
      )}
    </div>
  )
}

function InboxFilterDropdown({
  testId,
  label,
  ariaLabel,
  active,
  wide,
  children,
}: {
  testId: string
  label: string
  ariaLabel: string
  active: boolean
  wide?: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="inbox-chip-wrap">
      <button
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={label}
        className={`inbox-chip has-caret${active ? ' is-soft-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="inbox-chip-label">{label}</span>
      </button>
      {open && (
        <div
          className={`inbox-filter-menu${wide ? ' is-wide' : ''}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function InboxMenuOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`inbox-filter-menu-item${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <span className="inbox-filter-check" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
      {children}
    </button>
  )
}

function InboxDateSelect({
  value,
  onChange,
}: {
  value: '' | 'TODAY' | 'WEEK' | 'MONTH'
  onChange: (next: '' | 'TODAY' | 'WEEK' | 'MONTH') => void
}) {
  const options: Array<{ key: '' | 'TODAY' | 'WEEK' | 'MONTH'; label: string }> = [
    { key: '', label: 'Dates' },
    { key: 'TODAY', label: 'Today' },
    { key: 'WEEK', label: 'This week' },
    { key: 'MONTH', label: 'This month' },
  ]
  const selected = options.find((o) => o.key === value)
  const label = value ? (selected?.label ?? 'Dates') : 'Dates'
  return (
    <InboxFilterDropdown
      testId="inbox-date-filter"
      label={label}
      ariaLabel="Dates"
      active={Boolean(value)}
    >
      {(close) =>
        options.map((o) => (
          <InboxMenuOption
            key={o.key || 'all'}
            selected={o.key === value}
            onSelect={() => {
              onChange(o.key)
              close()
            }}
          >
            {o.label}
          </InboxMenuOption>
        ))
      }
    </InboxFilterDropdown>
  )
}

function InboxSubtypeSelect({
  direction,
  value,
  onChange,
}: {
  direction: 'incoming' | 'sent'
  value: string
  onChange: (next: string) => void
}) {
  const options = businessSubtypeFilterOptionsForDirection(direction).filter(
    (o) =>
      // Dedicated Quote control in Sent — hide ESTIMATE_QUOTE here.
      // Bid Opportunity remains (subtype label); Active Bid owns provenance UX.
      o.key !== 'ESTIMATE_QUOTE' && o.key !== 'GENERAL'
  )
  const selected = options.find((o) => o.key === value)
  const label = selected?.label ?? 'Subtype'
  return (
    <InboxFilterDropdown
      testId="inbox-subtype-filter"
      label={label}
      ariaLabel={selected ? `Subtype: ${selected.label}` : 'Subtype'}
      active={Boolean(value)}
      wide
    >
      {(close) => (
        <>
          <InboxMenuOption
            selected={!value}
            onSelect={() => {
              onChange('')
              close()
            }}
          >
            Subtype
          </InboxMenuOption>
          <div className="inbox-filter-menu-divider" aria-hidden="true" />
          {options.map((o) => (
            <InboxMenuOption
              key={o.key}
              selected={o.key === value}
              onSelect={() => {
                onChange(o.key === value ? '' : o.key)
                close()
              }}
            >
              {o.label}
            </InboxMenuOption>
          ))}
        </>
      )}
    </InboxFilterDropdown>
  )
}

function InboxPrioritySelect({
  value,
  onChange,
}: {
  value: Set<PriorityKey>
  onChange: (next: Set<PriorityKey>) => void
}) {
  const allOn = value.size === 3
  const active = !allOn && value.size > 0
  const selectedKey: PriorityKey | '' = allOn
    ? ''
    : value.has('HIGH') && value.size === 1
      ? 'HIGH'
      : value.has('NORMAL') && value.size === 1
        ? 'NORMAL'
        : value.has('LOW') && value.size === 1
          ? 'LOW'
          : ''
  const label =
    selectedKey === 'HIGH'
      ? 'High Priority'
      : selectedKey === 'NORMAL'
        ? 'Normal Priority'
        : selectedKey === 'LOW'
          ? 'Low Priority'
          : 'Priority'
  return (
    <InboxFilterDropdown
      testId="inbox-priority-filter"
      label={label}
      ariaLabel={`Priority filter: ${label}`}
      active={active}
    >
      {(close) => (
        <>
          <InboxMenuOption
            selected={allOn || value.size === 0}
            onSelect={() => {
              onChange(new Set(['LOW', 'NORMAL', 'HIGH']))
              close()
            }}
          >
            All
          </InboxMenuOption>
          {([['HIGH', 'High'], ['NORMAL', 'Normal'], ['LOW', 'Low']] as const).map(
            ([key, text]) => (
              <InboxMenuOption
                key={key}
                selected={selectedKey === key}
                onSelect={() => {
                  onChange(new Set([key]))
                  close()
                }}
              >
                {text}
              </InboxMenuOption>
            )
          )}
        </>
      )}
    </InboxFilterDropdown>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    if (d.toDateString() === now.toDateString()) return `Today, ${time}`
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (d.getFullYear() !== now.getFullYear()) return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${time}`
    return `${date}, ${time}`
  } catch { return iso }
}
