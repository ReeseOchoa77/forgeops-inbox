/**
 * Suppress auto-generated Tasks for raw bidding opportunities (V1).
 *
 * BID_OPPORTUNITY / BID_UPDATE emails are intake signals, not active bids.
 * They must not create normal Tasks (or Calendar items via Task.dueAt) until the
 * user explicitly creates a Job with status BIDDING.
 *
 * Canonical active-bid deadline is Job.bidDueAt — not a classifier Task.
 *
 * Heuristic / n8n paths without a resolved subtype still use invitation-subject
 * detection so "Invitation to Bid…" does not mint Tasks.
 *
 * Existing legacy rows are excluded from Calendar via structural provenance in
 * `calendar/bidding-calendar-inclusion.ts` (BID_* + source EmailMessage.jobId).
 */

export type BidSubmissionTaskFilterContext = {
  businessTypeKey?: string | null;
  subject?: string | null;
};

const BID_INVITATION_SUBJECT =
  /\b(?:invitation\s+to\s+bid|invite\s+to\s+bid|request\s+for\s+(?:bid|proposal)|ITB|RFP)\b/i;

/**
 * True when this email is a raw bidding opportunity (not an active BIDDING Job).
 * Used to suppress ALL classifier/heuristic auto-Tasks for that email.
 */
export function isRawBiddingOpportunityContext(
  ctx: BidSubmissionTaskFilterContext
): boolean {
  const key = (ctx.businessTypeKey ?? "").trim().toUpperCase();
  if (key === "BID_OPPORTUNITY" || key === "BID_UPDATE") return true;
  return subjectLooksLikeBidInvitation(ctx.subject);
}

export function subjectLooksLikeBidInvitation(
  subject: string | null | undefined
): boolean {
  const s = (subject ?? "").trim();
  if (!s) return false;
  return BID_INVITATION_SUBJECT.test(s);
}

/**
 * @deprecated Prefer `isRawBiddingOpportunityContext` — V1 suppresses all auto
 * Tasks for raw bidding opportunities, not only "submit bid" shapes.
 * Kept for diagnostic/title-shape helpers and older call sites.
 */
export function isBidSubmissionOpportunityTask(
  _task: { title: string; description?: string | null },
  ctx: BidSubmissionTaskFilterContext
): boolean {
  return isRawBiddingOpportunityContext(ctx);
}

/**
 * Drop auto-generated Task candidates for raw bidding-opportunity emails.
 * Non-bidding subtypes are unchanged.
 */
export function filterOutBidSubmissionTasks<
  T extends { title: string; description?: string | null },
>(tasks: T[], ctx: BidSubmissionTaskFilterContext): T[] {
  if (!isRawBiddingOpportunityContext(ctx)) return tasks;
  return [];
}
