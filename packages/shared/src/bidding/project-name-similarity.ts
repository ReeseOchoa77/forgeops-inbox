/**
 * Project/name similarity for Quote → Bid Invite / Inbox reconstruction.
 * Strips bidding wrappers; does not invent project identity.
 */

import { normalizeName } from "../reference/normalize.js";

const WRAPPER_PATTERNS: RegExp[] = [
  /^\s*((re|fw|fwd)\s*:\s*)+/i,
  /\b(invitation\s+to\s+bid|invite\s+to\s+bid|bid\s+invite|bid\s+invitation|itb)\b/gi,
  /\b(request\s+for\s+(?:quote|proposal|bid)|rfq|rfp)\b/gi,
  /\b(pricing\s+request|bid\s+request|proposal\s+request)\b/gi,
  /\b(revised?\s+quote|quote|proposal|estimate)\b/gi,
  /\b(rev(?:ision)?\s*#?\s*\d+)\b/gi,
  /\b(structural\s+steel|miscellaneous\s+metals|misc\.?\s+metals)\b/gi,
  /\b(addendum\s*#?\s*\d+)\b/gi,
];

/**
 * Strip common bidding wrappers from a subject/project string, then normalizeName.
 */
export function normalizeBiddingProjectName(
  raw: string | null | undefined
): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  for (const re of WRAPPER_PATTERNS) {
    s = s.replace(re, " ");
  }
  s = s.replace(/[-_|/]+/g, " ").replace(/\s+/g, " ").trim();
  return normalizeName(s);
}

/**
 * Similarity score 0–1 between two project-oriented strings.
 * Exact normalized match = 1; containment / token overlap otherwise.
 */
export function scoreProjectNameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
): { score: number; evidence: string[] } {
  const na = normalizeBiddingProjectName(a);
  const nb = normalizeBiddingProjectName(b);
  const evidence: string[] = [];
  if (!na || !nb || na.length < 3 || nb.length < 3) {
    return { score: 0, evidence };
  }
  if (na === nb) {
    return { score: 1, evidence: ["project_name_exact"] };
  }
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    const ratio = shorter / longer;
    const score = 0.55 + 0.35 * ratio;
    evidence.push("project_name_contains");
    return { score: Math.min(0.95, score), evidence };
  }

  const ta = new Set(na.split(" ").filter((t) => t.length >= 3));
  const tb = new Set(nb.split(" ").filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return { score: 0, evidence };
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  const jaccard = overlap / new Set([...ta, ...tb]).size;
  if (jaccard >= 0.5 && overlap >= 2) {
    evidence.push("project_name_tokens");
    return { score: Math.min(0.75, 0.35 + jaccard * 0.5), evidence };
  }
  if (jaccard >= 0.34 && overlap >= 1) {
    evidence.push("project_name_weak_tokens");
    return { score: Math.min(0.45, 0.2 + jaccard * 0.4), evidence };
  }
  return { score: 0, evidence };
}

/** Default days to search Bid Invites / Inbox before the Quote range start. */
export const BID_INVITE_LOOKBACK_DAYS = 180;

export function resolveBidInviteSearchSinceAt(
  quoteScanSinceAt: Date | null
): Date | null {
  if (!quoteScanSinceAt) return null;
  return new Date(
    quoteScanSinceAt.getTime() - BID_INVITE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );
}

/**
 * Score an email (invite/inbox) against Quote project identity.
 */
export function scoreEmailToQuoteProject(input: {
  emailSubject?: string | null;
  emailBodySnippet?: string | null;
  emailSenderName?: string | null;
  quoteProjectName?: string | null;
  quoteProjectNumber?: string | null;
  quoteCustomerName?: string | null;
  quoteSubject?: string | null;
}): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  let score = 0;

  const qNum = input.quoteProjectNumber?.trim().toLowerCase();
  const subject = input.emailSubject ?? "";
  if (qNum && new RegExp(`\\b${qNum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(subject)) {
    score += 0.55;
    evidence.push("project_number");
  }

  const nameSim = scoreProjectNameSimilarity(
    input.quoteProjectName ?? input.quoteSubject,
    subject
  );
  if (nameSim.score > 0) {
    // Exact normalized project identity is strong enough to auto-match alone.
    if (nameSim.score >= 0.95) {
      score += 0.55;
    } else {
      score += nameSim.score * 0.45;
    }
    evidence.push(...nameSim.evidence);
  }

  const body = input.emailBodySnippet ?? "";
  if (body && input.quoteProjectName) {
    const bodySim = scoreProjectNameSimilarity(input.quoteProjectName, body.slice(0, 2000));
    if (bodySim.score >= 0.55) {
      score += 0.12;
      evidence.push("body_project");
    }
  }

  const qCust = normalizeName(input.quoteCustomerName ?? "");
  const sender = normalizeName(input.emailSenderName ?? "");
  if (qCust && sender && (qCust === sender || sender.includes(qCust) || qCust.includes(sender))) {
    score += 0.1;
    evidence.push("customer_sender");
  }

  // Soft bid-language boost — never sufficient alone.
  if (
    /\b(invitation\s+to\s+bid|itb|request\s+for\s+quote|rfq|bid\s+due|bids?\s+due)\b/i.test(
      subject
    )
  ) {
    score += 0.05;
    evidence.push("bid_language");
  }

  return { score: Math.min(1, score), evidence };
}

export const ORIGINAL_BID_AUTO_MATCH_THRESHOLD = 0.55;
export const ORIGINAL_BID_REVIEW_THRESHOLD = 0.35;
