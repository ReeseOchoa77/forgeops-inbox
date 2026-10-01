/**
 * Defense-in-depth: suppress classifier-generated Tasks whose only purpose is
 * submitting a bidding opportunity (canonical deadline lives on Job.bidDueAt).
 *
 * Callers must only filter automatic extraction candidates — never user Tasks.
 *
 * ESTIMATE_QUOTE is intentionally excluded from subtype gating — quote/pricing
 * language there is often real customer work, not an external ITB opportunity.
 */

export const BIDDING_OPPORTUNITY_SUBTYPES = new Set([
  "BID_OPPORTUNITY",
  "BID_UPDATE",
]);

export function isBiddingOpportunitySubtype(
  businessTypeKey: string | null | undefined
): boolean {
  return Boolean(
    businessTypeKey && BIDDING_OPPORTUNITY_SUBTYPES.has(businessTypeKey)
  );
}

/** Subject looks like an external invitation-to-bid (when subtype missing). */
export function subjectLooksLikeBidInvitation(
  subject: string | null | undefined
): boolean {
  const s = (subject ?? "").trim();
  if (!s) return false;
  return (
    /\b(?:invitation\s+to\s+bid|invite\s+to\s+bid|\bitb\b|bid\s+invitation|request\s+for\s+(?:bid|proposal)|\brfp\b|\brfq\b)\b/i.test(
      s
    ) || /\breminder\s+to\s+submit\s+your\s+(?:bid|proposal|pricing)\b/i.test(s)
  );
}

export type BidTaskCandidateLike = {
  title: string;
  description?: string | null | undefined;
};

/** Distinct actionable work that may appear on bidding emails — keep these. */
const LEGITIMATE_BIDDING_ACTION =
  /\b(?:confirm(?:\s+your)?\s+intent|confirm(?:\s+your)?\s+participation|intent\s+to\s+bid|rsvp|pre[-\s]?bid|walkthrough|site\s+visit|bidder\s+questions?|submit\s+(?:an?\s+)?(?:rfi|question|questions|substitution)|send\s+(?:questions?|rfi|substitution)|insurance|certificate|takeoff|respond\s+to\s+(?:addendum|clarification))\b/i;

/**
 * Semantic shape of "just submit the opportunity / meet the bid deadline".
 * Narrow — does not match every use of bid/quote/pricing.
 */
const BID_SUBMISSION_OPPORTUNITY_TASK =
  /\b(?:submit(?:\s+your)?\s+(?:bid|proposal|pricing|quote|estimate)|(?:bid|proposal|pricing|quote|estimate)s?\s+(?:are\s+)?due|(?:bid|proposal)\s+deadline|(?:provide|send|complete)\s+(?:a\s+|the\s+)?(?:bid|proposal|pricing|quote)|respond\s+to\s+(?:this\s+)?(?:itb|rfp|rfq|invitation)|reminder[:\s].*(?:bid|proposal|pricing)|(?:update|extend(?:ed)?)\s+(?:the\s+)?bid(?:\s+deadline)?|bid\s+date\s+(?:extended|changed|updated))\b/i;

export function biddingTaskFilterContextActive(input: {
  businessTypeKey?: string | null | undefined;
  subject?: string | null | undefined;
}): boolean {
  return (
    isBiddingOpportunitySubtype(input.businessTypeKey) ||
    subjectLooksLikeBidInvitation(input.subject)
  );
}

/**
 * True when the task is opportunity metadata (submit the bid itself), not a
 * separate actionable ask.
 */
export function isBidSubmissionOpportunityTask(
  task: BidTaskCandidateLike,
  opts?: {
    businessTypeKey?: string | null | undefined;
    subject?: string | null | undefined;
  }
): boolean {
  if (!biddingTaskFilterContextActive(opts ?? {})) return false;

  const text = `${task.title}\n${task.description ?? ""}`.trim();
  if (!text) return false;

  // Distinct action wins even if bid-due language also appears.
  if (LEGITIMATE_BIDDING_ACTION.test(text)) return false;

  if (BID_SUBMISSION_OPPORTUNITY_TASK.test(text)) return true;

  // Legacy heuristic often titles the Task with the invitation subject itself.
  if (subjectLooksLikeBidInvitation(task.title)) return true;
  if (
    /^(?:bid(?:ding)?\s+opportunity|bid\s+deadline|project\s+bid)\b/i.test(
      task.title.trim()
    )
  ) {
    return true;
  }

  return false;
}

export function filterOutBidSubmissionTasks<T extends BidTaskCandidateLike>(
  tasks: readonly T[],
  opts: {
    businessTypeKey?: string | null | undefined;
    subject?: string | null | undefined;
  }
): T[] {
  if (!biddingTaskFilterContextActive(opts)) return [...tasks];
  return tasks.filter((task) => !isBidSubmissionOpportunityTask(task, opts));
}
