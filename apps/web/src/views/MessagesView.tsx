import { useEffect, useState } from 'react'
import { api, type MessageSummary } from '../api'
import { ConfidenceBadge, PriorityBadge, TypeBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string) => void
}

export function MessagesView({ workspaceId, connectionId, onSelectMessage }: Props) {
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)

  useEffect(() => {
    setPage(1)
  }, [connectionId])

  const loadMessages = () => {
    setLoading(true)
    api.getMessages(workspaceId, connectionId, page)
      .then(r => {
        setMessages(r.messages)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
      })
      .finally(() => setLoading(false))
  }

  useEffect(loadMessages, [workspaceId, connectionId, page])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalyzeResult(null)
    try {
      const result = await api.analyzeConnection(workspaceId, connectionId, true)
      const analysis = result.analysis as Record<string, unknown> | undefined
      const detail = analysis
        ? `${analysis.messagesClassified ?? 0} classified, ${analysis.taskCandidatesCreated ?? 0} tasks extracted`
        : 'Analysis completed'
      setAnalyzeResult(detail)
      loadMessages()
    } catch (e) {
      setAnalyzeResult(`Error: ${e instanceof Error ? e.message : 'Analysis failed'}`)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading messages...</p>

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">&#128236;</div>
        <h3>No messages yet</h3>
        <p>After syncing an inbox, your messages will appear here with automatic classification and task extraction.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Inbox</h2>
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>{totalCount} messages synced. Click any message to see full details.</p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? 'Analyzing...' : 'Run Analysis'}
        </button>
      </div>

      {analyzeResult && (
        <div style={{
          padding: '10px 16px', marginBottom: 12, borderRadius: 6, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: analyzeResult.startsWith('Error') ? '#fce4ec' : '#e6f4ea',
          border: `1px solid ${analyzeResult.startsWith('Error') ? '#e8a09a' : '#a8d5a2'}`
        }}>
          <span>{analyzeResult}</span>
          <button onClick={() => setAnalyzeResult(null)} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }}>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>From</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Subject</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Category</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Priority</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Confidence</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {messages.map(m => (
              <tr key={m.id} onClick={() => onSelectMessage(m.id)}
                style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
                onMouseOut={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{m.senderName ?? m.senderEmail}</div>
                  {m.senderName && <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{m.senderEmail}</div>}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 400 }}>{m.subject ?? '(no subject)'}</div>
                  {m.taskCandidate && (
                    <div style={{ fontSize: 11, color: '#1565c0', marginTop: 2 }}>Task: {m.taskCandidate.title.slice(0, 50)}</div>
                  )}
                </td>
                <td style={{ padding: '10px 14px' }}>{m.classification ? <TypeBadge type={m.classification.emailType} /> : <span style={{ color: '#ccc' }}>Not classified</span>}</td>
                <td style={{ padding: '10px 14px' }}>{m.classification ? <PriorityBadge priority={m.classification.priority} /> : <span style={{ color: '#ccc' }}>—</span>}</td>
                <td style={{ padding: '10px 14px' }}>{m.classification ? <ConfidenceBadge confidence={m.classification.confidence} /> : <span style={{ color: '#ccc' }}>—</span>}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, whiteSpace: 'nowrap', color: '#888' }}>{formatDate(m.receivedAt ?? m.sentAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span style={{ fontSize: 13, color: '#888' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-sm btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
