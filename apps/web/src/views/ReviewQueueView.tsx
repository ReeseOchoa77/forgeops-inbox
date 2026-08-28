import { useCallback, useEffect, useState, Fragment } from 'react'
import {
  api,
  type ClassificationAuditItem,
} from '../api'

interface Props {
  workspaceId: string
  connectionId: string
  onSelectMessage: (id: string) => void
}

type StatusFilter = 'ALL' | 'NEEDS_REVIEW' | 'REVIEWED'
type CategoryFilter = 'ALL' | 'BUSINESS' | 'PERSONAL'

const PAGE_SIZE = 50

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function pct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

function categoryBadge(cat: string): { bg: string; color: string; label: string } {
  if (cat === 'BUSINESS') return { bg: '#e3f2fd', color: '#1565c0', label: 'Business' }
  if (cat === 'PERSONAL') return { bg: '#f3e5f5', color: '#7b1fa2', label: 'Personal' }
  return { bg: '#f5f5f5', color: '#666', label: cat }
}

function statusBadge(status: ClassificationAuditItem['auditStatus']): { bg: string; color: string; label: string } {
  switch (status) {
    case 'NEEDS_REVIEW':
      return { bg: '#fff3e0', color: '#e65100', label: 'Needs review' }
    case 'CONFIRMED':
      return { bg: '#e8f5e9', color: '#2e7d32', label: 'Confirmed' }
    case 'CORRECTED':
      return { bg: '#e8eaf6', color: '#3949ab', label: 'Corrected' }
    case 'DISMISSED':
      return { bg: '#eceff1', color: '#546e7a', label: 'Dismissed' }
    default:
      return { bg: '#f5f5f5', color: '#757575', label: 'Auto' }
  }
}

