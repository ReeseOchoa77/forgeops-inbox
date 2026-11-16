/**
 * Run-specific Job Matcher evaluation exclusions.
 * Filters scored rows and recomputes headline metrics without rematching.
 */

import {
  aggregateEvalOutcomeRows,
  type AggregatedOutcomeCounts,
} from "./job-match-eval-export-integrity.js";
import type { HistoricalEvalMetrics } from "./job-match-historical-eval.js";

export type EvalExclusionEmailId = string;

export type EvalOutcomeMetricsLite = Pick<
  HistoricalEvalMetrics,
  | "totalEvaluated"
  | "correctMatches"
  | "wrongMatches"
  | "ambiguous"
  | "conflict"
  | "noMatch"
  | "precision"
  | "correctCoverage"
  | "wrongMatchRate"
  | "ambiguityRate"
  | "conflictRate"
  | "noMatchRate"
>;

export type EvalRowForExclusion = {
  emailMessageId: string;
  outcome: string;
  trueJobId: string;
  trueJobName?: string;
  trueJobNumber?: string | null;
};

export type EvalJobBreakdownLite = {
  jobId: string;
  jobName: string;
  jobNumber: string | null;
  evaluated: number;
  correct: number;
  wrong: number;
  ambiguous: number;
  conflict: number;
  noMatch: number;
};

/** Headline rates from outcome counts (same formulas as aggregateHistoricalEvalResults). */
export function ratesFromOutcomeCounts(
  counts: AggregatedOutcomeCounts
): EvalOutcomeMetricsLite {
  const {
    totalEvaluated,
    correctMatches,
    wrongMatches,
    ambiguous,
    conflict,
    noMatch,
  } = counts;
  const decided = correctMatches + wrongMatches;
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
  };
}

export function metricsFromOutcomeRows(
  rows: ReadonlyArray<{ outcome: string }>
): EvalOutcomeMetricsLite {
  return ratesFromOutcomeCounts(aggregateEvalOutcomeRows(rows));
}

/** Merge headline outcome rates onto a full metrics object; preserve marker stats from base when provided. */
export function overlayOutcomeMetrics(
  base: HistoricalEvalMetrics | EvalOutcomeMetricsLite | null | undefined,
  overlay: EvalOutcomeMetricsLite
): EvalOutcomeMetricsLite & Partial<HistoricalEvalMetrics> {
  return {
    ...(base ?? {}),
    ...overlay,
  };
}

export function exclusionIdSet(
  excludedEmailIds: ReadonlyArray<EvalExclusionEmailId> | ReadonlySet<EvalExclusionEmailId>
): Set<string> {
  return excludedEmailIds instanceof Set
    ? new Set(excludedEmailIds)
    : new Set(excludedEmailIds);
}

export function filterRowsByExclusions<T extends { emailMessageId: string }>(
  rows: ReadonlyArray<T>,
  excludedEmailIds: ReadonlyArray<string> | ReadonlySet<string>
): { included: T[]; excluded: T[] } {
  const excluded = exclusionIdSet(excludedEmailIds);
  const included: T[] = [];
  const excludedRows: T[] = [];
  for (const row of rows) {
    if (excluded.has(row.emailMessageId)) excludedRows.push(row);
    else included.push(row);
  }
  return { included, excluded: excludedRows };
}

export function buildJobBreakdownFromEvalRows(
  rows: ReadonlyArray<EvalRowForExclusion>
): EvalJobBreakdownLite[] {
  const buckets = new Map<
    string,
    {
      jobName: string;
      jobNumber: string | null;
      evaluated: number;
      correct: number;
      wrong: number;
      ambiguous: number;
      conflict: number;
      noMatch: number;
    }
  >();

  for (const row of rows) {
    const b = buckets.get(row.trueJobId) ?? {
      jobName: row.trueJobName ?? row.trueJobId,
      jobNumber: row.trueJobNumber ?? null,
      evaluated: 0,
      correct: 0,
      wrong: 0,
      ambiguous: 0,
      conflict: 0,
      noMatch: 0,
    };
    b.evaluated += 1;
    switch (row.outcome) {
      case "CORRECT_MATCH":
        b.correct += 1;
        break;
      case "WRONG_MATCH":
        b.wrong += 1;
        break;
      case "AMBIGUOUS":
        b.ambiguous += 1;
        break;
      case "CONFLICT":
        b.conflict += 1;
        break;
      default:
        b.noMatch += 1;
        break;
    }
    buckets.set(row.trueJobId, b);
  }

  return [...buckets.entries()]
    .map(([jobId, b]) => ({
      jobId,
      jobName: b.jobName,
      jobNumber: b.jobNumber,
      evaluated: b.evaluated,
      correct: b.correct,
      wrong: b.wrong,
      ambiguous: b.ambiguous,
      conflict: b.conflict,
      noMatch: b.noMatch,
    }))
    .sort((a, b) => b.wrong - a.wrong || b.evaluated - a.evaluated);
}

export type AdjustedEvalPolicyView = {
  includedRows: Array<{ emailMessageId: string; outcome: string }>;
  excludedRows: Array<{ emailMessageId: string; outcome: string }>;
  rawMetrics: EvalOutcomeMetricsLite;
  adjustedMetrics: EvalOutcomeMetricsLite;
  excludedCount: number;
  jobBreakdown: EvalJobBreakdownLite[];
};

/**
 * Apply run-scoped exclusions to one policy's rows.
 * Raw metrics come from all rows; adjusted from included only.
 */
export function applyExclusionsToPolicyRows<
  T extends EvalRowForExclusion,
>(input: {
  rows: ReadonlyArray<T>;
  excludedEmailIds: ReadonlyArray<string> | ReadonlySet<string>;
}): AdjustedEvalPolicyView & { includedRows: T[]; excludedRows: T[] } {
  const rawMetrics = metricsFromOutcomeRows(input.rows);
  const { included, excluded } = filterRowsByExclusions(
    input.rows,
    input.excludedEmailIds
  );
  const adjustedMetrics = metricsFromOutcomeRows(included);
  return {
    includedRows: included,
    excludedRows: excluded,
    rawMetrics,
    adjustedMetrics,
    excludedCount: excluded.length,
    jobBreakdown: buildJobBreakdownFromEvalRows(included),
  };
}
