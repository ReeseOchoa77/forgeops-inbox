import { describe, expect, it } from "vitest";
import {
  computeJobMatcherPerformanceScore,
  JMPS_WEIGHT_AMBIGUOUS,
  JMPS_WEIGHT_CONFLICT,
  JMPS_WEIGHT_WRONG,
} from "../jobs/job-match-performance-score.js";
import { applyExclusionsToPolicyRows } from "../jobs/job-match-eval-exclusions.js";

describe("Job Matcher Performance Score (JMPS)", () => {
  it("produces 80.41 for the documented V2 example", () => {
    const result = computeJobMatcherPerformanceScore({
      totalEvaluated: 2651,
      correctMatches: 2129,
      wrongMatches: 14,
      ambiguous: 475,
      conflict: 27,
      noMatch: 6,
    });
    expect(result.score).not.toBeNull();
    expect(result.display).toBe("80.41");
    expect(result.score!).toBeCloseTo(80.41, 2);
  });

  it("applies −5 Wrong, +0.15 Ambiguous, +0.05 Conflict, 0 No Match", () => {
    expect(JMPS_WEIGHT_WRONG).toBe(-5);
    expect(JMPS_WEIGHT_AMBIGUOUS).toBe(0.15);
    expect(JMPS_WEIGHT_CONFLICT).toBe(0.05);
    const onlyNoMatch = computeJobMatcherPerformanceScore({
      totalEvaluated: 10,
      correctMatches: 0,
      wrongMatches: 0,
      ambiguous: 0,
      conflict: 0,
      noMatch: 10,
    });
    expect(onlyNoMatch.score).toBe(0);
  });

  it("returns N/A when evaluated is 0", () => {
    const result = computeJobMatcherPerformanceScore({
      totalEvaluated: 0,
      correctMatches: 0,
      wrongMatches: 0,
      ambiguous: 0,
      conflict: 0,
      noMatch: 0,
    });
    expect(result.score).toBeNull();
    expect(result.display).toBe("N/A");
    expect(result.clampedForDisplay).toBeNull();
  });

  it("clamps only the visual bar, not the raw score", () => {
    // Heavy wrong penalty can push score below 0.
    const result = computeJobMatcherPerformanceScore({
      totalEvaluated: 10,
      correctMatches: 0,
      wrongMatches: 10,
      ambiguous: 0,
      conflict: 0,
    });
    expect(result.score).toBeLessThan(0);
    expect(result.clampedForDisplay).toBe(0);
  });

  it("adjusted scores respect evaluation exclusions", () => {
    const rows = [
      {
        emailMessageId: "c1",
        outcome: "CORRECT_MATCH",
        trueJobId: "j",
      },
      {
        emailMessageId: "w1",
        outcome: "WRONG_MATCH",
        trueJobId: "j",
      },
      {
        emailMessageId: "a1",
        outcome: "AMBIGUOUS",
        trueJobId: "j",
      },
    ];
    const raw = applyExclusionsToPolicyRows({
      rows,
      excludedEmailIds: [],
    });
    const adjusted = applyExclusionsToPolicyRows({
      rows,
      excludedEmailIds: ["w1"],
    });
    const rawJmps = computeJobMatcherPerformanceScore(raw.rawMetrics);
    const adjJmps = computeJobMatcherPerformanceScore(adjusted.adjustedMetrics);
    expect(rawJmps.denominator).toBe(3);
    expect(adjJmps.denominator).toBe(2);
    expect(adjJmps.score).toBeGreaterThan(rawJmps.score!);
  });
});
