import { useEffect, useState, type CSSProperties } from 'react'
import {
  api,
  type IntelligenceSafeDto,
  type JobMatcherTestOneResult,
} from '../api'
import { IntelligencePipelineView } from '../components/IntelligencePipeline'
import { JobMatcherEvaluationPanel } from '../components/JobMatcherEvaluationPanel'
import {
  intelligenceStatusLabel,
  intelligenceTypeLabel,
  instructionsTabLabel,
  showInstructionsSection,
  showRulesSection,
} from '../intelligence-display'

type Props = {
  workspaceId: string
  /** Stable registry id — when set, show detail. */
  intelligenceId?: string | null
  onOpen: (id: string) => void
  onBack: () => void
}

export function IntelligenceView({
  workspaceId,
  intelligenceId = null,
  onOpen,
  onBack,
}: Props) {
  if (intelligenceId) {
    return (
      <IntelligenceDetail
        workspaceId={workspaceId}
        intelligenceId={intelligenceId}
        onBack={onBack}
      />
    )
  }
  return <IntelligenceOverview workspaceId={workspaceId} onOpen={onOpen} />
}

function IntelligenceOverview({
  workspaceId,
  onOpen,
}: {
  workspaceId: string
  onOpen: (id: string) => void
}) {
  const [components, setComponents] = useState<IntelligenceSafeDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .listIntelligence(workspaceId)
      .then((r) => setComponents(r.components))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [workspaceId])

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Intelligence</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px', maxWidth: 640 }}>
        Discoverability surface for ForgeOps automated decision systems. Components are loaded from
        the canonical Intelligence Registry — new registered systems appear here without page-specific cards.
      </p>
      {error && <div role="alert" style={{ color: '#b42318', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>Loading intelligence…</div>
      ) : components.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <h3>No intelligence systems are currently registered.</h3>
          <p>Qualifying systems must be added to INTELLIGENCE_CATALOG.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {components.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c.id)}
              style={cardBtn}
              data-testid={`intelligence-card-${c.id}`}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 680, color: '#111827' }}>{c.name}</span>
                <TypeBadge type={c.type} />
                <StatusBadge status={c.status} />
              </div>
              <div style={{ fontSize: 13, color: '#4b5563', marginTop: 6, textAlign: 'left' }}>
                {c.description}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                <span>Version: {c.version}</span>
                <span>
                  Evaluation: {c.evaluation.supported ? 'available' : 'unavailable'}
                </span>
                <span>Ground truth: {c.evaluation.groundTruthQuality}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function IntelligenceDetail({
  workspaceId,
  intelligenceId,
  onBack,
}: {
  workspaceId: string
  intelligenceId: string
  onBack: () => void
}) {
  const [component, setComponent] = useState<IntelligenceSafeDto | null>(null)
  const [instructions, setInstructions] = useState<
    Array<{ key: string; available: boolean; text: string | null; note?: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'pipeline' | 'instructions' | 'evaluation' | 'test'>(
    'overview'
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    setTab('overview')
    api
      .getIntelligence(workspaceId, intelligenceId)
      .then((r) => {
        setComponent(r.component)
        setInstructions(r.instructions)
      })
      .catch((e) => {
        setComponent(null)
        setError(e instanceof Error ? e.message : 'Not found')
      })
      .finally(() => setLoading(false))
  }, [workspaceId, intelligenceId])

  if (loading) {
    return <div style={{ color: '#6b7280', fontSize: 13 }}>Loading…</div>
  }
  if (!component) {
    return (
      <div>
        <button type="button" onClick={onBack} style={linkBtn}>← Intelligence</button>
        <div role="alert" style={{ color: '#b42318', marginTop: 12, fontSize: 13 }}>
          {error ?? 'Intelligence not found'}
        </div>
      </div>
    )
  }

  const showInstructions = showInstructionsSection(component.type)
  const showRules = showRulesSection(component.type)

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'instructions', label: instructionsTabLabel(component.type) },
    { key: 'evaluation', label: 'Evaluation' },
    { key: 'test', label: 'Test' },
  ]

  return (
    <div>
      <button type="button" onClick={onBack} style={linkBtn}>← Intelligence</button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{component.name}</h2>
        <TypeBadge type={component.type} />
        <StatusBadge status={component.status} />
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '8px 0 14px' }}>{component.description}</p>

      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e5e5', marginBottom: 16, overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#1a1a2e' : '#888',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid #1a1a2e' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewSection component={component} />}
      {tab === 'pipeline' && (
        <IntelligencePipelineView nodes={component.pipeline.nodes} edges={component.pipeline.edges} />
      )}
      {tab === 'instructions' && (
        <InstructionsRulesSection
          component={component}
          instructions={instructions}
          showInstructions={showInstructions}
          showRules={showRules}
        />
      )}
      {tab === 'evaluation' && (
        <EvaluationSection workspaceId={workspaceId} component={component} />
      )}
      {tab === 'test' && <TestSection workspaceId={workspaceId} component={component} />}
    </div>
  )
}

