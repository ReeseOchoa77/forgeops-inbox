/**
 * Client-side export of a completed Job Matcher evaluation.
 * Never re-runs the matcher — serializes the viewed result only.
 * Standard CSV excludes email bodies.
 */
import type {
  JobMatcherEvalResult,
  JobMatcherEvalRow,
  JobMatcherIdentityCompareReport,
} from './api'

type ThreeWay = NonNullable<JobMatcherEvalResult['threeWayComparison']>

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function todayStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function jobMatcherEvalExportFilename(
  kind: 'summary' | 'detailed' | 'full' | 'comparison' | 'comparison-3way',
  ext: 'csv' | 'json'
): string {
  return `forgeops-job-matcher-evaluation-${kind}-${todayStamp()}.${ext}`
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function buildEvalSummaryCsv(result: JobMatcherEvalResult): string {
  const lines = ['section,metric,category,value']
  const push = (section: string, metric: string, category: string, value: string | number) => {
    lines.push([section, metric, category, value].map(csvEscape).join(','))
  }
  const m = result.metrics
  const d = result.diagnostics
  push('meta', 'summary_label', '', result.dataset.summaryLabel)
  push('meta', 'actual_evaluated', '', result.dataset.actualEvaluated)
  push('headline', 'evaluated', '', m.totalEvaluated)
  push('headline', 'correct', '', m.correctMatches)
  push('headline', 'wrong', '', m.wrongMatches)
  push('headline', 'ambiguous', '', m.ambiguous)
  push('headline', 'conflict', '', m.conflict)
  push('headline', 'no_match', '', m.noMatch)
  push('headline', 'precision', '', m.precision ?? '')
  push('headline', 'coverage', '', m.correctCoverage)
  push('headline', 'wrong_rate', '', m.wrongMatchRate)
  if (!d) return lines.join('\n')
  for (const row of d.wrongByFailureCategory) {
    push('wrong_by_failure_category', row.category, 'count', row.count)
    push('wrong_by_failure_category', row.category, 'pct', row.pct)
  }
  for (const row of d.markerPerformance) {
    push('marker_performance', row.marker, 'resolved', row.resolved)
    push('marker_performance', row.marker, 'correct', row.correct)
    push('marker_performance', row.marker, 'wrong', row.wrong)
    push('marker_performance', row.marker, 'precision', row.precision ?? '')
  }
  push('gt_survival', 'after_marker_1', 'pct', d.groundTruthSurvival.afterMarker1.pct)
  push('gt_survival', 'after_marker_2', 'pct', d.groundTruthSurvival.afterMarker2.pct)
  push('gt_survival', 'after_marker_3', 'pct', d.groundTruthSurvival.afterMarker3.pct)
  for (const row of d.firstGroundTruthLoss) {
    push('first_gt_loss', row.stage, 'count', row.count)
  }
  for (const row of d.commonConfusions) {
    push('common_confusions', `${row.actualJobName}->${row.predictedJobName}`, 'count', row.count)
  }
  return lines.join('\n')
}

export function buildEvalDetailedCsv(rows: JobMatcherEvalRow[]): string {
  const headers = [
    'email_message_id',
    'direction',
    'subject',
    'ground_truth_job_id',
    'ground_truth_job_number',
    'ground_truth_job_name',
    'ground_truth_assignment_source',
    'predicted_job_id',
    'predicted_job_number',
    'predicted_job_name',
    'decision',
    'outcome',
    'failure_category',
    'failure_subcategory',
    'resolving_marker',
    'contributing_markers',
    'resolving_evidence_type',
    'candidate_count_before_resolving_marker',
    'candidate_count_after_resolving_marker',
    'ground_truth_survived_marker_1',
    'ground_truth_survived_marker_2',
    'ground_truth_survived_marker_3',
    'first_ground_truth_loss_stage',
  ]
  const lines = [headers.join(',')]
  for (const row of rows) {
    const d = row.diagnostics
    lines.push(
      [
        row.emailMessageId,
        row.direction,
        row.subject,
        row.trueJobId,
        row.trueJobNumber,
        row.trueJobName,
        row.jobAssignmentSource,
        row.predictedJobId,
        row.predictedJobNumber,
        row.predictedJobName,
        row.decision,
        row.outcome,
        d?.failureCategory ?? '',
        d?.failureSubcategory ?? '',
        d?.resolvingMarker ?? row.resolvingMarker,
        (d?.contributingMarkers ?? []).join('|'),
        d?.resolvingEvidenceType ?? '',
        d?.candidateCountBeforeResolving ?? '',
        d?.candidateCountAfterResolving ?? '',
        d?.groundTruthSurvivedMarker1 ?? '',
        d?.groundTruthSurvivedMarker2 ?? '',
        d?.groundTruthSurvivedMarker3 ?? '',
        d?.firstGroundTruthLossStage ?? '',
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  return lines.join('\n')
}

/** Full JSON for offline analysis — strips nothing already on the result; no bodies. */
export function buildEvalFullJson(result: JobMatcherEvalResult): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      note: 'Completed evaluation export. Matcher was not re-run. Email bodies excluded.',
      evaluation: result,
    },
    null,
    2
  )
}

/** One row per email for baseline vs CONTEXT_AWARE_V1 paired comparison. */
export function buildEvalComparisonCsv(
  comparison: JobMatcherIdentityCompareReport
): string {
  const headers = [
    'email_message_id',
    'subject',
    'ground_truth_job_id',
    'ground_truth_job_name',
    'ground_truth_source',
    'baseline_decision',
    'baseline_predicted_job_id',
    'baseline_predicted_job_name',
    'baseline_outcome',
    'baseline_resolving_marker',
    'baseline_identity_evidence',
    'baseline_identity_reason',
    'v1_decision',
    'v1_predicted_job_id',
    'v1_predicted_job_name',
    'v1_outcome',
    'v1_resolving_marker',
    'v1_identity_evidence',
    'v1_abstention_reason',
    'transition',
    'ground_truth_review_flag',
  ]
  const lines = [headers.join(',')]
  for (const row of comparison.rows) {
    const bEvidence =
      row.baseline.identityDiagnostics?.matchedTerms?.join('|') ||
      row.baseline.evidence.map((e) => `${e.type}:${e.value}`).join('|')
    const vEvidence =
      row.proposed.identityDiagnostics?.matchedTerms?.join('|') ||
      row.proposed.evidence.map((e) => `${e.type}:${e.value}`).join('|')
    lines.push(
      [
        row.emailMessageId,
        row.subject,
        row.trueJobId,
        row.trueJobName,
        row.groundTruthSource,
        row.baseline.decision,
        row.baseline.predictedJobId,
        row.baseline.predictedJobName,
        row.baseline.outcome,
        row.baseline.resolvingMarker,
        bEvidence,
        row.baseline.identityDiagnostics?.reason ?? '',
        row.proposed.decision,
        row.proposed.predictedJobId,
        row.proposed.predictedJobName,
        row.proposed.outcome,
        row.proposed.resolvingMarker,
        vEvidence,
        row.proposed.identityDiagnostics?.resolutionAllowed === false
          ? row.proposed.identityDiagnostics.reason
          : '',
        row.transition,
        row.groundTruthReviewFlag,
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  return lines.join('\n')
}

/** Three-way BASELINE / V1 / V2 comparison CSV (one row per email). */
export function buildEvalThreeWayComparisonCsv(comparison: ThreeWay): string {
  const headers = [
    'email_message_id',
    'subject',
    'ground_truth_job_id',
    'ground_truth_job_name',
    'ground_truth_source',
    'baseline_decision',
    'baseline_outcome',
    'baseline_predicted_job',
    'baseline_resolving_marker',
    'v1_decision',
    'v1_outcome',
    'v1_predicted_job',
    'v1_resolving_marker',
    'v1_identity_reason',
    'v2_decision',
    'v2_outcome',
    'v2_predicted_job',
    'v2_resolving_marker',
    'v2_identity_reason',
    'v2_abstention_reason',
    'baseline_to_v1',
    'v1_to_v2',
    'ground_truth_review_flag',
  ]
  const lines = [headers.join(',')]
  for (const row of comparison.rows) {
    lines.push(
      [
        row.emailMessageId,
        row.subject,
        row.trueJobId,
        row.trueJobName,
        row.groundTruthSource,
        row.baseline.decision,
        row.baseline.outcome,
        row.baseline.predictedJobName,
        row.baseline.resolvingMarker,
        row.v1.decision,
        row.v1.outcome,
        row.v1.predictedJobName,
        row.v1.resolvingMarker,
        row.v1.identityDiagnostics?.reason ?? '',
        row.v2.decision,
        row.v2.outcome,
        row.v2.predictedJobName,
        row.v2.resolvingMarker,
        row.v2.identityDiagnostics?.reason ?? '',
        row.v2.identityDiagnostics?.resolutionAllowed === false
          ? row.v2.identityDiagnostics.reason
          : '',
        row.baselineToV1,
        row.v1ToV2,
        row.groundTruthReviewFlag,
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  return lines.join('\n')
}
