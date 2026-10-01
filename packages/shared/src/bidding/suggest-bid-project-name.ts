/**
 * Deterministic project-name suggestion for Add to Bidding (Create new bid).
 * Subject is authoritative; strips common invitation / reply boilerplate only.
 */

const REPLY_PREFIX = /^(?:re|fw|fwd)\s*:\s*/i;

/** Leading invitation wrappers — conservative, obvious boilerplate only. */
const INVITATION_PREFIXES: RegExp[] = [
  /^invitation\s+to\s+bid\s*[-–—:]\s*/i,
  /^invite\s+to\s+bid\s*[-–—:]\s*/i,
  /^itb\s*[-–—:]\s*/i,
  /^bid\s+invitation\s*[-–—:]\s*/i,
  /^request\s+for\s+(?:bid|proposal|quote)\s*[-–—:]\s*/i,
  /^rf[bpq]\s*[-–—:]\s*/i,
  /^reminder\s+to\s+submit\s+your\s+bids?\s+for\s+/i,
  /^reminder\s+to\s+submit\s+(?:your\s+)?(?:bid|pricing|proposal)\s+for\s+/i,
  /^reminder\s*[-–—:]\s*/i,
  /^please\s+submit\s+(?:your\s+)?(?:bid|pricing|proposal)\s+for\s+/i,
];

export function stripReplyPrefixes(subject: string): string {
  let cleaned = subject.trim();
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(REPLY_PREFIX, "").trim();
  }
  return cleaned;
}

export function stripBidInvitationPrefixes(subject: string): string {
  let cleaned = subject.trim();
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    for (const pattern of INVITATION_PREFIXES) {
      cleaned = cleaned.replace(pattern, "").trim();
    }
  }
  return cleaned;
}

/**
 * Suggest a project name from an email subject.
 * Does not invent names from body content.
 */
export function suggestBidProjectNameFromSubject(
  subject: string | null | undefined
): string | null {
  const raw = (subject ?? "").trim();
  if (!raw) return null;
  let cleaned = stripReplyPrefixes(raw);
  cleaned = stripBidInvitationPrefixes(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 300);
}

/**
 * Prefill helper: prefer an existing project name, else subject cleanup.
 */
export function suggestedBidName(
  subject: string | null | undefined,
  jobName?: string | null
): string {
  if (jobName?.trim()) return jobName.trim().slice(0, 300);
  return suggestBidProjectNameFromSubject(subject) ?? "";
}
