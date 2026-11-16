import { describe, expect, it } from 'vitest'
import type { JobMatcherEvalResult, JobMatcherEvalRow } from './api'
import {
  availableEvalPolicies,
  defaultSelectedPolicy,
  policyTabShortLabel,
  selectPolicyView,
  shouldShowResultModelTabs,
} from './job-matcher-eval-policy-view'

function metrics(partial: {
  correctMatches: number
  wrongMatches: number
  ambiguous: number
}): JobMatcherEvalResult['metrics'] {
  const total =
    partial.correctMatches +
    partial.wrongMatches +
    partial.ambiguous +
    0 +
    0
  const decided = partial.correctMatches + partial.wrongMatches
  return {
    totalEvaluated: total,
    correctMatches: partial.correctMatches,
    wrongMatches: partial.wrongMatches,
    ambiguous: partial.ambiguous,
    conflict: 0,
    noMatch: 0,
    precision: decided === 0 ? null : partial.correctMatches / decided,
    correctCoverage: total === 0 ? 0 : partial.correctMatches / total,
    wrongMatchRate: total === 0 ? 0 : partial.wrongMatches / total,
    ambiguityRate: total === 0 ? 0 : partial.ambiguous / total,
    conflictRate: 0,
    noMatchRate: 0,
  }
}

function row(
  id: string,
  outcome: string,
  policy: 'CONTEXT_AWARE_V2' | 'CONTEXT_AWARE_V2_2'
): JobMatcherEvalRow {
  return {
    emailMessageId: id,
    subject: id,
    direction: 'INBOUND',
    trueJobId: 'j1',
    trueJobName: 'Job',
    trueJobNumber: null,
    jobAssignmentSource: null,
    predictedJobId: outcome === 'CORRECT_MATCH' ? 'j1' : null,
    predictedJobName: outcome === 'CORRECT_MATCH' ? 'Job' : null,
    predictedJobNumber: null,
    decision: outcome === 'CORRECT_MATCH' ? 'MATCH' : 'AMBIGUOUS',
    outcome,
    resolvingMarker: null,
    evidence: [],
    markerTrace: [],
    identityPolicy: policy,
  }
}

function baseResult(
  overrides: Partial<JobMatcherEvalResult> = {}
): JobMatcherEvalResult {
  return {
    intelligenceId: 'job-matcher',
    databaseWrites: 'NONE',
    autoAssignEnabled: false,
    evaluationRunId: 'run-1',
    identityPolicy: 'BASELINE',
    dataset: {
      spec: {
        jobsMode: 'ALL',
        jobIds: [],
        sampling: 'TOTAL',
        count: 10,
        jobLifecycle: 'ALL',
      },
      summaryLabel: 'test',
      eligibleCount: 10,
      jobsInScope: 1,
      expectedMax: 10,
      sampleSizeRequested: 10,
      actualEvaluated: 2,
      capped: false,
      capReason: null,
    },
    metrics: metrics({ correctMatches: 1, wrongMatches: 0, ambiguous: 1 }),
    jobBreakdown: [],
    rows: [row('e1', 'AMBIGUOUS', 'CONTEXT_AWARE_V2')],
    wrongMatches: [],
    displayIdentityPolicy: 'CONTEXT_AWARE_V2',
    displayMetrics: metrics({
      correctMatches: 1,
      wrongMatches: 0,
      ambiguous: 1,
    }),
    groundTruthQuality: 'MODERATE',
    groundTruthNotes: '',
    ...overrides,
  }
}

