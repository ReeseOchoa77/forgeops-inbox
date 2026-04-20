import { useEffect, useState } from 'react'
import { api, type ReviewItem } from '../api'
import { ConfidenceBadge, PriorityBadge, TypeBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string) => void
}

const reasonLabels: Record<string, string> = {
  message_needs_review: 'Message flagged for review',
  classification_requires_review: 'Classification needs human check',
  classification_low_confidence: 'Low classification confidence',
  task_requires_review: 'Task needs human check',
  task_low_confidence: 'Low task confidence'
}

export function ReviewQueueView({ workspaceId, connectionId, onSelectMessage }: Props) {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

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
        <p>No items need human review right now. When the system is unsure about a classification or task, it will appear here for you to confirm or correct.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Review Queue</h2>
        <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
          {totalCount} item{totalCount !== 1 ? 's' : ''} need{totalCount === 1 ? 's' : ''} your review. Mark each as correct or incorrect.
        </p>
      </div>

      {items.map(item => {
        const m = item.message
        const approveKey = m.id + 'APPROVED'
        const rejectKey = m.id + 'REJECTED'

        return (
          <div key={m.id} className="card" style={{ borderLeft: '3px solid #f57f17' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, cursor: 'pointer', color: '#06c' }} onClick={() => onSelectMessage(m.id)}>
                  {m.subject ?? '(no subject)'}
                </div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>
                  From: {m.senderName ?? m.senderEmail}
                  <span style={{ color: '#ccc' }}> &middot; </span>
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

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              {m.classification && <TypeBadge type={m.classification.emailType} />}
              {m.classification && <PriorityBadge priority={m.classification.priority} />}
              {m.classification && <ConfidenceBadge confidence={m.classification.confidence} />}
              {m.taskCandidate && (
                <span style={{ fontSize: 12, color: '#1565c0' }}>
                  Task: <ConfidenceBadge confidence={m.taskCandidate.confidence} />
                </span>
              )}
            </div>

            <div style={{ fontSize: 12, color: '#999' }}>
              {item.reviewReasons.map(r => (
                <span key={r} style={{ marginRight: 12 }}>{reasonLabels[r] ?? r}</span>
              ))}
            </div>
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
  } catch {
    return iso
  }
}
