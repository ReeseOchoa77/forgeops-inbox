import { describe, expect, it } from "vitest";
import {
  applyGroundTruthCorrectionsToRows,
  metricsWithGroundTruthCorrections,
  reclassifyEvalRowAgainstTrueJob,
  type GroundTruthCorrectionApply,
} from "../jobs/job-match-eval-ground-truth-corrections.js";
import { computeJobMatcherPerformanceScore } from "../jobs/job-match-performance-score.js";

type Row = {
  emailMessageId: string;
  trueJobId: string;
  trueJobName: string;
  trueJobNumber: string | null;
  predictedJobId: string | null;
  predictedJobName: string | null;
  decision: string;
  outcome: string;
};

function row(
  id: string,
  decision: string,
  predictedJobId: string | null,
  trueJobId = "job-a"
): Row {
  return {
    emailMessageId: id,
    trueJobId,
    trueJobName: trueJobId,
    trueJobNumber: null,
    predictedJobId,
    predictedJobName: predictedJobId ? `name-${predictedJobId}` : null,
    decision,
    outcome: reclassifyEvalRowAgainstTrueJob({
      decision,
      predictedJobId,
      trueJobId,
    }),
  };
}

function correction(
  emailMessageId: string,
  corrected = "job-b",
  status: "ACTIVE" | "REVERSED" = "ACTIVE"
): GroundTruthCorrectionApply {
  return {
    emailMessageId,
    originalGroundTruthJobId: "job-a",
    correctedGroundTruthJobId: corrected,
    verificationStatus: status,
  };
}

// Model X predicted job-b (wrong vs original GT job-a); model Y predicted job-a.
const modelX = [
  row("e1", "MATCH", "job-b"), // WRONG
  row("e2", "MATCH", "job-a"), // CORRECT
  row("e3", "MATCH", "job-a"), // CORRECT
];
const modelY = [
  row("e1", "MATCH", "job-a"), // CORRECT
  row("e2", "MATCH", "job-a"), // CORRECT
  row("e3", "AMBIGUOUS", null), // AMBIGUOUS
];

describe("reclassifyEvalRowAgainstTrueJob", () => {
  it("mirrors classifyHistoricalEvalOutcome", () => {
    expect(
      reclassifyEvalRowAgainstTrueJob({
        decision: "MATCH",
        predictedJobId: "x",
        trueJobId: "x",
      })
    ).toBe("CORRECT_MATCH");
    expect(
      reclassifyEvalRowAgainstTrueJob({
        decision: "MATCH",
        predictedJobId: "x",
        trueJobId: "y",
      })
    ).toBe("WRONG_MATCH");
    expect(
      reclassifyEvalRowAgainstTrueJob({
        decision: "AMBIGUOUS",
        predictedJobId: null,
        trueJobId: "y",
      })
    ).toBe("AMBIGUOUS");
    expect(
      reclassifyEvalRowAgainstTrueJob({
        decision: "CONFLICT",
        predictedJobId: null,
        trueJobId: "y",
      })
    ).toBe("CONFLICT");
    expect(
      reclassifyEvalRowAgainstTrueJob({
        decision: "NO_MATCH",
        predictedJobId: null,
        trueJobId: "y",
      })
    ).toBe("NO_MATCH");
  });
});

