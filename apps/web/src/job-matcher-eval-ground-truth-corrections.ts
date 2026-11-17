/**
 * Client-side application of verified ground-truth corrections to Job Matcher
 * evaluation results. Corrections change the effective true Job for every model
 * on that email; rows are never dropped (denominator unchanged).
 */
import {
  activeCorrectionsByEmail,
  applyGroundTruthCorrectionsToRows,
  type GroundTruthCorrectionApply,
} from '@forgeops/shared/jobs/job-match-eval-ground-truth-corrections'
import {
  buildJobBreakdownFromEvalRows,
  metricsFromOutcomeRows,
  type EvalOutcomeMetricsLite,
} from '@forgeops/shared/jobs/job-match-eval-exclusions'
import type {
  JobMatcherEvalGroundTruthCorrectionDto,
  JobMatcherEvalPolicyResultBundle,
  JobMatcherEvalResult,
  JobMatcherEvalRow,
  JobMatcherIdentityPolicy,
} from './api'
import { selectPolicyView, type SelectedPolicyView } from './job-matcher-eval-policy-view'

type JobMatcherEvalJobBreakdown = JobMatcherEvalResult['jobBreakdown'][number]
type AvailableBase = Extract<SelectedPolicyView, { available: true }>

export type JobMatcherEvalGroundTruthCorrection = JobMatcherEvalGroundTruthCorrectionDto

export type CorrectedPolicyView = {
  identityPolicy: JobMatcherIdentityPolicy
  available: true
  /** Every row for this policy (denominator never reduced). */
  rows: JobMatcherEvalRow[]
  /** Metrics from the original (uncorrected) labels. */
  rawMetrics: EvalOutcomeMetricsLite
  /** Metrics after applying ACTIVE corrections (== rawMetrics when none / original view). */
  correctedMetrics: EvalOutcomeMetricsLite
  /** Metrics to display (corrected unless useOriginalGroundTruth). */
  metrics: EvalOutcomeMetricsLite
  jobBreakdown: JobMatcherEvalJobBreakdown[]
  diagnostics: JobMatcherEvalResult['diagnostics']
  wrongMatches: JobMatcherEvalResult['wrongMatches']
  /** Number of rows in this policy with a correction applied to the displayed rows. */
  correctionCount: number
  correctedEmailIds: string[]
  usingOriginalGroundTruth: boolean
}

export type CorrectedViewOptions = {
  /** Show raw labels (no rewrite of trueJob* / outcome). */
  useOriginalGroundTruth?: boolean
}

export type MarkCorrectEligibility =
  /** This model's MATCH is already the verified GT. */
  | 'verified'
  /** MATCH prediction that disagrees with current GT — can be marked correct. */
  | 'eligible'
  /** MATCH prediction already equal to the current GT. */
  | 'already-correct'
  /** Ambiguous / Conflict / No Match / missing prediction. */
  | 'ineligible'

export function correctionEmailIdSet(
  corrections: ReadonlyArray<
    Pick<GroundTruthCorrectionApply, 'emailMessageId' | 'verificationStatus'>
  >
): Set<string> {
  return new Set(activeCorrectionsByEmail(corrections).keys())
}

function asBreakdown(
  lite: ReturnType<typeof buildJobBreakdownFromEvalRows>,
  base: JobMatcherEvalJobBreakdown[]
): JobMatcherEvalJobBreakdown[] {
  const statusById = new Map(base.map((j) => [j.jobId, j.jobStatus] as const))
  return lite.map((j) => ({
    jobId: j.jobId,
    jobName: j.jobName,
    jobNumber: j.jobNumber,
    jobStatus: statusById.get(j.jobId) ?? null,
    evaluated: j.evaluated,
    correct: j.correct,
    wrong: j.wrong,
    ambiguous: j.ambiguous,
    conflict: j.conflict,
    noMatch: j.noMatch,
  }))
}

function correctWrongMatches(
  base: JobMatcherEvalResult['wrongMatches'],
  rows: JobMatcherEvalRow[],
  correctedEmailIds: ReadonlySet<string>
): JobMatcherEvalResult['wrongMatches'] {
  if (correctedEmailIds.size === 0) return base
  const kept = base.filter((w) => !correctedEmailIds.has(w.emailMessageId))
  const added = rows
    .filter(
      (r) => correctedEmailIds.has(r.emailMessageId) && r.outcome === 'WRONG_MATCH'
    )
    .map((r) => ({
      emailMessageId: r.emailMessageId,
      subject: r.subject,
      actualJobName: r.trueJobName,
      predictedJobName: r.predictedJobName,
      resolvingMarker: r.resolvingMarker,
    }))
  return [...kept, ...added]
}

