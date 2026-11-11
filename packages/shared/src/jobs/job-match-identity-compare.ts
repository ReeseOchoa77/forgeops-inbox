/**
 * Paired baseline vs CONTEXT_AWARE_V1 comparison helpers.
 * Both variants must evaluate the same email IDs against the same snapshot.
 */

import type { HistoricalEvalMetrics, HistoricalEvalOutcome } from "./job-match-historical-eval.js";

export type MatcherDecisionBucket = "CORRECT" | "WRONG" | "UNRESOLVED";

export type MatcherTransitionCategory =
  | "WRONG_TO_CORRECT"
  | "WRONG_TO_UNRESOLVED"
  | "WRONG_TO_WRONG_SAME_JOB"
  | "WRONG_TO_WRONG_DIFFERENT_JOB"
  | "CORRECT_TO_CORRECT"
  | "CORRECT_TO_UNRESOLVED"
  | "CORRECT_TO_WRONG"
  | "UNRESOLVED_TO_CORRECT"
  | "UNRESOLVED_TO_WRONG"
  | "UNRESOLVED_TO_UNRESOLVED";

export type IdentityCompareSideSummary = {
  decision: string;
  outcome: HistoricalEvalOutcome;
  predictedJobId: string | null;
  predictedJobName: string | null;
  resolvingMarker: string | null;
  evidence: Array<{ type: string; value: string }>;
  identityDiagnostics: {
    identityStrength: string;
    matchedPhrase: string | null;
    matchedTerms: string[];
    weakTerms: string[];
    reason: string;
    resolutionAllowed: boolean;
    strongIdentityAnchor: boolean;
  } | null;
};

export type IdentityCompareRow = {
  emailMessageId: string;
  subject: string | null;
  trueJobId: string;
  trueJobName: string;
  groundTruthSource: string | null;
  baseline: IdentityCompareSideSummary;
  proposed: IdentityCompareSideSummary;
  transition: MatcherTransitionCategory;
  /** Manual-review hint when proposed MATCH disagrees with label but may be more coherent. */
  groundTruthReviewFlag: boolean;
};

export type IdentityCompareTransitionCounts = Record<
  MatcherTransitionCategory,
  number
>;

export type IdentityCompareMetricsDelta = {
  evaluated: number;
  correct: { baseline: number; proposed: number; delta: number };
  wrong: { baseline: number; proposed: number; delta: number };
  ambiguous: { baseline: number; proposed: number; delta: number };
  conflict: { baseline: number; proposed: number; delta: number };
  noMatch: { baseline: number; proposed: number; delta: number };
  precision: {
    baseline: number | null;
    proposed: number | null;
    delta: number | null;
  };
  correctCoverage: { baseline: number; proposed: number; delta: number };
  wrongMatchRate: { baseline: number; proposed: number; delta: number };
  ambiguityRate: { baseline: number; proposed: number; delta: number };
  conflictRate: { baseline: number; proposed: number; delta: number };
  noMatchRate: { baseline: number; proposed: number; delta: number };
};

export type IdentityCompareReport = {
  baselinePolicy: "BASELINE";
  proposedPolicy: "CONTEXT_AWARE_V1";
  baselineMetrics: HistoricalEvalMetrics;
  proposedMetrics: HistoricalEvalMetrics;
  metricsDelta: IdentityCompareMetricsDelta;
  transitions: IdentityCompareTransitionCounts;
  rows: IdentityCompareRow[];
  safetyRegressions: {
    correctToWrong: number;
    unresolvedToWrong: number;
  };
  coverageLoss: {
    correctToUnresolved: number;
  };
  runtimeMs: {
    baseline: number;
    proposed: number;
    overheadRatio: number | null;
  };
};

export function outcomeToDecisionBucket(
  outcome: HistoricalEvalOutcome
): MatcherDecisionBucket {
  if (outcome === "CORRECT_MATCH") return "CORRECT";
  if (outcome === "WRONG_MATCH") return "WRONG";
  return "UNRESOLVED";
}

