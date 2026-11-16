/**
 * Metric deltas for multi-model Job Matcher evaluation comparison UI.
 * Pure presentation helpers — does not change scoring formulas.
 */
import { computeJobMatcherPerformanceScore } from '@forgeops/shared/jobs/job-match-performance-score'
import { getProductionJobMatchIdentityPolicy } from '@forgeops/shared/jobs/job-match-policy-registry'
import type { EvalOutcomeMetricsLite } from '@forgeops/shared/jobs/job-match-eval-exclusions'
import type { JobMatcherIdentityPolicy } from './api'

export type MetricDeltaKind = 'count' | 'rate' | 'jmps'

export type MetricDeltaDirection = 'higherBetter' | 'lowerBetter'

export type MetricDeltaKey =
  | 'correctMatches'
  | 'wrongMatches'
  | 'ambiguous'
  | 'conflict'
  | 'noMatch'
  | 'precision'
  | 'correctCoverage'
  | 'wrongMatchRate'
  | 'ambiguityRate'
  | 'conflictRate'
  | 'noMatchRate'
  | 'jmps'

export type MetricDeltaSpec = {
  key: MetricDeltaKey
  label: string
  kind: MetricDeltaKind
  direction: MetricDeltaDirection
}

export const JOB_MATCHER_DELTA_METRICS: readonly MetricDeltaSpec[] = [
  { key: 'jmps', label: 'JMPS', kind: 'jmps', direction: 'higherBetter' },
  {
    key: 'correctMatches',
    label: 'Correct',
    kind: 'count',
    direction: 'higherBetter',
  },
  {
    key: 'wrongMatches',
    label: 'Wrong',
    kind: 'count',
    direction: 'lowerBetter',
  },
  {
    key: 'ambiguous',
    label: 'Ambiguous',
    kind: 'count',
    direction: 'lowerBetter',
  },
  {
    key: 'conflict',
    label: 'Conflict',
    kind: 'count',
    direction: 'lowerBetter',
  },
  {
    key: 'noMatch',
    label: 'No Match',
    kind: 'count',
    direction: 'lowerBetter',
  },
  {
    key: 'precision',
    label: 'Precision',
    kind: 'rate',
    direction: 'higherBetter',
  },
  {
    key: 'correctCoverage',
    label: 'Coverage',
    kind: 'rate',
    direction: 'higherBetter',
  },
  {
    key: 'wrongMatchRate',
    label: 'Wrong rate',
    kind: 'rate',
    direction: 'lowerBetter',
  },
  {
    key: 'ambiguityRate',
    label: 'Ambiguity rate',
    kind: 'rate',
    direction: 'lowerBetter',
  },
  {
    key: 'conflictRate',
    label: 'Conflict rate',
    kind: 'rate',
    direction: 'lowerBetter',
  },
  {
    key: 'noMatchRate',
    label: 'No-match rate',
    kind: 'rate',
    direction: 'lowerBetter',
  },
] as const

export type MetricDeltaTone = 'improve' | 'regress' | 'neutral'

export type ComputedMetricDelta = {
  key: MetricDeltaKey
  delta: number | null
  tone: MetricDeltaTone
  display: string
  isBaseline: boolean
}

/** Default baseline: production V2 if present, else first selected policy. */
export function defaultDeltaBaseline(
  policies: readonly JobMatcherIdentityPolicy[]
): JobMatcherIdentityPolicy | null {
  if (policies.length === 0) return null
  const prod = getProductionJobMatchIdentityPolicy()
  if (policies.includes(prod)) return prod
  return policies[0] ?? null
}

function jmpsValue(m: EvalOutcomeMetricsLite | null | undefined): number | null {
  if (!m || m.totalEvaluated <= 0) return null
  return computeJobMatcherPerformanceScore(m).score
}

