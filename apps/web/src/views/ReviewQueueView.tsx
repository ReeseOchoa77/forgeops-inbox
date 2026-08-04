import { useEffect, useState } from 'react'
import { api, type ReviewItem } from '../api'
import { PriorityBadge, ConfidenceBadge } from '../components/Badges'
import { TypeBadge, ActionBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string) => void
}

type ReviewFilter = 'ALL' | 'BUSINESS' | 'PERSONAL'

export function ReviewQueueView({ workspaceId, connectionId, onSelectMessage }: Props) {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [filter, setFilter] = useState<ReviewFilter>('ALL')

  const load = () => {
    setLoading(true)
    api.getReviewQueue(workspaceId, connectionId, page)
      .then(r => {
        setItems(r.items)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { setPage(1) }, [connectionId])
  useEffect(load, [workspaceId, connectionId, page])

  const filteredItems = items.filter(item => {
    if (filter === 'ALL') return true
    if (filter === 'BUSINESS') return item.message.mailboxCategory === 'BUSINESS'
    if (filter === 'PERSONAL') return item.message.mailboxCategory === 'PERSONAL'
    return true
  })

  const handleReview = async (item: ReviewItem, decision: 'APPROVED' | 'REJECTED') => {
    const key = item.message.id + decision
    setActionLoading(key)
    try {
      if (item.message.classification?.id) {
        await api.reviewClassification(workspaceId, item.message.classification.id, decision)
      }
      if (item.message.taskCandidate?.id) {
        await api.reviewTask(workspaceId, item.message.taskCandidate.id, decision)
      }
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Review failed')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading review queue...</p>

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">&#9878;</div>
        <h3>All clear</h3>
        <p>No items need human review right now. When the system is unsure about a classification or task, it will appear here.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Email Review</h2>
        <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
          {totalCount} item{totalCount !== 1 ? 's' : ''} need{totalCount === 1 ? 's' : ''} your review.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['ALL', 'BUSINESS', 'PERSONAL'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', fontSize: 12, fontWeight: 500, borderRadius: 12,
            border: filter === f ? '1px solid #1a1a2e' : '1px solid #ddd',
            background: filter === f ? '#1a1a2e' : '#fff',
            color: filter === f ? '#fff' : '#666', cursor: 'pointer'
          }}>{f === 'ALL' ? 'All' : f === 'BUSINESS' ? 'Business' : 'Personal'}</button>
        ))}
      </div>

      {filteredItems.map(item => {
        const m = item.message
        const c = m.classification
        const t = m.taskCandidate
        const approveKey = m.id + 'APPROVED'
        const rejectKey = m.id + 'REJECTED'

        return (
          <div key={m.id} className="card" style={{ borderLeft: '3px solid #f57f17', marginBottom: 10 }}>
            {/* Header: subject + actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#06c' }} onClick={() => onSelectMessage(m.id)}>
                  {m.subject ?? '(no subject)'}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  From: <strong>{m.senderName ?? m.senderEmail}</strong>
                  {m.senderName && <span style={{ color: '#bbb' }}> ({m.senderEmail})</span>}
                  <span style={{ color: '#ddd' }}> &middot; </span>
                  {formatDate(m.receivedAt ?? m.sentAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="btn btn-sm btn-success"
                  disabled={actionLoading === approveKey}
                  onClick={() => handleReview(item, 'APPROVED')}>
                  {actionLoading === approveKey ? '...' : 'Correct'}
                </button>
                <button className="btn btn-sm btn-danger"
                  disabled={actionLoading === rejectKey}
                  onClick={() => handleReview(item, 'REJECTED')}>
                  {actionLoading === rejectKey ? '...' : 'Incorrect'}
                </button>
              </div>
            </div>

            {/* Evidence breakdown — scoring metrics from n8n */}
            {c?.classificationEvidence && (
              <div style={{ background: '#f8f9fa', border: '1px solid #eee', borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Classification Evidence</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {(['content', 'sender', 'signature', 'job', 'subject'] as const).map(key => {
                    const signal = c.classificationEvidence?.[key]
                    if (!signal) return null
                    const pct = Math.round(signal.probability * 100)
                    const contrib = Math.round(signal.contribution * 100)
                    const barColor = pct >= 70 ? '#4caf50' : pct >= 40 ? '#ff9800' : '#e0e0e0'
                    return (
                      <div key={key} style={{ fontSize: 11 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontWeight: 600, textTransform: 'capitalize', color: '#555' }}>{key}</span>
                          <span style={{ color: '#888' }}>{pct}% <span style={{ color: '#bbb', fontSize: 10 }}>({signal.weight * 100}% wt)</span></span>
                        </div>
                        <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: 10, color: '#999', lineHeight: 1.3 }}>
                          {signal.explanation ?? `Contributes ${contrib}%`}
                          {key === 'sender' && !!(signal as Record<string, unknown>).status && (
                            <span style={{ marginLeft: 4, fontWeight: 500, color: '#555' }}>({String((signal as Record<string, unknown>).status)})</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {c.classificationEvidence.finalBusinessProbability != null && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>Final Business Probability</span>
                    <span style={{
                      fontSize: 14, fontWeight: 700,
                      color: c.classificationEvidence.finalBusinessProbability >= 0.85 ? '#2e7d32'
                        : c.classificationEvidence.finalBusinessProbability <= 0.20 ? '#6a1b9a'
                        : '#f57f17'
                    }}>
                      {Math.round(c.classificationEvidence.finalBusinessProbability * 100)}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Classification details */}
            {c && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px 16px', fontSize: 12, marginBottom: 8 }}>
                <div>
                  <div style={{ color: '#aaa', fontSize: 10, marginBottom: 2 }}>Category</div>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: m.mailboxCategory === 'BUSINESS' ? '#e3f2fd' : '#f3e5f5',
                    color: m.mailboxCategory === 'BUSINESS' ? '#1565c0' : '#6a1b9a'
                  }}>{m.mailboxCategory}</span>
                </div>
                <div>
                  <div style={{ color: '#aaa', fontSize: 10, marginBottom: 2 }}>Business Type</div>
                  {c.businessTypeKey ? (
                    <TypeBadge type={c.emailType} businessTypeKey={c.businessTypeKey} />
                  ) : (
                    <span style={{ color: '#ccc' }}>—</span>
                  )}
                </div>
                <div>
                  <div style={{ color: '#aaa', fontSize: 10, marginBottom: 2 }}>Priority</div>
                  <PriorityBadge priority={c.priority} />
                </div>
                <div>
                  <div style={{ color: '#aaa', fontSize: 10, marginBottom: 2 }}>Confidence</div>
                  <ConfidenceBadge confidence={c.confidence} />
                </div>
                <div>
                  <div style={{ color: '#aaa', fontSize: 10, marginBottom: 2 }}>Action State</div>
                  <ActionBadge emailType={c.emailType} requiresReview={c.requiresReview} />
                  {!c.requiresReview && c.emailType !== 'ACTIONABLE_REQUEST' && <span style={{ color: '#ccc', fontSize: 11 }}>None</span>}
                </div>
                <div>
                  <div style={{ color: '#aaa', fontSize: 10, marginBottom: 2 }}>Action Request?</div>
                  <span style={{ fontWeight: 500, color: c.containsActionRequest ? '#1565c0' : '#ccc' }}>
                    {c.containsActionRequest ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            )}

            {/* Summary */}
            {c?.summary && (
              <div style={{ fontSize: 12, color: '#666', padding: '6px 10px', background: '#f8f9fa', borderRadius: 4, marginBottom: 8, lineHeight: 1.5 }}>
                <strong style={{ color: '#888' }}>Summary:</strong> {c.summary}
              </div>
            )}

            {/* Task candidate */}
            {t && (
              <div style={{ fontSize: 12, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ color: '#1565c0', fontWeight: 600 }}>Extracted Task:</span>
                  <span style={{ fontWeight: 500 }}>{t.title}</span>
                  <ConfidenceBadge confidence={t.confidence} />
                </div>
                {t.summary && <div style={{ color: '#888', fontSize: 11 }}>{t.summary}</div>}
                <div style={{ color: '#aaa', fontSize: 11, marginTop: 2 }}>
                  {t.dueAt && <span>Due: {formatDate(t.dueAt)} &middot; </span>}
                  {t.assigneeGuess && <span>Assignee: {t.assigneeGuess} &middot; </span>}
                  Priority: {t.priority}
                </div>
              </div>
            )}

            {/* Snippet */}
            {m.snippet && !c?.summary && (
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>{m.snippet.slice(0, 120)}</div>
            )}
          </div>
        )
      })}

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
  } catch { return iso }
}
