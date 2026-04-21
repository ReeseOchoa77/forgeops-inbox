import { useEffect, useState, useRef, useCallback } from 'react'
import { api, type MessageSummary } from '../api'
import { BusinessBadge, ConfidenceBadge, PriorityBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string) => void
}

const PAGE_SIZE = 30

export function MessagesView({ workspaceId, connectionId, onSelectMessage }: Props) {
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const loadPage = useCallback(async (pageNum: number, searchTerm: string, append: boolean) => {
    if (pageNum === 1) setLoading(true)
    else setLoadingMore(true)

    try {
      const r = await api.getMessages(workspaceId, connectionId, pageNum, PAGE_SIZE, searchTerm || undefined)
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
    setMessages([])
    setPage(1)
    setHasMore(true)
    setSearch('')
    setActiveSearch('')
    loadPage(1, '', false)
  }, [workspaceId, connectionId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setActiveSearch(search)
      setMessages([])
      setPage(1)
      setHasMore(true)
      loadPage(1, search, false)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loadingMore || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      loadPage(page + 1, activeSearch, true)
    }
  }, [page, activeSearch, hasMore, loadingMore, loadPage])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalyzeResult(null)
    try {
      const result = await api.analyzeConnection(workspaceId, connectionId, true)
      const analysis = result.analysis as Record<string, unknown> | undefined
      setAnalyzeResult(analysis
        ? `${analysis.messagesClassified ?? 0} classified, ${analysis.taskCandidatesCreated ?? 0} tasks`
        : 'Done')
      loadPage(1, activeSearch, false)
    } catch (e) {
      setAnalyzeResult(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return <p style={{ color: '#999', padding: 4 }}>Loading...</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
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
            style={{ padding: '5px 10px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, width: 220 }}
          />
          <button className="btn btn-sm btn-primary" onClick={handleAnalyze} disabled={analyzing} style={{ whiteSpace: 'nowrap' }}>
            {analyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {analyzeResult && (
        <div style={{
          padding: '6px 12px', marginBottom: 8, borderRadius: 4, fontSize: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: analyzeResult.startsWith('Error') ? '#fce4ec' : '#e6f4ea',
          border: `1px solid ${analyzeResult.startsWith('Error') ? '#e8a09a' : '#a8d5a2'}`
        }}>
          <span>{analyzeResult}</span>
          <button onClick={() => setAnalyzeResult(null)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: 0 }}>&times;</button>
        </div>
      )}

      {messages.length === 0 && !loading && (
        <div className="empty-state" style={{ padding: 32 }}>
          <div className="empty-icon">&#128236;</div>
          <h3>{activeSearch ? 'No results' : 'No messages yet'}</h3>
          <p>{activeSearch ? `No messages match "${activeSearch}"` : 'After syncing an inbox, messages appear here.'}</p>
        </div>
      )}

      {messages.length > 0 && (
        <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>From</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Subject</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Category</th>
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
                  <td style={{ padding: '7px 12px' }}>{m.classification ? <BusinessBadge category={m.classification.businessCategory} /> : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}</td>
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
