/**
 * Paired baseline vs CONTEXT_AWARE_V1 comparison helpers.
 * Both variants must evaluate the same email IDs against the same snapshot.
 */

import type { HistoricalEvalMetrics, HistoricalEvalOutcome } from "./job-match-historical-eval.js";
import {
  assertTransitionMetricsReconcile,
  attributePolicyChange,
  classifyDecisionTransition,
  classifyUnresolvedRecoverability,
  classifyWrongMatchFailure,
  emptyDecisionTransitionCounts,
  summarizeNewlyWrong,
  type DecisionTransitionKey,
  type NewlyWrongBreakdown,
  type PolicyChangeAttribution,
  type PolicyChangeReasonCode,
  type UnresolvedRecoverability,
  type WrongMatchFailureCategory,
} from "./job-match-decision-transitions.js";

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
  contactDiagnostics?: {
    reason: string;
    associationClass: string;
    authorityClass: string;
    resolutionAllowed: boolean;
    evidenceIndependentFromThread: boolean | null;
  } | null;
  markerCandidateCounts?: {
    name: number;
    contact: number;
    thread: number;
    final: number;
  } | null;
  gtInNameCandidates?: boolean | null;
  gtInFinalCandidates?: boolean | null;
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
  /** Granular CORRECT/WRONG/AMBIGUOUS/CONFLICT/NO_MATCH transition. */
  decisionTransition?: DecisionTransitionKey;
  changeAttribution?: PolicyChangeAttribution;
  wrongFailureCategory?: WrongMatchFailureCategory | null;
  unresolvedRecoverability?: UnresolvedRecoverability | null;
  /** Manual-review hint when proposed MATCH disagrees with label but may be more coherent. */
  groundTruthReviewFlag: boolean;
};

