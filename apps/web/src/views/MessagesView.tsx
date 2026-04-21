import { useEffect, useState, useRef, useCallback } from 'react'
import { api, type MessageSummary, type TaskListItem } from '../api'
import { ConfidenceBadge, PriorityBadge, TypeBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string) => void
}

const PAGE_SIZE = 30

type CategoryTab = 'ALL' | 'BUSINESS' | 'NON_BUSINESS'
type TypeFilter = '' | 'ACTIONABLE_REQUEST' | 'FYI_UPDATE' | 'SALES_MARKETING' | 'SUPPORT_CUSTOMER_ISSUE' | 'RECRUITING_HIRING' | 'INTERNAL_COORDINATION'

const CATEGORY_TABS: Array<{ key: CategoryTab; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'BUSINESS', label: 'Business' },
  { key: 'NON_BUSINESS', label: 'Non-Business' },
]

const TYPE_FILTERS: Array<{ key: TypeFilter; label: string }> = [
  { key: '', label: 'All Types' },
  { key: 'ACTIONABLE_REQUEST', label: 'Actionable' },
  { key: 'FYI_UPDATE', label: 'FYI' },
  { key: 'SALES_MARKETING', label: 'Marketing' },
  { key: 'SUPPORT_CUSTOMER_ISSUE', label: 'Support' },
  { key: 'RECRUITING_HIRING', label: 'Recruiting' },
  { key: 'INTERNAL_COORDINATION', label: 'Internal' },
]