function buildView(
  base: AvailableBase,
  corrections: ReadonlyArray<GroundTruthCorrectionApply>,
  opts: CorrectedViewOptions | undefined
): CorrectedPolicyView {
  const rawMetrics = metricsFromOutcomeRows(base.rows)
  const useOriginal = opts?.useOriginalGroundTruth === true
  const effectiveCorrections = useOriginal ? [] : corrections
  const corrected = applyGroundTruthCorrectionsToRows(base.rows, effectiveCorrections)
  const correctedEmailIds = new Set(
    corrected.filter((r) => r.groundTruthCorrected).map((r) => r.emailMessageId)
  )
  const correctedMetrics = metricsFromOutcomeRows(corrected)
  const hasCorrections = correctedEmailIds.size > 0

  return {
    identityPolicy: base.identityPolicy,
    available: true,
    rows: corrected,
    rawMetrics,
    correctedMetrics,
    metrics: correctedMetrics,
    jobBreakdown: hasCorrections
      ? asBreakdown(buildJobBreakdownFromEvalRows(corrected), base.jobBreakdown)
      : base.jobBreakdown,
    diagnostics: base.diagnostics,
    wrongMatches: correctWrongMatches(base.wrongMatches, corrected, correctedEmailIds),
    correctionCount: correctedEmailIds.size,
    correctedEmailIds: [...correctedEmailIds],
    usingOriginalGroundTruth: useOriginal,
  }
}

/**
 * Selected policy view with ground-truth corrections applied (same email ids and
 * corrected true Job for every policy). Each row keeps its own prediction/decision.
 */
export function selectCorrectedPolicyView(
  result: JobMatcherEvalResult,
  selectedPolicy: JobMatcherIdentityPolicy | null,
  corrections: ReadonlyArray<GroundTruthCorrectionApply>,
  opts?: CorrectedViewOptions
): CorrectedPolicyView | Extract<SelectedPolicyView, { available: false }> {
  const base = selectPolicyView(result, selectedPolicy)
  if (!base.available) return base
  return buildView(base, corrections, opts)
}

/** All policy bundles with corrections applied (comparison deltas / export integrity). */
export function correctedPolicyBundles(
  result: JobMatcherEvalResult,
  corrections: ReadonlyArray<GroundTruthCorrectionApply>,
  opts?: CorrectedViewOptions
): JobMatcherEvalPolicyResultBundle[] {
  const bundles: JobMatcherEvalPolicyResultBundle[] =
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
    const view = buildView(
      {
        identityPolicy: bundle.identityPolicy,
        metrics: bundle.metrics,
        rows: bundle.rows,
        jobBreakdown: bundle.jobBreakdown,
        diagnostics: (bundle.diagnostics ?? result.diagnostics) as JobMatcherEvalResult['diagnostics'],
        wrongMatches: bundle.wrongMatches,
        available: true,
      },
      corrections,
      opts
    )
    return {
      ...bundle,
      metrics: { ...bundle.metrics, ...view.metrics },
      rows: view.rows,
      jobBreakdown: view.jobBreakdown,
      wrongMatches: view.wrongMatches,
    }
  })
}

/** Raw (uncorrected) metrics for the selected policy. */
export function rawMetricsForPolicy(
  result: JobMatcherEvalResult,
  policy: JobMatcherIdentityPolicy | null
): EvalOutcomeMetricsLite | null {
  const view = selectPolicyView(result, policy)
  if (!view.available) return null
  return metricsFromOutcomeRows(view.rows)
}

/** Whether the row's model prediction can be verified as the true Job. */
export function markCorrectEligibility(
  row: Pick<
    JobMatcherEvalRow,
    'decision' | 'predictedJobId' | 'trueJobId' | 'groundTruthCorrected'
  >
): MarkCorrectEligibility {
  if (row.decision !== 'MATCH' || !row.predictedJobId) return 'ineligible'
  if (row.predictedJobId === row.trueJobId) {
    return row.groundTruthCorrected ? 'verified' : 'already-correct'
  }
  return 'eligible'
}

/**
 * Build a temporary in-memory Mark Correct override (never persisted).
 */
export function optimisticCorrection(input: {
  row: JobMatcherEvalRow
  evaluationRunId: string
  originalGroundTruthJobId: string
  userId?: string | null
  sourceModelPolicy?: string | null
}): JobMatcherEvalGroundTruthCorrection {
  const now = new Date().toISOString()
  return {
    id: `temporary-${input.row.emailMessageId}`,
    emailMessageId: input.row.emailMessageId,
    originalGroundTruthJobId: input.originalGroundTruthJobId,
    correctedGroundTruthJobId: input.row.predictedJobId ?? '',
    correctedJobName: input.row.predictedJobName ?? null,
    correctedJobNumber: input.row.predictedJobNumber ?? null,
    verificationStatus: 'ACTIVE',
    verifiedAt: now,
    verifiedByUserId: input.userId ?? null,
    sourceEvaluationRunId: input.evaluationRunId,
    sourceModelPolicy: input.sourceModelPolicy ?? null,
    note: 'temporary-session-override',
    reversedAt: null,
    reversedByUserId: null,
    createdAt: now,
    updatedAt: now,
  }
}