export type PolicyDiagnosticReport = {
  decisionTransitions: Record<DecisionTransitionKey, number>;
  newlyWrong: NewlyWrongBreakdown;
  changeReasonCounts: Partial<Record<PolicyChangeReasonCode, number>>;
  wrongFailureCategories: Partial<Record<WrongMatchFailureCategory, number>>;
  unresolvedRecoverability: Partial<Record<UnresolvedRecoverability, number>>;
  regressionEmailIds: string[];
  improvementEmailIds: string[];
  /** Present when transition matrix disagrees with baseline/proposed aggregates. */
  integrityError?: string | null;
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
  /** Granular decision matrix + newly-wrong / failure / recoverability breakdowns. */
  diagnostics?: PolicyDiagnosticReport;
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

export function enrichIdentityCompareRow(
  row: IdentityCompareRow
): IdentityCompareRow {
  const decisionTransition = classifyDecisionTransition({
    baselineOutcome: row.baseline.outcome,
    proposedOutcome: row.proposed.outcome,
  });
  const changeAttribution = attributePolicyChange({
    baseline: {
      decision: row.baseline.decision,
      outcome: row.baseline.outcome,
      predictedJobId: row.baseline.predictedJobId,
      resolvingMarker: row.baseline.resolvingMarker,
      identityStrength: row.baseline.identityDiagnostics?.identityStrength ?? null,
      identityReason: row.baseline.identityDiagnostics?.reason ?? null,
      strongIdentityAnchor:
        row.baseline.identityDiagnostics?.strongIdentityAnchor ?? null,
      contactReason: row.baseline.contactDiagnostics?.reason ?? null,
      nameCandidateCount: row.baseline.markerCandidateCounts?.name ?? null,
      contactCandidateCount: row.baseline.markerCandidateCounts?.contact ?? null,
      threadCandidateCount: row.baseline.markerCandidateCounts?.thread ?? null,
      finalCandidateCount: row.baseline.markerCandidateCounts?.final ?? null,
      gtInNameCandidates: row.baseline.gtInNameCandidates ?? null,
      gtInFinalCandidates: row.baseline.gtInFinalCandidates ?? null,
    },
    proposed: {
      decision: row.proposed.decision,
      outcome: row.proposed.outcome,
      predictedJobId: row.proposed.predictedJobId,
      resolvingMarker: row.proposed.resolvingMarker,
      identityStrength: row.proposed.identityDiagnostics?.identityStrength ?? null,
      identityReason: row.proposed.identityDiagnostics?.reason ?? null,
      strongIdentityAnchor:
        row.proposed.identityDiagnostics?.strongIdentityAnchor ?? null,
      contactReason: row.proposed.contactDiagnostics?.reason ?? null,
      nameCandidateCount: row.proposed.markerCandidateCounts?.name ?? null,
      contactCandidateCount: row.proposed.markerCandidateCounts?.contact ?? null,
      threadCandidateCount: row.proposed.markerCandidateCounts?.thread ?? null,
      finalCandidateCount: row.proposed.markerCandidateCounts?.final ?? null,
      gtInNameCandidates: row.proposed.gtInNameCandidates ?? null,
      gtInFinalCandidates: row.proposed.gtInFinalCandidates ?? null,
    },
    trueJobId: row.trueJobId,
  });

  const wrongFailureCategory =
    row.proposed.outcome === "WRONG_MATCH" ||
    row.baseline.outcome === "WRONG_MATCH"
      ? classifyWrongMatchFailure({
          resolvingMarker:
            row.proposed.outcome === "WRONG_MATCH"
              ? row.proposed.resolvingMarker
              : row.baseline.resolvingMarker,
          identityStrength:
            (row.proposed.outcome === "WRONG_MATCH"
              ? row.proposed.identityDiagnostics?.identityStrength
              : row.baseline.identityDiagnostics?.identityStrength) ?? null,
          identityReason:
            (row.proposed.outcome === "WRONG_MATCH"
              ? row.proposed.identityDiagnostics?.reason
              : row.baseline.identityDiagnostics?.reason) ?? null,
          contactReason:
            (row.proposed.outcome === "WRONG_MATCH"
              ? row.proposed.contactDiagnostics?.reason
              : row.baseline.contactDiagnostics?.reason) ?? null,
          gtInNameCandidates:
            (row.proposed.outcome === "WRONG_MATCH"
              ? row.proposed.gtInNameCandidates
              : row.baseline.gtInNameCandidates) ?? null,
          gtInFinalCandidates:
            (row.proposed.outcome === "WRONG_MATCH"
              ? row.proposed.gtInFinalCandidates
              : row.baseline.gtInFinalCandidates) ?? null,
          nameCandidateCount:
            (row.proposed.outcome === "WRONG_MATCH"
              ? row.proposed.markerCandidateCounts?.name
              : row.baseline.markerCandidateCounts?.name) ?? null,
          groundTruthReviewFlag: row.groundTruthReviewFlag,
        })
      : null;

  const unresolvedSide =
    row.baseline.outcome === "AMBIGUOUS" ||
    row.baseline.outcome === "CONFLICT" ||
    row.baseline.outcome === "NO_MATCH"
      ? row.baseline
      : row.proposed.outcome === "AMBIGUOUS" ||
          row.proposed.outcome === "CONFLICT" ||
          row.proposed.outcome === "NO_MATCH"
        ? row.proposed
        : null;
  const unresolvedRecoverability = unresolvedSide
    ? classifyUnresolvedRecoverability({
        outcome: unresolvedSide.outcome,
        gtInFinalCandidates: unresolvedSide.gtInFinalCandidates ?? null,
        gtInNameCandidates: unresolvedSide.gtInNameCandidates ?? null,
        finalCandidateCount: unresolvedSide.markerCandidateCounts?.final ?? null,
        strongIdentityAnchor:
          unresolvedSide.identityDiagnostics?.strongIdentityAnchor ?? null,
        contactReason: unresolvedSide.contactDiagnostics?.reason ?? null,
        identityReason: unresolvedSide.identityDiagnostics?.reason ?? null,
      })
    : null;

  return {
    ...row,
    decisionTransition,
    changeAttribution,
    wrongFailureCategory,
    unresolvedRecoverability,
  };
}

export function buildPolicyDiagnosticReport(
  rows: IdentityCompareRow[]
): PolicyDiagnosticReport {
  const decisionTransitions = emptyDecisionTransitionCounts();
  const changeReasonCounts: Partial<Record<PolicyChangeReasonCode, number>> =
    {};
  const wrongFailureCategories: Partial<
    Record<WrongMatchFailureCategory, number>
  > = {};
  const unresolvedRecoverability: Partial<
    Record<UnresolvedRecoverability, number>
  > = {};
  const regressionEmailIds: string[] = [];
  const improvementEmailIds: string[] = [];
  let wrongDifferentJob = 0;

  for (const raw of rows) {
    const row = raw.decisionTransition
      ? raw
      : enrichIdentityCompareRow(raw);
    const key = row.decisionTransition!;
    decisionTransitions[key] = (decisionTransitions[key] ?? 0) + 1;
    const reason = row.changeAttribution?.reason ?? "OTHER_DECISION_DELTA";
    changeReasonCounts[reason] = (changeReasonCounts[reason] ?? 0) + 1;
    if (row.wrongFailureCategory) {
      wrongFailureCategories[row.wrongFailureCategory] =
        (wrongFailureCategories[row.wrongFailureCategory] ?? 0) + 1;
    }
    if (
      row.baseline.outcome === "AMBIGUOUS" ||
      row.baseline.outcome === "CONFLICT" ||
      row.baseline.outcome === "NO_MATCH"
    ) {
      const rec =
        row.unresolvedRecoverability ??
        classifyUnresolvedRecoverability({
          outcome: row.baseline.outcome,
          gtInFinalCandidates: row.baseline.gtInFinalCandidates ?? null,
          gtInNameCandidates: row.baseline.gtInNameCandidates ?? null,
          finalCandidateCount: row.baseline.markerCandidateCounts?.final ?? null,
          strongIdentityAnchor:
            row.baseline.identityDiagnostics?.strongIdentityAnchor ?? null,
        });
      unresolvedRecoverability[rec] =
        (unresolvedRecoverability[rec] ?? 0) + 1;
    }
    if (row.transition === "WRONG_TO_WRONG_DIFFERENT_JOB") {
      wrongDifferentJob += 1;
    }
    if (
      row.transition === "CORRECT_TO_WRONG" ||
      row.transition === "CORRECT_TO_UNRESOLVED" ||
      row.transition === "UNRESOLVED_TO_WRONG"
    ) {
      regressionEmailIds.push(row.emailMessageId);
    }
    if (
      row.transition === "WRONG_TO_CORRECT" ||
      row.transition === "UNRESOLVED_TO_CORRECT" ||
      row.transition === "WRONG_TO_UNRESOLVED"
    ) {
      improvementEmailIds.push(row.emailMessageId);
    }
  }

  return {
    decisionTransitions,
    // Pass granular decision transitions only — do not pre-sum UNRESOLVED_TO_WRONG
    // or summarizeNewlyWrong will double-count AMBIGUOUS/CONFLICT/NO_MATCH → WRONG.
    newlyWrong: summarizeNewlyWrong({
      transitions: decisionTransitions,
      wrongDifferentJob,
    }),
    changeReasonCounts,
    wrongFailureCategories,
    unresolvedRecoverability,
    regressionEmailIds,
    improvementEmailIds,
  };
}

export function buildIdentityCompareReport(input: {
  baselinePolicy?: IdentityComparePolicyId;
  proposedPolicy?: IdentityComparePolicyId;
  baselineMetrics: HistoricalEvalMetrics;
  proposedMetrics: HistoricalEvalMetrics;
  rows: IdentityCompareRow[];
  runtimeMs: { baseline: number; proposed: number };
}): IdentityCompareReport & { diagnostics?: PolicyDiagnosticReport } {
  const enrichedRows = input.rows.map(enrichIdentityCompareRow);
  const transitions = emptyTransitionCounts();
  for (const row of enrichedRows) {
    transitions[row.transition] += 1;
  }
  const overheadRatio =
    input.runtimeMs.baseline <= 0
      ? null
      : input.runtimeMs.proposed / input.runtimeMs.baseline;

  const baselineSides = enrichedRows.map((r) => r.baseline);
  const proposedSides = enrichedRows.map((r) => r.proposed);
  const trueJobIds = enrichedRows.map((r) => r.trueJobId);
  const diagnostics = buildPolicyDiagnosticReport(enrichedRows);
  const transitionIntegrity = assertTransitionMetricsReconcile({
    transitions: diagnostics.decisionTransitions,
    baseline: input.baselineMetrics,
    proposed: input.proposedMetrics,
  });
  if (!transitionIntegrity.ok) {
    diagnostics.integrityError = transitionIntegrity.message;
  }

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
    rows: enrichedRows,
    baselineMarkerBreakdown: buildMarkerBreakdownFromSides(
      baselineSides,
      trueJobIds
    ),
    proposedMarkerBreakdown: buildMarkerBreakdownFromSides(
      proposedSides,
      trueJobIds
    ),
    safetyRegressions: {
      // Canonical: same source as diagnostics.newlyWrong (per-email compare rows).
      // Does NOT include WRONG→WRONG different Job (see newlyWrong.totalNewlyWrong).
      correctToWrong: diagnostics.newlyWrong.correctToWrong,
      unresolvedToWrong: diagnostics.newlyWrong.unresolvedToWrong,
    },
    coverageLoss: {
      correctToUnresolved: transitions.CORRECT_TO_UNRESOLVED,
    },
    runtimeMs: {
      baseline: input.runtimeMs.baseline,
      proposed: input.runtimeMs.proposed,
      overheadRatio,
    },
    diagnostics,
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