describe("job-match-eval-ground-truth-corrections", () => {
  const corrections = [correction("e1")];

  it("wrong → verify → CORRECT for the predicting model", () => {
    const { correctedRows } = metricsWithGroundTruthCorrections(
      modelX,
      corrections
    );
    const e1 = correctedRows.find((r) => r.emailMessageId === "e1")!;
    expect(e1.outcome).toBe("CORRECT_MATCH");
    expect(e1.trueJobId).toBe("job-b");
    expect(e1.originalTrueJobId).toBe("job-a");
    expect(e1.groundTruthCorrected).toBe(true);
    expect(e1.effectiveTrueJobId).toBe("job-b");
    // name falls back to the model's predicted name
    expect(e1.trueJobName).toBe("name-job-b");
  });

  it("another model that predicted the original GT becomes WRONG", () => {
    const { correctedRows } = metricsWithGroundTruthCorrections(
      modelY,
      corrections
    );
    const e1 = correctedRows.find((r) => r.emailMessageId === "e1")!;
    expect(e1.outcome).toBe("WRONG_MATCH");
    expect(e1.predictedJobId).toBe("job-a");
    // falls back to corrected id when this model never predicted it
    expect(e1.trueJobName).toBe("job-b");
  });

  it("denominator is unchanged", () => {
    for (const rows of [modelX, modelY]) {
      const m = metricsWithGroundTruthCorrections(rows, corrections);
      expect(m.correctedRows).toHaveLength(rows.length);
      expect(m.correctedMetrics.totalEvaluated).toBe(
        m.originalMetrics.totalEvaluated
      );
    }
  });

  it("correct / wrong / precision / JMPS change as expected", () => {
    const x = metricsWithGroundTruthCorrections(modelX, corrections);
    expect(x.originalMetrics.correctMatches).toBe(2);
    expect(x.originalMetrics.wrongMatches).toBe(1);
    expect(x.correctedMetrics.correctMatches).toBe(3);
    expect(x.correctedMetrics.wrongMatches).toBe(0);
    expect(x.correctedMetrics.precision).toBe(1);
    expect(x.originalMetrics.precision).toBeCloseTo(2 / 3);
    expect(
      computeJobMatcherPerformanceScore(x.correctedMetrics).score!
    ).toBeGreaterThan(
      computeJobMatcherPerformanceScore(x.originalMetrics).score!
    );

    const y = metricsWithGroundTruthCorrections(modelY, corrections);
    expect(y.originalMetrics.correctMatches).toBe(2);
    expect(y.correctedMetrics.correctMatches).toBe(1);
    expect(y.correctedMetrics.wrongMatches).toBe(1);
    expect(y.correctedMetrics.ambiguous).toBe(1);
    expect(y.correctedMetrics.precision).toBeCloseTo(1 / 2);
    expect(
      computeJobMatcherPerformanceScore(y.correctedMetrics).score!
    ).toBeLessThan(
      computeJobMatcherPerformanceScore(y.originalMetrics).score!
    );
  });

  it("reversing restores original outcomes", () => {
    const reversed = [correction("e1", "job-b", "REVERSED")];
    for (const rows of [modelX, modelY]) {
      const m = metricsWithGroundTruthCorrections(rows, reversed);
      expect(m.correctedMetrics).toEqual(m.originalMetrics);
      expect(m.correctedRows.map((r) => r.outcome)).toEqual(
        rows.map((r) => r.outcome)
      );
      expect(m.correctionCount).toBe(0);
    }
  });

  it("Ambiguous / Conflict / No Match never become CORRECT via correction", () => {
    const rows = [
      row("a", "AMBIGUOUS", null),
      row("c", "CONFLICT", null),
      row("n", "NO_MATCH", null),
    ];
    const applied = applyGroundTruthCorrectionsToRows(rows, [
      correction("a"),
      correction("c"),
      correction("n"),
    ]);
    expect(applied.map((r) => r.outcome)).toEqual([
      "AMBIGUOUS",
      "CONFLICT",
      "NO_MATCH",
    ]);
    expect(applied.every((r) => r.trueJobId === "job-b")).toBe(true);
    expect(applied.every((r) => r.groundTruthCorrected)).toBe(true);
  });

  it("only ACTIVE corrections apply", () => {
    const applied = applyGroundTruthCorrectionsToRows(modelX, [
      correction("e1", "job-b", "REVERSED"),
      correction("e2", "job-z", "ACTIVE"),
    ]);
    expect(applied[0]!.groundTruthCorrected).toBe(false);
    expect(applied[0]!.outcome).toBe("WRONG_MATCH");
    expect(applied[1]!.groundTruthCorrected).toBe(true);
    expect(applied[1]!.trueJobId).toBe("job-z");
    expect(applied[1]!.outcome).toBe("WRONG_MATCH");
  });
});
