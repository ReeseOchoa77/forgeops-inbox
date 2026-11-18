import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

type Props = {
  workspaceId: string
  jobId: string
  canEdit: boolean
}

type IntelligenceBundle = {
  job: { id: string; name: string; status: string; emailCount: number }
  summary: {
    id: string
    version: number
    status: string
    sections: Record<string, { text?: string; evidenceEventIds?: string[] }>
    generatedAt: string | null
    basedOnEventCount: number
  } | null
  latestRun: {
    id: string
    status: string
    kind: string
    progress: Record<string, unknown>
    completedAt: string | null
    errorMessage: string | null
    createdAt: string
  } | null
  events: Array<{
    id: string
    category: string
    title: string
    description: string
    status: string
    financialKind: string
    amount?: string | number | null
    amountDecimal?: string | number | null
    currency: string | null
    eventDate: string | null
    verificationStatus: string
    sources: Array<{
      id: string
      emailMessageId: string | null
      excerpt: string
      sourceRole: string
    }>
  }>
  emailStateCounts: Record<string, number>
}

const CATEGORY_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'FINANCIAL', label: 'Financial' },
  { key: 'SCOPE', label: 'Scope' },
  { key: 'SCHEDULE', label: 'Schedule' },
  { key: 'RFI_TECHNICAL', label: 'Technical/RFI' },
  { key: 'RISK_CHANGE', label: 'Risks' },
  { key: 'DECISION_COMMITMENT', label: 'Decisions' },
] as const

const SECTION_ORDER = [
  ['overview', 'Project Overview'],
  ['currentStatus', 'Current Project Status'],
  ['scope', 'Scope of Work'],
  ['financial', 'Financial Overview'],
  ['schedule', 'Schedule'],
  ['recentDevelopments', 'Recent Developments'],
  ['openIssues', 'Open Issues'],
  ['risks', 'Risks'],
  ['keyDecisions', 'Key Decisions'],
  ['nextActions', 'Next Actions'],
] as const

