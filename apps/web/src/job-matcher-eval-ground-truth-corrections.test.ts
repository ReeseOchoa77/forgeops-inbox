import { describe, expect, it } from 'vitest'
import {
  correctedPolicyBundles,
  markCorrectEligibility,
  selectCorrectedPolicyView,
} from './job-matcher-eval-ground-truth-corrections'
import type { JobMatcherEvalResult, JobMatcherEvalRow } from './api'

function row(
  id: string,
  decision: string,
  predictedJobId: string | null,
  policy: JobMatcherEvalRow['identityPolicy']
): JobMatcherEvalRow {
  const outcome =
    decision === 'MATCH'
      ? predictedJobId === 'job-a'
        ? 'CORRECT_MATCH'
        : 'WRONG_MATCH'
      : decision
  return {
    emailMessageId: id,
    direction: 'INCOMING',
    subject: id,
    trueJobId: 'job-a',
    trueJobName: 'Job A',
    trueJobNumber: '1',
    jobAssignmentSource: 'USER_ASSIGNED',
    predictedJobId,
    predictedJobName: predictedJobId ? `Name ${predictedJobId}` : null,
    predictedJobNumber: null,
    decision,
    outcome,
    resolvingMarker: 'NAME',
    identityPolicy: policy,
    evidence: [],
    markerTrace: [],
  }
}

function metricsFor(rows: JobMatcherEvalRow[]) {
  const c = rows.filter((r) => r.outcome === 'CORRECT_MATCH').length
  const w = rows.filter((r) => r.outcome === 'WRONG_MATCH').length
  const a = rows.filter((r) => r.outcome === 'AMBIGUOUS').length
  const n = rows.length
  return {
    totalEvaluated: n,
    correctMatches: c,
    wrongMatches: w,
    ambiguous: a,
    conflict: 0,
    noMatch: 0,
    precision: c + w === 0 ? null : c / (c + w),
    correctCoverage: c / n,
    wrongMatchRate: w / n,
    ambiguityRate: a / n,
    conflictRate: 0,
    noMatchRate: 0,
  }
}

function result(): JobMatcherEvalResult {
  // V2 wrongly predicts job-b on e2 (the email whose real job is job-b).
  const v2Rows = [
    row('e1', 'MATCH', 'job-a', 'CONTEXT_AWARE_V2'),
    row('e2', 'MATCH', 'job-b', 'CONTEXT_AWARE_V2'),
    row('e3', 'AMBIGUOUS', null, 'CONTEXT_AWARE_V2'),
  ]
  const v21Rows = [
    row('e1', 'MATCH', 'job-a', 'CONTEXT_AWARE_V2_1'),
    row('e2', 'MATCH', 'job-a', 'CONTEXT_AWARE_V2_1'),
    row('e3', 'AMBIGUOUS', null, 'CONTEXT_AWARE_V2_1'),
  ]
  const base = {
    intelligenceId: 'job-matcher',
    databaseWrites: 'NONE',
    autoAssignEnabled: false,
    evaluationRunId: '00000000-0000-4000-8000-000000000001',
    identityPolicy: 'CONTEXT_AWARE_V2',
    displayIdentityPolicy: 'CONTEXT_AWARE_V2',
    metrics: metricsFor(v2Rows),
    displayMetrics: metricsFor(v2Rows),
    policyResults: [
      {
        identityPolicy: 'CONTEXT_AWARE_V2',
        experimentRevision: null,
        metrics: metricsFor(v2Rows),
        jobBreakdown: [],
        rows: v2Rows,
        wrongMatches: [
          {
            emailMessageId: 'e2',
            subject: 'e2',
            actualJobName: 'Job A',
            predictedJobName: 'Name job-b',
            resolvingMarker: 'NAME',
          },
        ],
      },
      {
        identityPolicy: 'CONTEXT_AWARE_V2_1',
        experimentRevision: 'r1',
        metrics: metricsFor(v21Rows),
        jobBreakdown: [],
        rows: v21Rows,
        wrongMatches: [],
      },
    ],
    jobBreakdown: [],
    rows: v2Rows,
    wrongMatches: [],
  }
  return base as unknown as JobMatcherEvalResult
}

const correction = {
  emailMessageId: 'e2',
  originalGroundTruthJobId: 'job-a',
  correctedGroundTruthJobId: 'job-b',
  verificationStatus: 'ACTIVE' as const,
}