function Badge({ bg, color, label }: { bg: string; color: string; label: string }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 10,
      background: bg,
      color,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

export function ReviewQueueView({ workspaceId, connectionId, onSelectMessage }: Props) {
  const [items, setItems] = useState<ClassificationAuditItem[]>([])
  const [summary, setSummary] = useState({ total: 0, needsReview: 0, reviewed: 0 })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('NEEDS_REVIEW')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const soft = items.length > 0
    if (soft) setRefreshing(true)
    else setLoading(true)
    try {
      const r = await api.getClassificationAudit(workspaceId, connectionId, {
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter,
        category: categoryFilter,
      })
      setItems(r.items)
      setSummary(r.summary)
      setTotalPages(r.pagination.totalPages)
      setTotalCount(r.pagination.totalCount)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- soft refresh uses items.length intentionally outside deps
  }, [workspaceId, connectionId, page, statusFilter, categoryFilter])

  useEffect(() => { setPage(1) }, [connectionId, statusFilter, categoryFilter])
  useEffect(() => { void load() }, [load])

  const handleConfirm = async (row: ClassificationAuditItem) => {
    const classification = row.finalCategory === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL'
    setActionLoading(row.messageId + 'confirm')
    setNotice(null)
    try {
      await api.confirmSenderEvidence(
        workspaceId,
        row.senderEmail,
        row.senderName,
        classification
      )
      await api.reviewClassification(workspaceId, row.classificationId, 'APPROVED')
      setNotice(
        classification === 'BUSINESS'
          ? `Updated ${row.senderEmail} to Confirmed Business in Company Data.`
          : `Updated ${row.senderEmail} to Confirmed Personal in Company Data.`
      )
      if (statusFilter === 'NEEDS_REVIEW') {
        setItems(prev => prev.filter(i => i.classificationId !== row.classificationId))
        setSummary(s => ({
          ...s,
          needsReview: Math.max(0, s.needsReview - 1),
          reviewed: s.reviewed + 1,
        }))
        setTotalCount(c => Math.max(0, c - 1))
      } else {
        void load()
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to confirm sender')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReclassify = async (row: ClassificationAuditItem) => {
    const newCategory = row.finalCategory === 'BUSINESS' ? 'PERSONAL' : 'BUSINESS'
    setActionLoading(row.messageId + 'reclassify')
    try {
      await api.reclassifyMessage(workspaceId, row.messageId, { mailboxCategory: newCategory })
      void load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reclassify failed')
    } finally {
      setActionLoading(null)
    }
  }

  const filterBtn = (active: boolean) => ({
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600 as const,
    borderRadius: 6,
    border: active ? '1px solid #1a1a2e' : '1px solid #ddd',
    background: active ? '#1a1a2e' : '#fff',
    color: active ? '#fff' : '#555',
    cursor: 'pointer' as const,
  })

  const confirmLabel = (finalCategory: string) =>
    finalCategory === 'BUSINESS' ? 'Confirm Business' : 'Confirm Personal'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flexShrink: 0, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>Email Classification Review</h2>
          {refreshing && <span style={{ fontSize: 11, color: '#999' }}>Updating…</span>}
        </div>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
          Review and audit Business/Personal classifications across processed email.
          Confirm updates Company Data senders; records stay in the audit history.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #eaedf0', background: '#fff3e0',
            fontSize: 12, fontWeight: 600, color: '#e65100',
          }}>
            Needs Review: {summary.needsReview}
          </div>
          <div style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #eaedf0', background: '#e8f5e9',
            fontSize: 12, fontWeight: 600, color: '#2e7d32',
          }}>
            Reviewed: {summary.reviewed}
          </div>
          <div style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #eaedf0', background: '#fafafa',
            fontSize: 12, fontWeight: 600, color: '#555',
          }}>
            Total: {summary.total}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Status</span>
          {([
            ['NEEDS_REVIEW', 'Needs Review'],
            ['ALL', 'All Emails'],
            ['REVIEWED', 'Reviewed'],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" style={filterBtn(statusFilter === key)} onClick={() => setStatusFilter(key)}>
              {label}
            </button>
          ))}
          <span style={{ color: '#ddd', margin: '0 4px' }}>|</span>
          <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>Category</span>
          {([
            ['ALL', 'All'],
            ['BUSINESS', 'Business'],
            ['PERSONAL', 'Personal'],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" style={filterBtn(categoryFilter === key)} onClick={() => setCategoryFilter(key)}>
              {label}
            </button>
          ))}
        </div>

        {notice && (
          <div style={{
            padding: '8px 12px', marginBottom: 10, fontSize: 12, borderRadius: 6,
            background: '#e6f4ea', border: '1px solid #a8d5a2', color: '#2e7d32',
            display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center',
          }}>
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2e7d32' }}>&times;</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #e5e5e5', borderRadius: 8 }}>
        {loading && items.length === 0 ? (
          <p style={{ color: '#888', padding: 16, fontSize: 13 }}>Loading classifications…</p>
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, color: '#333' }}>No matching records</h3>
            <p style={{ margin: 0, fontSize: 13 }}>
              {statusFilter === 'NEEDS_REVIEW'
                ? 'Nothing needs review right now. Switch to All Emails to browse the audit history.'
                : 'No classification records for this mailbox/filter.'}
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#fafafa', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Date</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Sender</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Subject</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Mailbox</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>AI</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Conf.</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Status</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Final</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const ai = categoryBadge(row.predictedCategory)
                const fin = categoryBadge(row.finalCategory)
                const st = statusBadge(row.auditStatus)
                const busy = actionLoading?.startsWith(row.messageId)
                const expanded = expandedId === row.classificationId
                return (
                  <Fragment key={row.classificationId}>
                    <tr
                      style={{
                        borderTop: '1px solid #f0f0f0',
                        background: expanded ? '#f8f9fb' : undefined,
                        cursor: 'pointer',
                      }}
                      onClick={() => setExpandedId(expanded ? null : row.classificationId)}
                    >
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: '#666' }}>{formatDate(row.date)}</td>
                      <td style={{ padding: '7px 10px', maxWidth: 160 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.senderName || row.senderEmail}
                        </div>
                        {row.senderName && (
                          <div style={{ color: '#999', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.senderEmail}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '7px 10px', maxWidth: 280 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                          {row.subject || '(no subject)'}
                        </div>
                      </td>
                      <td style={{ padding: '7px 10px', color: '#888', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.mailboxEmail ?? '—'}
                      </td>
                      <td style={{ padding: '7px 10px' }}><Badge {...ai} /></td>
                      <td style={{ padding: '7px 10px', fontWeight: 600, color: row.confidence < 0.75 ? '#e65100' : '#555' }}>
                        {pct(row.confidence)}
                      </td>
                      <td style={{ padding: '7px 10px' }}><Badge {...st} /></td>
                      <td style={{ padding: '7px 10px' }}><Badge {...fin} /></td>
                      <td style={{ padding: '7px 10px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(row.auditStatus === 'NEEDS_REVIEW' || row.auditStatus === 'AUTO') && (
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => void handleConfirm(row)}
                              style={{
                                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                                border: '1px solid #2e7d32', background: '#e8f5e9', color: '#2e7d32', cursor: 'pointer',
                              }}
                            >
                              {confirmLabel(row.finalCategory)}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => void handleReclassify(row)}
                            style={{
                              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                              border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer',
                            }}
                          >
                            Switch to {row.finalCategory === 'BUSINESS' ? 'Personal' : 'Business'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectMessage(row.messageId)}
                            style={{
                              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                              border: '1px solid #1565c0', background: '#e3f2fd', color: '#1565c0', cursor: 'pointer',
                            }}
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={9} style={{ padding: '8px 14px 12px', background: '#f8f9fb', borderBottom: '1px solid #eee' }}>
                          <div style={{ fontSize: 12, color: '#555', maxWidth: 900 }}>
                            <strong style={{ color: '#333' }}>Preview:</strong>{' '}
                            {row.snippet || 'No snippet available. Open the message for full content.'}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{
          flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 0 0', fontSize: 12, color: '#666',
        }}>
          <span>
            Page {page} of {totalPages} · {totalCount} records · {PAGE_SIZE}/page
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ padding: '4px 12px', fontSize: 12, cursor: page <= 1 ? 'default' : 'pointer' }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              style={{ padding: '4px 12px', fontSize: 12, cursor: page >= totalPages ? 'default' : 'pointer' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
