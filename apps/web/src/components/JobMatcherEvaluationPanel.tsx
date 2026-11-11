import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  api,
  type JobMatcherEvalPreview,
  type JobMatcherEvalResult,
  type JobMatcherEvalRow,
  type JobLookup,
} from '../api'
import {
  DEFAULT_INTELLIGENCE_STATE,
  getJobMatcherEvalPending,
  getJobMatcherEvalSession,
  patchJobMatcherEvalSessionUi,
  saveSessionScroll,
  sessionScrollKey,
  getSessionScroll,
  setJobMatcherEvalPending,
  setJobMatcherEvalSession,
  clearJobMatcherEvalPending,
  type IntelligencePersistedState,
} from '../workspace-state'
import { SafeEmailBody } from './SafeEmailBody'

type JobsMode = 'ALL' | 'SPECIFIC' | 'SELECTED'
type Sampling = 'TOTAL' | 'PER_JOB' | 'ALL_ELIGIBLE'
type Lifecycle = 'ALL' | 'CURRENT' | 'ARCHIVED'
type OutcomeFilter = 'ALL' | 'CORRECT_MATCH' | 'WRONG_MATCH' | 'AMBIGUOUS' | 'CONFLICT' | 'NO_MATCH'
type ResultsView = 'emails' | 'jobs'

const TOTAL_PRESETS = [25, 50, 100, 250, 500, 1000]
const PER_JOB_PRESETS = [5, 10, 25, 50, 100]

