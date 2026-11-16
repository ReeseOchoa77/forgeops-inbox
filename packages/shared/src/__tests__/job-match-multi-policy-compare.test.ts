import { describe, expect, it } from "vitest";
import {
  buildIdentityMultiPolicyCompareReport,
  buildIdentityMultiPolicyCompareRow,
  normalizeEvalIdentityPolicies,
  pickCompareBaselinePolicy,
  rowMatchesMultiPolicyFilter,
} from "../jobs/job-match-multi-policy-compare.js";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
} from "../jobs/job-name-identity-policy.js";
import { listEvaluationSelectablePolicies } from "../jobs/job-match-policy-registry.js";
import type { HistoricalEvalMetrics } from "../jobs/job-match-historical-eval.js";
import type { IdentityCompareSideSummary } from "../jobs/job-match-identity-compare.js";

function metrics(partial: {
  correctMatches: number;
  wrongMatches: number;
}): HistoricalEvalMetrics {
  const ambiguous = 0;
  const conflict = 0;
  const noMatch = 0;
  const totalEvaluated =
    partial.correctMatches + partial.wrongMatches + ambiguous + conflict + noMatch;
  const decided = partial.correctMatches + partial.wrongMatches;
  return {
    totalEvaluated,
    correctMatches: partial.correctMatches,
    wrongMatches: partial.wrongMatches,
    ambiguous,
    conflict,
    noMatch,
    precision: decided === 0 ? null : partial.correctMatches / decided,
    correctCoverage: totalEvaluated === 0 ? 0 : partial.correctMatches / totalEvaluated,
    wrongMatchRate: totalEvaluated === 0 ? 0 : partial.wrongMatches / totalEvaluated,
    ambiguityRate: 0,
    conflictRate: 0,
    noMatchRate: 0,
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

describe("multi-policy compare", () => {
  it("normalizes and validates arbitrary policy subsets", () => {
    const two = normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    ]);
    expect(two).toEqual([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ]);
    expect(() => normalizeEvalIdentityPolicies(["NOT_A_POLICY"])).toThrow(
      /Invalid identity policy/
    );
  });

  it("builds dynamic comparison for V2 vs V2.2 only", () => {
    const policies = [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ] as const;
    const row = buildIdentityMultiPolicyCompareRow({
      emailMessageId: "e1",
      subject: "s",
      trueJobId: "j1",
      trueJobName: "Job",
      groundTruthSource: null,
      sides: [
        { policy: policies[0], summary: side("WRONG_MATCH", "j2") },
        { policy: policies[1], summary: side("CORRECT_MATCH", "j1") },
      ],
    });
    expect(row.policiesDisagree).toBe(true);
    const report = buildIdentityMultiPolicyCompareReport({
      policies: [...policies],
      metricsByPolicy: {
        [policies[0]]: metrics({ correctMatches: 10, wrongMatches: 2 }),
        [policies[1]]: metrics({ correctMatches: 12, wrongMatches: 0 }),
      },
      runtimeMsByPolicy: { [policies[0]]: 1, [policies[1]]: 2 },
      rows: [row],
    });
    expect(report.policies).toHaveLength(2);
    expect(report.baselinePolicy).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
    expect(report.performanceScores[policies[1]]).not.toBeNull();
  });

  it("supports three-model comparison and email filters", () => {
    const policies = [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ];
    const improved = buildIdentityMultiPolicyCompareRow({
      emailMessageId: "e1",
      subject: null,
      trueJobId: "j1",
      trueJobName: "Job",
      groundTruthSource: null,
      sides: [
        { policy: policies[0]!, summary: side("WRONG_MATCH", "j2") },
        { policy: policies[1]!, summary: side("CORRECT_MATCH", "j1") },
        { policy: policies[2]!, summary: side("WRONG_MATCH", "j2") },
      ],
    });
    expect(
      rowMatchesMultiPolicyFilter(
        improved,
        "EXPERIMENTAL_IMPROVED",
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
      )
    ).toBe(true);
    expect(
      rowMatchesMultiPolicyFilter(
        improved,
        "DISAGREE",
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
      )
    ).toBe(true);
  });

  it("defaults baseline to production when included", () => {
    expect(
      pickCompareBaselinePolicy([
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      ])
    ).toBe(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2);
  });

  it("exposes evaluation-selectable policies from the registry", () => {
    const selectable = listEvaluationSelectablePolicies();
    expect(selectable.every((e) => e.availableForEvaluation)).toBe(true);
    expect(selectable.map((e) => e.id)).toContain(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
    expect(selectable.map((e) => e.id)).toContain(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
    );
    expect(selectable.map((e) => e.id)).toContain(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2
    );
  });
});
