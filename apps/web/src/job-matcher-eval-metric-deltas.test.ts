import { describe, expect, it } from 'vitest'
import type { EvalOutcomeMetricsLite } from '@forgeops/shared/jobs/job-match-eval-exclusions'
import {
  areMetricSetsComparable,
  computeAllMetricDeltas,
  computeMetricDelta,
  defaultDeltaBaseline,
  deltaTone,
  formatMetricDelta,
} from './job-matcher-eval-metric-deltas'

function metrics(
  partial: Partial<EvalOutcomeMetricsLite> &
    Pick<
      EvalOutcomeMetricsLite,
      'totalEvaluated' | 'correctMatches' | 'wrongMatches'
    >
): EvalOutcomeMetricsLite {
  const {
    totalEvaluated,
    correctMatches,
    wrongMatches,
    ambiguous = 0,
    conflict = 0,
    noMatch = 0,
  } = partial
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

describe('job-matcher-eval-metric-deltas', () => {
  it('1. two-model count and rate deltas', () => {
    const baseline = metrics({
      totalEvaluated: 100,
      correctMatches: 80,
      wrongMatches: 10,
      ambiguous: 5,
      conflict: 2,
      noMatch: 3,
    })
    const proposed = metrics({
      totalEvaluated: 100,
      correctMatches: 85,
      wrongMatches: 8,
      ambiguous: 4,
      conflict: 1,
      noMatch: 2,
    })
    const correct = computeMetricDelta({
      key: 'correctMatches',
      kind: 'count',
      direction: 'higherBetter',
      baseline,
      comparison: proposed,
      isBaseline: false,
    })
    expect(correct.delta).toBe(5)
    expect(correct.display).toBe('+5')
    expect(correct.tone).toBe('improve')

    const coverage = computeMetricDelta({
      key: 'correctCoverage',
      kind: 'rate',
      direction: 'higherBetter',
      baseline,
      comparison: proposed,
      isBaseline: false,
    })
    expect(coverage.delta).toBeCloseTo(0.05)
    expect(coverage.display).toBe('+5.00 pp')
  })

  it('2. three-or-more-model baseline defaults to production V2 when present', () => {
    expect(
      defaultDeltaBaseline([
        'CONTEXT_AWARE_V2_1',
        'CONTEXT_AWARE_V2',
        'CONTEXT_AWARE_V2_4',
      ])
    ).toBe('CONTEXT_AWARE_V2')
  })

  it('3. baseline falls back to first policy when V2 absent', () => {
    expect(
      defaultDeltaBaseline(['CONTEXT_AWARE_V2_3', 'CONTEXT_AWARE_V2_4'])
    ).toBe('CONTEXT_AWARE_V2_3')
  })

  it('4. positive/negative color semantics (tone)', () => {
    expect(deltaTone(5, 'higherBetter')).toBe('improve')
    expect(deltaTone(-5, 'higherBetter')).toBe('regress')
    expect(deltaTone(-3, 'lowerBetter')).toBe('improve')
    expect(deltaTone(3, 'lowerBetter')).toBe('regress')
    expect(deltaTone(0, 'higherBetter')).toBe('neutral')
  })

  it('5. percentage-point formatting', () => {
    expect(formatMetricDelta(0.023, 'rate', false)).toBe('+2.30 pp')
    expect(formatMetricDelta(-0.01, 'rate', false)).toBe('-1.00 pp')
  })

  it('6. JMPS point formatting', () => {
    expect(formatMetricDelta(1.01, 'jmps', false)).toBe('+1.01 pts')
    expect(formatMetricDelta(-0.5, 'jmps', false)).toBe('-0.50 pts')
  })

  it('7. exclusion-adjusted totals change deltas', () => {
    const rawBase = metrics({
      totalEvaluated: 100,
      correctMatches: 50,
      wrongMatches: 50,
    })
    const rawProp = metrics({
      totalEvaluated: 100,
      correctMatches: 60,
      wrongMatches: 40,
    })
    const adjBase = metrics({
      totalEvaluated: 90,
      correctMatches: 50,
      wrongMatches: 40,
    })
    const adjProp = metrics({
      totalEvaluated: 90,
      correctMatches: 55,
      wrongMatches: 35,
    })
    const rawDelta = computeMetricDelta({
      key: 'correctMatches',
      kind: 'count',
      direction: 'higherBetter',
      baseline: rawBase,
      comparison: rawProp,
      isBaseline: false,
    })
    const adjDelta = computeMetricDelta({
      key: 'correctMatches',
      kind: 'count',
      direction: 'higherBetter',
      baseline: adjBase,
      comparison: adjProp,
      isBaseline: false,
    })
    expect(rawDelta.delta).toBe(10)
    expect(adjDelta.delta).toBe(5)
  })

  it('8. non-comparable populations flagged', () => {
    const check = areMetricSetsComparable(
      {
        CONTEXT_AWARE_V2: metrics({
          totalEvaluated: 100,
          correctMatches: 80,
          wrongMatches: 10,
        }),
        CONTEXT_AWARE_V2_4: metrics({
          totalEvaluated: 80,
          correctMatches: 70,
          wrongMatches: 5,
        }),
      },
      ['CONTEXT_AWARE_V2', 'CONTEXT_AWARE_V2_4']
    )
    expect(check.comparable).toBe(false)
    expect(check.reason).toMatch(/Not directly comparable/)
  })

  it('baseline model displays Baseline label', () => {
    const m = metrics({
      totalEvaluated: 10,
      correctMatches: 8,
      wrongMatches: 1,
    })
    const d = computeMetricDelta({
      key: 'correctMatches',
      kind: 'count',
      direction: 'higherBetter',
      baseline: m,
      comparison: m,
      isBaseline: true,
    })
    expect(d.display).toBe('Baseline')
  })

  it('computeAllMetricDeltas returns all specs', () => {
    const baseline = metrics({
      totalEvaluated: 100,
      correctMatches: 80,
      wrongMatches: 10,
      ambiguous: 5,
      conflict: 2,
      noMatch: 3,
    })
    const proposed = metrics({
      totalEvaluated: 100,
      correctMatches: 82,
      wrongMatches: 9,
      ambiguous: 5,
      conflict: 2,
      noMatch: 2,
    })
    const all = computeAllMetricDeltas({
      baseline,
      comparison: proposed,
      isBaseline: false,
    })
    expect(all.length).toBeGreaterThanOrEqual(12)
    expect(all.find((d) => d.key === 'jmps')?.display).toMatch(/pts|—/)
  })
})
