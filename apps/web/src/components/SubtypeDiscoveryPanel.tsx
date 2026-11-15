import { useEffect, useState, type CSSProperties } from 'react'
import {
  api,
  type SubtypeDiscoveryConfigInput,
  type SubtypeDiscoveryPreview,
  type SubtypeDiscoveryRecommendation,
  type SubtypeDiscoveryRunDto,
  type SubtypeRecommendationDecisionDto,
} from '../api'
import {
  SubtypeRecommendationReview,
  TaxonomyRevisionsPanel,
} from './SubtypeRecommendationReview'

type Props = {
  workspaceId: string
}

const PRESETS: Array<{ id: NonNullable<SubtypeDiscoveryConfigInput['samplePreset']>; label: string }> = [
  { id: '500', label: '500 emails' },
  { id: '2500', label: '2,500 emails' },
  { id: '10000', label: '10,000 emails' },
  { id: 'ALL_ELIGIBLE', label: 'All eligible' },
  { id: 'CUSTOM', label: 'Custom' },
]

export function SubtypeDiscoveryPanel({ workspaceId }: Props) {
  const [samplePreset, setSamplePreset] =
    useState<NonNullable<SubtypeDiscoveryConfigInput['samplePreset']>>('500')
  const [customCount, setCustomCount] = useState(100)
  const [mailboxCategory, setMailboxCategory] =
    useState<NonNullable<SubtypeDiscoveryConfigInput['mailboxCategory']>>('BUSINESS')
  const [receivedAfter, setReceivedAfter] = useState('')
  const [receivedBefore, setReceivedBefore] = useState('')
  const [preview, setPreview] = useState<SubtypeDiscoveryPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [run, setRun] = useState<SubtypeDiscoveryRunDto | null>(null)
  const [history, setHistory] = useState<
    Array<{
      id: string
      status: string
      createdAt: string
      completedAt: string | null
      summary: SubtypeDiscoveryRunDto['summary']
    }>
  >([])
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<SubtypeRecommendationDecisionDto[]>([])

  const config = (): SubtypeDiscoveryConfigInput => ({
    samplePreset,
    customCount: samplePreset === 'CUSTOM' ? customCount : null,
    mailboxCategory,
    inboxConnectionId: null,
    receivedAfter: receivedAfter.trim() ? new Date(receivedAfter).toISOString() : null,
    receivedBefore: receivedBefore.trim() ? new Date(receivedBefore).toISOString() : null,
  })

  const refreshHistory = () => {
    void api
      .listSubtypeDiscoveryRuns(workspaceId)
      .then((r) => setHistory(r.runs))
      .catch(() => setHistory([]))
  }

  const refreshDecisions = (runId: string) => {
    void api
      .listSubtypeRecommendationDecisions(workspaceId, runId)
      .then((r) => setDecisions(r.decisions))
      .catch(() => setDecisions([]))
  }

  useEffect(() => {
    refreshHistory()
  }, [workspaceId])

  useEffect(() => {
    if (!activeRunId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await api.getSubtypeDiscoveryRun(workspaceId, activeRunId)
        if (cancelled) return
        setRun(res.run)
        if (
          res.run.status === 'COMPLETED' ||
          res.run.status === 'FAILED' ||
          res.run.status === 'CANCELLED'
        ) {
          refreshHistory()
          refreshDecisions(activeRunId)
          return
        }
      } catch {
        /* keep polling */
      }
      if (!cancelled) window.setTimeout(() => void tick(), 2000)
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [workspaceId, activeRunId])

  const onPreview = async () => {
    setPreviewBusy(true)
    setError(null)
    try {
      const res = await api.previewSubtypeDiscovery(workspaceId, config())
      setPreview(res.preview)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewBusy(false)
    }
  }

  const onStart = async () => {
    setStartBusy(true)
    setError(null)
    try {
      const res = await api.startSubtypeDiscoveryRun(workspaceId, config())
      setActiveRunId(res.runId)
      setSelectedRecId(null)
      refreshHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start run')
    } finally {
      setStartBusy(false)
    }
  }

  const onCancel = async () => {
    if (!activeRunId) return
    try {
      await api.cancelSubtypeDiscoveryRun(workspaceId, activeRunId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    }
  }

  const onOpenHistory = async (id: string) => {
    setError(null)
    setActiveRunId(id)
    setSelectedRecId(null)
    try {
      const res = await api.getSubtypeDiscoveryRun(workspaceId, id)
      setRun(res.run)
      refreshDecisions(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run')
    }
  }

  const selectedRec =
    run?.recommendations.find((r) => r.id === selectedRecId) ?? null
  const selectedDecision =
    decisions.find((d) => d.recommendationId === selectedRecId) ?? null
  const running =
    run?.status === 'PENDING' ||
    run?.status === 'RUNNING' ||
    run?.status === 'CANCELLING'

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 960, paddingBottom: 32 }}>
      <div>
        <h3 style={h3}>Subtype Discovery</h3>
        <p style={muted}>
          Experimental read-only engine. Clusters sampled emails by communication purpose and
          recommends subtype taxonomy changes. Does <strong>not</strong> create, delete, or modify
          subtypes or reclassify mail.
        </p>
      </div>

      <section style={card}>
        <h4 style={h4}>New discovery run</h4>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={label}>
            Dataset size
            <select
              value={samplePreset}
              onChange={(e) =>
                setSamplePreset(
                  e.target.value as NonNullable<SubtypeDiscoveryConfigInput['samplePreset']>
                )
              }
              style={input}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {samplePreset === 'CUSTOM' && (
            <label style={label}>
              Custom count (1–10,000)
              <input
                type="number"
                min={1}
                max={10000}
                value={customCount}
                onChange={(e) => setCustomCount(Number(e.target.value) || 1)}
                style={input}
              />
            </label>
          )}
          <label style={label}>
            Email type filter
            <select
              value={mailboxCategory}
              onChange={(e) =>
                setMailboxCategory(
                  e.target.value as NonNullable<SubtypeDiscoveryConfigInput['mailboxCategory']>
                )
              }
              style={input}
            >
              <option value="BUSINESS">BUSINESS (recommended — subtypes are BUSINESS-parented)</option>
              <option value="PERSONAL">PERSONAL</option>
              <option value="ALL">All types</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...label, flex: 1, minWidth: 160 }}>
              Received after
              <input
                type="date"
                value={receivedAfter}
                onChange={(e) => setReceivedAfter(e.target.value)}
                style={input}
              />
            </label>
            <label style={{ ...label, flex: 1, minWidth: 160 }}>
              Received before
              <input
                type="date"
                value={receivedBefore}
                onChange={(e) => setReceivedBefore(e.target.value)}
                style={input}
              />
            </label>
          </div>
          <p style={{ ...muted, margin: 0 }}>
            Sampling uses deterministic time/mailbox strata (not newest-only). Preview validates
            requested size against eligible count.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={previewBusy} onClick={() => void onPreview()} style={secondaryBtn}>
              {previewBusy ? 'Previewing…' : 'Preview dataset'}
            </button>
            <button
              type="button"
              disabled={startBusy || running}
              onClick={() => void onStart()}
              style={primaryBtn}
            >
              {startBusy ? 'Starting…' : 'Start discovery run'}
            </button>
            {running && (
              <button type="button" onClick={() => void onCancel()} style={secondaryBtn}>
                Cancel
              </button>
            )}
          </div>
          {preview && (
            <div style={{ fontSize: 13, color: '#374151' }}>
              Eligible: {preview.eligibleCount} · Will sample: {preview.willSample}
              {preview.capped ? ' (requested size exceeds available — capped)' : ''}
            </div>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" style={{ color: '#b42318', fontSize: 13 }}>
          {error}
        </div>
      )}

      {run && (
        <section style={card}>
          <h4 style={h4}>Run {run.id.slice(0, 10)}… · {run.status}</h4>
          <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 10 }}>
            Phase: {run.progress.phase}
            {run.progress.message ? ` — ${run.progress.message}` : ''}
            {run.errorMessage ? (
              <div style={{ color: '#b42318', marginTop: 6 }}>{run.errorMessage}</div>
            ) : null}
          </div>
          {run.summary && <SummaryStrip summary={run.summary} />}
          {run.recommendations.length > 0 && (
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <h4 style={{ ...h4, marginBottom: 0 }}>Recommendations</h4>
              {run.recommendations.map((rec) => {
                const dec = decisions.find((d) => d.recommendationId === rec.id)
                return (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => setSelectedRecId(rec.id)}
                  style={{
                    ...cardBtn,
                    borderColor: selectedRecId === rec.id ? '#1d4ed8' : '#e5e7eb',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong style={{ fontSize: 14 }}>
                      {rec.suggestedSubtypeName ?? '(no label)'}
                    </strong>
                    <KindBadge kind={rec.kind} />
                    {dec && <KindBadge kind={dec.status} />}
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {rec.supportingEmailCount} emails ·{' '}
                      {Math.round(rec.shareOfAnalyzed * 1000) / 10}% of analyzed · cohesion{' '}
                      {rec.clusterCohesion}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#4b5563', marginTop: 6, textAlign: 'left' }}>
                    {rec.definition ?? rec.rationale}
                  </div>
                </button>
              )})}
            </div>
          )}
          {selectedRec && run && (
            <RecommendationDetail
              rec={selectedRec}
              workspaceId={workspaceId}
              runId={run.id}
              allRecommendations={run.recommendations}
              decision={selectedDecision}
              onDecisionChange={() => refreshDecisions(run.id)}
            />
          )}
        </section>
      )}

      <TaxonomyRevisionsPanel workspaceId={workspaceId} />

      <section style={card}>
        <h4 style={h4}>Previous runs</h4>
        {history.length === 0 ? (
          <p style={muted}>No discovery runs yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {history.map((h) => (
              <li key={h.id} style={{ marginBottom: 8 }}>
                <button type="button" onClick={() => void onOpenHistory(h.id)} style={linkBtn}>
                  {h.id.slice(0, 12)}… · {h.status} · {new Date(h.createdAt).toLocaleString()}
                </button>
                {h.summary && (
                  <span style={{ color: '#6b7280' }}>
                    {' '}
                    · {h.summary.emailsAnalyzed} analyzed · {h.summary.proposedNewSubtypes} new
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SummaryStrip({ summary }: { summary: NonNullable<SubtypeDiscoveryRunDto['summary']> }) {
  const cells = [
    ['Selected', summary.emailsSelected],
    ['Analyzed', summary.emailsAnalyzed],
    ['Excluded', summary.emailsExcluded],
    ['Clusters', summary.clustersDiscovered],
    ['New', summary.proposedNewSubtypes],
    ['Existing match', summary.existingSubtypeMatches],
    ['Unresolved', summary.unresolvedClusters],
    ['Duration', `${Math.round(summary.durationMs / 1000)}s`],
  ] as const
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 8,
      }}
    >
      {cells.map(([label, value]) => (
        <div
          key={label}
          style={{
            padding: '8px 10px',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          <div style={{ color: '#6b7280' }}>{label}</div>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{value}</div>
        </div>
      ))}
      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#6b7280' }}>
        Sampling: {summary.samplingMethod} · Embed: {summary.embeddingModel} · Cluster:{' '}
        {summary.clusterAlgorithm}
      </div>
    </div>
  )
}

function RecommendationDetail({
  rec,
  workspaceId,
  runId,
  allRecommendations,
  decision,
  onDecisionChange,
}: {
  rec: SubtypeDiscoveryRecommendation
  workspaceId: string
  runId: string
  allRecommendations: SubtypeDiscoveryRecommendation[]
  decision: SubtypeRecommendationDecisionDto | null
  onDecisionChange: () => void
}) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
      <h4 style={h4}>Detailed review</h4>
      <KV label="Kind" value={rec.kind} />
      <KV label="Parent type" value={rec.recommendedParentType ?? '—'} />
      <KV label="Definition" value={rec.definition ?? '—'} />
      <KV label="Inclusion" value={rec.inclusionCriteria ?? '—'} />
      <KV label="Exclusion" value={rec.exclusionCriteria ?? '—'} />
      <KV
        label="Similar subtypes"
        value={rec.similarExistingSubtypes.join(', ') || '—'}
      />
      <KV label="Overlap" value={rec.overlapNotes ?? '—'} />
      <KV label="Rationale" value={rec.rationale} />
      <KV
        label="Cohesion"
        value={`${rec.clusterCohesion} (mean internal cosine — not a confidence %)`}
      />
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>Examples</div>
        {rec.examples.map((ex) => (
          <div
            key={ex.emailMessageId}
            style={{
              padding: 10,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              marginBottom: 8,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600 }}>{ex.subject || '(no subject)'}</div>
            <div style={{ color: '#6b7280' }}>
              {ex.businessTypeKey ?? 'untyped'} · {ex.emailMessageId.slice(0, 12)}…
            </div>
            <div style={{ color: '#4b5563', marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {ex.snippet}
            </div>
          </div>
        ))}
      </div>
      <SubtypeRecommendationReview
        workspaceId={workspaceId}
        runId={runId}
        recommendation={rec}
        allRecommendations={allRecommendations}
        decision={decision}
        onDecisionChange={onDecisionChange}
      />
    </div>
  )
}

function KindBadge({ kind }: { kind: string }) {
  const colors: Record<string, [string, string]> = {
    NEW_SUBTYPE: ['#dcfce7', '#166534'],
    EXISTING_MATCH: ['#e0e7ff', '#3730a3'],
    REFINEMENT: ['#fef3c7', '#92400e'],
    MERGE_CANDIDATE: ['#fce7f3', '#9d174d'],
    UNCLEAR: ['#f3f4f6', '#4b5563'],
  }
  const [bg, fg] = colors[kind] ?? ['#f3f4f6', '#374151']
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 650,
        background: bg,
        color: fg,
      }}
    >
      {kind.replace(/_/g, ' ')}
    </span>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, fontSize: 13, marginBottom: 6 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  )
}

const h3: CSSProperties = { fontSize: 15, fontWeight: 700, margin: '0 0 6px' }
const h4: CSSProperties = { fontSize: 13, fontWeight: 650, margin: '0 0 10px' }
const muted: CSSProperties = { fontSize: 13, color: '#6b7280', margin: '0 0 8px' }
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: '#374151' }
const input: CSSProperties = {
  padding: '7px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 400,
}
const card: CSSProperties = {
  padding: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
}
const cardBtn: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 12,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
}
const primaryBtn: CSSProperties = {
  padding: '8px 14px',
  border: '1px solid #1a1a2e',
  borderRadius: 6,
  background: '#1a1a2e',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
const secondaryBtn: CSSProperties = {
  padding: '8px 14px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  background: '#fff',
  color: '#111827',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
const linkBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  color: '#1d4ed8',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
}
