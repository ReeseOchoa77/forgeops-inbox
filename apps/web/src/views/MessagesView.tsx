import { useEffect, useState, useRef, useCallback } from 'react'
import { api, type JobLookup, type MessageSummary, type ConnectionSummary, type StoredAttachment } from '../api'
import { buildInboxMessageListFilters } from '../inbox-message-list-filters'
import { PriorityBadge, TypeBadge } from '../components/Badges'
import type { Breakpoint } from '../hooks/useBreakpoint'

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
                  {att.filename}
                </div>
                <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>
                  {formatAttachmentSize(att.sizeBytes)}
                  {att.uploadStatus !== 'UPLOADED' ? ` · ${att.uploadStatus.toLowerCase()}` : ''}
                </div>
              </div>
              {att.uploadStatus === 'UPLOADED' ? (
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
              ) : (
                <span style={{ fontSize: 10, color: '#bbb', flexShrink: 0 }}>Unavailable</span>
              )}
            </div>
          ))}
        </div>
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
  onSelectMessage: (id: string) => void
  userRole: string
  userEmail: string
  connections: ConnectionSummary[]
  breakpoint?: Breakpoint
}

const PAGE_SIZE = 30

type InboxTab = 'ALL_BUSINESS' | 'BIDS_ESTIMATING' | 'PROJECTS' | 'PURCHASING' | 'ACCOUNTING' | 'INTERNAL' | 'OTHER' | 'PERSONAL' | 'TRASH'

const INBOX_TABS: Array<{ key: InboxTab; label: string }> = [
  { key: 'ALL_BUSINESS', label: 'All Business' },
  { key: 'BIDS_ESTIMATING', label: 'Bids & Estimating' },
  { key: 'PROJECTS', label: 'Projects' },
  { key: 'PURCHASING', label: 'Purchasing' },
  { key: 'ACCOUNTING', label: 'Accounting' },
  { key: 'INTERNAL', label: 'Internal' },
  { key: 'OTHER', label: 'Other' },
  { key: 'PERSONAL', label: 'Personal' },
  { key: 'TRASH', label: 'Trash' },
]

type ReadFilter = '' | 'unread' | 'read' | 'sent'
type PriorityKey = 'LOW' | 'MEDIUM' | 'HIGH'