function metricValue(
  metrics: EvalOutcomeMetricsLite | null | undefined,
  key: MetricDeltaKey
): number | null {
  if (!metrics) return null
  if (key === 'jmps') return jmpsValue(metrics)
  const v = metrics[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function deltaTone(
  delta: number,
  direction: MetricDeltaDirection
): MetricDeltaTone {
  if (Math.abs(delta) < 1e-12) return 'neutral'
  const improved =
    direction === 'higherBetter' ? delta > 0 : delta < 0
  return improved ? 'improve' : 'regress'
}

export function formatMetricDelta(
  delta: number | null,
  kind: MetricDeltaKind,
  isBaseline: boolean
): string {
  if (isBaseline) return 'Baseline'
  if (delta == null) return '—'
  if (Math.abs(delta) < 1e-12) return '0'
  const sign = delta > 0 ? '+' : ''
  if (kind === 'count') {
    return `${sign}${Math.round(delta).toLocaleString()}`
  }
  if (kind === 'rate') {
    // Percentage points (pp), not relative %.
    return `${sign}${(delta * 100).toFixed(2)} pp`
  }
  // JMPS score points
  return `${sign}${delta.toFixed(2)} pts`
}

export function computeMetricDelta(input: {
  key: MetricDeltaKey
  kind: MetricDeltaKind
  direction: MetricDeltaDirection
  baseline: EvalOutcomeMetricsLite | null | undefined
  comparison: EvalOutcomeMetricsLite | null | undefined
  isBaseline: boolean
}): ComputedMetricDelta {
  if (input.isBaseline) {
    return {
      key: input.key,
      delta: 0,
      tone: 'neutral',
      display: 'Baseline',
      isBaseline: true,
    }
  }
  const base = metricValue(input.baseline, input.key)
  const comp = metricValue(input.comparison, input.key)
  if (base == null || comp == null) {
    return {
      key: input.key,
      delta: null,
      tone: 'neutral',
      display: '—',
      isBaseline: false,
    }
  }
  const delta = comp - base
  return {
    key: input.key,
    delta,
    tone: deltaTone(delta, input.direction),
    display: formatMetricDelta(delta, input.kind, false),
    isBaseline: false,
  }
}

export function computeAllMetricDeltas(input: {
  baseline: EvalOutcomeMetricsLite | null | undefined
  comparison: EvalOutcomeMetricsLite | null | undefined
  isBaseline: boolean
}): ComputedMetricDelta[] {
  return JOB_MATCHER_DELTA_METRICS.map((spec) =>
    computeMetricDelta({
      key: spec.key,
      kind: spec.kind,
      direction: spec.direction,
      baseline: input.baseline,
      comparison: input.comparison,
      isBaseline: input.isBaseline,
    })
  )
}

/**
 * Comparable when every policy has the same evaluated population size.
 * Uses raw totals when provided; otherwise adjusted totals must agree.
 */
export function areMetricSetsComparable(
  metricsByPolicy: Readonly<
    Partial<Record<JobMatcherIdentityPolicy, EvalOutcomeMetricsLite | null | undefined>>
  >,
  policies: readonly JobMatcherIdentityPolicy[]
): { comparable: boolean; reason: string | null } {
  const totals: number[] = []
  for (const p of policies) {
    const m = metricsByPolicy[p]
    if (!m) {
      return {
        comparable: false,
        reason: 'Not directly comparable — missing metrics for a selected model.',
      }
    }
    totals.push(m.totalEvaluated)
  }
  if (totals.length < 2) {
    return { comparable: false, reason: null }
  }
  const first = totals[0]!
  if (totals.some((t) => t !== first)) {
    return {
      comparable: false,
      reason:
        'Not directly comparable — evaluated email counts differ across models.',
    }
  }
  return { comparable: true, reason: null }
}

export function deltaToneColor(tone: MetricDeltaTone): string {
  if (tone === 'improve') return '#166534'
  if (tone === 'regress') return '#991b1b'
  return '#6b7280'
}

export function deltaArrow(_tone: MetricDeltaTone, delta: number | null): string {
  if (delta == null || Math.abs(delta) < 1e-12) return '→'
  return delta > 0 ? '↑' : '↓'
}