export function classifyMatcherTransition(input: {
  baselineOutcome: HistoricalEvalOutcome;
  proposedOutcome: HistoricalEvalOutcome;
  baselinePredictedJobId: string | null;
  proposedPredictedJobId: string | null;
}): MatcherTransitionCategory {
  const from = outcomeToDecisionBucket(input.baselineOutcome);
  const to = outcomeToDecisionBucket(input.proposedOutcome);

  if (from === "WRONG" && to === "CORRECT") return "WRONG_TO_CORRECT";
  if (from === "WRONG" && to === "UNRESOLVED") return "WRONG_TO_UNRESOLVED";
  if (from === "WRONG" && to === "WRONG") {
    if (
      input.baselinePredictedJobId &&
      input.proposedPredictedJobId &&
      input.baselinePredictedJobId === input.proposedPredictedJobId
    ) {
      return "WRONG_TO_WRONG_SAME_JOB";
    }
    return "WRONG_TO_WRONG_DIFFERENT_JOB";
  }
  if (from === "CORRECT" && to === "CORRECT") return "CORRECT_TO_CORRECT";
  if (from === "CORRECT" && to === "UNRESOLVED") return "CORRECT_TO_UNRESOLVED";
  if (from === "CORRECT" && to === "WRONG") return "CORRECT_TO_WRONG";
  if (from === "UNRESOLVED" && to === "CORRECT") return "UNRESOLVED_TO_CORRECT";
  if (from === "UNRESOLVED" && to === "WRONG") return "UNRESOLVED_TO_WRONG";
  return "UNRESOLVED_TO_UNRESOLVED";
}

export function emptyTransitionCounts(): IdentityCompareTransitionCounts {
  return {
    WRONG_TO_CORRECT: 0,
    WRONG_TO_UNRESOLVED: 0,
    WRONG_TO_WRONG_SAME_JOB: 0,
    WRONG_TO_WRONG_DIFFERENT_JOB: 0,
    CORRECT_TO_CORRECT: 0,
    CORRECT_TO_UNRESOLVED: 0,
    CORRECT_TO_WRONG: 0,
    UNRESOLVED_TO_CORRECT: 0,
    UNRESOLVED_TO_WRONG: 0,
    UNRESOLVED_TO_UNRESOLVED: 0,
  };
}

export function assertTransitionsReconcile(
  transitions: IdentityCompareTransitionCounts,
  evaluated: number
): boolean {
  const sum = Object.values(transitions).reduce((a, b) => a + b, 0);
  return sum === evaluated;
}

function metricPair(
  baseline: number,
  proposed: number
): { baseline: number; proposed: number; delta: number } {
  return { baseline, proposed, delta: proposed - baseline };
}

export function buildIdentityCompareMetricsDelta(
  baseline: HistoricalEvalMetrics,
  proposed: HistoricalEvalMetrics
): IdentityCompareMetricsDelta {
  const precisionDelta =
    baseline.precision == null || proposed.precision == null
      ? null
      : proposed.precision - baseline.precision;
  return {
    evaluated: baseline.totalEvaluated,
    correct: metricPair(baseline.correctMatches, proposed.correctMatches),
    wrong: metricPair(baseline.wrongMatches, proposed.wrongMatches),
    ambiguous: metricPair(baseline.ambiguous, proposed.ambiguous),
    conflict: metricPair(baseline.conflict, proposed.conflict),
    noMatch: metricPair(baseline.noMatch, proposed.noMatch),
    precision: {
      baseline: baseline.precision,
      proposed: proposed.precision,
      delta: precisionDelta,
    },
    correctCoverage: metricPair(
      baseline.correctCoverage,
      proposed.correctCoverage
    ),
    wrongMatchRate: metricPair(
      baseline.wrongMatchRate,
      proposed.wrongMatchRate
    ),
    ambiguityRate: metricPair(baseline.ambiguityRate, proposed.ambiguityRate),
    conflictRate: metricPair(baseline.conflictRate, proposed.conflictRate),
    noMatchRate: metricPair(baseline.noMatchRate, proposed.noMatchRate),
  };
}

export function buildIdentityCompareReport(input: {
  baselineMetrics: HistoricalEvalMetrics;
  proposedMetrics: HistoricalEvalMetrics;
  rows: IdentityCompareRow[];
  runtimeMs: { baseline: number; proposed: number };
}): IdentityCompareReport {
  const transitions = emptyTransitionCounts();
  for (const row of input.rows) {
    transitions[row.transition] += 1;
  }
  const overheadRatio =
    input.runtimeMs.baseline <= 0
      ? null
      : input.runtimeMs.proposed / input.runtimeMs.baseline;

  return {
    baselinePolicy: "BASELINE",
    proposedPolicy: "CONTEXT_AWARE_V1",
    baselineMetrics: input.baselineMetrics,
    proposedMetrics: input.proposedMetrics,
    metricsDelta: buildIdentityCompareMetricsDelta(
      input.baselineMetrics,
      input.proposedMetrics
    ),
    transitions,
    rows: input.rows,
    safetyRegressions: {
      correctToWrong: transitions.CORRECT_TO_WRONG,
      unresolvedToWrong: transitions.UNRESOLVED_TO_WRONG,
    },
    coverageLoss: {
      correctToUnresolved: transitions.CORRECT_TO_UNRESOLVED,
    },
    runtimeMs: {
      baseline: input.runtimeMs.baseline,
      proposed: input.runtimeMs.proposed,
      overheadRatio,
    },
  };
}