function OverviewSection({ component }: { component: IntelligenceSafeDto }) {
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 13, maxWidth: 720 }}>
      <KV label="Purpose" value={component.purpose} />
      <KV label="Version" value={component.version} />
      <KV label="Inputs" value={component.inputs} />
      <KV label="Outputs" value={component.outputs} />
      <KV
        label="Evaluation"
        value={
          component.evaluation.supported
            ? `Supported (${component.evaluation.evaluatorId ?? '—'})`
            : `Unavailable — ${component.evaluation.notes}`
        }
      />
      <KV
        label="Ground truth"
        value={`${component.evaluation.groundTruthQuality} — ${component.evaluation.groundTruthNotes}`}
      />
      <KV
        label="Explainability"
        value={
          component.explainability.available
            ? component.explainability.capabilities.join(', ')
            : component.explainability.notes
        }
      />
      {component.featureFlags.length > 0 && (
        <div>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>Feature flags</div>
          {component.featureFlags.map((f) => (
            <div key={f.envName} style={{ marginBottom: 6 }}>
              <code style={{ fontSize: 12 }}>{f.envName}</code>
              <span style={{ color: '#6b7280' }}>
                {' '}
                · default {f.defaultEnabled ? 'ON' : 'OFF'} — {f.effect}
              </span>
            </div>
          ))}
        </div>
      )}
      <KV
        label="Implementation"
        value={`${component.implementation.packages.join(', ')} · ${component.implementation.entryPoints.join(', ')}`}
      />
    </div>
  )
}

