/**
 * Event reconciliation helpers — preserve history; flag conflicts; never erase.
 */

import type {
  JobIntelligenceExtractedEvent,
  JobIntelligenceEventStatusValue,
} from "./schemas.js";

export type StoredIntelligenceEventLite = {
  id: string;
  category: string;
  subtype: string | null;
  title: string;
  status: string;
  eventDate: Date | string | null;
  verificationStatus: string;
  contentFingerprint: string;
  supersededByEventId: string | null;
};

export type ScheduleSupersessionPlan = {
  /** Existing event that should be marked SUPERSEDED (history preserved). */
  previousEventId: string;
  /** New event carries the updated milestone. */
  reason: "schedule_date_change";
};

const SCHEDULE_TITLE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "for",
  "to",
  "of",
  "on",
  "and",
  "delivery",
  "date",
  "schedule",
  "scheduled",
  "moved",
  "confirmed",
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !SCHEDULE_TITLE_STOPWORDS.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * If a new SCHEDULE event looks like an update to an existing open milestone
 * with a different date, plan supersession (keep both rows; link previous → new).
 */
export function planScheduleSupersession(
  incoming: JobIntelligenceExtractedEvent,
  existing: StoredIntelligenceEventLite[]
): ScheduleSupersessionPlan | null {
  if (incoming.category !== "SCHEDULE") return null;
  if (!incoming.eventDate) return null;

  const incomingTokens = titleTokens(incoming.title);
  let best: { id: string; score: number; date: string } | null = null;

  for (const row of existing) {
    if (row.category !== "SCHEDULE") continue;
    if (row.supersededByEventId) continue;
    if (row.verificationStatus === "REJECTED") continue;
    if (row.contentFingerprint === incoming.contentFingerprint) continue;
    const prevDate =
      row.eventDate == null
        ? null
        : typeof row.eventDate === "string"
          ? row.eventDate.slice(0, 10)
          : row.eventDate.toISOString().slice(0, 10);
    if (!prevDate || prevDate === incoming.eventDate.slice(0, 10)) continue;
    const score = jaccard(incomingTokens, titleTokens(row.title));
    if (score < 0.34) continue;
    if (!best || score > best.score) {
      best = { id: row.id, score, date: prevDate };
    }
  }

  if (!best) return null;
  return { previousEventId: best.id, reason: "schedule_date_change" };
}

export type ConflictFlag = {
  type: "CONTRADICTION";
  category: string;
  existingEventId: string;
  message: string;
};

/**
 * Flag unresolved contradictions (e.g. two APPROVED amounts that differ) for review.
 * Does not auto-resolve or sum amounts.
 */
export function detectFinancialContradiction(
  incoming: JobIntelligenceExtractedEvent,
  existing: StoredIntelligenceEventLite[] &
    Array<{ financialKind?: string; amount?: unknown }>
): ConflictFlag | null {
  if (incoming.category !== "FINANCIAL") return null;
  if (incoming.financialKind !== "APPROVED" || incoming.amount == null) {
    return null;
  }
  for (const row of existing as Array<
    StoredIntelligenceEventLite & {
      financialKind?: string;
      amount?: number | string | null;
    }
  >) {
    if (row.category !== "FINANCIAL") continue;
    if (row.financialKind !== "APPROVED") continue;
    if (row.verificationStatus === "REJECTED") continue;
    if (row.supersededByEventId) continue;
    const amt =
      row.amount == null
        ? null
        : typeof row.amount === "number"
          ? row.amount
          : Number(row.amount);
    if (amt == null || !Number.isFinite(amt)) continue;
    if (Math.abs(amt - incoming.amount) < 0.01) continue;
    return {
      type: "CONTRADICTION",
      category: "FINANCIAL",
      existingEventId: row.id,
      message: `Conflicting APPROVED amounts: existing ${amt} vs incoming ${incoming.amount}`,
    };
  }
  return null;
}

export function shouldPreferIncomingStatus(
  previous: JobIntelligenceEventStatusValue,
  next: JobIntelligenceEventStatusValue
): boolean {
  const rank: Record<string, number> = {
    UNKNOWN: 0,
    PROPOSED: 1,
    REQUESTED: 2,
    TENTATIVE: 3,
    OPEN: 3,
    CONFIRMED: 4,
    APPROVED: 5,
    COMPLETED: 6,
    RESOLVED: 6,
    REJECTED: 7,
    CANCELED: 7,
    DISPUTED: 7,
    SUPERSEDED: 8,
  };
  return (rank[next] ?? 0) >= (rank[previous] ?? 0);
}

/** Never sum financial kinds into a single contract value. */
export function assertNoBlindFinancialSum(_amounts: number[]): null {
  return null;
}
