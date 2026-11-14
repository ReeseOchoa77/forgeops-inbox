import { describe, expect, it } from "vitest";
import {
  aggregateEvalOutcomeRows,
  assertExportRowsMatchMetrics,
} from "../jobs/job-match-eval-export-integrity.js";
import {
  assertTransitionMetricsReconcile,
  summarizeNewlyWrong,
} from "../jobs/job-match-decision-transitions.js";
import {
  buildIdentityCompareReport,
  classifyMatcherTransition,
} from "../jobs/job-match-identity-compare.js";
import type { HistoricalEvalMetrics } from "../jobs/job-match-historical-eval.js";

function metrics(
  partial: Partial<HistoricalEvalMetrics> & {
    totalEvaluated: number;
    correctMatches: number;
    wrongMatches: number;
    ambiguous: number;
    conflict: number;
    noMatch: number;
  }
): HistoricalEvalMetrics {
  const decided = partial.correctMatches + partial.wrongMatches;
  return {
    precision: decided === 0 ? null : partial.correctMatches / decided,
    correctCoverage:
      partial.totalEvaluated === 0
        ? 0
        : partial.correctMatches / partial.totalEvaluated,
    wrongMatchRate:
      partial.totalEvaluated === 0
        ? 0
        : partial.wrongMatches / partial.totalEvaluated,
    ambiguityRate:
      partial.totalEvaluated === 0
        ? 0
        : partial.ambiguous / partial.totalEvaluated,
    conflictRate:
      partial.totalEvaluated === 0
        ? 0
        : partial.conflict / partial.totalEvaluated,
    noMatchRate:
      partial.totalEvaluated === 0
        ? 0
        : partial.noMatch / partial.totalEvaluated,
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

describe("export/dashboard integrity", () => {
  it("aggregating row outcomes reproduces dashboard metrics", () => {
    const rows = [
      { outcome: "CORRECT_MATCH" },
      { outcome: "CORRECT_MATCH" },
      { outcome: "WRONG_MATCH" },
      { outcome: "AMBIGUOUS" },
      { outcome: "CONFLICT" },
      { outcome: "NO_MATCH" },
    ];
    const counts = aggregateEvalOutcomeRows(rows);
    expect(counts).toEqual({
      totalEvaluated: 6,
      correctMatches: 2,
      wrongMatches: 1,
      ambiguous: 1,
      conflict: 1,
      noMatch: 1,
    });
    const ok = assertExportRowsMatchMetrics({
      rows,
      metrics: metrics({
        totalEvaluated: 6,
        correctMatches: 2,
        wrongMatches: 1,
        ambiguous: 1,
        conflict: 1,
        noMatch: 1,
      }),
      policyLabel: "CONTEXT_AWARE_V2_1",
    });
    expect(ok.ok).toBe(true);
  });

  it("refuses export when rows are BASELINE but metrics are V2.1", () => {
    // Simulates the bug: filename/dashboard V2.1 (1886/24/...) vs BASELINE rows.
    const baselineLikeRows = [
      ...Array.from({ length: 2106 }, () => ({ outcome: "CORRECT_MATCH" })),
      ...Array.from({ length: 171 }, () => ({ outcome: "WRONG_MATCH" })),
      ...Array.from({ length: 137 }, () => ({ outcome: "AMBIGUOUS" })),
      ...Array.from({ length: 56 }, () => ({ outcome: "CONFLICT" })),
      ...Array.from({ length: 4 }, () => ({ outcome: "NO_MATCH" })),
    ];
    const v21Metrics = metrics({
      totalEvaluated: 2474,
      correctMatches: 1886,
      wrongMatches: 24,
      ambiguous: 397,
      conflict: 163,
      noMatch: 4,
    });
    const bad = assertExportRowsMatchMetrics({
      rows: baselineLikeRows,
      metrics: v21Metrics,
      policyLabel: "CONTEXT_AWARE_V2_1",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toMatch(/Export integrity error/);
      expect(bad.message).toMatch(/correct/);
    }
  });

  it("newly wrong total equals CORRECT→WRONG + unresolved→WRONG + WRONG different Job", () => {
    const rows = [
      {
        emailMessageId: "e1",
        subject: null,
        trueJobId: "j1",
        trueJobName: "J1",
        groundTruthSource: null,
        baseline: {
          decision: "MATCH",
          outcome: "CORRECT_MATCH" as const,
          predictedJobId: "j1",
          predictedJobName: "J1",
          resolvingMarker: "NAME",
          evidence: [],
          identityDiagnostics: null,
        },
        proposed: {
          decision: "MATCH",
          outcome: "WRONG_MATCH" as const,
          predictedJobId: "jx",
          predictedJobName: "X",
          resolvingMarker: "NAME",
          evidence: [],
          identityDiagnostics: null,
        },
        transition: classifyMatcherTransition({
          baselineOutcome: "CORRECT_MATCH",
          proposedOutcome: "WRONG_MATCH",
          baselinePredictedJobId: "j1",
          proposedPredictedJobId: "jx",
        }),
        groundTruthReviewFlag: false,
      },
      {
        emailMessageId: "e2",
        subject: null,
        trueJobId: "j2",
        trueJobName: "J2",
        groundTruthSource: null,
        baseline: {
          decision: "AMBIGUOUS",
          outcome: "AMBIGUOUS" as const,
          predictedJobId: null,
          predictedJobName: null,
          resolvingMarker: null,
          evidence: [],
          identityDiagnostics: null,
        },
        proposed: {
          decision: "MATCH",
          outcome: "WRONG_MATCH" as const,
          predictedJobId: "jy",
          predictedJobName: "Y",
          resolvingMarker: "CONTACT",
          evidence: [],
          identityDiagnostics: null,
        },
        transition: classifyMatcherTransition({
          baselineOutcome: "AMBIGUOUS",
          proposedOutcome: "WRONG_MATCH",
          baselinePredictedJobId: null,
          proposedPredictedJobId: "jy",
        }),
        groundTruthReviewFlag: false,
      },
      {
        emailMessageId: "e3",
        subject: null,
        trueJobId: "j3",
        trueJobName: "J3",
        groundTruthSource: null,
        baseline: {
          decision: "MATCH",
          outcome: "WRONG_MATCH" as const,
          predictedJobId: "ja",
          predictedJobName: "A",
          resolvingMarker: "NAME",
          evidence: [],
          identityDiagnostics: null,
        },
        proposed: {
          decision: "MATCH",
          outcome: "WRONG_MATCH" as const,
          predictedJobId: "jb",
          predictedJobName: "B",
          resolvingMarker: "NAME",
          evidence: [],
          identityDiagnostics: null,
        },
        transition: classifyMatcherTransition({
          baselineOutcome: "WRONG_MATCH",
          proposedOutcome: "WRONG_MATCH",
          baselinePredictedJobId: "ja",
          proposedPredictedJobId: "jb",
        }),
        groundTruthReviewFlag: false,
      },
    ];
    const report = buildIdentityCompareReport({
      baselinePolicy: "CONTEXT_AWARE_V2",
      proposedPolicy: "CONTEXT_AWARE_V2_1",
      baselineMetrics: metrics({
        totalEvaluated: 3,
        correctMatches: 1,
        wrongMatches: 1,
        ambiguous: 1,
        conflict: 0,
        noMatch: 0,
      }),
      proposedMetrics: metrics({
        totalEvaluated: 3,
        correctMatches: 0,
        wrongMatches: 3,
        ambiguous: 0,
        conflict: 0,
        noMatch: 0,
      }),
      rows,
      runtimeMs: { baseline: 1, proposed: 1 },
    });
    const nw = report.diagnostics!.newlyWrong;
    expect(nw.correctToWrong).toBe(1);
    expect(nw.unresolvedToWrong).toBe(1);
    expect(nw.wrongDifferentJob).toBe(1);
    expect(nw.totalNewlyWrong).toBe(3);
    expect(report.safetyRegressions.correctToWrong).toBe(nw.correctToWrong);
    expect(report.safetyRegressions.unresolvedToWrong).toBe(
      nw.unresolvedToWrong
    );
    expect(report.diagnostics!.integrityError ?? null).toBeNull();
  });

  it("does not double-count UNRESOLVED_TO_WRONG when granular keys exist", () => {
    const nw = summarizeNewlyWrong({
      transitions: {
        CORRECT_TO_WRONG: 2,
        AMBIGUOUS_TO_WRONG: 1,
        CONFLICT_TO_WRONG: 1,
        NO_MATCH_TO_WRONG: 0,
        // Legacy alias that previously caused 2+2=4 style inflation
        UNRESOLVED_TO_WRONG: 2,
        WRONG_TO_CORRECT: 0,
      },
      wrongDifferentJob: 2,
    });
    expect(nw.correctToWrong).toBe(2);
    expect(nw.unresolvedToWrong).toBe(2);
    expect(nw.totalNewlyWrong).toBe(6);
  });

  it("flags when transition matrix disagrees with proposed metrics", () => {
    const bad = assertTransitionMetricsReconcile({
      transitions: {
        CORRECT_TO_CORRECT: 10,
        CORRECT_TO_CONFLICT: 5,
        WRONG_TO_WRONG: 2,
        AMBIGUOUS_TO_AMBIGUOUS: 3,
        CONFLICT_TO_CONFLICT: 0,
        NO_MATCH_TO_NO_MATCH: 0,
      },
      baseline: {
        totalEvaluated: 20,
        correctMatches: 15,
        wrongMatches: 2,
        ambiguous: 3,
        conflict: 0,
        noMatch: 0,
      },
      proposed: {
        totalEvaluated: 20,
        // Intentionally wrong vs matrix projection (correct=10, conflict=5)
        correctMatches: 12,
        wrongMatches: 2,
        ambiguous: 3,
        conflict: 3,
        noMatch: 0,
      },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toMatch(/Transition integrity error/);
    }
  });
});
