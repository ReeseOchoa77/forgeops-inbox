import { useEffect, useState, type CSSProperties } from 'react'
import {
  api,
  type SubtypeApprovalPreview,
  type SubtypeDiscoveryRecommendation,
  type SubtypeRecommendationDecisionDto,
  type SubtypeRecommendationEditPayload,
  type SubtypeTaxonomyEvalMetrics,
  type TaxonomyRevisionDto,
} from '../api'

type Props = {
  workspaceId: string
  runId: string
  recommendation: SubtypeDiscoveryRecommendation
  allRecommendations: SubtypeDiscoveryRecommendation[]
  decision: SubtypeRecommendationDecisionDto | null
  onDecisionChange: () => void
}

function defaultEdit(rec: SubtypeDiscoveryRecommendation): SubtypeRecommendationEditPayload {
  const name = rec.suggestedSubtypeName?.trim() || 'Custom Subtype'
  const key = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return {
    suggestedSubtypeName: name,
    systemKey: key || 'CUSTOM_SUBTYPE',
    recommendedParentType: 'BUSINESS',
    definition: rec.definition ?? '',
    inclusionCriteria: rec.inclusionCriteria ?? '',
    exclusionCriteria: rec.exclusionCriteria ?? '',
  }
}

export function SubtypeRecommendationReview({
  workspaceId,
  runId,
  recommendation,
  allRecommendations,
  decision,
  onDecisionChange,
}: Props) {
  const [edit, setEdit] = useState<SubtypeRecommendationEditPayload>(() =>
    decision?.editedPayload ?? defaultEdit(recommendation)
  )
  const [mergeTarget, setMergeTarget] = useState(decision?.mergeTargetKey ?? '')
  const [notes, setNotes] = useState(decision?.notes ?? '')
  const [preview, setPreview] = useState<SubtypeApprovalPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setEdit(decision?.editedPayload ?? defaultEdit(recommendation))
    setMergeTarget(decision?.mergeTargetKey ?? '')
    setNotes(decision?.notes ?? '')
    setPreview(null)
    setError(null)
    setMessage(null)
  }, [recommendation.id, decision?.id])

  const approved = decision?.status === 'APPROVED'

  const runDecision = async (
    status: 'REJECTED' | 'MERGED' | 'DEFERRED' | 'PENDING'
  ) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.setSubtypeRecommendationDecision(workspaceId, runId, recommendation.id, {
        status,
        editedPayload: edit,
        mergeTargetKey: status === 'MERGED' ? mergeTarget || null : null,
        notes: notes || null,
      })
      setMessage(`Marked ${status}`)
      onDecisionChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed')
    } finally {
      setBusy(false)
    }
  }

  const onPreview = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.previewSubtypeRecommendationApproval(
        workspaceId,
        runId,
        recommendation.id,
        { editedPayload: edit }
      )
      setPreview(res.preview)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  const onApprove = async () => {
    if (!preview) {
      setError('Preview the exact change before approving')
      return
    }
    if (preview.duplicateOf) {
      setError(`Duplicate key ${preview.duplicateOf} — edit systemKey or merge`)
      return
    }
    const ok = window.confirm(
      `Apply taxonomy change?\n\nAdd subtype ${preview.systemKey} (${preview.displayLabel})\nParent: BUSINESS\nHistorical emails will NOT be reclassified.`
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await api.approveSubtypeRecommendation(workspaceId, runId, recommendation.id, {
        confirmApply: true,
        editedPayload: edit,
        notes: notes || null,
      })
      setMessage('Approved and applied (taxonomy only)')
      setPreview(null)
      onDecisionChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #d1d5db' }}>
      <h4 style={h4}>Review &amp; approval</h4>
      <p style={muted}>
        Approve creates a workspace BusinessType + taxonomy revision. It does not reclassify
        historical email. Reject / defer / merge record a decision only.
      </p>
      {decision && (
        <div style={{ fontSize: 12, marginBottom: 8, color: '#4b5563' }}>
          Current decision: <strong>{decision.status}</strong>
          {decision.taxonomyRevisionId ? ` · revision ${decision.taxonomyRevisionId.slice(0, 8)}…` : ''}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
        <Field
          label="Suggested name"
          value={edit.suggestedSubtypeName}
          disabled={approved}
          onChange={(v) => setEdit((e) => ({ ...e, suggestedSubtypeName: v }))}
        />
        <Field
          label="System key"
          value={edit.systemKey}
          disabled={approved}
          onChange={(v) =>
            setEdit((e) => ({
              ...e,
              systemKey: v.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
            }))
          }
        />
        <Field
          label="Definition"
          value={edit.definition}
          disabled={approved}
          multiline
          onChange={(v) => setEdit((e) => ({ ...e, definition: v }))}
        />
        <Field
          label="Inclusion"
          value={edit.inclusionCriteria}
          disabled={approved}
          multiline
          onChange={(v) => setEdit((e) => ({ ...e, inclusionCriteria: v }))}
        />
        <Field
          label="Exclusion"
          value={edit.exclusionCriteria}
          disabled={approved}
          multiline
          onChange={(v) => setEdit((e) => ({ ...e, exclusionCriteria: v }))}
        />
        <label style={label}>
          Merge target (existing key)
          <input
            value={mergeTarget}
            disabled={approved}
            onChange={(e) => setMergeTarget(e.target.value)}
            placeholder="e.g. RFI_CLARIFICATION"
            style={input}
          />
        </label>
        <Field
          label="Notes"
          value={notes}
          disabled={approved}
          onChange={setNotes}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {!approved && (
          <>
            <button type="button" disabled={busy} onClick={() => void onPreview()} style={secondaryBtn}>
              Preview approval
            </button>
            <button type="button" disabled={busy || !preview} onClick={() => void onApprove()} style={primaryBtn}>
              Confirm approve
            </button>
            <button type="button" disabled={busy} onClick={() => void runDecision('REJECTED')} style={secondaryBtn}>
              Reject
            </button>
            <button type="button" disabled={busy} onClick={() => void runDecision('MERGED')} style={secondaryBtn}>
              Merge
            </button>
            <button type="button" disabled={busy} onClick={() => void runDecision('DEFERRED')} style={secondaryBtn}>
              Defer
            </button>
          </>
        )}
      </div>

      {preview && (
        <div style={{ ...card, marginTop: 10, fontSize: 13 }}>
          <strong>Exact proposed change</strong>
          <div>Type: ADD_SUBTYPE · Parent: BUSINESS</div>
          <div>
            Key: <code>{preview.systemKey}</code> · Label: {preview.displayLabel}
          </div>
          <div>Reclassify historical emails: <strong>no</strong></div>
          {preview.duplicateOf && (
            <div style={{ color: '#b42318' }}>Duplicate of existing key {preview.duplicateOf}</div>
          )}
        </div>
      )}

      {error && <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 8 }}>{error}</div>}
      {message && <div style={{ color: '#166534', fontSize: 13, marginTop: 8 }}>{message}</div>}

      <TaxonomyEvalBlock
        workspaceId={workspaceId}
        runId={runId}
        allRecommendations={allRecommendations}
        focusRecommendationId={recommendation.id}
      />
    </div>
  )
}

