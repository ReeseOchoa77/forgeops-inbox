import { useEffect, useState } from 'react'
import { api, type ReviewItem, type MessageSummary } from '../api'
import { PriorityBadge, ConfidenceBadge } from '../components/Badges'
import { TypeBadge, ActionBadge } from '../components/Badges'
import { ClassificationEvidencePanel } from '../components/ClassificationEvidencePanel'
import {
  buildClassificationEvidenceViewModel,
} from '../../../../packages/shared/src/reference/classification-evidence-display'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string) => void
}

type ReviewTab = 'REVIEW' | 'RECLASSIFIED'
type ReviewFilter = 'ALL' | 'BUSINESS' | 'PERSONAL'

function senderCategoryFromMessage(mailboxCategory: string): 'BUSINESS' | 'PERSONAL' {
  return mailboxCategory === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL'
}

function verifySenderButtonLabel(mailboxCategory: string): string {
  return senderCategoryFromMessage(mailboxCategory) === 'BUSINESS'
    ? 'Confirm Business Sender'
    : 'Confirm Personal Sender'
}

export function ReviewQueueView({ workspaceId, connectionId, onSelectMessage }: Props) {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [reclassifiedMessages, setReclassifiedMessages] = useState<MessageSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [reclassifiedPage, setReclassifiedPage] = useState(1)
  const [reclassifiedTotal, setReclassifiedTotal] = useState(0)
  const [reclassifiedTotalPages, setReclassifiedTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<ReviewTab>('REVIEW')
  const [filter, setFilter] = useState<ReviewFilter>('ALL')

  const loadReview = () => {
    setLoading(true)
    api.getReviewQueue(workspaceId, connectionId, page)
      .then(r => {
        setItems(r.items)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
      })
      .finally(() => setLoading(false))
  }

  const loadReclassified = () => {
    setLoading(true)
    api.getMessages(workspaceId, connectionId, reclassifiedPage, 25, { reclassifiedOnly: true, includeTotal: true })
      .then(r => {
        setReclassifiedMessages(r.messages)
        setReclassifiedTotalPages(r.pagination.totalPages ?? 0)
        setReclassifiedTotal(r.pagination.totalCount ?? 0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { setPage(1); setReclassifiedPage(1) }, [connectionId])
  useEffect(() => { if (tab === 'REVIEW') loadReview() }, [workspaceId, connectionId, page, tab])
  useEffect(() => { if (tab === 'RECLASSIFIED') loadReclassified() }, [workspaceId, connectionId, reclassifiedPage, tab])

  const filteredItems = items.filter(item => {
    if (filter === 'ALL') return true
    if (filter === 'BUSINESS') return item.message.mailboxCategory === 'BUSINESS'
    if (filter === 'PERSONAL') return item.message.mailboxCategory === 'PERSONAL'
    return true
  })

  const handleReclassify = async (item: ReviewItem) => {
    const m = item.message
    const newCategory = m.mailboxCategory === 'BUSINESS' ? 'PERSONAL' : 'BUSINESS'
    setActionLoading(m.id + 'reclassify')
    try {
      await api.reclassifyMessage(workspaceId, m.id, { mailboxCategory: newCategory })
      setItems(prev => prev.filter(i => i.message.id !== m.id))
      setTotalCount(prev => prev - 1)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reclassify failed')
    } finally {
      setActionLoading(null)
    }
  }

  /** Push email classification into Reference Data → Senders as CONFIRMED_BUSINESS / CONFIRMED_PERSONAL. */
  const handleVerifySender = async (
    message: {
      id: string
      senderEmail: string
      senderName: string | null
      mailboxCategory: string
      classification?: { id: string } | null
      taskCandidate?: { id: string } | null
    },
    opts: { dismissReview: boolean; list: 'review' | 'reclassified' }
  ) => {
    const classification = senderCategoryFromMessage(message.mailboxCategory)
    const confirmKey = message.id + 'confirm'
    setActionLoading(confirmKey)
    setNotice(null)
    try {
      await api.confirmSenderEvidence(
        workspaceId,
        message.senderEmail,
        message.senderName,
        classification
      )

      if (opts.dismissReview) {
        if (message.classification?.id) {
          await api.reviewClassification(workspaceId, message.classification.id, 'APPROVED')
        }
        if (message.taskCandidate?.id) {
          await api.reviewTask(workspaceId, message.taskCandidate.id, 'APPROVED')
        }
      }

      if (opts.list === 'review') {
        setItems(prev => prev.filter(i => i.message.id !== message.id))
        setTotalCount(prev => Math.max(0, prev - 1))
      } else {
        setReclassifiedMessages(prev => prev.filter(m => m.id !== message.id))
        setReclassifiedTotal(prev => Math.max(0, prev - 1))
      }

      setNotice(
        classification === 'BUSINESS'
          ? `Updated ${message.senderEmail} to Confirmed Business in Reference Data.`
          : `Updated ${message.senderEmail} to Confirmed Personal in Reference Data.`
      )
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update sender in Reference Data')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading...</p>

  const tabStyle = (t: ReviewTab) => ({
    padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' as const,
    border: 'none', borderBottom: tab === t ? '2px solid #1a1a2e' : '2px solid transparent',
    background: 'none', color: tab === t ? '#1a1a2e' : '#888'
  })

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Email Review</h2>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e5e5', marginBottom: 14 }}>
        <button style={tabStyle('REVIEW')} onClick={() => setTab('REVIEW')}>
          Needs Review {totalCount > 0 && <span style={{ marginLeft: 4, fontSize: 11, background: '#f0f0f0', padding: '1px 6px', borderRadius: 8 }}>{totalCount}</span>}
        </button>
        <button style={tabStyle('RECLASSIFIED')} onClick={() => setTab('RECLASSIFIED')}>
          Reclassified {reclassifiedTotal > 0 && <span style={{ marginLeft: 4, fontSize: 11, background: '#f3e8ff', color: '#7c3aed', padding: '1px 6px', borderRadius: 8 }}>{reclassifiedTotal}</span>}
        </button>
      </div>

      {notice && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, fontSize: 12, borderRadius: 6,
          background: '#e6f4ea', border: '1px solid #a8d5a2', color: '#2e7d32',
          display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center',
        }}>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2e7d32' }}>&times;</button>
        </div>
      )}

      {tab === 'RECLASSIFIED' && (
        <div>
          <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
            Emails that were manually reclassified. Use <strong>Confirm Business/Personal Sender</strong> to update that sender in Reference Data → Senders to Confirmed Business or Confirmed Personal.
          </p>
          {reclassifiedMessages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" style={{ fontSize: 28 }}>✓</div>
              <h3>No reclassified emails</h3>
              <p>When emails are manually changed from Business to Personal or vice versa, they appear here.</p>
            </div>
          ) : (
            <>
              {reclassifiedMessages.map(m => {
                const confirmKey = m.id + 'confirm'
                const isBusiness = senderCategoryFromMessage(m.mailboxCategory) === 'BUSINESS'
                return (
                  <div key={m.id} className="card" style={{
                    borderLeft: '3px solid #7c3aed', marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onSelectMessage(m.id)}>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, color: '#06c' }}>{m.subject ?? '(no subject)'}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          From: <strong>{m.senderName ?? m.senderEmail}</strong>
                          {m.senderName && <span style={{ color: '#bbb' }}> ({m.senderEmail})</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#f3e8ff', color: '#7c3aed', fontWeight: 600 }}>
                          {m.previousCategory} → {m.mailboxCategory}
                        </span>
                        <button
                          type="button"
                          disabled={actionLoading === confirmKey}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleVerifySender(m, { dismissReview: false, list: 'reclassified' })
                          }}
                          style={{
                            minHeight: 32, padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                            border: isBusiness ? '1px solid #4caf50' : '1px solid #9c27b0',
                            background: isBusiness ? '#e8f5e9' : '#f3e5f5',
                            color: isBusiness ? '#2e7d32' : '#6a1b9a',
                            cursor: actionLoading === confirmKey ? 'not-allowed' : 'pointer',
                            opacity: actionLoading === confirmKey ? 0.6 : 1,
                          }}
                        >
                          {actionLoading === confirmKey ? 'Updating…' : verifySenderButtonLabel(m.mailboxCategory)}
                        </button>
                        <span style={{ fontSize: 11, color: '#aaa' }}>
                          {m.receivedAt ? new Date(m.receivedAt).toLocaleDateString() : ''}
                        </span>
                      </div>
                    </div>
                    {m.snippet && <div style={{ fontSize: 12, color: '#999', marginTop: 4, lineHeight: 1.4 }}>{m.snippet.slice(0, 120)}</div>}
                  </div>
                )
              })}
              {reclassifiedTotalPages > 1 && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <button className="btn btn-sm btn-outline" disabled={reclassifiedPage <= 1} onClick={() => setReclassifiedPage(p => p - 1)}>Previous</button>
                  <span style={{ fontSize: 13, color: '#888' }}>Page {reclassifiedPage} of {reclassifiedTotalPages}</span>
                  <button className="btn btn-sm btn-outline" disabled={reclassifiedPage >= reclassifiedTotalPages} onClick={() => setReclassifiedPage(p => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'REVIEW' && (<>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
        {totalCount} item{totalCount !== 1 ? 's' : ''} need{totalCount === 1 ? 's' : ''} your review.
        Confirm Business/Personal Sender updates that sender in Reference Data and clears the item from this queue.
      </p>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#9878;</div>
          <h3>All clear</h3>
          <p>No items need human review right now.</p>
        </div>
      ) : (<>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
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
        const reclassifyKey = m.id + 'reclassify'
        const confirmKey = m.id + 'confirm'
        const oppositeCategory = m.mailboxCategory === 'BUSINESS' ? 'Personal' : 'Business'
        const isBusiness = senderCategoryFromMessage(m.mailboxCategory) === 'BUSINESS'
        const evidenceVm = buildClassificationEvidenceViewModel(c?.classificationEvidence, m.mailboxCategory)
        const confidenceLabel =
          evidenceVm?.confidenceLabel === 'Classification confidence'
            ? 'Classification confidence'
            : 'Confidence'

        return (
          <div key={m.id} className="card" style={{ borderLeft: '3px solid #f57f17', marginBottom: 10 }}>
            {/* Header: subject + actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
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
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                <button
                  disabled={actionLoading === reclassifyKey}
                  onClick={() => handleReclassify(item)}
                  style={{
                    minHeight: 36, padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    border: '1px solid #ef5350', background: '#ffebee', color: '#c62828', cursor: 'pointer'
                  }}>
                  {actionLoading === reclassifyKey ? '...' : `Switch to ${oppositeCategory}`}
                </button>
                <button
                  disabled={actionLoading === confirmKey}
                  onClick={() => handleVerifySender(m, { dismissReview: true, list: 'review' })}
                  title="Sets this sender to Confirmed Business or Confirmed Personal in Reference Data"
                  style={{
                    minHeight: 36, padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    border: isBusiness ? '1px solid #4caf50' : '1px solid #9c27b0',
                    background: isBusiness ? '#e8f5e9' : '#f3e5f5',
                    color: isBusiness ? '#2e7d32' : '#6a1b9a',
                    cursor: actionLoading === confirmKey ? 'not-allowed' : 'pointer',
                    opacity: actionLoading === confirmKey ? 0.6 : 1,
                  }}>
                  {actionLoading === confirmKey ? 'Updating…' : verifySenderButtonLabel(m.mailboxCategory)}
                </button>
              </div>
            </div>

            {/* Evidence breakdown — n8n decision evidence (legacy weighted or new flags) */}
            {(c?.classificationEvidence || c?.routingHints) && (
              <ClassificationEvidencePanel
                evidence={c?.classificationEvidence}
                mailboxCategory={m.mailboxCategory}
                routingHints={c?.routingHints}
                confidence={c?.confidence}
              />
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
                  <div style={{ color: '#aaa', fontSize: 10, marginBottom: 2 }}>
                    {confidenceLabel}
                  </div>
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

      </>)}
      </>)}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
