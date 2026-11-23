import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

type Props = {
  workspaceId: string
}

type Config = {
  productionIntelligenceModelId: string
  productionMatcherPolicyId: string
  documentedMatcherPolicyId: string | null
  intelligenceModels: Array<{
    id: string
    displayName: string
    description: string
    status: string
    productionDefault: boolean
  }>
  matcherModels: Array<{
    id: string
    displayName: string
    description: string
    productionDefault: boolean
    experimental: boolean
    retired: boolean
  }>
}

type LabRunSummary = {
  id: string
  jobId: string | null
  status: string
  associationMode: string
  matcherModelId: string
  intelligenceModelId: string
  createdAt: string
  errorMessage: string | null
}

export function JobIntelligenceLabPanel({ workspaceId }: Props) {
  const [config, setConfig] = useState<Config | null>(null)
  const [jobId, setJobId] = useState('')
  const [associationMode, setAssociationMode] = useState<
    'PRODUCTION_ASSIGNMENTS' | 'MATCHER_POLICY'
  >('PRODUCTION_ASSIGNMENTS')
  const [matcherModelId, setMatcherModelId] = useState('')
  const [intelligenceModelId, setIntelligenceModelId] = useState('')
  const [runs, setRuns] = useState<LabRunSummary[]>([])
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [activeRun, setActiveRun] = useState<Record<string, unknown> | null>(null)
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [promoteConfirm, setPromoteConfirm] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [cfg, list] = await Promise.all([
        api.getJobIntelligenceLabConfig(workspaceId),
        api.listJobIntelligenceLabRuns(workspaceId),
      ])
      const typed = cfg as Config
      setConfig(typed)
      setRuns((list.runs ?? []) as LabRunSummary[])
      setIntelligenceModelId((prev) => prev || typed.productionIntelligenceModelId)
      setMatcherModelId((prev) => prev || typed.productionMatcherPolicyId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Lab')
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const onRun = async () => {
    if (!jobId.trim()) {
      setError('Enter a Job ID')
      return
    }
    setBusy(true)
    setError(null)
    setComparison(null)
    try {
      const result = await api.runJobIntelligenceLab(workspaceId, {
        jobId: jobId.trim(),
        associationMode,
        ...(associationMode === 'MATCHER_POLICY' ? { matcherModelId } : {}),
        intelligenceModelId: intelligenceModelId || undefined,
      })
      const detail = await api.getJobIntelligenceLabRun(workspaceId, result.runId)
      setActiveRun(detail.run as Record<string, unknown>)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lab run failed')
    } finally {
      setBusy(false)
    }
  }

  const onCompare = async () => {
    if (selectedRunIds.length < 2) {
      setError('Select at least two completed runs')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.compareJobIntelligenceLabRuns(workspaceId, selectedRunIds)
      setComparison(res.comparison as Record<string, unknown>)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compare failed')
    } finally {
      setBusy(false)
    }
  }

  const onPromote = async () => {
    if (!promoteConfirm || !intelligenceModelId) return
    setBusy(true)
    setError(null)
    try {
      await api.setJobIntelligenceProductionModel(workspaceId, {
        intelligenceModelId,
        confirm: true,
      })
      setPromoteConfirm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Promotion failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleRun = (id: string) => {
    setSelectedRunIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-4)
    )
  }

  const resultJson = (activeRun?.resultJson ?? null) as {
    events?: Array<Record<string, unknown>>
    summarySections?: Record<string, { text?: string }>
    limitations?: string[]
    fullEvents?: Array<Record<string, unknown>>
  } | null

  return (
    <div data-testid="job-intelligence-lab" style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Intelligence Lab</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Experimental runs only. Never writes EmailMessage.jobId or production Job Intelligence
          tables. Matcher and Intelligence models are selected independently.
        </div>
      </div>

      {error ? <div style={{ color: 'crimson', fontSize: 13 }}>{error}</div> : null}

      {config ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>Model Settings</div>
          <div style={{ fontSize: 12 }}>
            Production Job Matcher (registry, read-only here):{' '}
            <code>{config.productionMatcherPolicyId}</code>
          </div>
          <div style={{ fontSize: 12 }}>
            Production Job Intelligence: <code>{config.productionIntelligenceModelId}</code>
          </div>
          <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
            Promote intelligence model (requires confirmation)
            <select
              value={intelligenceModelId}
              onChange={(e) => setIntelligenceModelId(e.target.value)}
            >
              {config.intelligenceModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.status})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={promoteConfirm}
              onChange={(e) => setPromoteConfirm(e.target.checked)}
            />
            I confirm changing the production Job Intelligence model (does not rewrite history or
            change Job Matcher)
          </label>
          <button type="button" disabled={busy || !promoteConfirm} onClick={() => void onPromote()}>
            Set production intelligence model
          </button>
        </section>
      ) : null}

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>Run isolated analysis</div>
        <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
          Job ID
          <input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="cuid…" />
        </label>
        <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
          Association mode
          <select
            value={associationMode}
            onChange={(e) =>
              setAssociationMode(e.target.value as 'PRODUCTION_ASSIGNMENTS' | 'MATCHER_POLICY')
            }
          >
            <option value="PRODUCTION_ASSIGNMENTS">
              Production assignments (stored jobId + eligibility)
            </option>
            <option value="MATCHER_POLICY">
              Re-run Job Matcher policy (in-memory snapshot)
            </option>
          </select>
        </label>
        {associationMode === 'MATCHER_POLICY' && config ? (
          <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
            Job Matcher model
            <select value={matcherModelId} onChange={(e) => setMatcherModelId(e.target.value)}>
              {config.matcherModels
                .filter((m) => !m.retired)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.productionDefault ? ' (prod)' : ''}
                    {m.experimental ? ' — experimental' : ''}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {config ? (
          <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
            Job Intelligence model
            <select
              value={intelligenceModelId}
              onChange={(e) => setIntelligenceModelId(e.target.value)}
            >
              {config.intelligenceModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" disabled={busy} onClick={() => void onRun()}>
          {busy ? 'Running…' : 'Run Lab analysis'}
        </button>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Recent Lab runs</div>
        {runs.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No lab runs yet.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {runs.map((r) => (
              <li key={r.id} style={{ marginBottom: 6 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={selectedRunIds.includes(r.id)}
                    disabled={r.status !== 'COMPLETED'}
                    onChange={() => toggleRun(r.id)}
                  />
                  <span>
                    <button
                      type="button"
                      style={{ fontSize: 12 }}
                      onClick={() =>
                        void api.getJobIntelligenceLabRun(workspaceId, r.id).then((d) => {
                          setActiveRun(d.run as Record<string, unknown>)
                          setComparison(null)
                        })
                      }
                    >
                      {r.id.slice(0, 8)}…
                    </button>{' '}
                    {r.status} · {r.associationMode} · matcher={r.matcherModelId} · intel=
                    {r.intelligenceModelId}
                    {r.errorMessage ? ` · ${r.errorMessage}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <button type="button" disabled={busy || selectedRunIds.length < 2} onClick={() => void onCompare()}>
          Compare selected runs
        </button>
      </section>

      {activeRun ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>Run detail</div>
          <div style={{ fontSize: 12 }}>
            Status: {String(activeRun.status)} · Matcher: {String(activeRun.matcherModelId)} ·
            Intelligence: {String(activeRun.intelligenceModelId)}
          </div>
          {resultJson?.limitations?.length ? (
            <div style={{ fontSize: 12 }}>
              Limitations:
              <ul>
                {resultJson.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {resultJson?.summarySections ? (
            <div style={{ fontSize: 12 }}>
              <div style={{ fontWeight: 600 }}>Summary</div>
              {Object.entries(resultJson.summarySections).map(([k, v]) =>
                v?.text ? (
                  <div key={k} style={{ marginTop: 4 }}>
                    <strong>{k}</strong>: {v.text.slice(0, 280)}
                    {v.text.length > 280 ? '…' : ''}
                  </div>
                ) : null
              )}
            </div>
          ) : null}
          <div style={{ fontSize: 12 }}>
            <div style={{ fontWeight: 600 }}>
              Events ({resultJson?.events?.length ?? 0}) — count is not an accuracy score
            </div>
            <ul>
              {(resultJson?.events ?? []).slice(0, 30).map((ev, i) => (
                <li key={i}>
                  [{String(ev.category)}] {String(ev.title)} · {String(ev.status)}
                  {ev.financialKind && ev.financialKind !== 'NONE'
                    ? ` · ${String(ev.financialKind)}`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {comparison ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            display: 'grid',
            gap: 8,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600 }}>Comparison</div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 11 }}>
            {JSON.stringify(comparison, null, 2).slice(0, 8000)}
          </pre>
        </section>
      ) : null}
    </div>
  )
}
