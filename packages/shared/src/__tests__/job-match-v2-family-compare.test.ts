import { describe, expect, it } from "vitest";
import {
  buildIdentityV2FamilyCompareReport,
  buildV2FamilyCompareRow,
} from "../jobs/job-match-v2-family-compare.js";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
} from "../jobs/job-name-identity-policy.js";
import { selectDisplayMetricsForEvaluation } from "../jobs/job-match-policy-registry.js";
import type { HistoricalEvalMetrics } from "../jobs/job-match-historical-eval.js";
import type { IdentityCompareSideSummary } from "../jobs/job-match-identity-compare.js";

function metrics(
  partial: Partial<HistoricalEvalMetrics> & {
    correctMatches: number;
    wrongMatches: number;
  }
): HistoricalEvalMetrics {
  const correctMatches = partial.correctMatches;
  const wrongMatches = partial.wrongMatches;
  const ambiguous = partial.ambiguous ?? 0;
  const conflict = partial.conflict ?? 0;
  const noMatch = partial.noMatch ?? 0;
  const totalEvaluated =
    partial.totalEvaluated ??
    correctMatches + wrongMatches + ambiguous + conflict + noMatch;
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

function side(
  outcome: IdentityCompareSideSummary["outcome"],
  predictedJobId: string | null = "j1"
): IdentityCompareSideSummary {
  return {
    decision: outcome === "CORRECT_MATCH" ? "MATCH" : "NO_MATCH",
    outcome,
    predictedJobId,
    predictedJobName: predictedJobId ? "Job" : null,
    resolvingMarker: null,
    evidence: [],
    identityDiagnostics: null,
  };
}

describe("V2 family Compare All", () => {
  it("includes V2, V2.1, and V2.2 with their own metrics and JMPS", () => {
    const v2Metrics = metrics({
      totalEvaluated: 2651,
      correctMatches: 2129,
      wrongMatches: 14,
      ambiguous: 475,
      conflict: 27,
      noMatch: 6,
    });
    const v21Metrics = metrics({
      correctMatches: 100,
      wrongMatches: 1,
      ambiguous: 10,
      conflict: 2,
      noMatch: 0,
    });
    const v22Metrics = metrics({
      correctMatches: 90,
      wrongMatches: 5,
      ambiguous: 10,
      conflict: 5,
      noMatch: 3,
    });
    const row = buildV2FamilyCompareRow({
      emailMessageId: "e1",
      subject: "sub",
      trueJobId: "j1",
      trueJobName: "Job",
      groundTruthSource: "USER_ASSIGNED",
      v2: side("CORRECT_MATCH", "j1"),
      v21: side("WRONG_MATCH", "j2"),
      v22: side("AMBIGUOUS", null),
    });
    expect(row.policiesDisagree).toBe(true);
    expect(row.groundTruthReviewFlag).toBe(true);

    const report = buildIdentityV2FamilyCompareReport({
      v2Metrics,
      v21Metrics,
      v22Metrics,
      rows: [row],
      runtimeMs: { v2: 1, v21: 2, v22: 3 },
    });
    expect(report.policies).toEqual([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ]);
    expect(report.v2Metrics.correctMatches).toBe(2129);
    expect(report.v21Metrics.correctMatches).toBe(100);
    expect(report.v22Metrics.correctMatches).toBe(90);
    expect(report.performanceScores.v2).toBeCloseTo(80.41, 2);
    expect(report.performanceScores.v21).not.toBeNull();
    expect(report.performanceScores.v22).not.toBeNull();
    expect(report.rows).toHaveLength(1);
  });

  it("handles missing family comparison safely in display selection", () => {
    const display = selectDisplayMetricsForEvaluation({
      primaryPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      primaryMetrics: metrics({ correctMatches: 10, wrongMatches: 0 }),
      comparison: null,
      threeWayComparison: null,
      v2FamilyComparison: null,
    });
    expect(display.policy).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
  });

  it("prefers production V2 metrics when V2 family compare is present", () => {
    const display = selectDisplayMetricsForEvaluation({
      primaryPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      primaryMetrics: metrics({ correctMatches: 2129, wrongMatches: 14 }),
      v2FamilyComparison: {
        v2Metrics: metrics({ correctMatches: 2129, wrongMatches: 14 }),
        v21Metrics: metrics({ correctMatches: 2200, wrongMatches: 5 }),
        v22Metrics: metrics({ correctMatches: 2000, wrongMatches: 20 }),
      },
    });
    expect(display.policy).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
    expect(display.metrics.correctMatches).toBe(2129);
  });

  it("email-level rows expose all three policy outcomes", () => {
    const row = buildV2FamilyCompareRow({
      emailMessageId: "e2",
      subject: null,
      trueJobId: "j1",
      trueJobName: "Job",
      groundTruthSource: null,
      v2: side("CORRECT_MATCH", "j1"),
      v21: side("CORRECT_MATCH", "j1"),
      v22: side("CORRECT_MATCH", "j1"),
    });
    expect(row.v2.outcome).toBe("CORRECT_MATCH");
    expect(row.v21.outcome).toBe("CORRECT_MATCH");
    expect(row.v22.outcome).toBe("CORRECT_MATCH");
    expect(row.policiesDisagree).toBe(false);
    expect(row.v2ToV21).toBe("CORRECT_TO_CORRECT");
    expect(row.v2ToV22).toBe("CORRECT_TO_CORRECT");
    expect(row.v21ToV22).toBe("CORRECT_TO_CORRECT");
  });
});
