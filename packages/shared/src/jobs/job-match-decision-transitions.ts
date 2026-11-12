/**
 * Granular decision/outcome transitions for matcher policy comparisons.
 * Complements CORRECT/WRONG/UNRESOLVED buckets with AMBIGUOUS/CONFLICT/NO_MATCH.
 */

import type { HistoricalEvalOutcome } from "./job-match-historical-eval.js";

export type MatcherOutcomeLabel =
  | "CORRECT"
  | "WRONG"
  | "AMBIGUOUS"
  | "CONFLICT"
  | "NO_MATCH";

export type DecisionTransitionKey =
  `${MatcherOutcomeLabel}_TO_${MatcherOutcomeLabel}`;

export function outcomeToLabel(
  outcome: HistoricalEvalOutcome
): MatcherOutcomeLabel {
  if (outcome === "CORRECT_MATCH") return "CORRECT";
  if (outcome === "WRONG_MATCH") return "WRONG";
  if (outcome === "AMBIGUOUS") return "AMBIGUOUS";
  if (outcome === "CONFLICT") return "CONFLICT";
  return "NO_MATCH";
}

export function classifyDecisionTransition(input: {
  baselineOutcome: HistoricalEvalOutcome;
  proposedOutcome: HistoricalEvalOutcome;
}): DecisionTransitionKey {
  return `${outcomeToLabel(input.baselineOutcome)}_TO_${outcomeToLabel(input.proposedOutcome)}`;
}

export function emptyDecisionTransitionCounts(): Record<
  DecisionTransitionKey,
  number
> {
  const labels: MatcherOutcomeLabel[] = [
    "CORRECT",
    "WRONG",
    "AMBIGUOUS",
    "CONFLICT",
    "NO_MATCH",
  ];
  const out = {} as Record<DecisionTransitionKey, number>;
  for (const from of labels) {
    for (const to of labels) {
      out[`${from}_TO_${to}`] = 0;
    }
  }
  return out;
}

export function assertDecisionTransitionsReconcile(
  counts: Record<string, number>,
  expectedTotal: number
): boolean {
  let sum = 0;
  for (const n of Object.values(counts)) sum += n;
  return sum === expectedTotal;
}

/** Structured attribution for why a paired policy decision changed. */
export type PolicyChangeReasonCode =
  | "UNCHANGED"
  | "WEAK_CANDIDATE_PRESERVE_THREAD_CONFLICT"
  | "WEAK_CANDIDATE_PRESERVE_CONTACT_STEER"
  | "AUTH_CONTACT_RECOVERY_MATCH"
  | "AUTH_CONTACT_RECOVERY_WRONG"
  | "FAMILY_DISAMBIGUATION_DELTA"
  | "CONTACT_SAFETY_ABSTAIN"
  | "THREAD_RESOLUTION_DELTA"
  | "NAME_RESOLUTION_DELTA"
  | "OTHER_DECISION_DELTA";

export type PolicyChangeAttribution = {
  reason: PolicyChangeReasonCode;
  detail: string;
};

export type CompareSideDiagnosticsLite = {
  decision: string;
  outcome: HistoricalEvalOutcome;
  predictedJobId: string | null;
  resolvingMarker: string | null;
  identityStrength?: string | null;
  identityReason?: string | null;
  strongIdentityAnchor?: boolean | null;
  contactReason?: string | null;
  nameCandidateCount?: number | null;
  contactCandidateCount?: number | null;
  threadCandidateCount?: number | null;
  finalCandidateCount?: number | null;
  gtInNameCandidates?: boolean | null;
  gtInFinalCandidates?: boolean | null;
};

/**
 * Attribute a V2 → V2.1 (or similar) decision change using structured diagnostics.
 * Deterministic heuristics aligned with known policy deltas — not ML.
 */
