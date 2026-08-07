import { useEffect, useState, useRef, useCallback } from 'react'
import { api, type JobLookup, type MessageSummary, type ConnectionSummary } from '../api'
import { PriorityBadge, TypeBadge } from '../components/Badges'
import type { Breakpoint } from '../hooks/useBreakpoint'

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

type ReadFilter = '' | 'unread' | 'read'
type PriorityKey = 'LOW' | 'MEDIUM' | 'HIGH'

export function MessagesView({ workspaceId, connectionId, onSelectMessage, userRole, userEmail, connections, breakpoint = 'desktop' }: Props) {
  const isViewer = userRole === 'VIEWER'
  const canSeeAllPersonal = userRole === 'ADMIN' || userRole === 'OWNER'
  const currentConnectionEmail = connections.find(c => c.id === connectionId)?.email ?? ''
  const isOwnInbox = userEmail.toLowerCase() === currentConnectionEmail.toLowerCase()
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
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

  const [autoResponseStatus, setAutoResponseStatus] = useState<Record<string, AutoResponseStatus>>({})
  const [jobPickerOpen, setJobPickerOpen] = useState<string | null>(null)
  const [jobAssigning, setJobAssigning] = useState(false)
  const [deletingAllPersonal, setDeletingAllPersonal] = useState(false)

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
    if (!jobPickerOpen) return
    const close = () => setJobPickerOpen(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [jobPickerOpen])

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
    if (readFilter === 'unread') result = result.filter(m => !m.isRead)
    else if (readFilter === 'read') result = result.filter(m => m.isRead)
    const allPriorities = priorityFilter.size === 3
    if (priorityFilter.size > 0 && !allPriorities) {
      result = result.filter(m => {
        const p = m.classification?.priority
        if (!p) return false
        if (priorityFilter.has('HIGH') && (p === 'HIGH' || p === 'URGENT')) return true
        if (priorityFilter.has('MEDIUM') && p === 'MEDIUM') return true
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
    const f: Parameters<typeof api.getMessages>[4] = {}

    if (inboxTab === 'PERSONAL') {
      f.businessCategory = 'NON_BUSINESS'
    } else if (inboxTab === 'TRASH') {
      f.category = 'trash'
    } else {
      f.businessCategory = 'BUSINESS'
      if (inboxTab !== 'ALL_BUSINESS') {
        f.businessTypeGroup = inboxTab
      }
      if (jobFilter) f.jobId = jobFilter
    }

    if (activeSearch) f.search = activeSearch
    return f
  }, [inboxTab, activeSearch, jobFilter])

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
      setHasMore(pageNum < r.pagination.totalPages)
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
    setSearch('')
    setActiveSearch('')
    setInboxTab('ALL_BUSINESS')
    setReadFilter('')
    setPriorityFilter(new Set(['LOW', 'MEDIUM', 'HIGH']))
    setJobFilter('')
    loadPage(1, { businessCategory: 'BUSINESS' }, false)
  }, [workspaceId, connectionId])

  useEffect(() => {
    if (connectionResetRef.current) {
      connectionResetRef.current = false
      return
    }
    const filters = buildFilters()
    setMessages([])
    setPage(1)
    setHasMore(true)
    loadPage(1, filters, false)
  }, [inboxTab, activeSearch, jobFilter])

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
      setTotalCount(prev => prev - 1)
    } catch { /* */ }
  }

  const handleDeleteAllPersonal = async () => {
    if (totalCount === 0 && filteredMessages.length === 0) return
    const count = Math.max(totalCount, filteredMessages.length)
    const label = activeSearch
      ? `${count} personal email${count !== 1 ? 's' : ''} matching "${activeSearch}"`
      : `${count} personal email${count !== 1 ? 's' : ''}`
    if (!confirm(`Move ${label} to trash?`)) return
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
      setTotalCount(prev => prev - 1)
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
    return (
      <div
        key={m.id}
        onClick={() => onSelectMessage(m.id)}
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          background: m.isPinned ? '#fffde7' : m.isRead ? '#fff' : '#f0f4ff',
          borderLeft: m.isPinned ? '3px solid #f5a623' : 'none',
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

        <div style={{ marginTop: 4, fontWeight: m.isRead ? 400 : 600, fontSize: 13 }}>
          {m.subject ?? '(no subject)'}
          {m.hasAttachments && <span style={{ marginLeft: 6 }} title="Has attachments">📎</span>}
        </div>

        {m.snippet && (
          <div style={{ fontSize: 12, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.snippet.slice(0, 60)}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {isBusiness && m.classification && (
            <TypeBadge type={m.classification.emailType} businessTypeKey={m.classification.businessTypeKey} />
          )}
          {isBusiness && m.classification && (
            <PriorityBadge priority={m.classification.priority} />
          )}
          {isBusiness && (
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

        {isBusiness && m.classification?.priority === 'LOW' && (() => {
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
            {isBusiness && (
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
    const rowBg = m.isPinned ? '#fffde7' : m.isRead ? '' : '#f0f4ff'
    return (
    <tr key={m.id} onClick={() => onSelectMessage(m.id)}
      style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: rowBg, borderLeft: m.isPinned ? '3px solid #f5a623' : 'none' }}
      onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
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
      {isBusiness && (
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
        </div>
        {m.snippet && <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>{m.snippet.slice(0, 60)}</div>}
        {isBusiness && m.classification?.priority === 'LOW' && (() => {
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
      {isBusiness && !isTablet && (
        <td style={{ padding: '7px 12px' }}>
          {m.classification ? (
            <TypeBadge type={m.classification.emailType} businessTypeKey={m.classification.businessTypeKey} />
          ) : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}
        </td>
      )}
      {isBusiness && !isTablet && (
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
      {isBusiness && (
        <td style={{ padding: '7px 12px' }}>{m.classification ? <PriorityBadge priority={m.classification.priority} /> : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}</td>
      )}
      <td style={{ padding: '7px 12px', fontSize: 12, whiteSpace: 'nowrap', color: '#999' }}>{formatDate(m.receivedAt ?? m.sentAt)}</td>
      <td style={{ padding: '7px 6px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        {!isViewer && (
          <div style={{ display: 'flex', gap: 2, justifyContent: 'center', alignItems: 'center' }}>
            {inboxTab === 'PERSONAL' && (
              <button title="Mark Business" onClick={() => handleReclassify(m.id, 'BUSINESS')}
                style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid #bbdefb', background: '#e3f2fd', color: '#1565c0', cursor: 'pointer' }}>Biz</button>
            )}
            {isBusiness && (
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
          <span style={{ fontSize: 12, color: '#999' }}>{totalCount} messages</span>
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
          <input type="text" placeholder="Search emails..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '5px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, width: isPhone ? '100%' : 220 }} />
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 4, borderBottom: '2px solid #e5e5e5', flexShrink: 0,
        overflowX: 'auto',
        ...(isPhone ? { WebkitOverflowScrolling: 'touch' } as React.CSSProperties : {})
      }}>
        {INBOX_TABS.filter(tab => {
          if (tab.key === 'PERSONAL' && !canSeeAllPersonal && !isOwnInbox) return false
          return true
        }).map(tab => (
          <button key={tab.key} onClick={() => { setInboxTab(tab.key); setReadFilter(''); setPriorityFilter(new Set(['LOW', 'MEDIUM', 'HIGH'])) }}
            style={{
              padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap',
              fontWeight: inboxTab === tab.key ? 600 : 400,
              color: inboxTab === tab.key ? '#1a1a2e' : '#888',
              background: 'none', border: 'none',
              borderBottom: inboxTab === tab.key ? '2px solid #1a1a2e' : '2px solid transparent',
              marginBottom: -2, cursor: 'pointer'
            }}>{tab.label}</button>
        ))}
      </div>

      {/* Filter chips — hidden on Personal tab */}
      {isBusiness && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Read/Unread filter */}
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {([['', 'All'], ['unread', 'Unread'], ['read', 'Read']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setReadFilter(key as ReadFilter)} style={{
                padding: '3px 10px', fontSize: 11, fontWeight: 500, borderRadius: 12,
                border: readFilter === key ? '1px solid #1a1a2e' : '1px solid #ddd',
                background: readFilter === key ? '#1a1a2e' : '#fff',
                color: readFilter === key ? '#fff' : '#666', cursor: 'pointer'
              }}>{label}</button>
            ))}
          </div>

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
        </div>
      )}

      {/* Message list */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: '#999', padding: 4, fontSize: 13 }}>Loading...</p>
        ) : filteredMessages.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <div className="empty-icon">{inboxTab === 'TRASH' ? '\uD83D\uDDD1' : inboxTab === 'PERSONAL' ? '\uD83D\uDCE8' : '\u2709'}</div>
            <h3>{activeSearch ? 'No results' : `No ${INBOX_TABS.find(t => t.key === inboxTab)?.label.toLowerCase() ?? ''} emails`}</h3>
            <p>{activeSearch ? `No messages match "${activeSearch}"` : 'Emails will appear here after syncing and classification.'}</p>
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
                  {isBusiness && <th style={{ padding: '8px 6px', width: 28 }}></th>}
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>From</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Subject</th>
                  {isBusiness && !isTablet && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Type</th>}
                  {isBusiness && !isTablet && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Job</th>}
                  {isBusiness && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Priority</th>}
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
