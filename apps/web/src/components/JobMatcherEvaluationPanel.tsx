import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  api,
  type JobMatcherEvalPreview,
  type JobMatcherEvalResult,
  type JobMatcherEvalRow,
  type JobLookup,
} from '../api'
import { SafeEmailBody } from './SafeEmailBody'

type JobsMode = 'ALL' | 'SPECIFIC' | 'SELECTED'
type Sampling = 'TOTAL' | 'PER_JOB' | 'ALL_ELIGIBLE'
type Lifecycle = 'ALL' | 'CURRENT' | 'ARCHIVED'
type OutcomeFilter = 'ALL' | 'CORRECT_MATCH' | 'WRONG_MATCH' | 'AMBIGUOUS' | 'CONFLICT' | 'NO_MATCH'

const TOTAL_PRESETS = [25, 50, 100, 250, 500, 1000]
const PER_JOB_PRESETS = [5, 10, 25, 50, 100]

export function JobMatcherEvaluationPanel({
  workspaceId,
  groundTruthQuality,
  groundTruthNotes,
}: {
  workspaceId: string
  groundTruthQuality: string
  groundTruthNotes: string
}) {
  const [jobsMode, setJobsMode] = useState<JobsMode>('ALL')
  const [sampling, setSampling] = useState<Sampling>('TOTAL')
  const [count, setCount] = useState(50)
  const [lifecycle, setLifecycle] = useState<Lifecycle>('ALL')
  const [selectedJobs, setSelectedJobs] = useState<JobLookup[]>([])
  const [jobSearch, setJobSearch] = useState('')
  const [jobOptions, setJobOptions] = useState<JobLookup[]>([])
  const [preview, setPreview] = useState<JobMatcherEvalPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<JobMatcherEvalResult | null>(null)
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL')
  const [jobFilterId, setJobFilterId] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<JobMatcherEvalRow | null>(null)

  const dataset = useMemo(() => {
    const jobIds =
      jobsMode === 'ALL' ? [] : selectedJobs.map((j) => j.id)
    return {
      jobsMode,
      jobIds,
      sampling,
      count: sampling === 'ALL_ELIGIBLE' ? null : count,
      jobLifecycle: lifecycle,
    }
  }, [jobsMode, selectedJobs, sampling, count, lifecycle])

  useEffect(() => {
    if (jobsMode === 'ALL') return
    const t = window.setTimeout(() => {
      api
        .getJobsLookup(workspaceId, {
          search: jobSearch.trim() || undefined,
          showArchived: lifecycle !== 'CURRENT',
        })
        .then((r) => setJobOptions(r.jobs))
        .catch(() => setJobOptions([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [workspaceId, jobSearch, jobsMode, lifecycle])

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (jobsMode !== 'ALL' && selectedJobs.length === 0) {
        setPreview(null)
        return
      }
      if (jobsMode === 'SPECIFIC' && selectedJobs.length !== 1) {
        setPreview(null)
        return
      }
      setPreviewError(null)
      api
        .previewJobMatcherEvalDataset(workspaceId, { dataset })
        .then((r) => setPreview(r.preview))
        .catch((e) => {
          setPreview(null)
          setPreviewError(e instanceof Error ? e.message : 'Preview failed')
        })
    }, 250)
    return () => window.clearTimeout(t)
  }, [workspaceId, dataset, jobsMode, selectedJobs.length])

  const run = async () => {
    setBusy(true)
    setError(null)
    setSelectedRow(null)
    setJobFilterId(null)
    setOutcomeFilter('ALL')
    try {
      const res = await api.evaluateJobMatcherIntelligence(workspaceId, { dataset })
      setResult(res.evaluation)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed')
    } finally {
      setBusy(false)
    }
  }

  const filteredRows = useMemo(() => {
    if (!result) return []
    return result.rows.filter((row) => {
      if (outcomeFilter !== 'ALL' && row.outcome !== outcomeFilter) return false
      if (jobFilterId && row.trueJobId !== jobFilterId) return false
      return true
    })
  }, [result, outcomeFilter, jobFilterId])

  const canRun =
    !busy &&
    (jobsMode === 'ALL' ||
      (jobsMode === 'SPECIFIC' && selectedJobs.length === 1) ||
      (jobsMode === 'SELECTED' && selectedJobs.length > 0))

  return (
    <div>
      <p style={{ fontSize: 13, color: '#6b7280', maxWidth: 720 }}>
        Read-only historical evaluation. Does not assign emails, learn contacts, or write Job links.
        Selected Jobs filter ground-truth emails only — they are never leaked into matcher evidence.
        Ground truth: <strong>{groundTruthQuality}</strong> — {groundTruthNotes}
      </p>

      <DatasetBuilder
        jobsMode={jobsMode}
        setJobsMode={(m) => {
          setJobsMode(m)
          setSelectedJobs([])
        }}
        sampling={sampling}
        setSampling={setSampling}
        count={count}
        setCount={setCount}
        lifecycle={lifecycle}
        setLifecycle={setLifecycle}
        selectedJobs={selectedJobs}
        setSelectedJobs={setSelectedJobs}
        jobSearch={jobSearch}
        setJobSearch={setJobSearch}
        jobOptions={jobOptions}
        busy={busy}
      />

      <div
        style={{
          marginTop: 12,
          padding: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#f9fafb',
          fontSize: 13,
          maxWidth: 640,
        }}
      >
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Dataset summary</div>
        {previewError && <div style={{ color: '#b42318' }}>{previewError}</div>}
        {!preview && !previewError && (
          <div style={{ color: '#6b7280' }}>
            {jobsMode !== 'ALL' && selectedJobs.length === 0
              ? 'Select one or more Jobs to preview eligibility.'
              : 'Loading eligibility…'}
          </div>
        )}
        {preview && (
          <div style={{ display: 'grid', gap: 4, color: '#374151' }}>
            <div>{preview.summaryLabel}</div>
            <div>
              Jobs in scope: <strong>{preview.jobsInScope}</strong>
            </div>
            <div>
              Eligible authoritative emails: <strong>{preview.eligibleCount}</strong>
            </div>
            <div>
              Expected maximum: <strong>{preview.expectedMax}</strong>
            </div>
            {preview.capped && preview.capReason && (
              <div style={{ color: '#92400e' }}>{preview.capReason}</div>
            )}
            <div style={{ color: '#6b7280', fontSize: 12 }}>{preview.groundTruth}</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => void run()}
          disabled={!canRun}
          style={{ ...primaryBtn, marginTop: 10, opacity: canRun ? 1 : 0.5 }}
        >
          {busy ? 'Running…' : 'Run Evaluation'}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      )}

      {result && (
        <ResultsArea
          result={result}
          filteredRows={filteredRows}
          outcomeFilter={outcomeFilter}
          setOutcomeFilter={setOutcomeFilter}
          jobFilterId={jobFilterId}
          setJobFilterId={setJobFilterId}
          selectedRow={selectedRow}
          setSelectedRow={setSelectedRow}
          workspaceId={workspaceId}
        />
      )}
    </div>
  )
}

function DatasetBuilder(props: {
  jobsMode: JobsMode
  setJobsMode: (m: JobsMode) => void
  sampling: Sampling
  setSampling: (s: Sampling) => void
  count: number
  setCount: (n: number) => void
  lifecycle: Lifecycle
  setLifecycle: (l: Lifecycle) => void
  selectedJobs: JobLookup[]
  setSelectedJobs: (j: JobLookup[]) => void
  jobSearch: string
  setJobSearch: (s: string) => void
  jobOptions: JobLookup[]
  busy: boolean
}) {
  const presets = props.sampling === 'PER_JOB' ? PER_JOB_PRESETS : TOTAL_PRESETS
  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
      <fieldset style={fieldset}>
        <legend style={legend}>Jobs</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(
            [
              ['ALL', 'All Jobs'],
              ['SPECIFIC', 'Specific Job'],
              ['SELECTED', 'Selected Jobs'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} style={radioLabel}>
              <input
                type="radio"
                name="jobsMode"
                checked={props.jobsMode === value}
                disabled={props.busy}
                onChange={() => props.setJobsMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {props.jobsMode !== 'ALL' && (
          <div style={{ marginTop: 10 }}>
            <input
              value={props.jobSearch}
              onChange={(e) => props.setJobSearch(e.target.value)}
              placeholder="Search job number or name…"
              disabled={props.busy}
              style={inputStyle}
            />
            <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 6, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              {props.jobOptions.map((j) => {
                const checked = props.selectedJobs.some((s) => s.id === j.id)
                return (
                  <label
                    key={j.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      padding: '6px 8px',
                      fontSize: 13,
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      background: checked ? '#eff6ff' : '#fff',
                    }}
                  >
                    <input
                      type={props.jobsMode === 'SPECIFIC' ? 'radio' : 'checkbox'}
                      name="eval-job"
                      checked={checked}
                      disabled={props.busy}
                      onChange={() => {
                        if (props.jobsMode === 'SPECIFIC') {
                          props.setSelectedJobs([j])
                        } else if (checked) {
                          props.setSelectedJobs(props.selectedJobs.filter((s) => s.id !== j.id))
                        } else {
                          props.setSelectedJobs([...props.selectedJobs, j])
                        }
                      }}
                    />
                    <span>
                      {j.jobNumber ? `${j.jobNumber} — ` : ''}
                      {j.name}
                    </span>
                  </label>
                )
              })}
            </div>
            {props.selectedJobs.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                Selected: {props.selectedJobs.map((j) => j.jobNumber || j.name).join(', ')}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>Sampling</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(
            [
              ['TOTAL', 'Total sample'],
              ['PER_JOB', 'Per Job'],
              ['ALL_ELIGIBLE', 'All eligible'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} style={radioLabel}>
              <input
                type="radio"
                name="sampling"
                checked={props.sampling === value}
                disabled={props.busy}
                onChange={() => {
                  props.setSampling(value)
                  if (value === 'PER_JOB' && props.count > 100) props.setCount(25)
                  if (value === 'TOTAL' && props.count < 25) props.setCount(50)
                }}
              />
              {label}
            </label>
          ))}
        </div>
        {props.sampling !== 'ALL_ELIGIBLE' && (
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {presets.map((n) => (
              <button
                key={n}
                type="button"
                disabled={props.busy}
                onClick={() => props.setCount(n)}
                style={{
                  ...chipBtn,
                  background: props.count === n ? '#1a1a2e' : '#fff',
                  color: props.count === n ? '#fff' : '#111827',
                }}
              >
                {n}
              </button>
            ))}
            <label style={{ fontSize: 13 }}>
              Custom{' '}
              <input
                type="number"
                min={1}
                max={props.sampling === 'PER_JOB' ? 100 : 1000}
                value={props.count}
                disabled={props.busy}
                onChange={(e) => props.setCount(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 72, marginLeft: 4, padding: '4px 6px' }}
              />
            </label>
          </div>
        )}
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>Job lifecycle</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(
            [
              ['ALL', 'Current + Archived'],
              ['CURRENT', 'Current'],
              ['ARCHIVED', 'Archived'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} style={radioLabel}>
              <input
                type="radio"
                name="lifecycle"
                checked={props.lifecycle === value}
                disabled={props.busy}
                onChange={() => props.setLifecycle(value)}
              />
              {label}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
          Default matches the historical evaluator (includes archived/complete Jobs). Matcher still uses
          evaluation eligibility — this only filters which ground-truth emails are sampled.
        </div>
      </fieldset>
    </div>
  )
}

function ResultsArea(props: {
  result: JobMatcherEvalResult
  filteredRows: JobMatcherEvalRow[]
  outcomeFilter: OutcomeFilter
  setOutcomeFilter: (f: OutcomeFilter) => void
  jobFilterId: string | null
  setJobFilterId: (id: string | null) => void
  selectedRow: JobMatcherEvalRow | null
  setSelectedRow: (row: JobMatcherEvalRow | null) => void
  workspaceId: string
}) {
  const { result } = props
  const m = result.metrics
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
        <strong>Evaluation</strong> · {result.dataset.summaryLabel} · Jobs:{' '}
        {result.dataset.jobsInScope} · Emails evaluated: {result.dataset.actualEvaluated}
        {result.dataset.capped ? ` · capped (${result.dataset.capReason})` : ''} · databaseWrites:{' '}
        {result.databaseWrites}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 8,
        }}
      >
        <Metric label="Evaluated" value={m.totalEvaluated} />
        <Metric label="Correct" value={m.correctMatches} />
        <Metric label="Wrong" value={m.wrongMatches} />
        <Metric label="Ambiguous" value={m.ambiguous} />
        <Metric label="Conflict" value={m.conflict} />
        <Metric label="No Match" value={m.noMatch} />
        <Metric
          label="Precision"
          value={m.precision == null ? '—' : `${(m.precision * 100).toFixed(2)}%`}
        />
        <Metric label="Coverage" value={`${(m.correctCoverage * 100).toFixed(2)}%`} />
        <Metric label="Wrong rate" value={`${(m.wrongMatchRate * 100).toFixed(2)}%`} />
        <Metric label="Ambiguity" value={`${(m.ambiguityRate * 100).toFixed(2)}%`} />
        <Metric label="Conflict rate" value={`${(m.conflictRate * 100).toFixed(2)}%`} />
        <Metric label="No-match rate" value={`${(m.noMatchRate * 100).toFixed(2)}%`} />
      </div>

      {result.jobBreakdown.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={sectionH}>Job breakdown</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>Job</th>
                  <th style={th}>Evaluated</th>
                  <th style={th}>Correct</th>
                  <th style={th}>Wrong</th>
                  <th style={th}>Ambig.</th>
                  <th style={th}>Conflict</th>
                  <th style={th}>No match</th>
                </tr>
              </thead>
              <tbody>
                {result.jobBreakdown.map((j) => (
                  <tr
                    key={j.jobId}
                    onClick={() =>
                      props.setJobFilterId(props.jobFilterId === j.jobId ? null : j.jobId)
                    }
                    style={{
                      cursor: 'pointer',
                      background: props.jobFilterId === j.jobId ? '#eff6ff' : undefined,
                    }}
                  >
                    <td style={td}>
                      {j.jobNumber ? `${j.jobNumber} — ` : ''}
                      {j.jobName}
                    </td>
                    <td style={td}>{j.evaluated}</td>
                    <td style={td}>{j.correct}</td>
                    <td style={td}>{j.wrong}</td>
                    <td style={td}>{j.ambiguous}</td>
                    <td style={td}>{j.conflict}</td>
                    <td style={td}>{j.noMatch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 0,
          marginTop: 16,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          minHeight: 420,
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, borderRight: props.selectedRow ? '1px solid #e5e7eb' : undefined }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ fontSize: 13 }}>Results</strong>
            {(
              [
                ['ALL', 'All'],
                ['CORRECT_MATCH', 'Correct'],
                ['WRONG_MATCH', 'Wrong'],
                ['AMBIGUOUS', 'Ambiguous'],
                ['CONFLICT', 'Conflict'],
                ['NO_MATCH', 'No Match'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => props.setOutcomeFilter(value)}
                style={{
                  ...chipBtn,
                  background: props.outcomeFilter === value ? '#1a1a2e' : '#fff',
                  color: props.outcomeFilter === value ? '#fff' : '#111827',
                }}
              >
                {label}
              </button>
            ))}
            {props.jobFilterId && (
              <button type="button" onClick={() => props.setJobFilterId(null)} style={linkBtn}>
                Clear Job filter
              </button>
            )}
          </div>
          <div style={{ maxHeight: 560, overflow: 'auto' }}>
            <table style={{ ...tableStyle, border: 'none' }}>
              <thead>
                <tr>
                  <th style={th}>Subject</th>
                  <th style={th}>Outcome</th>
                  <th style={th}>Actual</th>
                  <th style={th}>Predicted</th>
                  <th style={th}>Marker</th>
                </tr>
              </thead>
              <tbody>
                {props.filteredRows.map((row) => {
                  const selected = props.selectedRow?.emailMessageId === row.emailMessageId
                  return (
                    <tr
                      key={row.emailMessageId}
                      data-testid={`eval-row-${row.emailMessageId}`}
                      onClick={() => props.setSelectedRow(row)}
                      style={{
                        cursor: 'pointer',
                        background: selected ? '#dbeafe' : undefined,
                      }}
                    >
                      <td style={td}>{(row.subject || '—').slice(0, 80)}</td>
                      <td style={td}>{row.outcome.replace(/_/g, ' ')}</td>
                      <td style={td}>
                        {row.trueJobNumber ? `${row.trueJobNumber} — ` : ''}
                        {row.trueJobName}
                      </td>
                      <td style={td}>
                        {row.predictedJobNumber
                          ? `${row.predictedJobNumber} — `
                          : ''}
                        {row.predictedJobName || '—'}
                      </td>
                      <td style={td}>{row.resolvingMarker || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {props.filteredRows.length === 0 && (
              <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>No rows for this filter.</div>
            )}
          </div>
        </div>
        {props.selectedRow && (
          <EmailInspector
            workspaceId={props.workspaceId}
            row={props.selectedRow}
            groundTruthQuality={result.groundTruthQuality}
            onClose={() => props.setSelectedRow(null)}
          />
        )}
      </div>
    </div>
  )
}

function EmailInspector({
  workspaceId,
  row,
  groundTruthQuality,
  onClose,
}: {
  workspaceId: string
  row: JobMatcherEvalRow
  groundTruthQuality: string
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState<Awaited<
    ReturnType<typeof api.getJobMatcherEvalEmail>
  >['email'] | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setEmail(null)
    api
      .getJobMatcherEvalEmail(workspaceId, row.emailMessageId)
      .then((r) => {
        if (!cancelled) setEmail(r.email)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load email')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, row.emailMessageId])

  return (
    <aside
      data-testid="eval-email-inspector"
      style={{
        width: 'min(440px, 46%)',
        flexShrink: 0,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 620,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong style={{ fontSize: 13 }}>Email Inspector</strong>
        <button type="button" onClick={onClose} style={linkBtn}>
          Close
        </button>
      </div>
      <div style={{ padding: 12, overflow: 'auto', fontSize: 13 }}>
        {loading && <div style={{ color: '#6b7280' }}>Loading email…</div>}
        {error && <div role="alert" style={{ color: '#b42318' }}>{error}</div>}
        {email && (
          <>
            <KV label="From" value={formatPerson(email.from)} />
            <KV label="To" value={email.to.map(formatPerson).join(', ') || '—'} />
            {email.cc.length > 0 && (
              <KV label="Cc" value={email.cc.map(formatPerson).join(', ')} />
            )}
            <KV
              label="Date"
              value={String(email.receivedAt || email.sentAt || '—')}
            />
            <KV label="Direction" value={email.direction || '—'} />
            <KV label="Subject" value={email.subject || '—'} />
            <div style={{ marginTop: 10, marginBottom: 6, fontWeight: 650 }}>Body</div>
            <SafeEmailBody bodyHtml={email.bodyHtml} bodyText={email.bodyText} />
            {email.attachments.length > 0 && (
              <>
                <div style={{ marginTop: 12, marginBottom: 6, fontWeight: 650 }}>Attachments</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {email.attachments.map((a) => (
                    <li key={a.id}>
                      {a.filename} · {a.mimeType} · {formatBytes(a.sizeBytes)} · {a.uploadStatus}
                      {a.uploadStatus === 'UPLOADED' && (
                        <>
                          {' '}
                          <a
                            href={api.getStoredAttachmentDownloadUrl(workspaceId, a.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            download
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>Ground truth</div>
          <KV
            label="Historical Job"
            value={`${row.trueJobNumber ? `${row.trueJobNumber} — ` : ''}${row.trueJobName}`}
          />
          <KV label="Assignment source" value={row.jobAssignmentSource || '—'} />
          <KV label="Ground-truth quality" value={groundTruthQuality} />
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>Matcher result</div>
          <KV
            label="Predicted Job"
            value={
              row.predictedJobName
                ? `${row.predictedJobNumber ? `${row.predictedJobNumber} — ` : ''}${row.predictedJobName}`
                : '—'
            }
          />
          <KV label="Decision" value={row.decision} />
          <KV label="Outcome" value={row.outcome.replace(/_/g, ' ')} />
          <KV label="Resolving marker" value={row.resolvingMarker || '—'} />
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>Marker evidence</div>
          {row.markerTrace.length === 0 && (
            <div style={{ color: '#6b7280' }}>No markerTrace on this result.</div>
          )}
          {row.markerTrace.map((t) => (
            <div
              key={t.marker}
              style={{
                marginBottom: 10,
                padding: 10,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#f9fafb',
              }}
            >
              <div style={{ fontWeight: 650 }}>
                {t.marker} · {t.status}
              </div>
              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                Candidates ({t.candidateJobIds.length}):{' '}
                {t.candidateJobNames.slice(0, 8).join(', ') || '—'}
              </div>
            </div>
          ))}
          {row.evidence.length > 0 && (
            <>
              <div style={{ fontWeight: 650, margin: '8px 0 4px' }}>Evidence</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {row.evidence.slice(0, 30).map((e, i) => (
                  <li key={i}>
                    {e.type}: {e.value}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

function formatPerson(p: { name: string | null; email: string }): string {
  return p.name ? `${p.name} <${p.email}>` : p.email
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, marginBottom: 4 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

const fieldset: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '10px 12px',
  margin: 0,
}
const legend: CSSProperties = { fontSize: 12, fontWeight: 650, padding: '0 4px' }
const radioLabel: CSSProperties = { fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
}
const chipBtn: CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 12,
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
const linkBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  color: '#1d4ed8',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
}
const sectionH: CSSProperties = { fontSize: 14, fontWeight: 650, margin: '0 0 8px' }
const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
  border: '1px solid #e5e7eb',
}
const th: CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
}
const td: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
}