export function attributePolicyChange(input: {
  baseline: CompareSideDiagnosticsLite;
  proposed: CompareSideDiagnosticsLite;
  trueJobId: string;
}): PolicyChangeAttribution {
  const from = outcomeToLabel(input.baseline.outcome);
  const to = outcomeToLabel(input.proposed.outcome);
  if (from === to && input.baseline.predictedJobId === input.proposed.predictedJobId) {
    return { reason: "UNCHANGED", detail: "Same outcome and predicted Job" };
  }

  const baseNameCand = input.baseline.nameCandidateCount ?? null;
  const propNameCand = input.proposed.nameCandidateCount ?? null;
  const weakPreserve =
    (baseNameCand === 0 || baseNameCand == null) &&
    propNameCand != null &&
    propNameCand > 0 &&
    (input.baseline.identityStrength === "WEAK" ||
      input.proposed.identityStrength === "WEAK");

  if (
    weakPreserve &&
    to === "CONFLICT" &&
    (from === "CORRECT" || from === "AMBIGUOUS" || from === "WRONG")
  ) {
    return {
      reason: "WEAK_CANDIDATE_PRESERVE_THREAD_CONFLICT",
      detail:
        "Proposed policy preserved weak name candidates that later conflicted with authoritative thread evidence",
    };
  }

  if (
    input.proposed.contactReason ===
      "VERIFIED_AUTHORITATIVE_SINGLE_JOB_CONTACT" &&
    input.baseline.contactReason !==
      "VERIFIED_AUTHORITATIVE_SINGLE_JOB_CONTACT"
  ) {
    if (to === "WRONG") {
      return {
        reason: "AUTH_CONTACT_RECOVERY_WRONG",
        detail: "AUTH single-Job contact recovery authorized an incorrect MATCH",
      };
    }
    if (to === "CORRECT") {
      return {
        reason: "AUTH_CONTACT_RECOVERY_MATCH",
        detail: "AUTH single-Job contact recovery authorized a correct MATCH",
      };
    }
  }

  if (
    weakPreserve &&
    input.proposed.resolvingMarker === "CONTACT" &&
    input.baseline.resolvingMarker !== "CONTACT"
  ) {
    return {
      reason: "WEAK_CANDIDATE_PRESERVE_CONTACT_STEER",
      detail: "Preserved weak name candidates steered Marker 2 contact narrowing",
    };
  }

  if (
    input.baseline.identityReason !== input.proposed.identityReason &&
    (input.baseline.resolvingMarker === "NAME" ||
      input.proposed.resolvingMarker === "NAME")
  ) {
    return {
      reason: "NAME_RESOLUTION_DELTA",
      detail: `Name identity reason ${input.baseline.identityReason ?? "∅"} → ${input.proposed.identityReason ?? "∅"}`,
    };
  }

  if (
    (input.baseline.contactReason ?? null) !==
      (input.proposed.contactReason ?? null) &&
    to === "AMBIGUOUS"
  ) {
    return {
      reason: "CONTACT_SAFETY_ABSTAIN",
      detail: `Contact reason ${input.baseline.contactReason ?? "∅"} → ${input.proposed.contactReason ?? "∅"}`,
    };
  }

  if (
    input.baseline.resolvingMarker === "THREAD" ||
    input.proposed.resolvingMarker === "THREAD"
  ) {
    return {
      reason: "THREAD_RESOLUTION_DELTA",
      detail: `Thread path ${from} → ${to}`,
    };
  }

  return {
    reason: "OTHER_DECISION_DELTA",
    detail: `${from} → ${to}`,
  };
}

export type NewlyWrongBreakdown = {
  /** Baseline CORRECT → proposed WRONG */
  correctToWrong: number;
  /** Baseline unresolved → proposed WRONG */
  unresolvedToWrong: number;
  /** Baseline WRONG → proposed WRONG with different Job */
  wrongDifferentJob: number;
  totalNewlyWrong: number;
  /** Baseline WRONG → proposed CORRECT */
  wrongToCorrect: number;
};

