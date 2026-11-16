/**
 * Job Matcher Performance Score (JMPS).
 *
 * JMPS = 100 × (C - 5W + 0.15A + 0.05F) / N
 *
 * Weights: Correct +1, Wrong −5, Ambiguous +0.15, Conflict +0.05, No Match 0.
 * Distinct from precision / coverage — a weighted operator score.
 */

export const JMPS_WEIGHT_CORRECT = 1;
export const JMPS_WEIGHT_WRONG = -5;
export const JMPS_WEIGHT_AMBIGUOUS = 0.15;
export const JMPS_WEIGHT_CONFLICT = 0.05;
export const JMPS_WEIGHT_NO_MATCH = 0;

export type JmpsCounts = {
  totalEvaluated: number;
  correctMatches: number;
  wrongMatches: number;
  ambiguous: number;
  conflict: number;
  /** Included for documentation; contributes 0 to the numerator. */
  noMatch?: number;
};

export type JmpsResult = {
  /** Raw score; may be outside 0–100. Null when N = 0. */
  score: number | null;
  /** Display string: two decimals, or "N/A". */
  display: string;
  /** Visual bar only — clamped to [0, 100]; null when score is null. */
  clampedForDisplay: number | null;
  numerator: number;
  denominator: number;
  weights: {
    correct: number;
    wrong: number;
    ambiguous: number;
    conflict: number;
    noMatch: number;
  };
};

export function computeJobMatcherPerformanceScore(
  counts: JmpsCounts
): JmpsResult {
  const N = counts.totalEvaluated;
  const C = counts.correctMatches;
  const W = counts.wrongMatches;
  const A = counts.ambiguous;
  const F = counts.conflict;
  const numerator =
    JMPS_WEIGHT_CORRECT * C +
    JMPS_WEIGHT_WRONG * W +
    JMPS_WEIGHT_AMBIGUOUS * A +
    JMPS_WEIGHT_CONFLICT * F +
    JMPS_WEIGHT_NO_MATCH * (counts.noMatch ?? 0);
  const weights = {
    correct: JMPS_WEIGHT_CORRECT,
    wrong: JMPS_WEIGHT_WRONG,
    ambiguous: JMPS_WEIGHT_AMBIGUOUS,
    conflict: JMPS_WEIGHT_CONFLICT,
    noMatch: JMPS_WEIGHT_NO_MATCH,
  };
  if (N <= 0) {
    return {
      score: null,
      display: "N/A",
      clampedForDisplay: null,
      numerator,
      denominator: 0,
      weights,
    };
  }
  const score = (100 * numerator) / N;
  return {
    score,
    display: score.toFixed(2),
    clampedForDisplay: Math.min(100, Math.max(0, score)),
    numerator,
    denominator: N,
    weights,
  };
}

/** Tooltip / help copy for the Performance Score control. */
export const JMPS_TOOLTIP =
  "Job Matcher Performance Score (JMPS) = 100 × (Correct − 5×Wrong + 0.15×Ambiguous + 0.05×Conflict) / Evaluated. No Match contributes 0. This is a weighted operator score, not precision or accuracy.";