function progressNum(progress: Record<string, unknown> | null | undefined, key: string): number {
  const v = progress?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function JobIntelligencePanel({ workspaceId, jobId, canEdit }: Props) {
  const [bundle, setBundle] = useState<IntelligenceBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('ALL')
  const [analyzing, setAnalyzing] = useState(false)
  const [busyEventId, setBusyEventId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getJobIntelligence(
        workspaceId,
        jobId,
        category === 'ALL' ? undefined : category
      )
      setBundle(data as IntelligenceBundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Job Intelligence')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId, category])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const runStatus = bundle?.latestRun?.status
    if (runStatus !== 'PENDING' && runStatus !== 'RUNNING') return
    const t = window.setInterval(() => {
      void load()
    }, 2500)
    return () => window.clearInterval(t)
  }, [bundle?.latestRun?.status, load])

  const onAnalyze = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      await api.analyzeJobIntelligence(workspaceId, jobId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analyze failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const onVerify = async (eventId: string, action: 'verify' | 'reject') => {
    setBusyEventId(eventId)
    try {
      if (action === 'verify') await api.verifyJobIntelligenceEvent(workspaceId, jobId, eventId)
      else await api.rejectJobIntelligenceEvent(workspaceId, jobId, eventId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyEventId(null)
    }
  }

  if (loading && !bundle) {
    return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading Job Intelligence…</div>
  }

  const run = bundle?.latestRun
  const progress = (run?.progress ?? {}) as Record<string, unknown>
  const sections = bundle?.summary?.sections ?? {}
  const events = bundle?.events ?? []
  const emailCount = bundle?.job.emailCount ?? 0

  return (
    <div data-testid="job-intelligence-panel" style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Job Intelligence</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Emails: {emailCount.toLocaleString('en-US')}
            {run ? ` · Analysis: ${run.status}` : ' · Not analyzed'}
            {bundle?.summary?.generatedAt
              ? ` · Updated ${new Date(bundle.summary.generatedAt).toLocaleString()}`
              : ''}
          </div>
          {run && (run.status === 'PENDING' || run.status === 'RUNNING') ? (
            <div style={{ fontSize: 12, marginTop: 6 }}>
              Processed {progressNum(progress, 'processed')} / {progressNum(progress, 'eligibleTotal')}
              {' · '}Skipped {progressNum(progress, 'skipped')}
              {' · '}Failed {progressNum(progress, 'failed')}
              {' · '}Events {progressNum(progress, 'eventsExtracted')}
            </div>
          ) : null}
          {run?.errorMessage ? (
            <div style={{ fontSize: 12, color: 'crimson', marginTop: 4 }}>{run.errorMessage}</div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void onAnalyze()}
              disabled={analyzing || run?.status === 'RUNNING' || run?.status === 'PENDING'}
            >
              {analyzing || run?.status === 'RUNNING' || run?.status === 'PENDING'
                ? 'Analyzing…'
                : 'Analyze Job History'}
            </button>
          ) : null}
          <button type="button" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ color: 'crimson', fontSize: 13 }}>{error}</div>
      ) : null}

      {emailCount === 0 ? (
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          This Job has no associated emails yet. Assign correspondence before analyzing.
        </div>
      ) : null}

      {!bundle?.summary && emailCount > 0 && run?.status !== 'RUNNING' && run?.status !== 'PENDING' ? (
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          No Job Intelligence yet. Run <strong>Analyze Job History</strong> to extract evidence-backed
          project events from eligible emails.
        </div>
      ) : null}

      {bundle?.summary ? (
        <section style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>Project brief</div>
          {SECTION_ORDER.map(([key, label]) => {
            const section = sections[key]
            const text = section?.text?.trim()
            if (!text) return null
            return (
              <div key={key} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{text}</div>
              </div>
            )
          })}
        </section>
      ) : null}

      <section style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <div style={{ fontWeight: 600, marginRight: 8 }}>Timeline</div>
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setCategory(f.key)}
              style={{
                fontSize: 12,
                fontWeight: category === f.key ? 600 : 400,
                opacity: category === f.key ? 1 : 0.75,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {events.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No extracted events for this filter.</div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 10,
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{ev.category}</span>
                  <div style={{ fontWeight: 600 }}>{ev.title}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                  <div>{ev.status}</div>
                  <div>{ev.verificationStatus}</div>
                  {ev.eventDate ? <div>{new Date(ev.eventDate).toLocaleDateString()}</div> : null}
                </div>
              </div>
              <div style={{ fontSize: 13 }}>{ev.description}</div>
              {ev.category === 'FINANCIAL' ? (
                <div style={{ fontSize: 12 }}>
                  {ev.financialKind}
                  {(ev.amountDecimal ?? ev.amount) != null
                    ? ` · ${ev.currency ?? 'USD'} ${ev.amountDecimal ?? ev.amount}`
                    : ''}
                  <div style={{ color: 'var(--muted)' }}>
                    Proposed/quote amounts are not treated as approved revenue.
                  </div>
                </div>
              ) : null}
              {ev.sources?.length ? (
                <details>
                  <summary style={{ fontSize: 12, cursor: 'pointer' }}>
                    Sources ({ev.sources.length})
                  </summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                    {ev.sources.map((s) => (
                      <li key={s.id}>
                        {s.emailMessageId ? (
                          <code style={{ fontSize: 11 }}>{s.emailMessageId.slice(0, 10)}…</code>
                        ) : null}{' '}
                        “{s.excerpt.slice(0, 180)}
                        {s.excerpt.length > 180 ? '…' : ''}”
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {canEdit &&
              ev.verificationStatus !== 'HUMAN_VERIFIED' &&
              ev.verificationStatus !== 'REJECTED' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={busyEventId === ev.id}
                    onClick={() => void onVerify(ev.id, 'verify')}
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    disabled={busyEventId === ev.id}
                    onClick={() => void onVerify(ev.id, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