export function summarizeNewlyWrong(input: {
  transitions: Record<string, number>;
  wrongDifferentJob?: number;
}): NewlyWrongBreakdown {
  const t = input.transitions;
  const correctToWrong = t.CORRECT_TO_WRONG ?? 0;
  const unresolvedToWrong =
    (t.AMBIGUOUS_TO_WRONG ?? 0) +
    (t.CONFLICT_TO_WRONG ?? 0) +
    (t.NO_MATCH_TO_WRONG ?? 0) +
    (t.UNRESOLVED_TO_WRONG ?? 0);
  const wrongDifferentJob = input.wrongDifferentJob ?? 0;
  const wrongToCorrect =
    (t.WRONG_TO_CORRECT ?? 0);
  return {
    correctToWrong,
    unresolvedToWrong,
    wrongDifferentJob,
    totalNewlyWrong: correctToWrong + unresolvedToWrong + wrongDifferentJob,
    wrongToCorrect,
  };
}

/** Ranked failure categories for WRONG_MATCH rows (deterministic heuristics). */
export type WrongMatchFailureCategory =
  | "PROJECT_IDENTITY_RESOLUTION"
  | "SIMILAR_PROJECT_NAME"
  | "CONTACT_ASSOCIATION"
  | "THREAD_CONTAMINATION"
  | "MULTI_JOB_REFERENCE"
  | "WEAK_EVIDENCE_OVERRIDE"
  | "PREMATURE_CANDIDATE_ELIMINATION"
  | "GROUND_TRUTH_REVIEW"
  | "OTHER";

export function classifyWrongMatchFailure(input: {
  resolvingMarker: string | null;
  identityStrength?: string | null;
  identityReason?: string | null;
  contactReason?: string | null;
  gtInNameCandidates?: boolean | null;
  gtInFinalCandidates?: boolean | null;
  nameCandidateCount?: number | null;
  sharedNameTokens?: boolean | null;
  groundTruthReviewFlag?: boolean;
}): WrongMatchFailureCategory {
  if (input.groundTruthReviewFlag) return "GROUND_TRUTH_REVIEW";
  if (input.gtInFinalCandidates === false && input.gtInNameCandidates === true) {
    return "PREMATURE_CANDIDATE_ELIMINATION";
  }
  if (input.resolvingMarker === "THREAD") return "THREAD_CONTAMINATION";
  if (input.resolvingMarker === "CONTACT") return "CONTACT_ASSOCIATION";
  if (
    input.identityStrength === "WEAK" ||
    input.identityReason === "GENERIC_TERM_ONLY" ||
    input.identityReason === "NON_CONTIGUOUS_TOKEN_OVERLAP"
  ) {
    return "WEAK_EVIDENCE_OVERRIDE";
  }
  if ((input.nameCandidateCount ?? 0) > 1) return "MULTI_JOB_REFERENCE";
  if (input.sharedNameTokens) return "SIMILAR_PROJECT_NAME";
  if (input.resolvingMarker === "NAME") return "PROJECT_IDENTITY_RESOLUTION";
  return "OTHER";
}

export type UnresolvedRecoverability =
  | "SAFELY_RECOVERABLE"
  | "POTENTIALLY_RECOVERABLE"
  | "GENUINELY_AMBIGUOUS"
  | "INSUFFICIENT_EVIDENCE";

export function classifyUnresolvedRecoverability(input: {
  outcome: HistoricalEvalOutcome;
  gtInFinalCandidates: boolean | null;
  gtInNameCandidates: boolean | null;
  finalCandidateCount: number | null;
  strongIdentityAnchor: boolean | null;
  contactReason?: string | null;
  identityReason?: string | null;
}): UnresolvedRecoverability {
  if (input.outcome === "CORRECT_MATCH" || input.outcome === "WRONG_MATCH") {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (input.finalCandidateCount === 0 && input.gtInNameCandidates !== true) {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (
    input.gtInFinalCandidates === true &&
    (input.finalCandidateCount === 1 ||
      (input.strongIdentityAnchor === true &&
        input.gtInNameCandidates === true &&
        (input.finalCandidateCount ?? 99) <= 2))
  ) {
    return "SAFELY_RECOVERABLE";
  }
  if (input.gtInFinalCandidates === true || input.gtInNameCandidates === true) {
    return "POTENTIALLY_RECOVERABLE";
  }
  if ((input.finalCandidateCount ?? 0) >= 2) return "GENUINELY_AMBIGUOUS";
  return "INSUFFICIENT_EVIDENCE";
}
