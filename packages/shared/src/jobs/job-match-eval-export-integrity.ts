/**
 * Export/dashboard integrity helpers for Job Matcher evaluation.
 * Aggregating exported row outcomes must reproduce displayed metrics exactly.
 */

import type { HistoricalEvalMetrics } from "./job-match-historical-eval.js";
import { assertDecisionCountsReconcile } from "./job-match-policy-registry.js";

export type EvalOutcomeRowLite = {
  outcome: string;
};

export type AggregatedOutcomeCounts = {
  totalEvaluated: number;
  correctMatches: number;
  wrongMatches: number;
  ambiguous: number;
  conflict: number;
  noMatch: number;
};

export function aggregateEvalOutcomeRows(
  rows: ReadonlyArray<EvalOutcomeRowLite>
): AggregatedOutcomeCounts {
  let correctMatches = 0;
  let wrongMatches = 0;
  let ambiguous = 0;
  let conflict = 0;
  let noMatch = 0;
  for (const row of rows) {
    switch (row.outcome) {
      case "CORRECT_MATCH":
        correctMatches += 1;
        break;
      case "WRONG_MATCH":
        wrongMatches += 1;
        break;
      case "AMBIGUOUS":
        ambiguous += 1;
        break;
      case "CONFLICT":
        conflict += 1;
        break;
      default:
        noMatch += 1;
        break;
    }
  }
  return {
    totalEvaluated: rows.length,
    correctMatches,
    wrongMatches,
    ambiguous,
    conflict,
    noMatch,
  };
}

export type ExportMetricsIntegrityResult =
  | { ok: true; counts: AggregatedOutcomeCounts }
  | {
      ok: false;
      counts: AggregatedOutcomeCounts;
      expected: AggregatedOutcomeCounts;
      message: string;
    };

/**
 * Verify exported/display rows reproduce the dashboard metrics for the same policy.
 */
export function assertExportRowsMatchMetrics(input: {
  rows: ReadonlyArray<EvalOutcomeRowLite>;
  metrics: Pick<
    HistoricalEvalMetrics,
    | "totalEvaluated"
    | "correctMatches"
    | "wrongMatches"
    | "ambiguous"
    | "conflict"
    | "noMatch"
  >;
  policyLabel?: string;
}): ExportMetricsIntegrityResult {
  const counts = aggregateEvalOutcomeRows(input.rows);
  const expected: AggregatedOutcomeCounts = {
    totalEvaluated: input.metrics.totalEvaluated,
    correctMatches: input.metrics.correctMatches,
    wrongMatches: input.metrics.wrongMatches,
    ambiguous: input.metrics.ambiguous,
    conflict: input.metrics.conflict,
    noMatch: input.metrics.noMatch,
  };
  const policy = input.policyLabel ?? "policy";
  if (!assertDecisionCountsReconcile(counts)) {
    return {
      ok: false,
      counts,
      expected,
      message: `Export integrity error (${policy}): row outcome counts do not sum to evaluated (${counts.totalEvaluated}).`,
    };
  }
  const mismatches: string[] = [];
  if (counts.totalEvaluated !== expected.totalEvaluated) {
    mismatches.push(
      `evaluated ${counts.totalEvaluated}≠${expected.totalEvaluated}`
    );
  }
  if (counts.correctMatches !== expected.correctMatches) {
    mismatches.push(
      `correct ${counts.correctMatches}≠${expected.correctMatches}`
    );
  }
  if (counts.wrongMatches !== expected.wrongMatches) {
    mismatches.push(`wrong ${counts.wrongMatches}≠${expected.wrongMatches}`);
  }
  if (counts.ambiguous !== expected.ambiguous) {
    mismatches.push(`ambiguous ${counts.ambiguous}≠${expected.ambiguous}`);
  }
  if (counts.conflict !== expected.conflict) {
    mismatches.push(`conflict ${counts.conflict}≠${expected.conflict}`);
  }
  if (counts.noMatch !== expected.noMatch) {
    mismatches.push(`noMatch ${counts.noMatch}≠${expected.noMatch}`);
  }
  if (mismatches.length > 0) {
    return {
      ok: false,
      counts,
      expected,
      message: `Export integrity error (${policy}): row aggregates disagree with dashboard metrics (${mismatches.join("; ")}). Refusing inconsistent export.`,
    };
  }
  return { ok: true, counts };
}
