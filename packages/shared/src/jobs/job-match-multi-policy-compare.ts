/**
 * Dynamic N-policy Job Matcher comparison on a shared email dataset.
 * Not tied to a fixed V2/V2.1/V2.2 trio — registry-driven policy lists.
 */
import type { HistoricalEvalMetrics } from "./job-match-historical-eval.js";
import {
  classifyMatcherTransition,
  type IdentityCompareSideSummary,
  type MatcherTransitionCategory,
} from "./job-match-identity-compare.js";
import { computeJobMatcherPerformanceScore } from "./job-match-performance-score.js";
import {
  getProductionJobMatchIdentityPolicy,
  isJobMatchIdentityPolicyId,
  jobMatchPolicyAdvanceRank,
  type JobMatchIdentityPolicyId,
} from "./job-match-policy-registry.js";

export type IdentityMultiPolicySide = IdentityCompareSideSummary;

export type IdentityMultiPolicyCompareRow = {
  emailMessageId: string;
  subject: string | null;
  trueJobId: string;
  trueJobName: string;
  groundTruthSource: string | null;
  /** Ordered sides aligned with report.policies. */
  sides: Array<{
    policy: JobMatchIdentityPolicyId;
    summary: IdentityMultiPolicySide;
  }>;
  policiesDisagree: boolean;
  groundTruthReviewFlag: boolean;
};

export type IdentityMultiPolicyCompareReport = {
  policies: JobMatchIdentityPolicyId[];
  /** Baseline for improve/regress filters — production when included, else first. */
  baselinePolicy: JobMatchIdentityPolicyId;
  metricsByPolicy: Record<string, HistoricalEvalMetrics>;
  performanceScores: Record<string, number | null>;
  rows: IdentityMultiPolicyCompareRow[];
  runtimeMsByPolicy: Record<string, number>;
};

function sidesDisagree(
  a: IdentityCompareSideSummary,
  b: IdentityCompareSideSummary
): boolean {
  return (
    a.outcome !== b.outcome ||
    (a.predictedJobId ?? null) !== (b.predictedJobId ?? null)
  );
}

export function pickCompareBaselinePolicy(
  policies: ReadonlyArray<JobMatchIdentityPolicyId>
): JobMatchIdentityPolicyId {
  const production = getProductionJobMatchIdentityPolicy();
  if (policies.includes(production)) return production;
  return [...policies].sort(
    (a, b) => jobMatchPolicyAdvanceRank(a) - jobMatchPolicyAdvanceRank(b)
  )[0]!;
}

export function buildIdentityMultiPolicyCompareRow(input: {
  emailMessageId: string;
  subject: string | null;
  trueJobId: string;
  trueJobName: string;
  groundTruthSource: string | null;
  sides: Array<{
    policy: JobMatchIdentityPolicyId;
    summary: IdentityMultiPolicySide;
  }>;
}): IdentityMultiPolicyCompareRow {
  let disagree = false;
  for (let i = 0; i < input.sides.length; i++) {
    for (let j = i + 1; j < input.sides.length; j++) {
      if (sidesDisagree(input.sides[i]!.summary, input.sides[j]!.summary)) {
        disagree = true;
        break;
      }
    }
    if (disagree) break;
  }
  return {
    ...input,
    policiesDisagree: disagree,
    groundTruthReviewFlag: input.sides.some(
      (s) => s.summary.outcome === "WRONG_MATCH"
    ),
  };
}

