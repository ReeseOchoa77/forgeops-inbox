import { describe, expect, it } from 'vitest'
import { selectAdjustedPolicyView } from './job-matcher-eval-exclusions'
import type { JobMatcherEvalResult, JobMatcherEvalRow } from './api'

function row(
  id: string,
  outcome: JobMatcherEvalRow['outcome'],
  policy: JobMatcherEvalRow['identityPolicy'] = 'CONTEXT_AWARE_V2'
): JobMatcherEvalRow {
  return {
    emailMessageId: id,
    direction: 'INCOMING',
    subject: id,
    trueJobId: 'job-a',
    trueJobName: 'Job A',
    trueJobNumber: '1',
    jobAssignmentSource: 'USER_ASSIGNED',
    predictedJobId: outcome === 'CORRECT_MATCH' ? 'job-a' : outcome === 'WRONG_MATCH' ? 'job-b' : null,
    predictedJobName: null,
    predictedJobNumber: null,
    decision: outcome === 'CORRECT_MATCH' || outcome === 'WRONG_MATCH' ? 'MATCH' : outcome,
    outcome,
    resolvingMarker: 'NAME',
    identityPolicy: policy,
    evidence: [],
    candidateJobIds: [],
    candidateJobNames: [],
  }
}

function metrics(partial: {
  totalEvaluated: number
  correctMatches: number
  wrongMatches: number
  ambiguous?: number
  conflict?: number
  noMatch?: number
}) {
  const totalEvaluated = partial.totalEvaluated
  const correctMatches = partial.correctMatches
  const wrongMatches = partial.wrongMatches
  const ambiguous = partial.ambiguous ?? 0
  const conflict = partial.conflict ?? 0
  const noMatch = partial.noMatch ?? 0
  const decided = correctMatches + wrongMatches
  return {
    totalEvaluated,
    correctMatches,
    wrongMatches,
    ambiguous,
    conflict,
    noMatch,
    precision: decided === 0 ? null : correctMatches / decided,
    correctCoverage: totalEvaluated === 0 ? 0 : correctMatches / totalEvaluated,
    wrongMatchRate: totalEvaluated === 0 ? 0 : wrongMatches / totalEvaluated,
    ambiguityRate: totalEvaluated === 0 ? 0 : ambiguous / totalEvaluated,
    conflictRate: totalEvaluated === 0 ? 0 : conflict / totalEvaluated,
    noMatchRate: totalEvaluated === 0 ? 0 : noMatch / totalEvaluated,
  }
}

function result(): JobMatcherEvalResult {
  const v2Rows = [
    row('e1', 'CORRECT_MATCH'),
    row('e2', 'WRONG_MATCH'),
    row('e3', 'AMBIGUOUS'),
  ]
  const v21Rows = [
    row('e1', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2_1'),
    row('e2', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2_1'),
    row('e3', 'AMBIGUOUS', 'CONTEXT_AWARE_V2_1'),
  ]
  return {
    intelligenceId: 'job-matcher',
    databaseWrites: 'NONE',
    autoAssignEnabled: false,
    evaluationRunId: '00000000-0000-4000-8000-000000000001',
    identityPolicy: 'CONTEXT_AWARE_V2',
    dataset: {
      spec: { jobsMode: 'ALL', sampling: 'ALL_ELIGIBLE' },
      summaryLabel: 'test',
      eligibleCount: 3,
      jobsInScope: 1,
      expectedMax: 3,
      sampleSizeRequested: null,
      actualEvaluated: 3,
      capped: false,
      capReason: null,
    },
    metrics: metrics({
      totalEvaluated: 3,
      correctMatches: 1,
      wrongMatches: 1,
      ambiguous: 1,
    }),
    displayIdentityPolicy: 'CONTEXT_AWARE_V2',
    displayMetrics: metrics({
      totalEvaluated: 3,
      correctMatches: 1,
      wrongMatches: 1,
      ambiguous: 1,
    }),
    policyResults: [
      {
        identityPolicy: 'CONTEXT_AWARE_V2',
        experimentRevision: null,
        metrics: metrics({
          totalEvaluated: 3,
          correctMatches: 1,
          wrongMatches: 1,
          ambiguous: 1,
        }),
        jobBreakdown: [],
        rows: v2Rows,
        wrongMatches: [],
      },
      {
        identityPolicy: 'CONTEXT_AWARE_V2_1',
        experimentRevision: 'independent-v21-title-gap-v22-unique-token-r1',
        metrics: metrics({
          totalEvaluated: 3,
          correctMatches: 2,
          wrongMatches: 0,
          ambiguous: 1,
        }),
        jobBreakdown: [],
        rows: v21Rows,
        wrongMatches: [],
      },
    ],
    datasetFingerprint: 'e1,e2,e3',
    diagnostics: {
      wrongByFailureCategory: [],
      markerPerformance: [],
      groundTruthSurvival: {
        afterMarker1: { count: 0, pct: 0 },
        afterMarker2: { count: 0, pct: 0 },
        afterMarker3: { count: 0, pct: 0 },
      },
      firstGroundTruthLoss: [],
      commonConfusions: [],
    },
    jobBreakdown: [],
    rows: v2Rows,
    wrongMatches: [],
    runtimeMs: 1,
    groundTruthQuality: 'MODERATE',
    groundTruthNotes: '',
  }
}

describe('selectAdjustedPolicyView', () => {
  it('excludes the same email from all policies in the run', () => {
    const r = result()
    const exclusions = [{ emailMessageId: 'e2' }]
    const v2 = selectAdjustedPolicyView(r, 'CONTEXT_AWARE_V2', exclusions)
    const v21 = selectAdjustedPolicyView(r, 'CONTEXT_AWARE_V2_1', exclusions)
    expect(v2.available && v2.adjustedMetrics.totalEvaluated).toBe(2)
    expect(v21.available && v21.adjustedMetrics.totalEvaluated).toBe(2)
    expect(v2.available && v2.adjustedMetrics.wrongMatches).toBe(0)
    expect(v21.available && v21.adjustedMetrics.correctMatches).toBe(1)
    expect(v2.available && v2.excludedRows.map((x) => x.emailMessageId)).toEqual([
      'e2',
    ])
  })

  it('preserves raw metrics separately from adjusted', () => {
    const r = result()
    const view = selectAdjustedPolicyView(r, 'CONTEXT_AWARE_V2', [
      { emailMessageId: 'e2' },
    ])
    expect(view.available).toBe(true)
    if (!view.available) return
    expect(view.rawMetrics.wrongMatches).toBe(1)
    expect(view.adjustedMetrics.wrongMatches).toBe(0)
    expect(view.rawMetrics.totalEvaluated).toBe(3)
    expect(view.adjustedMetrics.totalEvaluated).toBe(2)
  })
})