describe('selectCorrectedPolicyView', () => {
  it('applies one correction consistently across policies without changing the denominator', () => {
    const r = result()
    const v2 = selectCorrectedPolicyView(r, 'CONTEXT_AWARE_V2', [correction])
    const v21 = selectCorrectedPolicyView(r, 'CONTEXT_AWARE_V2_1', [correction])
    expect(v2.available && v21.available).toBe(true)
    if (!v2.available || !v21.available) return

    expect(v2.rows).toHaveLength(3)
    expect(v21.rows).toHaveLength(3)
    expect(v2.metrics.totalEvaluated).toBe(3)
    expect(v21.metrics.totalEvaluated).toBe(3)

    // Predicting model flips WRONG → CORRECT.
    expect(v2.rawMetrics.wrongMatches).toBe(1)
    expect(v2.metrics.wrongMatches).toBe(0)
    expect(v2.metrics.correctMatches).toBe(2)
    expect(v2.wrongMatches).toEqual([])

    // Model that predicted the original GT flips CORRECT → WRONG.
    expect(v21.rawMetrics.correctMatches).toBe(2)
    expect(v21.metrics.correctMatches).toBe(1)
    expect(v21.metrics.wrongMatches).toBe(1)
    expect(v21.wrongMatches.map((w) => w.emailMessageId)).toEqual(['e2'])
    expect(v21.wrongMatches[0]!.actualJobName).toBe('job-b')

    // Both policies share the same effective GT for e2.
    const e2v2 = v2.rows.find((x) => x.emailMessageId === 'e2')!
    const e2v21 = v21.rows.find((x) => x.emailMessageId === 'e2')!
    expect(e2v2.trueJobId).toBe('job-b')
    expect(e2v21.trueJobId).toBe('job-b')
    expect(e2v2.originalTrueJobId).toBe('job-a')
    expect(e2v21.predictedJobId).toBe('job-a')

    // Ambiguous row is untouched.
    expect(v2.rows.find((x) => x.emailMessageId === 'e3')!.outcome).toBe('AMBIGUOUS')
    expect(v2.correctionCount).toBe(1)
  })

  it('useOriginalGroundTruth returns raw outcomes', () => {
    const r = result()
    const v = selectCorrectedPolicyView(r, 'CONTEXT_AWARE_V2', [correction], {
      useOriginalGroundTruth: true,
    })
    expect(v.available).toBe(true)
    if (!v.available) return
    expect(v.metrics).toEqual(v.rawMetrics)
    expect(v.correctionCount).toBe(0)
    expect(v.rows.find((x) => x.emailMessageId === 'e2')!.trueJobId).toBe('job-a')
  })

  it('reversed corrections do not apply; bundles stay consistent', () => {
    const r = result()
    const reversed = [{ ...correction, verificationStatus: 'REVERSED' as const }]
    const v = selectCorrectedPolicyView(r, 'CONTEXT_AWARE_V2', reversed)
    expect(v.available && v.metrics).toEqual(v.available && v.rawMetrics)

    const bundles = correctedPolicyBundles(r, [correction])
    const byPolicy = Object.fromEntries(
      bundles.map((b) => [b.identityPolicy, b.metrics])
    )
    expect(byPolicy.CONTEXT_AWARE_V2!.wrongMatches).toBe(0)
    expect(byPolicy.CONTEXT_AWARE_V2_1!.wrongMatches).toBe(1)
    expect(byPolicy.CONTEXT_AWARE_V2!.totalEvaluated).toBe(
      byPolicy.CONTEXT_AWARE_V2_1!.totalEvaluated
    )
  })
})

describe('markCorrectEligibility', () => {
  it('only MATCH predictions that disagree with GT are eligible', () => {
    const base = { trueJobId: 'job-a', groundTruthCorrected: false }
    expect(
      markCorrectEligibility({ ...base, decision: 'MATCH', predictedJobId: 'job-b' })
    ).toBe('eligible')
    expect(
      markCorrectEligibility({ ...base, decision: 'MATCH', predictedJobId: 'job-a' })
    ).toBe('already-correct')
    expect(
      markCorrectEligibility({
        ...base,
        groundTruthCorrected: true,
        decision: 'MATCH',
        predictedJobId: 'job-a',
      })
    ).toBe('verified')
    expect(
      markCorrectEligibility({ ...base, decision: 'AMBIGUOUS', predictedJobId: null })
    ).toBe('ineligible')
    expect(
      markCorrectEligibility({ ...base, decision: 'MATCH', predictedJobId: null })
    ).toBe('ineligible')
  })
})