export function buildIdentityMultiPolicyCompareReport(input: {
  policies: JobMatchIdentityPolicyId[];
  metricsByPolicy: Record<string, HistoricalEvalMetrics>;
  runtimeMsByPolicy: Record<string, number>;
  rows: IdentityMultiPolicyCompareRow[];
  baselinePolicy?: JobMatchIdentityPolicyId;
}): IdentityMultiPolicyCompareReport {
  if (input.policies.length < 2) {
    throw new Error("Multi-policy comparison requires at least two policies");
  }
  for (const p of input.policies) {
    if (!isJobMatchIdentityPolicyId(p)) {
      throw new Error(`Unknown identity policy: ${p}`);
    }
    if (!input.metricsByPolicy[p]) {
      throw new Error(`Missing metrics for policy ${p}`);
    }
  }
  const performanceScores: Record<string, number | null> = {};
  for (const p of input.policies) {
    performanceScores[p] = computeJobMatcherPerformanceScore(
      input.metricsByPolicy[p]!
    ).score;
  }
  return {
    policies: [...input.policies],
    baselinePolicy:
      input.baselinePolicy ?? pickCompareBaselinePolicy(input.policies),
    metricsByPolicy: input.metricsByPolicy,
    performanceScores,
    rows: input.rows,
    runtimeMsByPolicy: input.runtimeMsByPolicy,
  };
}

export type MultiPolicyEmailCompareFilter =
  | "ALL"
  | "DISAGREE"
  | "AGREE"
  | "EXPERIMENTAL_IMPROVED"
  | "EXPERIMENTAL_REGRESSED";

/**
 * Improvement / regression vs baseline using ground-truth outcomes only.
 * Ambiguous/conflict/no-match are unresolved — not claimed as improvements.
 */
export function classifyVsBaseline(
  baseline: IdentityCompareSideSummary,
  other: IdentityCompareSideSummary
): MatcherTransitionCategory {
  return classifyMatcherTransition({
    baselineOutcome: baseline.outcome,
    proposedOutcome: other.outcome,
    baselinePredictedJobId: baseline.predictedJobId,
    proposedPredictedJobId: other.predictedJobId,
  });
}

const IMPROVED: ReadonlySet<MatcherTransitionCategory> = new Set([
  "WRONG_TO_CORRECT",
  "UNRESOLVED_TO_CORRECT",
]);

const REGRESSED: ReadonlySet<MatcherTransitionCategory> = new Set([
  "CORRECT_TO_WRONG",
  "UNRESOLVED_TO_WRONG",
  "WRONG_TO_WRONG_DIFFERENT_JOB",
  "CORRECT_TO_UNRESOLVED",
]);

export function rowMatchesMultiPolicyFilter(
  row: IdentityMultiPolicyCompareRow,
  filter: MultiPolicyEmailCompareFilter,
  baselinePolicy: JobMatchIdentityPolicyId
): boolean {
  if (filter === "ALL") return true;
  if (filter === "DISAGREE") return row.policiesDisagree;
  if (filter === "AGREE") return !row.policiesDisagree;

  const baselineSide = row.sides.find((s) => s.policy === baselinePolicy);
  if (!baselineSide) return false;

  const others = row.sides.filter((s) => s.policy !== baselinePolicy);
  if (others.length === 0) return false;

  if (filter === "EXPERIMENTAL_IMPROVED") {
    return others.some((o) =>
      IMPROVED.has(classifyVsBaseline(baselineSide.summary, o.summary))
    );
  }
  if (filter === "EXPERIMENTAL_REGRESSED") {
    return others.some((o) =>
      REGRESSED.has(classifyVsBaseline(baselineSide.summary, o.summary))
    );
  }
  return true;
}

/** Validate + dedupe + sort by advance rank for stable orchestration. */
export function normalizeEvalIdentityPolicies(
  policies: ReadonlyArray<string>
): JobMatchIdentityPolicyId[] {
  const seen = new Set<JobMatchIdentityPolicyId>();
  const out: JobMatchIdentityPolicyId[] = [];
  for (const raw of policies) {
    if (!isJobMatchIdentityPolicyId(raw)) {
      throw new Error(`Invalid identity policy: ${raw}`);
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  out.sort(
    (a, b) => jobMatchPolicyAdvanceRank(a) - jobMatchPolicyAdvanceRank(b)
  );
  return out;
}
