/**
 * Helpers deciding when optional AI enrichment is warranted for Bid/Quote staging.
 */

export function bidFieldsNeedAiEnrichment(fields: {
  projectName: string | null;
  customerName: string | null;
  bidDueAt: Date | string | null;
  projectNumber: string | null;
  scope?: string | null;
}): boolean {
  const hasName = Boolean(fields.projectName?.trim());
  const hasDue = fields.bidDueAt != null && String(fields.bidDueAt).length > 0;
  const hasCustomer = Boolean(fields.customerName?.trim());
  // Complete enough for READY without AI.
  if (hasName && hasDue && hasCustomer) return false;
  // Name alone with due is often enough — still enrich if customer missing? Prefer
  // AI only when name OR due missing (operationally important).
  if (hasName && hasDue) return false;
  return true;
}

export function quoteFieldsNeedAiEnrichment(fields: {
  amount: number | null;
  scope: string | null;
  /** PDF text usable but deterministic missed amount/scope */
  hasUsablePdfText?: boolean;
}): boolean {
  if (fields.amount != null && fields.scope) return false;
  if (fields.amount != null && !fields.hasUsablePdfText) return false;
  // Amount missing with PDF evidence → AI may help; or scope missing with PDF.
  if (fields.hasUsablePdfText && (fields.amount == null || !fields.scope)) {
    return true;
  }
  // Body-only weak extract with neither amount nor scope → AI optional.
  return fields.amount == null && !fields.scope;
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
  // Ambiguous band: either mid score or tight race with runner-up.
  if (secondScore != null && bestScore - secondScore < 0.12) return true;
  return bestScore < autoLinkThreshold && bestScore >= reviewThreshold;
}

export function existingJobNeedsAiAdjudication(status: string): boolean {
  return status === "NEEDS_REVIEW" || status === "POSSIBLE";
}
