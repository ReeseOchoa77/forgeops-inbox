import { describe, expect, it } from "vitest";
import {
  applyExclusionsToPolicyRows,
  metricsFromOutcomeRows,
  ratesFromOutcomeCounts,
} from "../jobs/job-match-eval-exclusions.js";

function row(id: string, outcome: string, trueJobId = "job-a") {
  return {
    emailMessageId: id,
    outcome,
    trueJobId,
    trueJobName: trueJobId,
    trueJobNumber: null,
  };
}

describe("job-match-eval-exclusions", () => {
  const rows = [
    row("e1", "CORRECT_MATCH"),
    row("e2", "CORRECT_MATCH"),
    row("e3", "WRONG_MATCH"),
    row("e4", "AMBIGUOUS"),
    row("e5", "CONFLICT"),
    row("e6", "NO_MATCH"),
  ];

  it("raw metrics match all rows", () => {
    const m = metricsFromOutcomeRows(rows);
    expect(m.totalEvaluated).toBe(6);
    expect(m.correctMatches).toBe(2);
    expect(m.wrongMatches).toBe(1);
    expect(m.ambiguous).toBe(1);
    expect(m.conflict).toBe(1);
    expect(m.noMatch).toBe(1);
    expect(m.precision).toBeCloseTo(2 / 3);
    expect(m.correctCoverage).toBeCloseTo(2 / 6);
  });

  it("excluding Wrong decreases Wrong and Evaluated", () => {
    const adj = applyExclusionsToPolicyRows({
      rows,
      excludedEmailIds: ["e3"],
    });
    expect(adj.rawMetrics.wrongMatches).toBe(1);
    expect(adj.adjustedMetrics.totalEvaluated).toBe(5);
    expect(adj.adjustedMetrics.wrongMatches).toBe(0);
    expect(adj.adjustedMetrics.correctMatches).toBe(2);
    expect(adj.adjustedMetrics.precision).toBe(1);
    expect(adj.adjustedMetrics.correctCoverage).toBeCloseTo(2 / 5);
    expect(adj.excludedCount).toBe(1);
  });

  it("excluding Correct decreases Correct and Evaluated", () => {
    const adj = applyExclusionsToPolicyRows({
      rows,
      excludedEmailIds: ["e1"],
    });
    expect(adj.adjustedMetrics.correctMatches).toBe(1);
    expect(adj.adjustedMetrics.totalEvaluated).toBe(5);
  });

  it("excluding Ambiguous / Conflict / No Match updates those buckets", () => {
    expect(
      applyExclusionsToPolicyRows({ rows, excludedEmailIds: ["e4"] })
        .adjustedMetrics.ambiguous
    ).toBe(0);
    expect(
      applyExclusionsToPolicyRows({ rows, excludedEmailIds: ["e5"] })
        .adjustedMetrics.conflict
    ).toBe(0);
    expect(
      applyExclusionsToPolicyRows({ rows, excludedEmailIds: ["e6"] })
        .adjustedMetrics.noMatch
    ).toBe(0);
  });

  it("restoring exclusions restores metrics", () => {
    const excluded = applyExclusionsToPolicyRows({
      rows,
      excludedEmailIds: ["e3"],
    });
    const restored = applyExclusionsToPolicyRows({
      rows,
      excludedEmailIds: [],
    });
    expect(restored.adjustedMetrics).toEqual(excluded.rawMetrics);
    expect(restored.excludedCount).toBe(0);
  });

  it("empty included set does not produce NaN", () => {
    const adj = applyExclusionsToPolicyRows({
      rows,
      excludedEmailIds: rows.map((r) => r.emailMessageId),
    });
    expect(adj.adjustedMetrics.totalEvaluated).toBe(0);
    expect(adj.adjustedMetrics.precision).toBeNull();
    expect(adj.adjustedMetrics.correctCoverage).toBe(0);
    expect(Number.isNaN(adj.adjustedMetrics.wrongMatchRate)).toBe(false);
  });

  it("ratesFromOutcomeCounts matches decided=0 edge", () => {
    const rates = ratesFromOutcomeCounts({
      totalEvaluated: 0,
      correctMatches: 0,
      wrongMatches: 0,
      ambiguous: 0,
      conflict: 0,
      noMatch: 0,
    });
    expect(rates.precision).toBeNull();
    expect(rates.correctCoverage).toBe(0);
  });

  it("applies the same exclusion ids across conceptual multi-policy sets", () => {
    const v2 = [
      row("shared", "WRONG_MATCH"),
      row("ok", "CORRECT_MATCH"),
    ];
    const v21 = [
      row("shared", "CORRECT_MATCH"),
      row("ok", "CORRECT_MATCH"),
    ];
    const ids = ["shared"];
    const a = applyExclusionsToPolicyRows({ rows: v2, excludedEmailIds: ids });
    const b = applyExclusionsToPolicyRows({ rows: v21, excludedEmailIds: ids });
    expect(a.adjustedMetrics.totalEvaluated).toBe(1);
    expect(b.adjustedMetrics.totalEvaluated).toBe(1);
    expect(a.includedRows.map((r) => r.emailMessageId)).toEqual(["ok"]);
    expect(b.includedRows.map((r) => r.emailMessageId)).toEqual(["ok"]);
  });
});
