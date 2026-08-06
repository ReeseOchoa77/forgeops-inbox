import { useEffect, useState, useRef, useCallback } from 'react'
import { api, type JobLookup, type MessageSummary, type ConnectionSummary } from '../api'
import { PriorityBadge, TypeBadge } from '../components/Badges'

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

type InboxFilter = '' | 'unread' | 'read' | 'low_priority' | 'medium_priority' | 'high_priority'

const INBOX_FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: '', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
  { key: 'low_priority', label: 'Low Priority' },
  { key: 'medium_priority', label: 'Medium Priority' },
  { key: 'high_priority', label: 'High Priority' },
]

export function MessagesView({ workspaceId, connectionId, onSelectMessage, userRole, userEmail, connections }: Props) {
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
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('')
  const [jobFilter, setJobFilter] = useState('')
  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')

  const [autoResponseStatus, setAutoResponseStatus] = useState<Record<string, AutoResponseStatus>>({})

  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const connectionResetRef = useRef(false)

  const isBusiness = inboxTab !== 'PERSONAL' && inboxTab !== 'TRASH'

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
    if (!inboxFilter) return msgs
    switch (inboxFilter) {
      case 'unread': return msgs.filter(m => !m.isRead)
      case 'read': return msgs.filter(m => m.isRead)
      case 'low_priority': return msgs.filter(m => m.classification?.priority === 'LOW')
      case 'medium_priority': return msgs.filter(m => m.classification?.priority === 'MEDIUM')
      case 'high_priority': return msgs.filter(m => m.classification?.priority === 'HIGH' || m.classification?.priority === 'URGENT')
      default: return msgs
    }
  }, [inboxFilter])

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
    setInboxFilter('')
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

  const handleReclassify = async (messageId: string, category: 'BUSINESS' | 'PERSONAL') => {
    try {
      await api.reclassifyMessage(workspaceId, messageId, { mailboxCategory: category })
      setMessages(prev => prev.filter(m => m.id !== messageId))
      setTotalCount(prev => prev - 1)
    } catch { /* */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Inbox</h2>
          <span style={{ fontSize: 12, color: '#999' }}>{totalCount} messages</span>
        </div>
        <input type="text" placeholder="Search emails..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '5px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, width: 220 }} />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 4, borderBottom: '2px solid #e5e5e5', overflowX: 'auto', flexShrink: 0 }}>
        {INBOX_TABS.filter(tab => {
          if (tab.key === 'PERSONAL' && !canSeeAllPersonal && !isOwnInbox) return false
          return true
        }).map(tab => (
          <button key={tab.key} onClick={() => { setInboxTab(tab.key); setInboxFilter('') }}
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

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {INBOX_FILTERS.map(f => (
          <button key={f.key} onClick={() => setInboxFilter(f.key)} style={{
            padding: '3px 10px', fontSize: 11, fontWeight: 500, borderRadius: 12,
            border: inboxFilter === f.key ? '1px solid #1a1a2e' : '1px solid #ddd',
            background: inboxFilter === f.key ? '#1a1a2e' : '#fff',
            color: inboxFilter === f.key ? '#fff' : '#666', cursor: 'pointer'
          }}>{f.label}</button>
        ))}
        {isBusiness && (
          <select
            value={jobFilter}
            onChange={e => setJobFilter(e.target.value)}
            style={{
              marginLeft: 4, padding: '3px 8px', fontSize: 11, borderRadius: 6,
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
        )}
      </div>

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
        ) : (
          <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                  {isBusiness && <th style={{ padding: '8px 6px', width: 28 }}></th>}
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>From</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Subject</th>
                  {isBusiness && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Type</th>}
                  {isBusiness && <th style={{ padding: '8px 12px', fontWeight: 600 }}>Priority</th>}
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '8px 6px', width: 64 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredMessages.map(m => (
                  <tr key={m.id} onClick={() => onSelectMessage(m.id)}
                    style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: m.isRead ? '' : '#f0f4ff' }}
                    onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
                    onMouseOut={e => (e.currentTarget.style.background = m.isRead ? '' : '#f0f4ff')}>
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
                    {isBusiness && (
                      <td style={{ padding: '7px 12px' }}>
                        {m.classification ? (
                          <TypeBadge type={m.classification.emailType} businessTypeKey={m.classification.businessTypeKey} />
                        ) : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}
                      </td>
                    )}
                    {isBusiness && (
                      <td style={{ padding: '7px 12px' }}>{m.classification ? <PriorityBadge priority={m.classification.priority} /> : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}</td>
                    )}
                    <td style={{ padding: '7px 12px', fontSize: 12, whiteSpace: 'nowrap', color: '#999' }}>{formatDate(m.receivedAt ?? m.sentAt)}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      {!isViewer && (
                        <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                          {inboxTab === 'PERSONAL' && (
                            <button title="Mark Business" onClick={() => handleReclassify(m.id, 'BUSINESS')}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#1565c0', padding: 2, fontWeight: 600 }}>Biz</button>
                          )}
                          {isBusiness && (
                            <button title="Mark Personal" onClick={() => handleReclassify(m.id, 'PERSONAL')}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#6a1b9a', padding: 2 }}>Pers</button>
                          )}
                          {inboxTab !== 'TRASH' ? (
                            <button title="Trash" onClick={() => handleTrash(m.id, false)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#bbb', padding: 2 }}>{'\uD83D\uDDD1'}</button>
                          ) : (
                            <button title="Restore" onClick={() => handleTrash(m.id, true)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#888', padding: 2 }}>{'\u21A9'}</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
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