function TaxonomyEvalBlock({
  workspaceId,
  runId,
  allRecommendations,
  focusRecommendationId,
}: {
  workspaceId: string
  runId: string
  allRecommendations: SubtypeDiscoveryRecommendation[]
  focusRecommendationId: string
}) {
  const [selected, setSelected] = useState<string[]>([focusRecommendationId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<SubtypeTaxonomyEvalMetrics | null>(null)
  const [evalId, setEvalId] = useState<string | null>(null)
  const [history, setHistory] = useState<
    Array<{ id: string; createdAt: string; groundTruthQuality: string; metrics: SubtypeTaxonomyEvalMetrics }>
  >([])

  useEffect(() => {
    void api.listSubtypeTaxonomyEvals(workspaceId, runId).then((r) =>
      setHistory(
        r.evals.map((e) => ({
          id: e.id,
          createdAt: e.createdAt,
          groundTruthQuality: e.groundTruthQuality,
          metrics: e.metrics,
        }))
      )
    )
  }, [workspaceId, runId, evalId])

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const runEval = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.runSubtypeTaxonomyEval(workspaceId, runId, {
        proposedRecommendationIds: selected,
      })
      setMetrics(res.metrics)
      setEvalId(res.evalRunId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eval failed')
    } finally {
      setBusy(false)
    }
  }

  const openEval = async (id: string) => {
    const res = await api.getSubtypeTaxonomyEval(workspaceId, id)
    setMetrics(res.eval.metrics)
    setEvalId(res.eval.id)
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={h4}>Before / after evaluation (experimental)</h4>
      <p style={muted}>
        Compares current subtype assignments vs simulated proposed assignments from selected
        discovery recommendations. Not production accuracy. Precision only when human correction
        labels exist.
      </p>
      <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
        {allRecommendations.map((r) => (
          <label key={r.id} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={selected.includes(r.id)}
              onChange={() => toggle(r.id)}
            />
            {r.suggestedSubtypeName ?? r.id} ({r.kind})
          </label>
        ))}
      </div>
      <button type="button" disabled={busy || selected.length === 0} onClick={() => void runEval()} style={secondaryBtn}>
        {busy ? 'Evaluating…' : 'Run comparison'}
      </button>
      {error && <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {metrics && <EvalMetricsView metrics={metrics} evalId={evalId} />}
      {history.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div style={{ fontWeight: 650, marginBottom: 4 }}>Saved experimental evals (switch without rerun)</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {history.map((h) => (
              <li key={h.id}>
                <button type="button" style={linkBtn} onClick={() => void openEval(h.id)}>
                  {h.id.slice(0, 10)}… · {new Date(h.createdAt).toLocaleString()} · GT{' '}
                  {h.groundTruthQuality}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function TaxonomyRevisionsPanel({ workspaceId }: { workspaceId: string }) {
  const [revisions, setRevisions] = useState<TaxonomyRevisionDto[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    void api
      .listTaxonomyRevisions(workspaceId)
      .then((r) => setRevisions(r.revisions))
      .catch(() => setRevisions([]))
  }

  useEffect(() => {
    refresh()
  }, [workspaceId])

  const onRollback = async (id: string) => {
    const ok = window.confirm(
      'Rollback this ADD_SUBTYPE revision? The workspace BusinessType will be deactivated. Historical email classifications will NOT be rewritten.'
    )
    if (!ok) return
    setError(null)
    try {
      await api.rollbackTaxonomyRevision(workspaceId, id, { confirmRollback: true })
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed')
    }
  }

  return (
    <section style={card}>
      <h4 style={h4}>Taxonomy revisions</h4>
      <p style={muted}>
        Sequential workspace taxonomy versions. Rollback deactivates added subtypes without rewriting
        historical classifications.
      </p>
      {error && <div role="alert" style={{ color: '#b42318', fontSize: 13 }}>{error}</div>}
      {revisions.length === 0 ? (
        <p style={muted}>No taxonomy revisions yet.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {revisions.map((r) => (
            <li key={r.id} style={{ marginBottom: 8 }}>
              v{r.version} · {r.changeType} · {r.status} · {r.systemKey ?? '—'} ·{' '}
              {new Date(r.createdAt).toLocaleString()}
              {r.status === 'ACTIVE' && r.changeType === 'ADD_SUBTYPE' && (
                <>
                  {' '}
                  <button type="button" style={linkBtn} onClick={() => void onRollback(r.id)}>
                    Rollback
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EvalMetricsView({
  metrics,
  evalId,
}: {
  metrics: SubtypeTaxonomyEvalMetrics
  evalId: string | null
}) {
  return (
    <div style={{ ...card, marginTop: 10, fontSize: 12 }}>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>
        Experimental eval {evalId ? evalId.slice(0, 10) + '…' : ''} · GT quality:{' '}
        {metrics.groundTruthQuality}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
        }}
      >
        <MetricCol title="Current" side={metrics.current} />
        <MetricCol title="Proposed" side={metrics.proposed} />
        <div>
          <div style={{ fontWeight: 650 }}>Delta</div>
          <div>Coverage: {metrics.delta.coverage}</div>
          <div>OTHER_BUSINESS: {metrics.delta.otherBusinessCount}</div>
          <div>
            GT precision Δ:{' '}
            {metrics.delta.groundTruthPrecision == null
              ? 'n/a (no GT)'
              : metrics.delta.groundTruthPrecision}
          </div>
          <div>Newly matching GT: {metrics.delta.newlyMatchingGt}</div>
          <div>Newly mismatching GT: {metrics.delta.newlyMismatchingGt}</div>
          <div>Assignment changes: {metrics.delta.assignmentChanges}</div>
        </div>
      </div>
      {metrics.current.groundTruthLabeled > 0 && metrics.proposed.confusion.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 650 }}>Proposed confusion (GT available only)</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {metrics.proposed.confusion.slice(0, 12).map((c, i) => (
              <li key={i}>
                {c.actual} → {c.predicted}: {c.count}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p style={{ ...muted, marginTop: 8, marginBottom: 0 }}>{metrics.methodologyNotes}</p>
    </div>
  )
}

function MetricCol({
  title,
  side,
}: {
  title: string
  side: SubtypeTaxonomyEvalMetrics['current']
}) {
  return (
    <div>
      <div style={{ fontWeight: 650 }}>{title}</div>
      <div>Coverage: {side.coverage}</div>
      <div>Labeled: {side.labeledCount}</div>
      <div>OTHER: {side.otherBusinessCount}</div>
      <div>
        GT precision:{' '}
        {side.groundTruthPrecision == null
          ? 'n/a'
          : `${side.groundTruthPrecision} (n=${side.groundTruthLabeled})`}
      </div>
    </div>
  )
}

function Field({
  label: lab,
  value,
  onChange,
  disabled,
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  multiline?: boolean
}) {
  return (
    <label style={label}>
      {lab}
      {multiline ? (
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...input, resize: 'vertical' }}
        />
      ) : (
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={input}
        />
      )}
    </label>
  )
}

const h4: CSSProperties = { fontSize: 13, fontWeight: 650, margin: '0 0 8px' }
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', margin: '0 0 8px' }
const label: CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
}
const input: CSSProperties = {
  padding: '7px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 400,
}
const card: CSSProperties = {
  padding: 12,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#f9fafb',
}
const primaryBtn: CSSProperties = {
  padding: '7px 12px',
  border: '1px solid #1a1a2e',
  borderRadius: 6,
  background: '#1a1a2e',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
const secondaryBtn: CSSProperties = {
  padding: '7px 12px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  background: '#fff',
  color: '#111827',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
const linkBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  color: '#1d4ed8',
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
}
