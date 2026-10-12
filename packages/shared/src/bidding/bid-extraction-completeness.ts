/**
 * Helpers deciding when optional AI enrichment is warranted for Bid/Quote staging.
 */

import {
  isDetailedScopeComplete,
  type DetailedScope,
} from "./scope-detail.js";

export function bidFieldsNeedAiEnrichment(fields: {
  projectName: string | null;
  customerName: string | null;
  bidDueAt: Date | string | null;
  projectNumber: string | null;
  scope?: string | null;
  /** When false/undefined with evidence available, AI may enrich detailed scope. */
  scopeDetailComplete?: boolean;
  /** Evidence text available for scope enrichment (body or PDF). */
  hasScopeEvidence?: boolean;
}): boolean {
  const hasName = Boolean(fields.projectName?.trim());
  const hasDue = fields.bidDueAt != null && String(fields.bidDueAt).length > 0;
  const hasCustomer = Boolean(fields.customerName?.trim());

  // Detailed scope incomplete with usable evidence → AI enrichment allowed.
  if (
    fields.hasScopeEvidence &&
    fields.scopeDetailComplete === false
  ) {
    return true;
  }

  // Complete enough for READY without AI (identity fields).
  if (hasName && hasDue && hasCustomer) return false;
  if (hasName && hasDue) return false;
  return true;
}

export function quoteFieldsNeedAiEnrichment(fields: {
  amount: number | null;
  scope: string | null;
  scopeDetail?: DetailedScope | null;
  /** PDF text usable but deterministic missed amount/scope */
  hasUsablePdfText?: boolean;
  hasBodyEvidence?: boolean;
}): boolean {
  const detailComplete = isDetailedScopeComplete(fields.scopeDetail);
  const hasEvidence = Boolean(fields.hasUsablePdfText || fields.hasBodyEvidence);

  // Generic trade-only scope is incomplete — allow AI when evidence exists.
  if (!detailComplete && hasEvidence) return true;

  if (fields.amount != null && detailComplete) return false;
  if (fields.amount != null && !fields.hasUsablePdfText && detailComplete) {
    return false;
  }
  if (fields.hasUsablePdfText && (fields.amount == null || !detailComplete)) {
    return true;
  }
  return fields.amount == null && !detailComplete;
}

/** Deterministic Quote→Bid scores in this band may use AI shortlist adjudication. */
export function quoteMatchNeedsAiAdjudication(input: {
  bestScore: number;
  secondScore: number | null;
  autoLinkThreshold: number;
  reviewThreshold: number;
}): boolean {
  const { bestScore, secondScore, autoLinkThreshold, reviewThreshold } = input;
  if (bestScore >= autoLinkThreshold) return false;
  if (bestScore < reviewThreshold) return false;
  if (secondScore != null && bestScore - secondScore < 0.12) return true;
  return bestScore < autoLinkThreshold && bestScore >= reviewThreshold;
}

export function existingJobNeedsAiAdjudication(status: string): boolean {
  return status === "NEEDS_REVIEW" || status === "POSSIBLE";
}