function InstructionsRulesSection({
  component,
  instructions,
  showInstructions,
  showRules,
}: {
  component: IntelligenceSafeDto
  instructions: Array<{ key: string; available: boolean; text: string | null; note?: string }>
  showInstructions: boolean
  showRules: boolean
}) {
  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 800 }}>
      {showInstructions && (
        <section>
          <h3 style={sectionH}>Instructions (read-only)</h3>
          {component.instructions.available === false ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>{component.instructions.reason}</p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
                {component.instructions.summary} Editing production prompts is not available in V1.
              </p>
              {instructions.map((row) => (
                <div key={row.key} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{row.key}</div>
                  {row.note && !row.text ? (
                    <p style={{ fontSize: 12, color: '#6b7280' }}>{row.note}</p>
                  ) : (
                    <pre style={preStyle}>{row.text ?? '(unavailable)'}</pre>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      )}
      {showRules && (
        <section>
          <h3 style={sectionH}>Rules</h3>
          {component.rules.available === false ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>{component.rules.reason}</p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>{component.rules.summary}</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {component.rules.items.map((r) => (
                  <li key={r.id} style={{ marginBottom: 8 }}>
                    <strong>{r.title}</strong>
                    {r.version ? <span style={{ color: '#6b7280' }}> · {r.version}</span> : null}
                    <div style={{ color: '#4b5563' }}>{r.summary}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function EvaluationSection({
  workspaceId,
  component,
}: {
  workspaceId: string
  component: IntelligenceSafeDto
}) {
  if (!component.evaluation.supported) {
    return (
      <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 640 }}>
        <p style={{ marginTop: 0 }}>Evaluation is not available for this intelligence.</p>
        <p>{component.evaluation.notes}</p>
        <p>
          Ground truth: <strong>{component.evaluation.groundTruthQuality}</strong> —{' '}
          {component.evaluation.groundTruthNotes}
        </p>
      </div>
    )
  }

  if (component.id !== 'job-matcher') {
    return (
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        Evaluation is declared (`{component.evaluation.evaluatorId}`), but a Manage UI runner is only
        wired for Job Matcher in V1. {component.evaluation.notes}
      </div>
    )
  }

  return (
    <JobMatcherEvaluationPanel
      workspaceId={workspaceId}
      groundTruthQuality={component.evaluation.groundTruthQuality}
      groundTruthNotes={component.evaluation.groundTruthNotes}
    />
  )
}

function TestSection({
  workspaceId,
  component,
}: {
  workspaceId: string
  component: IntelligenceSafeDto
}) {
  const [emails, setEmails] = useState<
    Array<{
      id: string
      subject: string | null
      jobName: string | null
      jobNumber: string | null
    }>
  >([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<JobMatcherTestOneResult | null>(null)

  useEffect(() => {
    if (component.id !== 'job-matcher') return
    const t = window.setTimeout(() => {
      api
        .listJobMatcherTestEmails(workspaceId, { search: search.trim() || undefined })
        .then((r) => setEmails(r.emails))
        .catch(() => setEmails([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [workspaceId, component.id, search])

  if (component.id !== 'job-matcher') {
    return (
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        Test One is implemented for Job Matcher in V1. Other systems show stored metadata only —
        live LLM re-runs are not auto-triggered from this page.
      </div>
    )
  }

  const run = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.testJobMatcherOne(workspaceId, { emailMessageId: selectedId })
      setTest(res.test)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <p style={{ fontSize: 13, color: '#6b7280' }}>
        Select an existing authoritative email. Runs the Marker pipeline read-only (evaluation mode +
        holdout). No Job assignment is written.
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search subjects…"
        style={{ width: '100%', maxWidth: 400, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, marginBottom: 8 }}
      />
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{ width: '100%', maxWidth: 560, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, display: 'block', marginBottom: 10 }}
      >
        <option value="">Select email…</option>
        {emails.map((e) => (
          <option key={e.id} value={e.id}>
            {(e.subject || '(no subject)').slice(0, 80)} · {e.jobNumber || e.jobName || e.id}
          </option>
        ))}
      </select>
      <button type="button" disabled={!selectedId || busy} onClick={() => void run()} style={primaryBtn}>
        {busy ? 'Running…' : 'Run Matcher'}
      </button>
      {error && <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 8 }}>{error}</div>}
      {test && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <KV label="Decision" value={test.result.decision} />
          <KV label="Predicted Job" value={test.result.selectedJobName || test.result.selectedJobId || '—'} />
          <KV
            label="Historical Job"
            value={
              test.historical.jobName || test.historical.jobId || '—'
            }
          />
          <KV
            label="Outcome"
            value={
              test.historical.outcome ??
              (test.historical.authoritativeGroundTruth ? '—' : 'No authoritative ground truth')
            }
          />
          <KV label="Resolving marker" value={test.result.resolvingMarker || '—'} />
          <h3 style={{ ...sectionH, marginTop: 14 }}>Marker trace</h3>
          {(test.result.markerTrace ?? []).map((row) => (
            <div key={row.marker} style={{ marginBottom: 10, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div style={{ fontWeight: 650 }}>{row.marker} · {row.status}</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>
                Candidates: {(row.candidateJobIds ?? []).slice(0, 8).join(', ') || '—'}
              </div>
            </div>
          ))}
          <h3 style={sectionH}>Evidence</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(test.result.evidence ?? []).slice(0, 20).map((ev, i) => (
              <li key={i}>{ev.type}: {ev.value}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  return <span style={badge('#eef2ff', '#3730a3')}>{intelligenceTypeLabel(type)}</span>
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    ACTIVE: ['#dcfce7', '#166534'],
    FEATURE_GATED: ['#fef3c7', '#92400e'],
    SHADOW: ['#e0e7ff', '#3730a3'],
    EVALUATION_ONLY: ['#f3e8ff', '#6b21a8'],
    LEGACY: ['#f3f4f6', '#4b5563'],
    DISABLED: ['#fee2e2', '#991b1b'],
  }
  const [bg, fg] = colors[status] ?? ['#f3f4f6', '#374151']
  return <span style={badge(bg, fg)}>{intelligenceStatusLabel(status)}</span>
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  )
}

function badge(bg: string, color: string): CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 650,
    background: bg,
    color,
  }
}

const cardBtn: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
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
const sectionH: CSSProperties = { fontSize: 14, fontWeight: 650, margin: '0 0 8px' }
const preStyle: CSSProperties = {
  margin: '6px 0 0',
  padding: 12,
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  maxHeight: 280,
  overflow: 'auto',
}