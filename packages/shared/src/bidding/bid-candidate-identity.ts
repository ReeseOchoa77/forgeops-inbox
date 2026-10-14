/**
 * Deterministic BidCandidate identity keys for idempotent staging upserts.
 */

import { normalizeName } from "../reference/normalize.js";
import { normalizeBiddingProjectName } from "./project-name-similarity.js";
import { parseSequentialJobNumber } from "./suggest-next-job-number.js";

/**
 * Whether a project/job number is distinctive enough to act as a *standalone*
 * Quote-group or Candidate identity key.
 *
 * Prefer false split over false merge: short generics (01, 25) and calendar
 * years (2025, 2026) must not independently collapse unrelated projects.
 * Reuses shop sequential formats from {@link parseSequentialJobNumber}.
 */
export function isTrustworthyBiddingProjectNumber(
  raw: string | null | undefined
): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;

  const parsed = parseSequentialJobNumber(trimmed);
  if (parsed?.kind === "yy-seq") {
    // Shop convention e.g. "26-200" — distinctive as a whole token.
    return true;
  }

  if (parsed?.kind === "plain") {
    const digits = parsed.raw;
    // 01, 02, 25, 26, etc. — too generic for sole identity.
    if (digits.length < 3) return false;
    // Calendar years commonly appear in subjects; never sole identity.
    if (
      digits.length === 4 &&
      parsed.value >= 1900 &&
      parsed.value <= 2099
    ) {
      return false;
    }
    return true;
  }

  // Other formats (e.g. "J-1000"): require letter + digit and enough length.
  if (
    trimmed.length >= 4 &&
    /[a-zA-Z]/.test(trimmed) &&
    /\d/.test(trimmed)
  ) {
    return true;
  }

  return false;
}

/**
 * Candidate identity for idempotent upserts.
 *
 * `num:` may only come from an *external* customer/GC project or bid number
 * (email evidence). Never pass a ForgeOps Job number — Candidates do not
 * consume Job numbering.
 */
export function buildBidCandidateIdentityKey(input: {
  /**
   * External customer/GC project or bid number from email/evidence.
   * Preferred over deprecated projectNumber.
   */
  externalProjectNumber?: string | null;
  /**
   * @deprecated Alias for externalProjectNumber. Must NOT be a ForgeOps Job number.
   */
  projectNumber?: string | null;
  projectName?: string | null;
  customerName?: string | null;
  /** Fallback when no project identity — one candidate per message / manual create. */
  fallbackMessageId?: string | null;
}): string | null {
  const num = (
    input.externalProjectNumber ?? input.projectNumber
  )?.trim().toLowerCase();
  if (num && isTrustworthyBiddingProjectNumber(num)) return `num:${num}`;

  const name = normalizeName(input.projectName ?? "");
  if (name && name.length >= 3) {
    const cust = normalizeName(input.customerName ?? "");
    return cust ? `name:${name}|cust:${cust}` : `name:${name}`;
  }

  const msg = input.fallbackMessageId?.trim();
  if (msg) return `msg:${msg}`;
  return null;
}

/**
 * Quote-first project group key — strips bidding wrappers so Quote revisions
 * ("Rev 2", "Revised Quote") collapse to one Candidate when the project matches.
 *
 * Trustworthy project numbers may group alone (`qnum:`). Weak/generic numbers
 * never establish sole identity — fall back to normalized name/customer.
 */
export function buildQuoteProjectGroupKey(input: {
  projectNumber?: string | null;
  projectName?: string | null;
  customerName?: string | null;
  fallbackMessageId?: string | null;
}): string | null {
  const num = input.projectNumber?.trim().toLowerCase();
  if (num && isTrustworthyBiddingProjectNumber(num)) return `qnum:${num}`;

  const name = normalizeBiddingProjectName(input.projectName);
  if (name && name.length >= 3) {
    const cust = normalizeName(input.customerName ?? "");
    return cust ? `qname:${name}|cust:${cust}` : `qname:${name}`;
  }

  const msg = input.fallbackMessageId?.trim();
  if (msg) return `qmsg:${msg}`;
  return null;
}

/** Inexpensive evidence label for how a Quote group key was formed. */
export function quoteGroupKeyBasisLabel(groupKey: string): string {
  if (groupKey.startsWith("qnum:")) return "group_by_strong_project_number";
  if (groupKey.startsWith("qname:") && groupKey.includes("|cust:")) {
    return "group_by_project_name_customer";
  }
  if (groupKey.startsWith("qname:")) return "group_by_project_name";
  if (groupKey.startsWith("qmsg:")) return "group_by_message";
  return "group_by_other";
}

/**
 * Deterministic Quote → BidCandidate score (0–1) from evidence labels.
 * No AI. Higher = stronger match.
 */
export function scoreQuoteToBidCandidate(input: {
  quoteProjectName?: string | null;
  quoteProjectNumber?: string | null;
  quoteCustomerName?: string | null;
  quoteSubject?: string | null;
  quoteAttachmentNames?: string[];
  candidate: {
    proposedProjectName?: string | null;
    proposedJobNumber?: string | null;
    proposedCustomerName?: string | null;
  };
}): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  let score = 0;

  const qNum = input.quoteProjectNumber?.trim().toLowerCase();
  const cNum = input.candidate.proposedJobNumber?.trim().toLowerCase();
  if (
    qNum &&
    cNum &&
    qNum === cNum &&
    isTrustworthyBiddingProjectNumber(qNum)
  ) {
    score += 0.55;
    evidence.push("project_number");
  }

  const qName = normalizeName(input.quoteProjectName ?? "");
  const cName = normalizeName(input.candidate.proposedProjectName ?? "");
  if (qName && cName && qName === cName) {
    score += 0.35;
    evidence.push("project_name_exact");
  } else if (qName && cName && (qName.includes(cName) || cName.includes(qName))) {
    score += 0.18;
    evidence.push("project_name_partial");
  }

  const qCust = normalizeName(input.quoteCustomerName ?? "");
  const cCust = normalizeName(input.candidate.proposedCustomerName ?? "");
  if (qCust && cCust && qCust === cCust) {
    score += 0.12;
    evidence.push("customer_exact");
  }

  const subject = (input.quoteSubject ?? "").toLowerCase();
  if (cName && subject.includes(cName.replace(/\s+/g, " "))) {
    score += 0.08;
    evidence.push("subject_project");
  }

  const attachments = input.quoteAttachmentNames ?? [];
  for (const fn of attachments) {
    const n = normalizeName(fn);
    if (cName && n.includes(cName)) {
      score += 0.1;
      evidence.push("attachment_filename");
      break;
    }
  }

  return { score: Math.min(1, score), evidence };
}

/** Strong enough to auto-link Quote to BidCandidate (still not a Job). */
export const QUOTE_AUTO_LINK_THRESHOLD = 0.55;
/** Below this → unmatched / needs review. */
export const QUOTE_REVIEW_THRESHOLD = 0.35;