export function MessagesView({ workspaceId, connectionId, onSelectMessage, userRole, userEmail, connections, breakpoint = 'desktop' }: Props) {
  const isViewer = userRole === 'VIEWER'
  const canSeeAllPersonal = userRole === 'ADMIN' || userRole === 'OWNER'
  const currentConnectionEmail = connections.find(c => c.id === connectionId)?.email ?? ''
  const isOwnInbox = userEmail.toLowerCase() === currentConnectionEmail.toLowerCase()
  const monitoredEmails = new Set(connections.map(c => c.email.toLowerCase()))
  const isSentEmail = (m: MessageSummary) => monitoredEmails.has(m.senderEmail.toLowerCase())
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [inboxTab, setInboxTab] = useState<InboxTab>('ALL_BUSINESS')
  const [readFilter, setReadFilter] = useState<ReadFilter>('')
  const [priorityFilter, setPriorityFilter] = useState<Set<PriorityKey>>(new Set(['LOW', 'MEDIUM', 'HIGH']))
  const [jobFilter, setJobFilter] = useState('')
  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [searchIn, setSearchIn] = useState<'all' | 'sender'>('all')

  const [autoResponseStatus, setAutoResponseStatus] = useState<Record<string, AutoResponseStatus>>({})
  const [jobPickerOpen, setJobPickerOpen] = useState<string | null>(null)
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState<string | null>(null)
  const [jobAssigning, setJobAssigning] = useState(false)
  const [deletingAllPersonal, setDeletingAllPersonal] = useState(false)
  /** When on, clicking a list row trashes it instead of opening the email. */
  const [massDeleteMode, setMassDeleteMode] = useState(false)
  const massDeletingIds = useRef<Set<string>>(new Set())

  const handleAssignJob = async (messageId: string, jobId: string) => {
    setJobAssigning(true)
    try {
      await api.assignEmailToJob(workspaceId, jobId, { messageId })
      const job = jobs.find(j => j.id === jobId)
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, job: job ? { id: job.id, jobNumber: job.jobNumber, name: job.name, status: job.status } : m.job } : m))
      setJobPickerOpen(null)
    } catch { /* */ }
    finally { setJobAssigning(false) }
  }

  useEffect(() => {
    if (!jobPickerOpen && !attachmentPickerOpen) return
    const close = () => {
      setJobPickerOpen(null)
      setAttachmentPickerOpen(null)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [jobPickerOpen, attachmentPickerOpen])

  const handleRemoveJob = async (messageId: string, jobId: string) => {
    try {
      await api.removeEmailFromJob(workspaceId, jobId, messageId)
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, job: undefined } : m))
      setJobPickerOpen(null)
    } catch { /* */ }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const connectionResetRef = useRef(false)

  const isBusiness = inboxTab !== 'PERSONAL' && inboxTab !== 'TRASH'
  const isSentView = readFilter === 'sent'
  /** Business subtype chrome (priority/job/type columns) — not on Personal, Trash, or global Sent. */
  const showBusinessChrome = isBusiness && !isSentView

  const isPhone = breakpoint === 'phone'
  const isTablet = breakpoint === 'tablet'

  const handleAutoResponse = async (msg: MessageSummary, affirm: boolean) => {
    setAutoResponseStatus(prev => ({ ...prev, [msg.id]: 'sending' }))
    try {
      await api.sendMessage(workspaceId, connectionId, {
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
        if (priorityFilter.has('MEDIUM') && (p === 'MEDIUM' || p === 'NORMAL')) return true
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
      jobFilter,
      activeSearch,
      searchIn,
    })
  }, [inboxTab, activeSearch, jobFilter, readFilter, searchIn])

  const selectDirectionFilter = (key: ReadFilter) => {
    if (key === 'sent') {
      // Global Sent: clear Business/Personal category + job so they cannot stale-combine.
      setReadFilter('sent')
      setInboxTab('ALL_BUSINESS')
      setJobFilter('')
      setPriorityFilter(new Set(['LOW', 'MEDIUM', 'HIGH']))
      return
    }
    setReadFilter(key)
  }

  const selectInboxTab = (tab: InboxTab) => {
    // Leaving Sent (or switching category) always clears sentOnly.
    setInboxTab(tab)
    setReadFilter('')
    setPriorityFilter(new Set(['LOW', 'MEDIUM', 'HIGH']))
    if (tab === 'PERSONAL' || tab === 'TRASH') setJobFilter('')
    if (tab === 'TRASH') setMassDeleteMode(false)
  }

  const loadPage = useCallback(async (pageNum: number, filters: ReturnType<typeof buildFilters>, append: boolean) => {
    if (pageNum === 1) setLoading(true)
    else setLoadingMore(true)
    try {
      const r = await api.getMessages(workspaceId, connectionId, pageNum, PAGE_SIZE, filters)
      if (append) {
        setMessages(prev => [...prev, ...r.messages])
      } else {
        setMessages(r.messages)
      }
      setTotalCount(r.pagination.totalCount)
      setHasMore(r.pagination.hasMore)
      setPage(pageNum)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [workspaceId, connectionId])

  useEffect(() => {
    api.getJobsLookup(workspaceId, { showArchived: false })
      .then(r => setJobs(r.jobs))
      .catch(() => setJobs([]))
  }, [workspaceId])

  useEffect(() => {
    connectionResetRef.current = true
    setMessages([])
    setPage(1)
    setHasMore(true)
    setTotalCount(null)
    setSearch('')
    setActiveSearch('')
    setSearchIn('all')
    setInboxTab('ALL_BUSINESS')
    setReadFilter('')
    setPriorityFilter(new Set(['LOW', 'MEDIUM', 'HIGH']))
    setJobFilter('')
    setMassDeleteMode(false)
    loadPage(1, { businessCategory: 'BUSINESS' }, false)
  }, [workspaceId, connectionId])

  const sentOnly = readFilter === 'sent'
  const unreadOnly = readFilter === 'unread'

  useEffect(() => {
    if (connectionResetRef.current) {
      connectionResetRef.current = false
      return
    }
    const filters = buildFilters()
    setMessages([])
    setPage(1)
    setHasMore(true)
    setTotalCount(null)
    loadPage(1, filters, false)
  }, [inboxTab, activeSearch, jobFilter, sentOnly, unreadOnly, searchIn])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setActiveSearch(search) }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loadingMore || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      loadPage(page + 1, buildFilters(), true)
    }
  }, [page, buildFilters, hasMore, loadingMore, loadPage])

  const handleTrash = async (messageId: string, isTrashed: boolean) => {
    try {
      if (isTrashed) await api.untrashMessage(workspaceId, connectionId, messageId)
      else await api.trashMessage(workspaceId, connectionId, messageId)
      setMessages(prev => prev.filter(m => m.id !== messageId))
      setTotalCount(prev => (prev == null ? prev : Math.max(0, prev - 1)))
    } catch { /* */ }
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
    onSelectMessage(messageId)
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

  const handlePin = async (messageId: string, currentlyPinned: boolean) => {
    const newPinned = !currentlyPinned
    const sortMessages = (msgs: MessageSummary[]) => [...msgs].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      const dateA = new Date(a.receivedAt ?? a.sentAt).getTime()
      const dateB = new Date(b.receivedAt ?? b.sentAt).getTime()
      return dateB - dateA
    })
    setMessages(prev => sortMessages(prev.map(m => m.id === messageId ? { ...m, isPinned: newPinned } : m)))
    try {
      await api.pinMessage(workspaceId, connectionId, messageId, newPinned)
    } catch {
      setMessages(prev => sortMessages(prev.map(m => m.id === messageId ? { ...m, isPinned: currentlyPinned } : m)))
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
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', marginLeft: 8 }}>
            {formatDate(m.receivedAt ?? m.sentAt)}
          </div>
        </div>

        <div style={{ marginTop: 4, fontWeight: m.isRead ? 400 : 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{m.subject ?? '(no subject)'}</span>
          {m.hasAttachments && (
            <InboxAttachmentsButton
              workspaceId={workspaceId}
              messageId={m.id}
              open={attachmentPickerOpen === m.id}
              onToggle={() => {
                setJobPickerOpen(null)
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
          {showBusinessChrome && m.classification && !isSentEmail(m) && (
            <PriorityBadge priority={m.classification.priority} />
          )}
          {showBusinessChrome && (
            m.job ? (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                background: '#e0f2f1', color: '#00695c', whiteSpace: 'nowrap'
              }} title={m.job.name}>
                {m.job.jobNumber ?? (m.job.name.length > 18 ? `${m.job.name.slice(0, 18)}…` : m.job.name)}
              </span>
            ) : (
              <span style={{
                fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 10,
                background: '#f0f0f0', color: '#999', whiteSpace: 'nowrap'
              }}>Unassigned</span>
            )
          )}
        </div>

        {showBusinessChrome && m.classification?.priority === 'LOW' && (() => {
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
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            {inboxTab === 'PERSONAL' && (
              <button title="Mark Business" onClick={() => handleReclassify(m.id, 'BUSINESS')}
                style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid #bbdefb', background: '#e3f2fd', color: '#1565c0', cursor: 'pointer', minHeight: 28 }}>Biz</button>
            )}
            {showBusinessChrome && (
              <button title="Mark Personal" onClick={() => handleReclassify(m.id, 'PERSONAL')}
                style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid #e1bee7', background: '#f3e5f5', color: '#6a1b9a', cursor: 'pointer', minHeight: 28 }}>Pers</button>
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
    <tr key={m.id} onClick={() => handleMessageActivate(m.id)}
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
      </td>
      <td style={{ padding: '7px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: m.isRead ? 400 : 600 }}>{m.subject ?? '(no subject)'}</span>
          {m.hasAttachments && (
            <InboxAttachmentsButton
              workspaceId={workspaceId}
              messageId={m.id}
              open={attachmentPickerOpen === m.id}
              onToggle={() => {
                setJobPickerOpen(null)
                setAttachmentPickerOpen(attachmentPickerOpen === m.id ? null : m.id)
              }}
            />
          )}
        </div>
        {m.snippet && <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>{m.snippet.slice(0, 60)}</div>}
        {showBusinessChrome && m.classification?.priority === 'LOW' && (() => {
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
        <td style={{ padding: '7px 12px', position: 'relative' }} onClick={e => e.stopPropagation()}>
          <span
            onClick={() => !isViewer && setJobPickerOpen(jobPickerOpen === m.id ? null : m.id)}
            style={{
              fontSize: 10, fontWeight: m.job ? 600 : 500, padding: '1px 7px', borderRadius: 10,
              background: m.job ? '#e0f2f1' : '#f0f0f0',
              color: m.job ? '#00695c' : '#999',
              whiteSpace: 'nowrap', cursor: isViewer ? 'default' : 'pointer',
            }}
            title={m.job ? m.job.name : 'Click to assign a job'}
          >
            {m.job ? (m.job.jobNumber ?? (m.job.name.length > 18 ? `${m.job.name.slice(0, 18)}…` : m.job.name)) : 'Unassigned'}
          </span>
          {jobPickerOpen === m.id && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 20,
              background: '#fff', border: '1px solid #ddd', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)', width: 240, maxHeight: 220, overflowY: 'auto',
            }}>
              {m.job && (
                <div
                  onClick={() => handleRemoveJob(m.id, m.job!.id)}
                  style={{ padding: '6px 10px', fontSize: 11, color: '#c62828', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
                >Remove from {m.job.jobNumber ?? m.job.name}</div>
              )}
              {jobs.map(j => (
                <div
                  key={j.id}
                  onClick={() => !jobAssigning && handleAssignJob(m.id, j.id)}
                  style={{
                    padding: '6px 10px', fontSize: 11, cursor: 'pointer',
                    background: m.job?.id === j.id ? '#e0f2f1' : 'transparent',
                    fontWeight: m.job?.id === j.id ? 600 : 400,
                  }}
                  onMouseOver={e => { if (m.job?.id !== j.id) (e.currentTarget.style.background = '#f5f5f5') }}
                  onMouseOut={e => { if (m.job?.id !== j.id) (e.currentTarget.style.background = 'transparent') }}
                >
                  {j.jobNumber ? `${j.jobNumber} — ${j.name}` : j.name}
                </div>
              ))}
              {jobs.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11, color: '#999' }}>No jobs available</div>}
            </div>
          )}
        </td>
      )}
      {showBusinessChrome && (
        <td style={{ padding: '7px 12px' }}>
          {m.classification && !isSentEmail(m)
            ? <PriorityBadge priority={m.classification.priority} />
            : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}
        </td>
      )}
      <td style={{ padding: '7px 12px', fontSize: 12, whiteSpace: 'nowrap', color: '#999' }}>{formatDate(m.receivedAt ?? m.sentAt)}</td>
      <td style={{ padding: '7px 6px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        {!isViewer && (
          <div style={{ display: 'flex', gap: 2, justifyContent: 'center', alignItems: 'center' }}>
            {inboxTab === 'PERSONAL' && (
              <button title="Mark Business" onClick={() => handleReclassify(m.id, 'BUSINESS')}
                style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid #bbdefb', background: '#e3f2fd', color: '#1565c0', cursor: 'pointer' }}>Biz</button>
            )}
            {showBusinessChrome && (
              <button title="Mark Personal" onClick={() => handleReclassify(m.id, 'PERSONAL')}
                style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid #e1bee7', background: '#f3e5f5', color: '#6a1b9a', cursor: 'pointer' }}>Pers</button>
            )}
            <span style={{ width: 12 }} />
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
            {totalCount != null
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid #ddd', borderRadius: 5, overflow: 'hidden', background: '#fff' }}>
            <select
              value={searchIn}
              onChange={e => setSearchIn(e.target.value as 'all' | 'sender')}
              aria-label="Search in"
              style={{
                padding: '5px 6px 5px 8px', fontSize: 12, border: 'none', borderRight: '1px solid #eee',
                background: '#fafafa', color: '#555', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="all">All</option>
              <option value="sender">Sender</option>
            </select>
            <input
              type="text"
              placeholder={searchIn === 'sender' ? 'Filter by sender name or email…' : 'Search emails…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '5px 10px', border: 'none', fontSize: 13, outline: 'none',
                width: isPhone ? 140 : 200, background: 'transparent',
              }}
            />
          </div>
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

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 4, borderBottom: '2px solid #e5e5e5', flexShrink: 0,
        overflowX: 'auto',
        ...(isPhone ? { WebkitOverflowScrolling: 'touch' } as React.CSSProperties : {})
      }}>
        {INBOX_TABS.filter(tab => {
          if (tab.key === 'PERSONAL' && !canSeeAllPersonal && !isOwnInbox) return false
          return true
        }).map(tab => {
          const tabActive = !isSentView && inboxTab === tab.key
          return (
          <button key={tab.key} onClick={() => selectInboxTab(tab.key)}
            style={{
              padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap',
              fontWeight: tabActive ? 600 : 400,
              color: tabActive ? '#1a1a2e' : '#888',
              background: 'none', border: 'none',
              borderBottom: tabActive ? '2px solid #1a1a2e' : '2px solid transparent',
              marginBottom: -2, cursor: 'pointer'
            }}>{tab.label}</button>
          )
        })}
      </div>

      {/* Global direction chips (All/Unread/Read/Sent). Sent omits Business/Personal category. */}
      {inboxTab !== 'TRASH' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {([['', 'All'], ['unread', 'Unread'], ['read', 'Read'], ['sent', 'Sent']] as const).map(([key, label]) => (
              <button key={key || 'all'} onClick={() => selectDirectionFilter(key as ReadFilter)} style={{
                padding: '3px 10px', fontSize: 11, fontWeight: 500, borderRadius: 12,
                border: readFilter === key ? '1px solid #1a1a2e' : '1px solid #ddd',
                background: readFilter === key ? '#1a1a2e' : '#fff',
                color: readFilter === key ? '#fff' : '#666', cursor: 'pointer'
              }}>{label}</button>
            ))}
          </div>

          {showBusinessChrome && (
            <>
              <span style={{ color: '#ddd' }}>|</span>

              {/* Priority multi-select */}
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                {([['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High']] as const).map(([key, label]) => {
                  const active = priorityFilter.has(key as PriorityKey)
                  return (
                    <button key={key} onClick={() => setPriorityFilter(prev => {
                      const next = new Set(prev)
                      if (next.has(key as PriorityKey)) next.delete(key as PriorityKey)
                      else next.add(key as PriorityKey)
                      return next
                    })} style={{
                      padding: '3px 10px', fontSize: 11, fontWeight: 500, borderRadius: 12,
                      border: active ? '1px solid #1a1a2e' : '1px solid #ddd',
                      background: active ? '#1a1a2e' : '#fff',
                      color: active ? '#fff' : '#666', cursor: 'pointer'
                    }}>{label}</button>
                  )
                })}
              </div>

              <span style={{ color: '#ddd' }}>|</span>

              {/* Job filter */}
              <select
                value={jobFilter}
                onChange={e => setJobFilter(e.target.value)}
                style={{
                  padding: '3px 8px', fontSize: 11, borderRadius: 6,
                  border: '1px solid #ddd', background: '#fff', color: '#444', cursor: 'pointer'
                }}
              >
                <option value="">All Jobs</option>
                <option value="unassigned">Unassigned</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.jobNumber ? `${j.jobNumber} — ${j.name}` : j.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {/* Message list */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
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
            <div className="empty-icon">{inboxTab === 'TRASH' ? '\uD83D\uDDD1' : isSentView ? '\uD83D\uDCE4' : inboxTab === 'PERSONAL' ? '\uD83D\uDCE8' : '\u2709'}</div>
            <h3>{activeSearch ? 'No results' : isSentView ? 'No sent emails' : `No ${INBOX_TABS.find(t => t.key === inboxTab)?.label.toLowerCase() ?? ''} emails`}</h3>
            <p>{activeSearch
              ? (searchIn === 'sender'
                ? `No senders match "${activeSearch}"`
                : `No messages match "${activeSearch}"`)
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
                  {showBusinessChrome && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Priority</th>}
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '8px 6px', width: 64 }}></th>
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
    </div>
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
