/**
 * Deterministic BidCandidate identity keys for idempotent staging upserts.
 */

import { normalizeName } from "../reference/normalize.js";
import { normalizeBiddingProjectName } from "./project-name-similarity.js";

export function buildBidCandidateIdentityKey(input: {
  projectNumber?: string | null;
  projectName?: string | null;
  customerName?: string | null;
  /** Fallback when no project identity — one candidate per message. */
  fallbackMessageId?: string | null;
}): string | null {
  const num = input.projectNumber?.trim().toLowerCase();
  if (num) return `num:${num}`;

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
 */
export function buildQuoteProjectGroupKey(input: {
  projectNumber?: string | null;
  projectName?: string | null;
  customerName?: string | null;
  fallbackMessageId?: string | null;
}): string | null {
  const num = input.projectNumber?.trim().toLowerCase();
  if (num) return `qnum:${num}`;

  const name = normalizeBiddingProjectName(input.projectName);
  if (name && name.length >= 3) {
    const cust = normalizeName(input.customerName ?? "");
    return cust ? `qname:${name}|cust:${cust}` : `qname:${name}`;
  }

  const msg = input.fallbackMessageId?.trim();
  if (msg) return `qmsg:${msg}`;
  return null;
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
  if (qNum && cNum && qNum === cNum) {
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
