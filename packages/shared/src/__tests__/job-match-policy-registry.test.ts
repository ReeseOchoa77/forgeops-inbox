import { describe, expect, it } from "vitest";
import {
  assertDecisionCountsReconcile,
  getProductionJobMatchIdentityPolicy,
  JOB_MATCH_IDENTITY_POLICY_BASELINE,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  selectDisplayMetricsForEvaluation,
  selectMostAdvancedPolicy,
} from "../jobs/job-match-policy-registry.js";
import { DEFAULT_JOB_MATCH_IDENTITY_POLICY } from "../jobs/job-name-identity-policy.js";
import type { HistoricalEvalMetrics } from "../jobs/job-match-historical-eval.js";

function metrics(partial: Partial<HistoricalEvalMetrics>): HistoricalEvalMetrics {
  const totalEvaluated = partial.totalEvaluated ?? 1000;
  const correctMatches = partial.correctMatches ?? 0;
  const wrongMatches = partial.wrongMatches ?? 0;
  const ambiguous = partial.ambiguous ?? 0;
  const conflict = partial.conflict ?? 0;
  const noMatch = partial.noMatch ?? 0;
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
    marker1Resolutions: 0,
    marker2Resolutions: 0,
    marker3Resolutions: 0,
    marker2NarrowedUnresolved: 0,
    marker3NarrowedUnresolved: 0,
    conflictsEncountered: 0,
    noEvidence: 0,
    internalJobNumberEvidenceCount: 0,
    jobNumberMatchEmittedCount: 0,
    ...partial,
  };
}

describe("job-match-policy-registry", () => {
  it("production default is CONTEXT_AWARE_V2", () => {
    expect(getProductionJobMatchIdentityPolicy()).toBe(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
    expect(DEFAULT_JOB_MATCH_IDENTITY_POLICY).toBe(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
  });

  it("selects most advanced policy by registry rank", () => {
    expect(
      selectMostAdvancedPolicy([
        JOB_MATCH_IDENTITY_POLICY_BASELINE,
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
      ])
    ).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
    expect(
      selectMostAdvancedPolicy([
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      ])
    ).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1);
  });

  it("primary display metrics prefer V2 over BASELINE in V1→V2 compare", () => {
    const baseline = metrics({
      correctMatches: 824,
      wrongMatches: 80,
      ambiguous: 65,
      conflict: 29,
      noMatch: 2,
    });
    const v2 = metrics({
      correctMatches: 747,
      wrongMatches: 11,
      ambiguous: 188,
      conflict: 52,
      noMatch: 2,
    });
    const display = selectDisplayMetricsForEvaluation({
      primaryPolicy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
      primaryMetrics: baseline,
      comparison: {
        baselinePolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
        proposedPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
        baselineMetrics: metrics({ correctMatches: 818, wrongMatches: 45 }),
        proposedMetrics: v2,
      },
    });
    expect(display.policy).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
    expect(display.metrics.correctMatches).toBe(747);
    expect(display.metrics.wrongMatches).toBe(11);
    expect(display.metrics.precision).toBeCloseTo(747 / (747 + 11), 5);
    expect(assertDecisionCountsReconcile(display.metrics)).toBe(true);
  });

  it("prefers production V2 over V2.1 in multi-policy compare", () => {
    const display = selectDisplayMetricsForEvaluation({
      primaryPolicy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
      primaryMetrics: metrics({ correctMatches: 824, wrongMatches: 80 }),
      threeWayComparison: {
        baselineMetrics: metrics({ correctMatches: 824, wrongMatches: 80 }),
        v1Metrics: metrics({ correctMatches: 818, wrongMatches: 45 }),
        v2Metrics: metrics({ correctMatches: 747, wrongMatches: 11 }),
        v21Metrics: metrics({ correctMatches: 780, wrongMatches: 11 }),
      },
    });
    expect(display.policy).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
    expect(display.metrics.correctMatches).toBe(747);
  });

  it("shows single-policy V2.1 when that is the primary evaluation", () => {
    const v21 = metrics({
      correctMatches: 780,
      wrongMatches: 11,
      ambiguous: 100,
      conflict: 50,
      noMatch: 2,
    });
    const display = selectDisplayMetricsForEvaluation({
      primaryPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      primaryMetrics: v21,
    });
    expect(display.policy).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1);
    expect(display.metrics.correctMatches).toBe(780);
  });

  it("shows BASELINE when evaluation has only BASELINE results", () => {
    const baseline = metrics({
      correctMatches: 824,
      wrongMatches: 80,
      ambiguous: 65,
      conflict: 29,
      noMatch: 2,
    });
    const display = selectDisplayMetricsForEvaluation({
      primaryPolicy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
      primaryMetrics: baseline,
    });
    expect(display.policy).toBe(JOB_MATCH_IDENTITY_POLICY_BASELINE);
    expect(display.metrics.correctMatches).toBe(824);
  });

  it("ignores missing/incomplete comparison bundles", () => {
    const display = selectDisplayMetricsForEvaluation({
      primaryPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      primaryMetrics: metrics({ correctMatches: 100, wrongMatches: 0 }),
      comparison: null,
      threeWayComparison: null,
    });
    expect(display.policy).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
  });

  it("guards metric denominators and reconciles decision counts", () => {
    const empty = metrics({
      totalEvaluated: 0,
      correctMatches: 0,
      wrongMatches: 0,
      ambiguous: 0,
      conflict: 0,
      noMatch: 0,
    });
    expect(empty.precision).toBeNull();
    expect(assertDecisionCountsReconcile(empty)).toBe(true);
    expect(
      assertDecisionCountsReconcile(
        metrics({
          totalEvaluated: 10,
          correctMatches: 5,
          wrongMatches: 1,
          ambiguous: 2,
          conflict: 1,
          noMatch: 1,
        })
      )
    ).toBe(true);
    expect(
      assertDecisionCountsReconcile(
        metrics({
          totalEvaluated: 10,
          correctMatches: 5,
          wrongMatches: 1,
          ambiguous: 0,
          conflict: 0,
          noMatch: 0,
        })
      )
    ).toBe(false);
  });
});
