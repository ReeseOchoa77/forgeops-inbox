/**
 * Client-side application of run-specific Job Matcher evaluation exclusions.
 */
import {
  applyExclusionsToPolicyRows,
  type EvalOutcomeMetricsLite,
} from '@forgeops/shared/jobs/job-match-eval-exclusions'
import type {
  JobMatcherEvalPolicyResultBundle,
  JobMatcherEvalResult,
  JobMatcherEvalRow,
  JobMatcherIdentityPolicy,
} from './api'

type JobMatcherEvalJobBreakdown = JobMatcherEvalResult['jobBreakdown'][number]
import { selectPolicyView, type SelectedPolicyView } from './job-matcher-eval-policy-view'

export type JobMatcherEvalExclusion = {
  id: string
  evaluationRunId: string
  emailMessageId: string
  excludedByUserId: string | null
  reason: string | null
  createdAt: string
  updatedAt: string
}

export type AdjustedPolicyView = {
  identityPolicy: JobMatcherIdentityPolicy
  available: true
  /** Included rows used for adjusted metrics / default filters. */
  rows: JobMatcherEvalRow[]
  /** Excluded rows for the Excluded filter. */
  excludedRows: JobMatcherEvalRow[]
  rawMetrics: EvalOutcomeMetricsLite
  adjustedMetrics: EvalOutcomeMetricsLite
  metrics: EvalOutcomeMetricsLite
  jobBreakdown: JobMatcherEvalJobBreakdown[]
  diagnostics: JobMatcherEvalResult['diagnostics']
  wrongMatches: JobMatcherEvalResult['wrongMatches']
  excludedCount: number
  excludedEmailIds: string[]
}

function asBreakdown(
  lite: ReturnType<typeof applyExclusionsToPolicyRows>['jobBreakdown']
): JobMatcherEvalJobBreakdown[] {
  return lite.map((j) => ({
    jobId: j.jobId,
    jobName: j.jobName,
    jobNumber: j.jobNumber,
    jobStatus: null,
    evaluated: j.evaluated,
    correct: j.correct,
    wrong: j.wrong,
    ambiguous: j.ambiguous,
    conflict: j.conflict,
    noMatch: j.noMatch,
  }))
}

export function exclusionEmailIdSet(
  exclusions: ReadonlyArray<Pick<JobMatcherEvalExclusion, 'emailMessageId'>>
): Set<string> {
  return new Set(exclusions.map((e) => e.emailMessageId))
}

/**
 * Build adjusted metrics for the selected policy using run-scoped exclusions
 * (same email ids applied to every policy bundle).
 */
export function selectAdjustedPolicyView(
  result: JobMatcherEvalResult,
  selectedPolicy: JobMatcherIdentityPolicy | null,
  exclusions: ReadonlyArray<Pick<JobMatcherEvalExclusion, 'emailMessageId'>>
): AdjustedPolicyView | Extract<SelectedPolicyView, { available: false }> {
  const base = selectPolicyView(result, selectedPolicy)
  if (!base.available) return base

  const excludedIds = exclusionEmailIdSet(exclusions)
  const applied = applyExclusionsToPolicyRows({
    rows: base.rows,
    excludedEmailIds: excludedIds,
  })

  const wrongMatches = base.wrongMatches.filter(
    (w) => !excludedIds.has(w.emailMessageId)
  )

  return {
    identityPolicy: base.identityPolicy,
    available: true,
    rows: applied.includedRows,
    excludedRows: applied.excludedRows,
    rawMetrics: applied.rawMetrics,
    adjustedMetrics: applied.adjustedMetrics,
    metrics: applied.adjustedMetrics,
    jobBreakdown: asBreakdown(applied.jobBreakdown),
    diagnostics: base.diagnostics,
    wrongMatches,
    excludedCount: applied.excludedCount,
    excludedEmailIds: [...excludedIds],
  }
}

/** Raw metrics from the selected policy bundle (unadjusted). */
export function rawMetricsForPolicy(
  result: JobMatcherEvalResult,
  policy: JobMatcherIdentityPolicy | null
): EvalOutcomeMetricsLite | null {
  const view = selectPolicyView(result, policy)
  if (!view.available) return null
  return applyExclusionsToPolicyRows({
    rows: view.rows,
    excludedEmailIds: [],
  }).rawMetrics
}

export function annotateRowsWithExclusion(
  rows: ReadonlyArray<JobMatcherEvalRow>,
  excludedIds: ReadonlySet<string>
): Array<JobMatcherEvalRow & { excluded: boolean }> {
  return rows.map((r) => ({ ...r, excluded: excludedIds.has(r.emailMessageId) }))
}

/** All policy bundles with exclusions applied (for export integrity). */
export function adjustedPolicyBundles(
  result: JobMatcherEvalResult,
  exclusions: ReadonlyArray<Pick<JobMatcherEvalExclusion, 'emailMessageId'>>
): JobMatcherEvalPolicyResultBundle[] {
  const excludedIds = exclusionEmailIdSet(exclusions)
  const bundles =
    result.policyResults && result.policyResults.length > 0
      ? result.policyResults
      : [
          {
            identityPolicy:
              result.displayIdentityPolicy ??
              result.identityPolicy ??
              ('CONTEXT_AWARE_V2' as const),
            experimentRevision: result.experimentRevision ?? null,
            metrics: result.displayMetrics ?? result.metrics,
            diagnostics: result.diagnostics,
            jobBreakdown: result.jobBreakdown,
            rows: result.rows,
            wrongMatches: result.wrongMatches,
          },
        ]

  return bundles.map((bundle) => {
    const applied = applyExclusionsToPolicyRows({
      rows: bundle.rows,
      excludedEmailIds: excludedIds,
    })
    return {
      ...bundle,
      metrics: {
        ...bundle.metrics,
        ...applied.adjustedMetrics,
      },
      rows: applied.includedRows,
      jobBreakdown: asBreakdown(applied.jobBreakdown),
      wrongMatches: bundle.wrongMatches.filter(
        (w) => !excludedIds.has(w.emailMessageId)
      ),
    }
  })
}
