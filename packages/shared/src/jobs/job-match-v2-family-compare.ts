/**
 * V2-family three-policy comparison: CONTEXT_AWARE_V2 / V2.1 / V2.2
 * on the same emails / snapshot / exclusion set.
 */
import type { HistoricalEvalMetrics } from "./job-match-historical-eval.js";
import {
  assertTransitionsReconcile,
  classifyMatcherTransition,
  emptyTransitionCounts,
  type IdentityCompareSideSummary,
  type IdentityCompareTransitionCounts,
  type MatcherTransitionCategory,
} from "./job-match-identity-compare.js";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
} from "./job-name-identity-policy.js";
import { computeJobMatcherPerformanceScore } from "./job-match-performance-score.js";

export type IdentityV2FamilyCompareRow = {
  emailMessageId: string;
  subject: string | null;
  trueJobId: string;
  trueJobName: string;
  groundTruthSource: string | null;
  v2: IdentityCompareSideSummary;
  v21: IdentityCompareSideSummary;
  v22: IdentityCompareSideSummary;
  v2ToV21: MatcherTransitionCategory;
  v2ToV22: MatcherTransitionCategory;
  v21ToV22: MatcherTransitionCategory;
  /** True when any policy disagrees with another on predicted Job or outcome. */
  policiesDisagree: boolean;
  groundTruthReviewFlag: boolean;
};

export type IdentityV2FamilyCompareReport = {
  policies: [
    typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  ];
  v2Metrics: HistoricalEvalMetrics;
  v21Metrics: HistoricalEvalMetrics;
  v22Metrics: HistoricalEvalMetrics;
  v2ToV21: IdentityCompareTransitionCounts;
  v2ToV22: IdentityCompareTransitionCounts;
  v21ToV22: IdentityCompareTransitionCounts;
  rows: IdentityV2FamilyCompareRow[];
  runtimeMs: {
    v2: number;
    v21: number;
    v22: number;
  };
  performanceScores: {
    v2: number | null;
    v21: number | null;
    v22: number | null;
  };
};

function sidesDisagree(
  a: IdentityCompareSideSummary,
  b: IdentityCompareSideSummary
): boolean {
  return (
    a.outcome !== b.outcome ||
    (a.predictedJobId ?? null) !== (b.predictedJobId ?? null)
  );
}

export function buildIdentityV2FamilyCompareReport(input: {
  v2Metrics: HistoricalEvalMetrics;
  v21Metrics: HistoricalEvalMetrics;
  v22Metrics: HistoricalEvalMetrics;
  rows: IdentityV2FamilyCompareRow[];
  runtimeMs: { v2: number; v21: number; v22: number };
}): IdentityV2FamilyCompareReport {
  const v2ToV21 = emptyTransitionCounts();
  const v2ToV22 = emptyTransitionCounts();
  const v21ToV22 = emptyTransitionCounts();
  for (const row of input.rows) {
    v2ToV21[row.v2ToV21] += 1;
    v2ToV22[row.v2ToV22] += 1;
    v21ToV22[row.v21ToV22] += 1;
  }
  if (
    !assertTransitionsReconcile(v2ToV21, input.rows.length) ||
    !assertTransitionsReconcile(v2ToV22, input.rows.length) ||
    !assertTransitionsReconcile(v21ToV22, input.rows.length)
  ) {
    throw new Error(
      `V2-family transition counts do not equal evaluated (${input.rows.length})`
    );
  }
  return {
    policies: [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ],
    v2Metrics: input.v2Metrics,
    v21Metrics: input.v21Metrics,
    v22Metrics: input.v22Metrics,
    v2ToV21,
    v2ToV22,
    v21ToV22,
    rows: input.rows,
    runtimeMs: input.runtimeMs,
    performanceScores: {
      v2: computeJobMatcherPerformanceScore(input.v2Metrics).score,
      v21: computeJobMatcherPerformanceScore(input.v21Metrics).score,
      v22: computeJobMatcherPerformanceScore(input.v22Metrics).score,
    },
  };
}

export function buildV2FamilyCompareRow(input: {
  emailMessageId: string;
  subject: string | null;
  trueJobId: string;
  trueJobName: string;
  groundTruthSource: string | null;
  v2: IdentityCompareSideSummary;
  v21: IdentityCompareSideSummary;
  v22: IdentityCompareSideSummary;
}): IdentityV2FamilyCompareRow {
  const v2ToV21 = classifyMatcherTransition({
    baselineOutcome: input.v2.outcome,
    proposedOutcome: input.v21.outcome,
    baselinePredictedJobId: input.v2.predictedJobId,
    proposedPredictedJobId: input.v21.predictedJobId,
  });
  const v2ToV22 = classifyMatcherTransition({
    baselineOutcome: input.v2.outcome,
    proposedOutcome: input.v22.outcome,
    baselinePredictedJobId: input.v2.predictedJobId,
    proposedPredictedJobId: input.v22.predictedJobId,
  });
  const v21ToV22 = classifyMatcherTransition({
    baselineOutcome: input.v21.outcome,
    proposedOutcome: input.v22.outcome,
    baselinePredictedJobId: input.v21.predictedJobId,
    proposedPredictedJobId: input.v22.predictedJobId,
  });
  return {
    ...input,
    v2ToV21,
    v2ToV22,
    v21ToV22,
    policiesDisagree:
      sidesDisagree(input.v2, input.v21) ||
      sidesDisagree(input.v2, input.v22) ||
      sidesDisagree(input.v21, input.v22),
    groundTruthReviewFlag:
      input.v2.outcome === "WRONG_MATCH" ||
      input.v21.outcome === "WRONG_MATCH" ||
      input.v22.outcome === "WRONG_MATCH",
  };
}
