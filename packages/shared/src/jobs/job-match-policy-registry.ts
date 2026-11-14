/**
 * Canonical Job Matcher identity-policy registry and display ranking.
 * Higher rank = more advanced shadow/eval policy.
 * Production default is CONTEXT_AWARE_V2 (see productionDefault).
 */

import type { HistoricalEvalMetrics } from "./job-match-historical-eval.js";
import {
  JOB_MATCH_IDENTITY_POLICY_BASELINE,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  type JobMatchIdentityPolicy,
} from "./job-name-identity-policy.js";

export {
  JOB_MATCH_IDENTITY_POLICY_BASELINE,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
};

export type JobMatchIdentityPolicyId = JobMatchIdentityPolicy;

export type JobMatchPolicyRegistryEntry = {
  id: JobMatchIdentityPolicyId;
  /** Higher = more advanced. Used for primary metric-card selection. */
  advanceRank: number;
  label: string;
  productionDefault: boolean;
};

export const JOB_MATCH_POLICY_REGISTRY: readonly JobMatchPolicyRegistryEntry[] =
  [
    {
      id: JOB_MATCH_IDENTITY_POLICY_BASELINE,
      advanceRank: 0,
      label: "BASELINE",
      productionDefault: false,
    },
    {
      id: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
      advanceRank: 1,
      label: "CONTEXT_AWARE_V1",
      productionDefault: false,
    },
    {
      id: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      advanceRank: 2,
      label: "CONTEXT_AWARE_V2",
      productionDefault: true,
    },
    {
      id: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      advanceRank: 3,
      label: "CONTEXT_AWARE_V2_1",
      productionDefault: false,
    },
  ] as const;

/** Active production identity policy (exactly one registry entry). */
export function getProductionJobMatchIdentityPolicy(): JobMatchIdentityPolicyId {
  const entry = JOB_MATCH_POLICY_REGISTRY.find((e) => e.productionDefault);
  return entry?.id ?? JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2;
}

const RANK = new Map(
  JOB_MATCH_POLICY_REGISTRY.map((e) => [e.id, e.advanceRank] as const)
);

export function isJobMatchIdentityPolicyId(
  value: string
): value is JobMatchIdentityPolicyId {
  return RANK.has(value as JobMatchIdentityPolicyId);
}

export function jobMatchPolicyAdvanceRank(
  policy: string | null | undefined
): number {
  if (!policy || !isJobMatchIdentityPolicyId(policy)) return -1;
  return RANK.get(policy) ?? -1;
}

export function selectMostAdvancedPolicy(
  policies: ReadonlyArray<string | null | undefined>
): JobMatchIdentityPolicyId {
  let best: JobMatchIdentityPolicyId = JOB_MATCH_IDENTITY_POLICY_BASELINE;
  let bestRank = -1;
  for (const p of policies) {
    if (!p || !isJobMatchIdentityPolicyId(p)) continue;
    const rank = RANK.get(p) ?? -1;
    if (rank > bestRank) {
      best = p;
      bestRank = rank;
    }
  }
  return best;
}

export type PolicyMetricsBundle = {
  policy: JobMatchIdentityPolicyId;
  metrics: HistoricalEvalMetrics;
};

/**
 * Choose metrics for the primary Evaluation metric cards.
 *
 * - Single-policy runs: show that policy's metrics (primary).
 * - Compare / multi-policy runs: prefer the active production policy when it
 *   was scored, so V2.1 shadow results are not mistaken for production.
 * - Otherwise fall back to the most advanced scored policy.
 */
export function selectDisplayMetricsForEvaluation(input: {
  primaryPolicy: string | null | undefined;
  primaryMetrics: HistoricalEvalMetrics;
  comparison?: {
    baselinePolicy: string;
    proposedPolicy: string;
    baselineMetrics: HistoricalEvalMetrics;
    proposedMetrics: HistoricalEvalMetrics;
  } | null;
  threeWayComparison?: {
    baselineMetrics: HistoricalEvalMetrics;
    v1Metrics: HistoricalEvalMetrics;
    v2Metrics: HistoricalEvalMetrics;
    v21Metrics?: HistoricalEvalMetrics | null;
  } | null;
}): PolicyMetricsBundle {
  const bundles: PolicyMetricsBundle[] = [];
  const production = getProductionJobMatchIdentityPolicy();
  const isCompare =
    Boolean(input.comparison) || Boolean(input.threeWayComparison);

  if (
    input.primaryPolicy &&
    isJobMatchIdentityPolicyId(input.primaryPolicy)
  ) {
    bundles.push({
      policy: input.primaryPolicy,
      metrics: input.primaryMetrics,
    });
  } else {
    bundles.push({
      policy: production,
      metrics: input.primaryMetrics,
    });
  }

  if (input.comparison) {
    if (isJobMatchIdentityPolicyId(input.comparison.baselinePolicy)) {
      bundles.push({
        policy: input.comparison.baselinePolicy,
        metrics: input.comparison.baselineMetrics,
      });
    }
    if (isJobMatchIdentityPolicyId(input.comparison.proposedPolicy)) {
      bundles.push({
        policy: input.comparison.proposedPolicy,
        metrics: input.comparison.proposedMetrics,
      });
    }
  }

  if (input.threeWayComparison) {
    bundles.push({
      policy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
      metrics: input.threeWayComparison.baselineMetrics,
    });
    bundles.push({
      policy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
      metrics: input.threeWayComparison.v1Metrics,
    });
    bundles.push({
      policy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      metrics: input.threeWayComparison.v2Metrics,
    });
    if (input.threeWayComparison.v21Metrics) {
      bundles.push({
        policy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
        metrics: input.threeWayComparison.v21Metrics,
      });
    }
  }

  if (!isCompare) {
    const primary =
      input.primaryPolicy && isJobMatchIdentityPolicyId(input.primaryPolicy)
        ? bundles.find((b) => b.policy === input.primaryPolicy)
        : null;
    if (primary) return primary;
  }

  const prodBundle = bundles.find((b) => b.policy === production);
  if (prodBundle) return prodBundle;

  const advanced = selectMostAdvancedPolicy(bundles.map((b) => b.policy));
  const match = bundles.find((b) => b.policy === advanced);
  return (
    match ?? {
      policy: production,
      metrics: input.primaryMetrics,
    }
  );
}

/** Decision counts must sum to evaluated (canonical consistency check). */
export function assertDecisionCountsReconcile(
  metrics: Pick<
    HistoricalEvalMetrics,
    | "totalEvaluated"
    | "correctMatches"
    | "wrongMatches"
    | "ambiguous"
    | "conflict"
    | "noMatch"
  >
): boolean {
  const sum =
    metrics.correctMatches +
    metrics.wrongMatches +
    metrics.ambiguous +
    metrics.conflict +
    metrics.noMatch;
  return sum === metrics.totalEvaluated;
}
