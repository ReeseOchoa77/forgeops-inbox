/**
 * Deterministic bid-submission deadline extraction.
 * Only matches phrases that clearly mean the bid/proposal due date.
 * Prefers NULL over guessing (pre-bid, RFI, site visit, send date, etc.).
 */

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/** Context that indicates a bid SUBMISSION deadline (not meetings / RFIs). */
const BID_DUE_ANCHOR =
  /(?:bids?\s+(?:are\s+)?due|submit\s+(?:your\s+)?(?:bid|pricing|proposal)s?\s+by|bid\s+(?:submission\s+)?deadline|bid\s+date\s*:|proposals?\s+(?:are\s+)?due|pricing\s+(?:is\s+)?due|please\s+submit\s+(?:pricing|bids?|proposals?)\s+by)/i;

/** Nearby date after an anchor (month name or numeric). */
const DATE_AFTER =
  /\s*(?:on\s+|by\s+|at\s+)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:,?\s*\d{4})?)/i;

/** Phrases that must NOT drive a bid-due suggestion when they are the only date context. */
const NON_BID_DEADLINE =
  /\b(?:pre[-\s]?bid|site\s+visit|walkthrough|rfi\s+deadline|questions?\s+due|addendum|meeting|kickoff|start\s+date|delivery)\b/i;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(year: number, monthIndex: number, day: number): string | null {
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (monthIndex < 0 || monthIndex > 11) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, monthIndex, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== monthIndex ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function parseDateToken(token: string, nowYear: number): string | null {
  const t = token.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return toYmd(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const us = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (us) {
    const month = Number(us[1]) - 1;
    const day = Number(us[2]);
    let year = Number(us[3] ?? nowYear);
    if (year < 100) year += 2000;
    return toYmd(year, month, day);
  }
  const named = t.match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i
  );
  if (named?.[1] && named[2]) {
    const monthIndex = MONTHS[named[1].toLowerCase().replace(/\.$/, "")];
    if (monthIndex == null) return null;
    const day = Number(named[2]);
    const year = Number(named[3] ?? nowYear);
    return toYmd(year, monthIndex, day);
  }
  return null;
}

/**
 * Extract YYYY-MM-DD bid submission deadline from subject/body, or null.
 */
export function extractBidDueDateDeterministic(input: {
  subject?: string | null;
  bodyText?: string | null;
  now?: Date;
}): string | null {
  const now = input.now ?? new Date();
  const nowYear = now.getUTCFullYear();
  const haystack = [input.subject ?? "", input.bodyText ?? ""].join("\n");
  if (!haystack.trim()) return null;

  // Scan for bid-due anchors; take the first clearly dated one.
  const re = new RegExp(BID_DUE_ANCHOR.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(haystack)) != null) {
    const from = match.index;
    const window = haystack.slice(from, from + 120);
    // Skip if this window is clearly about a non-bid event.
    if (NON_BID_DEADLINE.test(window) && !/bids?\s+(?:are\s+)?due/i.test(window)) {
      continue;
    }
    const dateMatch = window.match(DATE_AFTER);
    if (!dateMatch?.[1]) continue;
    const ymd = parseDateToken(dateMatch[1], nowYear);
    if (ymd) return ymd;
  }

  return null;
}
