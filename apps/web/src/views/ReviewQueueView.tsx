import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  api,
  type ClassificationAuditItem,
  type ClassificationInspection,
} from '../api'

interface Props {
  workspaceId: string
  connectionId: string
}

type StatusFilter = 'ALL' | 'CORRECTED' | 'CONFIRMED'
type CategoryFilter = 'ALL' | 'BUSINESS' | 'PERSONAL'

const PAGE_SIZE = 50

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
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

function categoryBadge(cat: string | null | undefined): { bg: string; color: string; label: string } {
  if (cat === 'BUSINESS') return { bg: '#e3f2fd', color: '#1565c0', label: 'Business' }
  if (cat === 'PERSONAL') return { bg: '#f3e5f5', color: '#7b1fa2', label: 'Personal' }
  return { bg: '#f5f5f5', color: '#666', label: cat || '—' }
}

function historyBadge(status: ClassificationAuditItem['historyStatus']): { bg: string; color: string; label: string } {
  switch (status) {
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h4 style={{
        margin: '0 0 8px',
        fontSize: 11,
        fontWeight: 700,
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
      }}>
        {title}
      </h4>
      {children}
    </section>
  )
}

function ClassificationInspectorPanel({
  workspaceId,
  connectionId,
  row,
  onClose,
  onCorrected,
}: {
  workspaceId: string
  connectionId: string
  row: ClassificationAuditItem
  onClose: () => void
  onCorrected: () => void
}) {
  const [data, setData] = useState<ClassificationInspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showBody, setShowBody] = useState(false)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (includeBody = false) => {
    if (includeBody) setBodyLoading(true)
    else setLoading(true)
    setError('')
    try {
      const r = await api.getClassificationInspection(
        workspaceId,
        connectionId,
        row.classificationId,
        { includeBody }
      )
      setData(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inspection')
    } finally {
      setLoading(false)
      setBodyLoading(false)
    }
  }, [workspaceId, connectionId, row.classificationId])

  useEffect(() => {
    void load(false)
  }, [load])

  const expandBody = async () => {
    setShowBody(true)
    if (data && data.email.bodyText === undefined) {
      await load(true)
    }
  }

  const handleConfirm = async () => {
    const classification = row.finalCategory === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL'
    setActionLoading(true)
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
      onCorrected()
      await load(showBody)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to confirm sender')
    } finally {
      setActionLoading(false)
    }
  }

  const handleReclassify = async () => {
    const newCategory = row.finalCategory === 'BUSINESS' ? 'PERSONAL' : 'BUSINESS'
    setActionLoading(true)
    try {
      await api.reclassifyMessage(workspaceId, row.messageId, { mailboxCategory: newCategory })
      onCorrected()
      await load(showBody)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reclassify failed')
    } finally {
      setActionLoading(false)
    }
  }

  const fin = categoryBadge(data?.classification.mailboxCategory ?? row.finalCategory)

  return (
    <aside style={{
      width: 420,
      maxWidth: '100%',
      borderLeft: '1px solid #e5e5e5',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      flexShrink: 0,
    }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid #eee',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 8,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Classification Inspector</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            Why ForgeOps classified this email
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#888' }}
          aria-label="Close inspector"
        >
          &times;
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {loading && !data ? (
          <p style={{ color: '#888', fontSize: 13 }}>Loading evidence…</p>
        ) : error && !data ? (
          <p style={{ color: '#c62828', fontSize: 13 }}>{error}</p>
        ) : data ? (
          <>
            {notice && (
              <div style={{
                padding: '8px 10px', marginBottom: 12, fontSize: 12, borderRadius: 6,
                background: '#e6f4ea', border: '1px solid #a8d5a2', color: '#2e7d32',
              }}>
                {notice}
              </div>
            )}

            <Section title="Final classification">
              <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <div><strong>Business / Personal:</strong> <Badge {...fin} /></div>
                <div><strong>Type / subtype:</strong> {data.classification.businessTypeKey ?? '—'}</div>
                <div>
                  <strong>Job:</strong>{' '}
                  {data.entities.job
                    ? `${data.entities.job.jobNumber ?? ''} ${data.entities.job.name}`.trim()
                    : 'None'}
                </div>
                <div><strong>Priority:</strong> {data.classification.priority ?? '—'}</div>
                <div><strong>Confidence:</strong> {pct(data.classification.confidence)}</div>
                {data.classification.summary && (
                  <div style={{ color: '#555', lineHeight: 1.4 }}>{data.classification.summary}</div>
                )}
              </div>
            </Section>

            <Section title="Business / Personal signals">
              {data.decision ? (
                <div style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.45 }}>
                  <div><strong>Decision rule:</strong> {data.decision.title ?? data.decision.rule ?? '—'}</div>
                  {data.decision.summary && (
                    <div style={{ color: '#666', marginTop: 4 }}>{data.decision.summary}</div>
                  )}
                  {data.decision.cumulative && data.decision.cumulative.total != null && (
                    <div style={{ color: '#888', marginTop: 4, fontSize: 11 }}>
                      Cumulative score {data.decision.cumulative.total}
                      {data.decision.cumulative.threshold != null
                        ? ` / threshold ${data.decision.cumulative.threshold}`
                        : ''}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#888', margin: '0 0 8px' }}>
                  No persisted decision evidence for this classification.
                </p>
              )}
              {data.signals.length === 0 ? (
                <p style={{ fontSize: 12, color: '#888', margin: 0 }}>No signal markers stored.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.signals.map((s) => (
                    <div key={s.key} style={{
                      border: '1px solid #eee',
                      borderRadius: 6,
                      padding: '8px 10px',
                      background: '#fafafa',
                      fontSize: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong>{s.label}</strong>
                        <span style={{ color: '#555' }}>
                          {s.direction ? `${s.direction} — ` : ''}
                          {s.probabilityPct != null ? `${s.probabilityPct}%` : s.status ?? '—'}
                          {s.strongFlag ? ' · strong' : ''}
                        </span>
                      </div>
                      {s.explanation && (
                        <div style={{ color: '#888', marginTop: 4, fontSize: 11 }}>{s.explanation}</div>
                      )}
                      {s.cumulativeAdjustment != null && s.cumulativeAdjustment !== 0 && (
                        <div style={{ color: '#888', marginTop: 2, fontSize: 11 }}>
                          Cumulative adjustment: {s.cumulativeAdjustment > 0 ? '+' : ''}{s.cumulativeAdjustment}
                        </div>
                      )}
                      {!s.includedInDecision && (
                        <div style={{ color: '#bbb', marginTop: 2, fontSize: 10 }}>Not included in decision</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Job association">
              {data.jobAssociation.status === 'CONFIRMED' ? (
                <div style={{
                  border: '1px solid #c8e6c9',
                  background: '#e8f5e9',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12,
                  marginBottom: 8,
                }}>
                  <div style={{ fontWeight: 700, color: '#2e7d32', marginBottom: 4 }}>
                    CONFIRMED BUSINESS
                  </div>
                  <div>
                    <strong>Matched Job:</strong>{' '}
                    {[
                      data.jobAssociation.jobNumber
                        ? `#${data.jobAssociation.jobNumber}`
                        : null,
                      data.jobAssociation.name,
                    ]
                      .filter(Boolean)
                      .join(' — ')}
                  </div>
                  <div style={{ marginTop: 6, color: '#1b5e20' }}>
                    <strong>Decision effect:</strong> {data.jobAssociation.decisionEffect}
                  </div>
                  {data.jobAssociation.forcedDecision && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#33691e' }}>
                      This association forced the final category to BUSINESS.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                  No confirmed ForgeOps job attached to this email.
                </div>
              )}
              {data.jobCandidate.status === 'CANDIDATE' ? (
                <div style={{
                  border: '1px solid #eee',
                  background: '#fafafa',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 12,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Job candidate (probabilistic)</div>
                  <div style={{ color: '#666' }}>
                    {data.jobCandidate.confidencePct != null
                      ? `${data.jobCandidate.confidencePct}% job-reference confidence`
                      : 'AI/job hint only'}
                    {data.jobCandidate.hintedJobId
                      ? ` · hinted job ${data.jobCandidate.hintedJobId}`
                      : ''}
                  </div>
                  {data.jobCandidate.explanation && (
                    <div style={{ color: '#888', marginTop: 4, fontSize: 11 }}>
                      {data.jobCandidate.explanation}
                    </div>
                  )}
                  <div style={{ color: '#999', marginTop: 4, fontSize: 10 }}>
                    Candidate alone does not confirm BUSINESS — only a persisted Job association does.
                  </div>
                </div>
              ) : null}
            </Section>

            <Section title="Reference data">
              <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.senderEvidence ? (
                  <div>
                    <strong>Sender:</strong> {data.senderEvidence.status.replace(/_/g, ' ')}
                    {' · '}{pct(data.senderEvidence.confidence)}
                    {data.senderEvidence.displayName ? ` · ${data.senderEvidence.displayName}` : ''}
                  </div>
                ) : (
                  <div style={{ color: '#888' }}>Sender evidence: none stored</div>
                )}
                {data.domainEvidence ? (
                  <div>
                    <strong>Domain:</strong> {data.domainEvidence.domain} · {data.domainEvidence.status.replace(/_/g, ' ')}
                    {' · '}{pct(data.domainEvidence.confidence)}
                  </div>
                ) : (
                  <div style={{ color: '#888' }}>Domain evidence: none stored</div>
                )}
                {data.entities.customer && (
                  <div><strong>Customer:</strong> {data.entities.customer.name}</div>
                )}
                {data.entities.vendor && (
                  <div><strong>Vendor:</strong> {data.entities.vendor.name}</div>
                )}
                {data.entities.entityMatchConfidence != null && (
                  <div>Entity match confidence: {pct(data.entities.entityMatchConfidence)}</div>
                )}
                {data.entities.matchEvidence.length > 0 && (
                  <div style={{ color: '#666', fontSize: 11 }}>
                    Match evidence entries: {data.entities.matchEvidence.length}
                  </div>
                )}
              </div>
            </Section>

            {data.availableStages.includes('tasks') && (
              <Section title="Tasks">
                {data.tasks.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#888', margin: 0 }}>None</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                    {data.tasks.map((t) => (
                      <li key={t.id} style={{ marginBottom: 4 }}>
                        {t.title}
                        {t.dueAt ? ` · due ${formatDate(t.dueAt)}` : ''}
                        {' · '}{t.priority}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {data.priorityDecision && (
              <Section title="Priority">
                <div style={{ fontSize: 12 }}>
                  <div><strong>{data.priorityDecision.displayLabel}</strong> — {data.priorityDecision.reason}</div>
                  {data.priorityDecision.showJobConfidence && data.priorityDecision.jobConfidencePct != null && (
                    <div style={{ color: '#888', marginTop: 4 }}>
                      Job confidence {data.priorityDecision.jobConfidencePct}%
                      {data.priorityDecision.jobThresholdPct != null
                        ? ` (threshold ${data.priorityDecision.jobThresholdPct}%)`
                        : ''}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {data.corrections.length > 0 && (
              <Section title="Correction history">
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                  {data.corrections.map((c) => (
                    <li key={c.id} style={{ marginBottom: 4 }}>
                      {c.originalMailboxCategory ?? '?'} → {c.correctedMailboxCategory ?? '?'}
                      {' · '}{formatDate(c.reviewedAt)}
                      {c.reason ? ` · ${c.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Email content">
              <button
                type="button"
                onClick={() => void (showBody ? setShowBody(false) : expandBody())}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6,
                  border: '1px solid #ddd', background: '#fff', cursor: 'pointer',
                }}
              >
                {showBody ? 'Hide Email Content' : 'View Email Content'}
              </button>
              {showBody && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#444', lineHeight: 1.45 }}>
                  {bodyLoading && <div style={{ color: '#888' }}>Loading body…</div>}
                  <div><strong>From:</strong> {data.email.fromName ? `${data.email.fromName} <${data.email.fromEmail}>` : data.email.fromEmail}</div>
                  <div><strong>Subject:</strong> {data.email.subject || '(no subject)'}</div>
                  <div><strong>Date:</strong> {formatDate(data.email.date)}</div>
                  {data.email.snippet && !data.email.bodyText && (
                    <div style={{ marginTop: 8, color: '#666' }}>{data.email.snippet}</div>
                  )}
                  {data.email.bodyText != null && (
                    <pre style={{
                      marginTop: 10,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      background: '#fafafa',
                      border: '1px solid #eee',
                      borderRadius: 6,
                      padding: 10,
                      maxHeight: 280,
                      overflow: 'auto',
                    }}>
                      {data.email.bodyText || '(empty body)'}
                    </pre>
                  )}
                </div>
              )}
            </Section>
          </>
        ) : null}
      </div>

      <div style={{
        borderTop: '1px solid #eee',
        padding: 12,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}>
        <button
          type="button"
          disabled={actionLoading}
          onClick={() => void handleConfirm()}
          style={{
            fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 4,
            border: '1px solid #2e7d32', background: '#e8f5e9', color: '#2e7d32', cursor: 'pointer',
          }}
        >
          Confirm {row.finalCategory === 'BUSINESS' ? 'Business' : 'Personal'}
        </button>
        <button
          type="button"
          disabled={actionLoading}
          onClick={() => void handleReclassify()}
          style={{
            fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 4,
            border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer',
          }}
        >
          Switch to {row.finalCategory === 'BUSINESS' ? 'Personal' : 'Business'}
        </button>
      </div>
    </aside>
  )
}

export function ReviewQueueView({ workspaceId, connectionId }: Props) {
  const [items, setItems] = useState<ClassificationAuditItem[]>([])
  const [summary, setSummary] = useState({ total: 0, corrected: 0, confirmed: 0 })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<ClassificationAuditItem | null>(null)

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- soft refresh uses items.length intentionally
  }, [workspaceId, connectionId, page, statusFilter, categoryFilter])

  useEffect(() => { setPage(1) }, [connectionId, statusFilter, categoryFilter])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setSelected(null) }, [connectionId, statusFilter, categoryFilter, page])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flexShrink: 0, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>Email Classification Review</h2>
          {refreshing && <span style={{ fontSize: 11, color: '#999' }}>Updating…</span>}
        </div>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
          Classification history and evidence inspector. Click a row to see why ForgeOps classified it —
          not an inbox review queue.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #eaedf0', background: '#fafafa',
            fontSize: 12, fontWeight: 600, color: '#555',
          }}>
            Total: {summary.total}
          </div>
          <div style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #eaedf0', background: '#e8eaf6',
            fontSize: 12, fontWeight: 600, color: '#3949ab',
          }}>
            Corrected: {summary.corrected}
          </div>
          <div style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #eaedf0', background: '#e8f5e9',
            fontSize: 12, fontWeight: 600, color: '#2e7d32',
          }}>
            Confirmed: {summary.confirmed}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>History</span>
          {([
            ['ALL', 'All'],
            ['CORRECTED', 'Corrected'],
            ['CONFIRMED', 'Confirmed'],
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
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0, border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {loading && items.length === 0 ? (
            <p style={{ color: '#888', padding: 16, fontSize: 13 }}>Loading classifications…</p>
          ) : items.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 15, color: '#333' }}>No classification records</h3>
              <p style={{ margin: 0, fontSize: 13 }}>
                Classified emails for this mailbox will appear here.
              </p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#fafafa', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Date</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Sender</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Subject</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Category</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Type</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Job</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Priority</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>Conf.</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: '#666', borderBottom: '1px solid #eee' }}>History</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const fin = categoryBadge(row.finalCategory)
                  const hist = historyBadge(
                    row.historyStatus ??
                      (row.auditStatus === 'CONFIRMED' ||
                      row.auditStatus === 'CORRECTED' ||
                      row.auditStatus === 'DISMISSED' ||
                      row.auditStatus === 'AUTO'
                        ? row.auditStatus
                        : 'AUTO')
                  )
                  const active = selected?.classificationId === row.classificationId
                  return (
                    <tr
                      key={row.classificationId}
                      style={{
                        borderTop: '1px solid #f0f0f0',
                        background: active ? '#eef3ff' : undefined,
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelected(row)}
                    >
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: '#666' }}>{formatDate(row.date)}</td>
                      <td style={{ padding: '7px 10px', maxWidth: 150 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.senderName || row.senderEmail}
                        </div>
                      </td>
                      <td style={{ padding: '7px 10px', maxWidth: 240 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                          {row.subject || '(no subject)'}
                        </div>
                      </td>
                      <td style={{ padding: '7px 10px' }}><Badge {...fin} /></td>
                      <td style={{ padding: '7px 10px', color: '#666', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.businessTypeKey ?? '—'}
                      </td>
                      <td style={{ padding: '7px 10px', color: '#666', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.job ? (row.job.jobNumber || row.job.name) : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', color: '#555' }}>{row.priority ?? '—'}</td>
                      <td style={{ padding: '7px 10px', fontWeight: 600, color: '#555' }}>{pct(row.confidence)}</td>
                      <td style={{ padding: '7px 10px' }}><Badge {...hist} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <ClassificationInspectorPanel
            workspaceId={workspaceId}
            connectionId={connectionId}
            row={selected}
            onClose={() => setSelected(null)}
            onCorrected={() => void load()}
          />
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
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ padding: '4px 12px', fontSize: 12 }}>
              Previous
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} style={{ padding: '4px 12px', fontSize: 12 }}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