export function JobMatcherEvaluationPanel({
  workspaceId,
  userId,
  groundTruthQuality,
  groundTruthNotes,
  initialUi = DEFAULT_INTELLIGENCE_STATE,
  onUiChange,
}: {
  workspaceId: string
  userId?: string
  groundTruthQuality: string
  groundTruthNotes: string
  initialUi?: IntelligencePersistedState
  onUiChange?: (next: IntelligencePersistedState) => void
}) {
  const [jobsMode, setJobsMode] = useState<JobsMode>(() => initialUi.evalConfig.jobsMode)
  const [sampling, setSampling] = useState<Sampling>(() => initialUi.evalConfig.sampling)
  const [count, setCount] = useState(() => initialUi.evalConfig.count)
  const [lifecycle, setLifecycle] = useState<Lifecycle>(() => initialUi.evalConfig.lifecycle)
  const [selectedJobs, setSelectedJobs] = useState<JobLookup[]>([])
  const [jobSearch, setJobSearch] = useState('')
  const [jobOptions, setJobOptions] = useState<JobLookup[]>([])
  const [jobPickerOpen, setJobPickerOpen] = useState(false)
  const [preview, setPreview] = useState<JobMatcherEvalPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const sessionSeed =
    userId ? getJobMatcherEvalSession(workspaceId, userId) : null
  const pendingSeed = userId ? getJobMatcherEvalPending(workspaceId, userId) : null
  const [busy, setBusy] = useState(() => !!pendingSeed)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<JobMatcherEvalResult | null>(
    () => sessionSeed?.result ?? null
  )
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>(() => initialUi.outcomeFilter)
  const [jobFilterId, setJobFilterId] = useState<string | null>(
    () => sessionSeed?.jobFilterId ?? null
  )
  const [selectedRow, setSelectedRow] = useState<JobMatcherEvalRow | null>(() => {
    const id = initialUi.selectedEmailMessageId
    if (!id || !sessionSeed?.result) return null
    return sessionSeed.result.rows.find((r) => r.emailMessageId === id) ?? null
  })
  const [resultsView, setResultsView] = useState<ResultsView>(() => initialUi.resultsView)
  const [inspectorTab, setInspectorTab] = useState<'email' | 'match'>(() => initialUi.inspectorTab)
  const [wide, setWide] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1100 : true
  )
  const jobsHydratedRef = useRef(false)
  const skipUiPersistRef = useRef(true)
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1100)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Rehydrate selected Jobs from persisted IDs once; drop IDs that no longer exist.
  useEffect(() => {
    if (jobsHydratedRef.current) return
    jobsHydratedRef.current = true
    const ids = initialUi.evalConfig.jobIds
    if (ids.length === 0 || initialUi.evalConfig.jobsMode === 'ALL') return
    let cancelled = false
    api
      .getJobsLookup(workspaceId, { showArchived: true })
      .then((r) => {
        if (cancelled) return
        const byId = new Map(r.jobs.map((j) => [j.id, j]))
        setSelectedJobs(ids.map((id) => byId.get(id)).filter(Boolean) as JobLookup[])
      })
      .catch(() => {
        if (!cancelled) setSelectedJobs([])
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, initialUi.evalConfig.jobIds, initialUi.evalConfig.jobsMode])

  // Persist evaluation draft / UI prefs (never result payloads or email bodies).
  useEffect(() => {
    if (!onUiChange) return
    if (skipUiPersistRef.current) {
      skipUiPersistRef.current = false
      return
    }
    onUiChange({
      tab: 'evaluation',
      evalConfig: {
        jobsMode,
        jobIds: selectedJobs.map((j) => j.id),
        sampling,
        count,
        lifecycle,
      },
      outcomeFilter,
      resultsView,
      selectedEmailMessageId: selectedRow?.emailMessageId ?? null,
      inspectorTab,
    })
  }, [
    onUiChange,
    jobsMode,
    selectedJobs,
    sampling,
    count,
    lifecycle,
    outcomeFilter,
    resultsView,
    selectedRow?.emailMessageId,
    inspectorTab,
  ])

  // selectedEmailMessageId is restored only while in-memory `result` exists (results are not durable).
  useEffect(() => {
    if (!result || !initialUi.selectedEmailMessageId || selectedRow) return
    const row = result.rows.find((r) => r.emailMessageId === initialUi.selectedEmailMessageId)
    if (row) setSelectedRow(row)
  }, [result, initialUi.selectedEmailMessageId, selectedRow])

  // Re-attach to an in-flight SPA evaluation after navigating away/back.
  useEffect(() => {
    if (!userId) return
    const pending = getJobMatcherEvalPending(workspaceId, userId)
    if (!pending) return
    let cancelled = false
    setBusy(true)
    pending.promise
      .then((evaluation) => {
        if (cancelled) return
        setResult(evaluation)
        setJobMatcherEvalSession({
          workspaceId,
          userId,
          result: evaluation,
          jobFilterId: null,
        })
        clearJobMatcherEvalPending(workspaceId, userId)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Evaluation failed')
        clearJobMatcherEvalPending(workspaceId, userId)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, userId])

  // Keep completed evaluation in SPA session memory (navigation, not browser reload).
  useEffect(() => {
    if (!userId || !result) return
    setJobMatcherEvalSession({
      workspaceId,
      userId,
      result,
      jobFilterId,
    })
  }, [workspaceId, userId, result, jobFilterId])

  useEffect(() => {
    if (!userId || !result) return
    patchJobMatcherEvalSessionUi({ workspaceId, userId, jobFilterId })
  }, [workspaceId, userId, result, jobFilterId])

  // Restore results list scroll after remount when rows are present.
  useEffect(() => {
    if (!userId || !result || !resultsScrollRef.current) return
    const key = sessionScrollKey({
      workspaceId,
      userId,
      surface: 'job-matcher-results',
    })
    const top = getSessionScroll(key)
    if (top == null) return
    const el = resultsScrollRef.current
    requestAnimationFrame(() => {
      el.scrollTop = top
    })
  }, [workspaceId, userId, result?.dataset.actualEvaluated])

  const dataset = useMemo(() => {
    const jobIds = jobsMode === 'ALL' ? [] : selectedJobs.map((j) => j.id)
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
    if (!userId) {
      setError('Sign in required to run evaluation.')
      return
    }
    setBusy(true)
    setError(null)
    setSelectedRow(null)
    setJobFilterId(null)
    setOutcomeFilter('ALL')
    setResultsView('emails')
    setResult(null)
    const promise = api
      .evaluateJobMatcherIntelligence(workspaceId, { dataset })
      .then((res) => res.evaluation)
    setJobMatcherEvalPending({ workspaceId, userId, promise })
    try {
      const evaluation = await promise
      setResult(evaluation)
      setJobMatcherEvalSession({
        workspaceId,
        userId,
        result: evaluation,
        jobFilterId: null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed')
    } finally {
      clearJobMatcherEvalPending(workspaceId, userId)
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
    !!userId &&
    !busy &&
    (jobsMode === 'ALL' ||
      (jobsMode === 'SPECIFIC' && selectedJobs.length === 1) ||
      (jobsMode === 'SELECTED' && selectedJobs.length > 0))

  const countPresets = sampling === 'PER_JOB' ? PER_JOB_PRESETS : TOTAL_PRESETS
  const groundTruthParts = parseGroundTruthLabel(preview?.groundTruth ?? '')
  const m = result?.metrics

  return (
    <div
      data-testid="job-matcher-eval-workspace"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: '#6b7280' }} title={groundTruthNotes}>
          Read-only evaluation · Ground truth quality: {groundTruthQuality}
        </div>

        {/* Compact configuration — horizontal controls, not stacked fieldsets */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'flex-end',
            padding: '8px 10px',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          <Control label="Jobs">
            <select
              value={jobsMode}
              disabled={busy}
              onChange={(e) => {
                setJobsMode(e.target.value as JobsMode)
                setSelectedJobs([])
                setJobPickerOpen(e.target.value !== 'ALL')
              }}
              style={selectStyle}
            >
              <option value="ALL">All Jobs</option>
              <option value="SPECIFIC">Specific Job</option>
              <option value="SELECTED">Selected Jobs</option>
            </select>
          </Control>
          {jobsMode !== 'ALL' && (
            <Control label="Job pick">
              <button
                type="button"
                disabled={busy}
                onClick={() => setJobPickerOpen((o) => !o)}
                style={{ ...selectStyle, textAlign: 'left', cursor: 'pointer', minWidth: 180 }}
              >
                {selectedJobs.length === 0
                  ? 'Select…'
                  : selectedJobs.length === 1
                    ? `${selectedJobs[0]!.jobNumber ? `${selectedJobs[0]!.jobNumber} — ` : ''}${selectedJobs[0]!.name}`
                    : `${selectedJobs.length} jobs`}
              </button>
            </Control>
          )}
          <Control label="Sampling">
            <select
              value={sampling}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as Sampling
                setSampling(next)
                if (next === 'PER_JOB' && count > 100) setCount(25)
                if (next === 'TOTAL' && count < 25) setCount(50)
              }}
              style={selectStyle}
            >
              <option value="TOTAL">Total sample</option>
              <option value="PER_JOB">Per Job</option>
              <option value="ALL_ELIGIBLE">All eligible</option>
            </select>
          </Control>
          {sampling !== 'ALL_ELIGIBLE' && (
            <Control label="Amount">
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <select
                  value={countPresets.includes(count as (typeof countPresets)[number]) ? count : ''}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.value) setCount(Number(e.target.value))
                  }}
                  style={{ ...selectStyle, minWidth: 88 }}
                >
                  {!countPresets.includes(count as (typeof countPresets)[number]) && (
                    <option value="">Custom</option>
                  )}
                  {countPresets.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={sampling === 'PER_JOB' ? 100 : 1000}
                  value={count}
                  disabled={busy}
                  onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
                  style={{ ...selectStyle, width: 72, minWidth: 72 }}
                  aria-label="Custom amount"
                />
              </div>
            </Control>
          )}
          <Control label="Lifecycle">
            <select
              value={lifecycle}
              disabled={busy}
              onChange={(e) => setLifecycle(e.target.value as Lifecycle)}
              style={selectStyle}
            >
              <option value="ALL">Current + Archived</option>
              <option value="CURRENT">Current</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </Control>
        </div>

        {jobPickerOpen && jobsMode !== 'ALL' && (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: '#fff',
              padding: 8,
              maxHeight: 160,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <input
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
              placeholder="Search job number or name…"
              disabled={busy}
              style={{ ...inputStyle, maxWidth: 360 }}
            />
            <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
              {jobOptions.map((j) => {
                const checked = selectedJobs.some((s) => s.id === j.id)
                return (
                  <label
                    key={j.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      padding: '4px 6px',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: checked ? '#eff6ff' : undefined,
                    }}
                  >
                    <input
                      type={jobsMode === 'SPECIFIC' ? 'radio' : 'checkbox'}
                      name="eval-job"
                      checked={checked}
                      disabled={busy}
                      onChange={() => {
                        if (jobsMode === 'SPECIFIC') {
                          setSelectedJobs([j])
                          setJobPickerOpen(false)
                        } else if (checked) {
                          setSelectedJobs(selectedJobs.filter((s) => s.id !== j.id))
                        } else {
                          setSelectedJobs([...selectedJobs, j])
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
          </div>
        )}

        {/* Dataset Summary — keep panel; use horizontal space; Run lives here */}
        <div
          data-testid="job-matcher-dataset-summary"
          style={{
            padding: '10px 12px',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#f9fafb',
            fontSize: 13,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <div style={{ fontWeight: 650, marginBottom: 4 }}>Dataset summary</div>
              {previewError && <div style={{ color: '#b42318' }}>{previewError}</div>}
              {!preview && !previewError && (
                <div style={{ color: '#6b7280' }}>
                  {jobsMode !== 'ALL' && selectedJobs.length === 0
                    ? 'Select one or more Jobs to preview eligibility.'
                    : 'Loading eligibility…'}
                </div>
              )}
              {preview && (
                <>
                  <div style={{ color: '#111827', fontWeight: 600, marginBottom: 8 }}>
                    {preview.summaryLabel}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px 20px',
                      marginBottom: 8,
                    }}
                  >
                    <SummaryStat label="Jobs in scope" value={preview.jobsInScope} />
                    <SummaryStat label="Eligible emails" value={preview.eligibleCount} />
                    <SummaryStat label="Expected maximum" value={preview.expectedMax} />
                  </div>
                  {preview.capped && preview.capReason && (
                    <div style={{ color: '#92400e', fontSize: 12, marginBottom: 6 }}>
                      {preview.capReason}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px 16px',
                      fontSize: 12,
                      color: '#4b5563',
                    }}
                  >
                    <span>
                      <span style={{ color: '#6b7280' }}>Ground truth </span>
                      <strong style={{ fontWeight: 600, color: '#111827' }}>
                        {groundTruthParts.included || preview.groundTruth}
                      </strong>
                    </span>
                    {groundTruthParts.excluded && (
                      <span>
                        <span style={{ color: '#6b7280' }}>Excluded </span>
                        <strong style={{ fontWeight: 600, color: '#111827' }}>
                          {groundTruthParts.excluded}
                        </strong>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                type="button"
                onClick={() => void run()}
                disabled={!canRun}
                style={{ ...primaryBtn, opacity: canRun ? 1 : 0.5, whiteSpace: 'nowrap' }}
              >
                {busy ? 'Running…' : 'Run Evaluation'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" style={{ color: '#b42318', fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* 12 bordered metric cards — original preferred style */}
        {result && m && (
          <div
            data-testid="job-matcher-metric-cards"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 8,
            }}
          >
            <Metric label="Evaluated" value={m.totalEvaluated} />
            <Metric label="Correct" value={m.correctMatches} tone="positive" />
            <Metric label="Wrong" value={m.wrongMatches} tone="negative" />
            <Metric label="Ambiguous" value={m.ambiguous} tone="warning" />
            <Metric label="Conflict" value={m.conflict} tone="warning" />
            <Metric label="No Match" value={m.noMatch} />
            <Metric
              label="Precision"
              value={m.precision == null ? '—' : `${(m.precision * 100).toFixed(2)}%`}
              strong
            />
            <Metric
              label="Coverage"
              value={`${(m.correctCoverage * 100).toFixed(2)}%`}
              strong
            />
            <Metric label="Wrong rate" value={`${(m.wrongMatchRate * 100).toFixed(2)}%`} />
            <Metric label="Ambiguity" value={`${(m.ambiguityRate * 100).toFixed(2)}%`} />
            <Metric label="Conflict rate" value={`${(m.conflictRate * 100).toFixed(2)}%`} />
            <Metric label="No-match rate" value={`${(m.noMatchRate * 100).toFixed(2)}%`} />
          </div>
        )}
      </div>

      {/* Results | Inspector — remaining viewport */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: wide ? 'row' : 'column',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <div
          style={{
            flex: wide ? '0 0 42%' : '1 1 45%',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: wide ? '1px solid #e5e7eb' : undefined,
            borderBottom: !wide ? '1px solid #e5e7eb' : undefined,
          }}
        >
          <ResultsPane
            result={result}
            filteredRows={filteredRows}
            outcomeFilter={outcomeFilter}
            setOutcomeFilter={setOutcomeFilter}
            jobFilterId={jobFilterId}
            setJobFilterId={setJobFilterId}
            selectedRow={selectedRow}
            setSelectedRow={(row) => {
              setSelectedRow(row)
              setInspectorTab('email')
            }}
            resultsView={resultsView}
            setResultsView={setResultsView}
            scrollRef={resultsScrollRef}
            onScrollSave={(top) => {
              if (!userId) return
              saveSessionScroll(
                sessionScrollKey({
                  workspaceId,
                  userId,
                  surface: 'job-matcher-results',
                }),
                top
              )
            }}
          />
        </div>
        <div
          style={{
            flex: wide ? '1 1 58%' : '1 1 55%',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {selectedRow ? (
            <EmailInspector
              workspaceId={workspaceId}
              userId={userId}
              row={selectedRow}
              groundTruthQuality={groundTruthQuality}
              inspectorTab={inspectorTab}
              setInspectorTab={setInspectorTab}
              onClose={() => setSelectedRow(null)}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
                fontSize: 13,
                padding: 24,
                textAlign: 'center',
              }}
            >
              {result
                ? 'Select an email to inspect its content and matcher evidence.'
                : 'Configure the dataset and run evaluation to fill this workspace.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultsPane(props: {
  result: JobMatcherEvalResult | null
  filteredRows: JobMatcherEvalRow[]
  outcomeFilter: OutcomeFilter
  setOutcomeFilter: (f: OutcomeFilter) => void
  jobFilterId: string | null
  setJobFilterId: (id: string | null) => void
  selectedRow: JobMatcherEvalRow | null
  setSelectedRow: (row: JobMatcherEvalRow | null) => void
  resultsView: ResultsView
  setResultsView: (v: ResultsView) => void
  scrollRef?: RefObject<HTMLDivElement | null>
  onScrollSave?: (scrollTop: number) => void
}) {
  return (
    <>
      <div
        style={{
          flexShrink: 0,
          padding: '6px 8px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <strong style={{ fontSize: 12 }}>
          Results{props.result ? ` (${props.filteredRows.length})` : ''}
        </strong>
        <Segmented
          value={props.resultsView}
          onChange={props.setResultsView}
          options={[
            { value: 'emails', label: 'Emails' },
            { value: 'jobs', label: 'Jobs' },
          ]}
        />
        {props.resultsView === 'emails' && (
          <>
            {(
              [
                ['ALL', 'All'],
                ['WRONG_MATCH', 'Wrong'],
                ['AMBIGUOUS', 'Ambig'],
                ['CONFLICT', 'Conflict'],
                ['NO_MATCH', 'None'],
                ['CORRECT_MATCH', 'Correct'],
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
          </>
        )}
        {props.jobFilterId && (
          <button type="button" onClick={() => props.setJobFilterId(null)} style={linkBtn}>
            Clear Job filter
          </button>
        )}
      </div>
      <div
        ref={props.scrollRef}
        onScroll={(e) => props.onScrollSave?.(e.currentTarget.scrollTop)}
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        {!props.result && (
          <div style={{ padding: 16, color: '#9ca3af', fontSize: 12 }}>No evaluation yet.</div>
        )}
        {props.result && props.resultsView === 'jobs' && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>Correct / Eval</th>
                <th style={th}>Wrong</th>
                <th style={th}>Ambig</th>
                <th style={th}>Conflict</th>
                <th style={th}>No match</th>
              </tr>
            </thead>
            <tbody>
              {props.result.jobBreakdown.map((j) => (
                <tr
                  key={j.jobId}
                  onClick={() => {
                    props.setJobFilterId(j.jobId)
                    props.setResultsView('emails')
                  }}
                  style={{
                    cursor: 'pointer',
                    background: props.jobFilterId === j.jobId ? '#eff6ff' : undefined,
                  }}
                >
                  <td style={td}>
                    {j.jobNumber ? `${j.jobNumber} — ` : ''}
                    {j.jobName}
                  </td>
                  <td style={{ ...td, fontWeight: 650, whiteSpace: 'nowrap' }}>
                    {j.correct} / {j.evaluated}
                  </td>
                  <td style={td}>{j.wrong}</td>
                  <td style={td}>{j.ambiguous}</td>
                  <td style={td}>{j.conflict}</td>
                  <td style={td}>{j.noMatch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {props.result && props.resultsView === 'emails' && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Result</th>
                <th style={th}>Subject</th>
                <th style={th}>Historical → Predicted</th>
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
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <OutcomePill outcome={row.outcome} />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 550 }}>{(row.subject || '—').slice(0, 72)}</div>
                    </td>
                    <td style={td}>
                      <div style={{ color: '#4b5563' }}>
                        {(row.trueJobNumber || row.trueJobName).slice(0, 28)}
                        {' → '}
                        {row.predictedJobName
                          ? (row.predictedJobNumber || row.predictedJobName).slice(0, 28)
                          : '—'}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {props.result && props.resultsView === 'emails' && props.filteredRows.length === 0 && (
          <div style={{ padding: 12, color: '#6b7280', fontSize: 12 }}>No rows for this filter.</div>
        )}
      </div>
    </>
  )
}

function EmailInspector({
  workspaceId,
  userId,
  row,
  groundTruthQuality,
  inspectorTab,
  setInspectorTab,
  onClose,
}: {
  workspaceId: string
  userId?: string
  row: JobMatcherEvalRow
  groundTruthQuality: string
  inspectorTab: 'email' | 'match'
  setInspectorTab: (t: 'email' | 'match') => void
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState<
    Awaited<ReturnType<typeof api.getJobMatcherEvalEmail>>['email'] | null
  >(null)
  const bodyScrollRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (!userId || !email || !bodyScrollRef.current) return
    const key = sessionScrollKey({
      workspaceId,
      userId,
      surface: 'job-matcher-inspector',
      context: row.emailMessageId,
    })
    const top = getSessionScroll(key)
    if (top == null) return
    const el = bodyScrollRef.current
    requestAnimationFrame(() => {
      el.scrollTop = top
    })
  }, [workspaceId, userId, row.emailMessageId, email, inspectorTab])

  return (
    <aside
      data-testid="eval-email-inspector"
      style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: '6px 10px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 12 }}>Inspector</strong>
        <Segmented
          value={inspectorTab}
          onChange={setInspectorTab}
          options={[
            { value: 'email', label: 'Email' },
            { value: 'match', label: 'Match Analysis' },
          ]}
        />
        <OutcomePill outcome={row.outcome} />
        <button type="button" onClick={onClose} style={{ ...linkBtn, marginLeft: 'auto' }}>
          Close
        </button>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '6px 10px',
          borderBottom: '1px solid #e5e7eb',
          fontSize: 12,
          display: 'grid',
          gap: 2,
          background: '#f9fafb',
        }}
      >
        <div>
          <span style={{ color: '#6b7280' }}>Historical: </span>
          <strong>
            {row.trueJobNumber ? `${row.trueJobNumber} — ` : ''}
            {row.trueJobName}
          </strong>
          <span style={{ color: '#9ca3af' }}> · {row.jobAssignmentSource || '—'} · GT {groundTruthQuality}</span>
        </div>
        <div>
          <span style={{ color: '#6b7280' }}>Predicted: </span>
          <strong>
            {row.predictedJobName
              ? `${row.predictedJobNumber ? `${row.predictedJobNumber} — ` : ''}${row.predictedJobName}`
              : '—'}
          </strong>
          <span style={{ color: '#9ca3af' }}>
            {' '}
            · {row.decision}
            {row.resolvingMarker ? ` · ${row.resolvingMarker}` : ''}
          </span>
        </div>
      </div>

      <div
        ref={bodyScrollRef}
        onScroll={(e) => {
          if (!userId) return
          saveSessionScroll(
            sessionScrollKey({
              workspaceId,
              userId,
              surface: 'job-matcher-inspector',
              context: row.emailMessageId,
            }),
            e.currentTarget.scrollTop
          )
        }}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px', fontSize: 12 }}
      >
        {inspectorTab === 'email' && (
          <>
            {loading && <div style={{ color: '#6b7280' }}>Loading email…</div>}
            {error && (
              <div role="alert" style={{ color: '#b42318' }}>
                {error}
              </div>
            )}
            {email && (
              <>
                <MetaLine label="From" value={formatPerson(email.from)} />
                <MetaLine label="To" value={email.to.map(formatPerson).join(', ') || '—'} />
                {email.cc.length > 0 && (
                  <MetaLine label="Cc" value={email.cc.map(formatPerson).join(', ')} />
                )}
                <MetaLine label="Date" value={String(email.receivedAt || email.sentAt || '—')} />
                <MetaLine label="Subject" value={email.subject || '—'} />
                <div style={{ marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
                  <SafeEmailBody bodyHtml={email.bodyHtml} bodyText={email.bodyText} />
                </div>
                {email.attachments.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 650, marginBottom: 4 }}>Attachments</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {email.attachments.map((a) => (
                        <li key={a.id}>
                          {a.filename} · {formatBytes(a.sizeBytes)}
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
                  </div>
                )}
              </>
            )}
          </>
        )}

        {inspectorTab === 'match' && (
          <>
            <MarkerStrip row={row} />
            {row.evidence.length > 0 && (
              <>
                <div style={{ fontWeight: 650, margin: '10px 0 4px' }}>Evidence</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {row.evidence.slice(0, 40).map((e, i) => (
                    <li key={i}>
                      {e.type}: {e.value}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function MarkerStrip({ row }: { row: JobMatcherEvalRow }) {
  const markers = row.markerTrace.length
    ? row.markerTrace
    : [{ marker: '—', status: row.decision, candidateJobIds: [], candidateJobNames: [] }]

  return (
    <div>
      <div style={{ fontWeight: 650, marginBottom: 8 }}>Marker progression</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' }}>
        {markers.map((t, i) => (
          <div key={`${t.marker}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '8px 10px',
                minWidth: 110,
                background: t.status === 'MATCH' ? '#ecfdf5' : '#f9fafb',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: 0.3 }}>
                {t.marker}
              </div>
              <div style={{ fontWeight: 650, marginTop: 2 }}>{t.status}</div>
              <div style={{ color: '#6b7280', marginTop: 4, fontSize: 11 }}>
                {t.candidateJobNames.slice(0, 2).join(', ') ||
                  (t.candidateJobIds.length ? `${t.candidateJobIds.length} candidates` : '—')}
              </div>
            </div>
            {i < markers.length - 1 && <span style={{ color: '#9ca3af' }}>→</span>}
          </div>
        ))}
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: '8px 10px',
            minWidth: 110,
            background: '#fef3c7',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>FINAL</div>
          <div style={{ fontWeight: 650, marginTop: 2 }}>{row.decision}</div>
          <div style={{ color: '#6b7280', marginTop: 4, fontSize: 11 }}>
            {row.predictedJobName || '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 2, fontSize: 11, color: '#6b7280' }}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #d0d5dd', borderRadius: 6, overflow: 'hidden' }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            padding: '3px 8px',
            fontSize: 11,
            border: 'none',
            cursor: 'pointer',
            background: value === o.value ? '#1a1a2e' : '#fff',
            color: value === o.value ? '#fff' : '#374151',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function OutcomePill({ outcome }: { outcome: string }) {
  const colors: Record<string, [string, string]> = {
    CORRECT_MATCH: ['#dcfce7', '#166534'],
    WRONG_MATCH: ['#fee2e2', '#991b1b'],
    AMBIGUOUS: ['#fef3c7', '#92400e'],
    CONFLICT: ['#f3e8ff', '#6b21a8'],
    NO_MATCH: ['#f3f4f6', '#4b5563'],
  }
  const [bg, fg] = colors[outcome] ?? ['#f3f4f6', '#374151']
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        background: bg,
        color: fg,
      }}
    >
      {outcome.replace(/_/g, ' ')}
    </span>
  )
}

function parseGroundTruthLabel(raw: string): { included: string; excluded: string | null } {
  const text = raw.trim()
  if (!text) return { included: '', excluded: null }
  const excl = text.match(/JOB_NUMBER_MATCH\s+excluded/i)
  const included = text
    .replace(/\(.*?\)/g, '')
    .replace(/;?\s*JOB_NUMBER_MATCH\s+excluded/i, '')
    .replace(/\bauthoritative\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    included: included || text,
    excluded: excl ? 'JOB_NUMBER_MATCH' : null,
  }
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ minWidth: 100 }}>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: '#111827',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  )
}

/** Original bordered white metric cards — preferred evaluation scan style. */
function Metric({
  label,
  value,
  tone,
  strong,
}: {
  label: string
  value: string | number
  tone?: 'positive' | 'negative' | 'warning'
  strong?: boolean
}) {
  const valueColor =
    tone === 'positive'
      ? '#166534'
      : tone === 'negative'
        ? '#991b1b'
        : tone === 'warning'
          ? '#92400e'
          : '#111827'
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '10px 12px',
        background: '#fff',
        minHeight: 58,
      }}
    >
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: strong ? 750 : 700,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  )
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 6, marginBottom: 2 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', wordBreak: 'break-word' }}>{value}</span>
    </div>
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

const selectStyle: CSSProperties = {
  padding: '5px 8px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 12,
  background: '#fff',
  color: '#111827',
  minWidth: 120,
}
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 12,
}
const chipBtn: CSSProperties = {
  padding: '2px 8px',
  border: '1px solid #d0d5dd',
  borderRadius: 5,
  fontSize: 11,
  cursor: 'pointer',
}
const primaryBtn: CSSProperties = {
  padding: '6px 12px',
  border: '1px solid #1a1a2e',
  borderRadius: 6,
  background: '#1a1a2e',
  color: '#fff',
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
const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
}
const th: CSSProperties = {
  textAlign: 'left',
  padding: '5px 8px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  position: 'sticky',
  top: 0,
  zIndex: 1,
}
const td: CSSProperties = {
  padding: '5px 8px',
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
}
