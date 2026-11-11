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

export type IdentityComparePolicyId =
  | "BASELINE"
  | "CONTEXT_AWARE_V1"
  | "CONTEXT_AWARE_V2"
  | "CONTEXT_AWARE_V2_1";

export type IdentityCompareMarkerBreakdown = {
  marker: "NAME" | "CONTACT" | "THREAD" | "NONE";
  resolved: number;
  correct: number;
  wrong: number;
  precision: number | null;
  shareOfWrong: number | null;
};

export type IdentityCompareReport = {
  baselinePolicy: IdentityComparePolicyId;
  proposedPolicy: IdentityComparePolicyId;
  baselineMetrics: HistoricalEvalMetrics;
  proposedMetrics: HistoricalEvalMetrics;
  metricsDelta: IdentityCompareMetricsDelta;
  transitions: IdentityCompareTransitionCounts;
  rows: IdentityCompareRow[];
  baselineMarkerBreakdown: IdentityCompareMarkerBreakdown[];
  proposedMarkerBreakdown: IdentityCompareMarkerBreakdown[];
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

/**
 * Multi-policy shadow evaluation: BASELINE + V1 + V2 (+ optional V2.1)
 * on the same snapshot.
 */
export type IdentityThreeWayCompareRow = {
  emailMessageId: string;
  subject: string | null;
  trueJobId: string;
  trueJobName: string;
  groundTruthSource: string | null;
  baseline: IdentityCompareSideSummary;
  v1: IdentityCompareSideSummary;
  v2: IdentityCompareSideSummary;
  v21?: IdentityCompareSideSummary | null;
  baselineToV1: MatcherTransitionCategory;
  v1ToV2: MatcherTransitionCategory;
  v2ToV21?: MatcherTransitionCategory | null;
  groundTruthReviewFlag: boolean;
};

export type IdentityThreeWayCompareReport = {
  policies:
    | ["BASELINE", "CONTEXT_AWARE_V1", "CONTEXT_AWARE_V2"]
    | ["BASELINE", "CONTEXT_AWARE_V1", "CONTEXT_AWARE_V2", "CONTEXT_AWARE_V2_1"];
  baselineMetrics: HistoricalEvalMetrics;
  v1Metrics: HistoricalEvalMetrics;
  v2Metrics: HistoricalEvalMetrics;
  v21Metrics?: HistoricalEvalMetrics | null;
  baselineToV1: IdentityCompareTransitionCounts;
  v1ToV2: IdentityCompareTransitionCounts;
  v2ToV21?: IdentityCompareTransitionCounts | null;
  markerBreakdown: {
    baseline: IdentityCompareMarkerBreakdown[];
    v1: IdentityCompareMarkerBreakdown[];
    v2: IdentityCompareMarkerBreakdown[];
    v21?: IdentityCompareMarkerBreakdown[];
  };
  rows: IdentityThreeWayCompareRow[];
  safetyRegressions: {
    v1ToV2CorrectToWrong: number;
    v1ToV2UnresolvedToWrong: number;
    v2ToV21CorrectToWrong?: number;
    v2ToV21UnresolvedToWrong?: number;
    v2ToV21WrongDifferentJob?: number;
  };
  coverageLoss: {
    v1ToV2CorrectToUnresolved: number;
    v2ToV21CorrectToUnresolved?: number;
  };
  runtimeMs: {
    baseline: number;
    v1: number;
    v2: number;
    v21?: number;
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

export function buildMarkerBreakdownFromSides(
  sides: IdentityCompareSideSummary[],
  trueJobIds: string[]
): IdentityCompareMarkerBreakdown[] {
  const markers: Array<"NAME" | "CONTACT" | "THREAD" | "NONE"> = [
    "NAME",
    "CONTACT",
    "THREAD",
    "NONE",
  ];
  const wrongTotal = sides.filter((s) => s.outcome === "WRONG_MATCH").length;
  return markers.map((marker) => {
    let resolved = 0;
    let correct = 0;
    let wrong = 0;
    for (let i = 0; i < sides.length; i += 1) {
      const side = sides[i]!;
      const resolving = (side.resolvingMarker ?? "NONE") as
        | "NAME"
        | "CONTACT"
        | "THREAD"
        | "NONE";
      if (side.outcome !== "CORRECT_MATCH" && side.outcome !== "WRONG_MATCH") {
        continue;
      }
      if (resolving !== marker) continue;
      resolved += 1;
      if (side.outcome === "CORRECT_MATCH" && side.predictedJobId === trueJobIds[i]) {
        correct += 1;
      } else if (side.outcome === "WRONG_MATCH") {
        wrong += 1;
      } else if (side.outcome === "CORRECT_MATCH") {
        correct += 1;
      }
    }
    return {
      marker,
      resolved,
      correct,
      wrong,
      precision: resolved === 0 ? null : correct / resolved,
      shareOfWrong: wrongTotal === 0 ? null : wrong / wrongTotal,
    };
  });
}

export function buildIdentityCompareReport(input: {
  baselinePolicy?: IdentityComparePolicyId;
  proposedPolicy?: IdentityComparePolicyId;
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

  const baselineSides = input.rows.map((r) => r.baseline);
  const proposedSides = input.rows.map((r) => r.proposed);
  const trueJobIds = input.rows.map((r) => r.trueJobId);

  return {
    baselinePolicy: input.baselinePolicy ?? "BASELINE",
    proposedPolicy: input.proposedPolicy ?? "CONTEXT_AWARE_V1",
    baselineMetrics: input.baselineMetrics,
    proposedMetrics: input.proposedMetrics,
    metricsDelta: buildIdentityCompareMetricsDelta(
      input.baselineMetrics,
      input.proposedMetrics
    ),
    transitions,
    rows: input.rows,
    baselineMarkerBreakdown: buildMarkerBreakdownFromSides(
      baselineSides,
      trueJobIds
    ),
    proposedMarkerBreakdown: buildMarkerBreakdownFromSides(
      proposedSides,
      trueJobIds
    ),
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

export function buildIdentityThreeWayCompareReport(input: {
  baselineMetrics: HistoricalEvalMetrics;
  v1Metrics: HistoricalEvalMetrics;
  v2Metrics: HistoricalEvalMetrics;
  v21Metrics?: HistoricalEvalMetrics | null;
  rows: IdentityThreeWayCompareRow[];
  runtimeMs: { baseline: number; v1: number; v2: number; v21?: number };
}): IdentityThreeWayCompareReport {
  const baselineToV1 = emptyTransitionCounts();
  const v1ToV2 = emptyTransitionCounts();
  const v2ToV21 = emptyTransitionCounts();
  let hasV21 = false;
  for (const row of input.rows) {
    baselineToV1[row.baselineToV1] += 1;
    v1ToV2[row.v1ToV2] += 1;
    if (row.v2ToV21) {
      hasV21 = true;
      v2ToV21[row.v2ToV21] += 1;
    }
  }
  const trueJobIds = input.rows.map((r) => r.trueJobId);
  const includeV21 = hasV21 || input.v21Metrics != null;
  return {
    policies: includeV21
      ? ["BASELINE", "CONTEXT_AWARE_V1", "CONTEXT_AWARE_V2", "CONTEXT_AWARE_V2_1"]
      : ["BASELINE", "CONTEXT_AWARE_V1", "CONTEXT_AWARE_V2"],
    baselineMetrics: input.baselineMetrics,
    v1Metrics: input.v1Metrics,
    v2Metrics: input.v2Metrics,
    ...(includeV21
      ? {
          v21Metrics: input.v21Metrics ?? null,
          v2ToV21,
        }
      : {}),
    baselineToV1,
    v1ToV2,
    markerBreakdown: {
      baseline: buildMarkerBreakdownFromSides(
        input.rows.map((r) => r.baseline),
        trueJobIds
      ),
      v1: buildMarkerBreakdownFromSides(
        input.rows.map((r) => r.v1),
        trueJobIds
      ),
      v2: buildMarkerBreakdownFromSides(
        input.rows.map((r) => r.v2),
        trueJobIds
      ),
      ...(includeV21
        ? {
            v21: buildMarkerBreakdownFromSides(
              input.rows
                .map((r) => r.v21)
                .filter((s): s is IdentityCompareSideSummary => s != null),
              trueJobIds
            ),
          }
        : {}),
    },
    rows: input.rows,
    safetyRegressions: {
      v1ToV2CorrectToWrong: v1ToV2.CORRECT_TO_WRONG,
      v1ToV2UnresolvedToWrong: v1ToV2.UNRESOLVED_TO_WRONG,
      ...(includeV21
        ? {
            v2ToV21CorrectToWrong: v2ToV21.CORRECT_TO_WRONG,
            v2ToV21UnresolvedToWrong: v2ToV21.UNRESOLVED_TO_WRONG,
            v2ToV21WrongDifferentJob: v2ToV21.WRONG_TO_WRONG_DIFFERENT_JOB,
          }
        : {}),
    },
    coverageLoss: {
      v1ToV2CorrectToUnresolved: v1ToV2.CORRECT_TO_UNRESOLVED,
      ...(includeV21
        ? { v2ToV21CorrectToUnresolved: v2ToV21.CORRECT_TO_UNRESOLVED }
        : {}),
    },
    runtimeMs: input.runtimeMs,
  };
}