describe('job-matcher-eval-policy-view', () => {
  it('lists available policies from policyResults', () => {
    const result = baseResult({
      policyResults: [
        {
          identityPolicy: 'CONTEXT_AWARE_V2',
          metrics: metrics({
            correctMatches: 1,
            wrongMatches: 0,
            ambiguous: 1,
          }),
          jobBreakdown: [],
          rows: [row('e1', 'AMBIGUOUS', 'CONTEXT_AWARE_V2')],
          wrongMatches: [],
        },
        {
          identityPolicy: 'CONTEXT_AWARE_V2_2',
          metrics: metrics({
            correctMatches: 2,
            wrongMatches: 0,
            ambiguous: 0,
          }),
          jobBreakdown: [],
          rows: [row('e1', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2_2')],
          wrongMatches: [],
        },
      ],
    })
    expect(availableEvalPolicies(result)).toEqual([
      'CONTEXT_AWARE_V2',
      'CONTEXT_AWARE_V2_2',
    ])
    expect(defaultSelectedPolicy(result)).toBe('CONTEXT_AWARE_V2')
  })

  it('selecting V2.2 returns V2.2 metrics and rows (not V2)', () => {
    const result = baseResult({
      policyResults: [
        {
          identityPolicy: 'CONTEXT_AWARE_V2',
          metrics: metrics({
            correctMatches: 1,
            wrongMatches: 0,
            ambiguous: 1,
          }),
          jobBreakdown: [],
          rows: [row('e1', 'AMBIGUOUS', 'CONTEXT_AWARE_V2')],
          wrongMatches: [],
        },
        {
          identityPolicy: 'CONTEXT_AWARE_V2_2',
          metrics: metrics({
            correctMatches: 2,
            wrongMatches: 0,
            ambiguous: 0,
          }),
          jobBreakdown: [],
          rows: [row('e1', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2_2')],
          wrongMatches: [],
        },
      ],
    })
    const v2 = selectPolicyView(result, 'CONTEXT_AWARE_V2')
    expect(v2.available).toBe(true)
    if (!v2.available) return
    expect(v2.metrics.correctMatches).toBe(1)
    expect(v2.rows[0]?.outcome).toBe('AMBIGUOUS')

    const v22 = selectPolicyView(result, 'CONTEXT_AWARE_V2_2')
    expect(v22.available).toBe(true)
    if (!v22.available) return
    expect(v22.metrics.correctMatches).toBe(2)
    expect(v22.metrics.ambiguous).toBe(0)
    expect(v22.rows[0]?.outcome).toBe('CORRECT_MATCH')
  })

  it('missing policy is unavailable (not zero metrics)', () => {
    const result = baseResult({
      policyResults: [
        {
          identityPolicy: 'CONTEXT_AWARE_V2',
          metrics: metrics({
            correctMatches: 1,
            wrongMatches: 0,
            ambiguous: 0,
          }),
          jobBreakdown: [],
          rows: [row('e1', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2')],
          wrongMatches: [],
        },
      ],
    })
    const missing = selectPolicyView(result, 'CONTEXT_AWARE_V2_2')
    expect(missing.available).toBe(false)
  })

  it('legacy single-policy results still work without policyResults', () => {
    const result = baseResult()
    expect(availableEvalPolicies(result)).toEqual(['CONTEXT_AWARE_V2'])
    const view = selectPolicyView(result, 'CONTEXT_AWARE_V2')
    expect(view.available).toBe(true)
    if (!view.available) return
    expect(view.rows).toHaveLength(1)
  })

  it('result model tabs only for multi-model evaluations', () => {
    expect(shouldShowResultModelTabs(['CONTEXT_AWARE_V2'])).toBe(false)
    expect(
      shouldShowResultModelTabs(['CONTEXT_AWARE_V2', 'CONTEXT_AWARE_V2_1'])
    ).toBe(true)
    expect(
      shouldShowResultModelTabs([
        'CONTEXT_AWARE_V2',
        'CONTEXT_AWARE_V2_1',
        'CONTEXT_AWARE_V2_2',
        'CONTEXT_AWARE_V2_3',
      ])
    ).toBe(true)
  })

  it('policyTabShortLabel is dynamic from displayName', () => {
    expect(
      policyTabShortLabel('CONTEXT_AWARE_V2', 'V2 — Base Job Matcher')
    ).toBe('V2')
    expect(
      policyTabShortLabel(
        'CONTEXT_AWARE_V2_3',
        'V2.3 — Normalized Subject Identity'
      )
    ).toBe('V2.3')
    expect(policyTabShortLabel('CONTEXT_AWARE_V2_1')).toBe('V2_1')
  })

  it('four-model policyResults yield four available tabs', () => {
    const result = baseResult({
      policyResults: [
        {
          identityPolicy: 'CONTEXT_AWARE_V2',
          metrics: metrics({ correctMatches: 1, wrongMatches: 0, ambiguous: 0 }),
          jobBreakdown: [],
          rows: [row('e1', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2')],
          wrongMatches: [],
        },
        {
          identityPolicy: 'CONTEXT_AWARE_V2_1',
          metrics: metrics({ correctMatches: 1, wrongMatches: 0, ambiguous: 0 }),
          jobBreakdown: [],
          rows: [row('e1', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2_1')],
          wrongMatches: [],
        },
        {
          identityPolicy: 'CONTEXT_AWARE_V2_2',
          metrics: metrics({ correctMatches: 0, wrongMatches: 1, ambiguous: 0 }),
          jobBreakdown: [],
          rows: [row('e1', 'WRONG_MATCH', 'CONTEXT_AWARE_V2_2')],
          wrongMatches: [],
        },
        {
          identityPolicy: 'CONTEXT_AWARE_V2_3',
          metrics: metrics({ correctMatches: 1, wrongMatches: 0, ambiguous: 0 }),
          jobBreakdown: [],
          rows: [row('e1', 'CORRECT_MATCH', 'CONTEXT_AWARE_V2_3')],
          wrongMatches: [],
        },
      ],
    })
    const policies = availableEvalPolicies(result)
    expect(policies).toHaveLength(4)
    expect(shouldShowResultModelTabs(policies)).toBe(true)
    const v22 = selectPolicyView(result, 'CONTEXT_AWARE_V2_2')
    expect(v22.available).toBe(true)
    if (!v22.available) return
    expect(v22.rows[0]?.outcome).toBe('WRONG_MATCH')
  })
})