export function MessagesView({ workspaceId, connectionId, onSelectMessage }: Props) {
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [categoryTab, setCategoryTab] = useState<CategoryTab>('ALL')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('')
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')

  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)

  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [taskCount, setTaskCount] = useState(0)
  const [tasksExpanded, setTasksExpanded] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const buildFilters = useCallback(() => {
    const f: Parameters<typeof api.getMessages>[4] = {}
    if (categoryTab !== 'ALL') f.businessCategory = categoryTab
    if (typeFilter) f.classificationType = typeFilter
    if (activeSearch) f.search = activeSearch
    return f
  }, [categoryTab, typeFilter, activeSearch])

  const loadPage = useCallback(async (pageNum: number, filters: typeof buildFilters extends () => infer R ? R : never, append: boolean) => {
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

  const loadTasks = useCallback(async () => {
    setTasksLoading(true)
    try {
      const r = await api.getTasks(workspaceId, connectionId, 1)
      setTasks(r.tasks.slice(0, 10))
      setTaskCount(r.pagination.totalCount)
    } catch {
      setTasks([])
      setTaskCount(0)
    } finally {
      setTasksLoading(false)
    }
  }, [workspaceId, connectionId])

  useEffect(() => {
    setMessages([])
    setPage(1)
    setHasMore(true)
    setSearch('')
    setActiveSearch('')
    setCategoryTab('ALL')
    setTypeFilter('')
    loadPage(1, {}, false)
    loadTasks()
  }, [workspaceId, connectionId])

  useEffect(() => {
    const filters = buildFilters()
    setMessages([])
    setPage(1)
    setHasMore(true)
    loadPage(1, filters, false)
  }, [categoryTab, typeFilter, activeSearch])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setActiveSearch(search)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loadingMore || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      loadPage(page + 1, buildFilters(), true)
    }
  }, [page, buildFilters, hasMore, loadingMore, loadPage])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalyzeResult(null)
    try {
      const result = await api.analyzeConnection(workspaceId, connectionId, true)
      const analysis = result.analysis as Record<string, unknown> | undefined
      setAnalyzeResult(analysis
        ? `${analysis.messagesClassified ?? 0} classified, ${analysis.taskCandidatesCreated ?? 0} tasks`
        : 'Done')
      loadPage(1, buildFilters(), false)
      loadTasks()
    } catch (e) {
      setAnalyzeResult(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Inbox</h2>
          <span style={{ fontSize: 12, color: '#999' }}>{totalCount} messages</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search emails..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '5px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, width: 200 }}
          />
          <button className="btn btn-sm btn-primary" onClick={handleAnalyze} disabled={analyzing} style={{ whiteSpace: 'nowrap' }}>
            {analyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {analyzeResult && (
        <div style={{
          padding: '6px 12px', marginBottom: 6, borderRadius: 4, fontSize: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: analyzeResult.startsWith('Error') ? '#fce4ec' : '#e6f4ea',
          border: `1px solid ${analyzeResult.startsWith('Error') ? '#e8a09a' : '#a8d5a2'}`
        }}>
          <span>{analyzeResult}</span>
          <button onClick={() => setAnalyzeResult(null)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: 0 }}>&times;</button>
        </div>
      )}

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 6, borderBottom: '2px solid #e5e5e5' }}>
        {CATEGORY_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setCategoryTab(tab.key)}
            style={{
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: categoryTab === tab.key ? 600 : 400,
              color: categoryTab === tab.key ? '#1a1a2e' : '#888',
              background: 'none',
              border: 'none',
              borderBottom: categoryTab === tab.key ? '2px solid #1a1a2e' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              transition: 'color 0.15s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Type filter chips */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {TYPE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 12,
              border: typeFilter === f.key ? '1px solid #1a1a2e' : '1px solid #ddd',
              background: typeFilter === f.key ? '#1a1a2e' : '#fff',
              color: typeFilter === f.key ? '#fff' : '#666',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Main content area: messages + tasks */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Messages table */}
        {loading ? (
          <p style={{ color: '#999', padding: 4, fontSize: 13 }}>Loading...</p>
        ) : messages.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <div className="empty-icon">&#128236;</div>
            <h3>{activeSearch || typeFilter || categoryTab !== 'ALL' ? 'No results' : 'No messages yet'}</h3>
            <p>{activeSearch ? `No messages match "${activeSearch}"` : categoryTab !== 'ALL' || typeFilter ? 'No messages match the current filters.' : 'After syncing an inbox, messages appear here.'}</p>
          </div>
        ) : (
          <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>From</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Subject</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Type</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Priority</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Confidence</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {messages.map(m => (
                  <tr key={m.id} onClick={() => onSelectMessage(m.id)}
                    style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
                    onMouseOut={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '7px 12px' }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{m.senderName ?? m.senderEmail}</div>
                      {m.senderName && <div style={{ fontSize: 11, color: '#aaa' }}>{m.senderEmail}</div>}
                    </td>
                    <td style={{ padding: '7px 12px' }}>
                      <div>{m.subject ?? '(no subject)'}</div>
                      {m.taskCandidate && <div style={{ fontSize: 11, color: '#1565c0', marginTop: 1 }}>Task: {m.taskCandidate.title.slice(0, 50)}</div>}
                      {m.snippet && !m.taskCandidate && <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>{m.snippet.slice(0, 60)}</div>}
                    </td>
                    <td style={{ padding: '7px 12px' }}>{m.classification ? <TypeBadge type={m.classification.emailType} /> : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}</td>
                    <td style={{ padding: '7px 12px' }}>{m.classification ? <PriorityBadge priority={m.classification.priority} /> : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}</td>
                    <td style={{ padding: '7px 12px' }}>{m.classification ? <ConfidenceBadge confidence={m.classification.confidence} /> : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}</td>
                    <td style={{ padding: '7px 12px', fontSize: 12, whiteSpace: 'nowrap', color: '#999' }}>{formatDate(m.receivedAt ?? m.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loadingMore && <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 13 }}>Loading more...</div>}
            {!hasMore && messages.length > 0 && <div style={{ padding: 10, textAlign: 'center', color: '#ccc', fontSize: 12 }}>End of inbox</div>}
          </div>
        )}

        {/* Inline tasks panel */}
        {taskCount > 0 && (
          <div style={{ marginTop: 8, borderTop: '1px solid #e5e5e5', flexShrink: 0 }}>
            <button
              onClick={() => setTasksExpanded(!tasksExpanded)}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 4px', background: 'none', border: 'none',
                fontSize: 13, fontWeight: 600, color: '#333', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              <span style={{ fontSize: 10, color: '#888' }}>{tasksExpanded ? '▼' : '▶'}</span>
              Tasks ({taskCount})
            </button>
            {tasksExpanded && (
              <div style={{ maxHeight: 200, overflow: 'auto', paddingBottom: 4 }}>
                {tasksLoading ? (
                  <p style={{ color: '#999', fontSize: 12, padding: '4px 8px' }}>Loading tasks...</p>
                ) : (
                  tasks.map(({ task, sourceMessage }) => (
                    <div
                      key={task.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 8px',
                        borderBottom: '1px solid #f5f5f5', fontSize: 12
                      }}
                    >
                      <span style={{ color: '#1565c0', flexShrink: 0, marginTop: 1 }}>&#9745;</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: '#333' }}>{task.title}</div>
                        {sourceMessage && (
                          <div style={{ color: '#aaa', fontSize: 11, marginTop: 1 }}>
                            {sourceMessage.senderEmail} &middot; {sourceMessage.subject?.slice(0, 40) ?? '(no subject)'}
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, display: 'flex', gap: 4 }}>
                        <PriorityBadge priority={task.priority} />
                      </div>
                      {task.dueAt && (
                        <div style={{ flexShrink: 0, color: '#888', fontSize: 11, whiteSpace: 'nowrap' }}>
                          Due {formatDate(task.dueAt)}
                        </div>
                      )}
                    </div>
                  ))
                )}
                {taskCount > 10 && (
                  <div style={{ padding: '6px 8px', fontSize: 11, color: '#999', textAlign: 'center' }}>
                    Showing 10 of {taskCount} tasks
                  </div>
                )}
              </div>
            )}
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
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return iso }
}
