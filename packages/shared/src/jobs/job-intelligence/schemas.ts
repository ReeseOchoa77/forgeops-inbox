/**
 * Runtime validation for Job Intelligence structured extraction output.
 * Manual parsers (no Zod) — match bidding-intake style.
 */

import { createHash } from "node:crypto";

import {
  JOB_INTELLIGENCE_MAX_EVENTS_PER_EMAIL,
  JOB_INTELLIGENCE_SCHEMA_VERSION,
} from "./constants.js";

export const JOB_INTELLIGENCE_CATEGORIES = [
  "FINANCIAL",
  "SCOPE",
  "SCHEDULE",
  "RFI_TECHNICAL",
  "RISK_CHANGE",
  "CONTACT",
  "DECISION_COMMITMENT",
  "OTHER",
] as const;

export type JobIntelligenceCategory =
  (typeof JOB_INTELLIGENCE_CATEGORIES)[number];

export const JOB_INTELLIGENCE_EVENT_STATUSES = [
  "PROPOSED",
  "REQUESTED",
  "TENTATIVE",
  "CONFIRMED",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "CANCELED",
  "SUPERSEDED",
  "OPEN",
  "RESOLVED",
  "DISPUTED",
  "UNKNOWN",
] as const;

export type JobIntelligenceEventStatusValue =
  (typeof JOB_INTELLIGENCE_EVENT_STATUSES)[number];

export const JOB_INTELLIGENCE_FINANCIAL_KINDS = [
  "ESTIMATE",
  "QUOTE",
  "PROPOSAL",
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "INVOICED",
  "PAID",
  "DISPUTED",
  "CREDIT",
  "BACKCHARGE",
  "CHANGE_ORDER",
  "OTHER",
  "NONE",
] as const;

export type JobIntelligenceFinancialKindValue =
  (typeof JOB_INTELLIGENCE_FINANCIAL_KINDS)[number];

export type JobIntelligenceEvidence = {
  sourceEmailId: string;
  sourceAttachmentId: string | null;
  excerpt: string;
  sourceRole: "PRIMARY" | "QUOTED" | "ATTACHMENT";
};

export type JobIntelligenceExtractedEvent = {
  category: JobIntelligenceCategory;
  subtype: string | null;
  title: string;
  description: string;
  eventDate: string | null;
  eventDatePrecision: "DAY" | "MONTH" | "YEAR" | "UNKNOWN" | null;
  status: JobIntelligenceEventStatusValue;
  confidence: number | null;
  financialKind: JobIntelligenceFinancialKindValue;
  amount: number | null;
  currency: string | null;
  parties: string[];
  fabricationItems: string[];
  relatedFingerprintHint: string | null;
  evidence: JobIntelligenceEvidence[];
  /** Set after validation — deterministic fingerprint for upsert. */
  contentFingerprint: string;
};

export type JobIntelligenceExtractionResult = {
  events: JobIntelligenceExtractedEvent[];
  rejectedCount: number;
  issues: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  if (typeof value !== "string") return null;
  const u = value.trim().toUpperCase() as T;
  return allowed.includes(u) ? u : null;
}

function asAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[$,]/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asConfidence(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function asStringList(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = asString(item, 200);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function hashExcerpt(excerpt: string): string {
  return createHash("sha256").update(excerpt).digest("hex").slice(0, 32);
}

export function buildEventContentFingerprint(input: {
  category: string;
  subtype: string | null;
  title: string;
  financialKind: string;
  amount: number | null;
  eventDate: string | null;
  primaryEmailId: string | null;
}): string {
  const norm = [
    input.category,
    (input.subtype ?? "").toLowerCase().trim(),
    input.title.toLowerCase().replace(/\s+/g, " ").trim(),
    input.financialKind,
    input.amount == null ? "" : String(input.amount),
    input.eventDate ?? "",
    input.primaryEmailId ?? "",
  ].join("|");
  return createHash("sha256").update(norm).digest("hex").slice(0, 40);
}

export function isHumanProtectedVerification(
  status: string | null | undefined
): boolean {
  return (
    status === "HUMAN_VERIFIED" ||
    status === "HUMAN_CORRECTED" ||
    status === "REJECTED"
  );
}

/**
 * Validate raw LLM JSON. Rejects events with missing evidence or source IDs
 * not in the allowed set for this email batch.
 */
export function parseJobIntelligenceExtraction(
  raw: unknown,
  opts: {
    allowedEmailIds: Set<string>;
    allowedAttachmentIds: Set<string>;
  }
): JobIntelligenceExtractionResult {
  const issues: string[] = [];
  if (!isPlainObject(raw)) {
    return { events: [], rejectedCount: 0, issues: ["response must be a JSON object"] };
  }
  const eventsRaw = raw.events;
  if (!Array.isArray(eventsRaw)) {
    return { events: [], rejectedCount: 0, issues: ["events must be an array"] };
  }

  const events: JobIntelligenceExtractedEvent[] = [];
  let rejectedCount = 0;

  for (const item of eventsRaw.slice(0, JOB_INTELLIGENCE_MAX_EVENTS_PER_EMAIL)) {
    if (!isPlainObject(item)) {
      rejectedCount += 1;
      issues.push("event must be an object");
      continue;
    }
    const category = asEnum(item.category, JOB_INTELLIGENCE_CATEGORIES);
    const title = asString(item.title, 240);
    const description = asString(item.description, 4000);
    if (!category || !title || !description) {
      rejectedCount += 1;
      issues.push("event missing category/title/description");
      continue;
    }
    const status =
      asEnum(item.status, JOB_INTELLIGENCE_EVENT_STATUSES) ?? "UNKNOWN";
    const financialKind =
      asEnum(item.financialKind, JOB_INTELLIGENCE_FINANCIAL_KINDS) ?? "NONE";
    const evidenceRaw = item.evidence;
    if (!Array.isArray(evidenceRaw) || evidenceRaw.length === 0) {
      rejectedCount += 1;
      issues.push(`event "${title}" missing evidence`);
      continue;
    }
    const evidence: JobIntelligenceEvidence[] = [];
    let evidenceOk = true;
    for (const ev of evidenceRaw.slice(0, 8)) {
      if (!isPlainObject(ev)) {
        evidenceOk = false;
        break;
      }
      const sourceEmailId = asString(ev.sourceEmailId, 64);
      const excerpt = asString(ev.excerpt, 800);
      if (!sourceEmailId || !excerpt) {
        evidenceOk = false;
        break;
      }
      if (!opts.allowedEmailIds.has(sourceEmailId)) {
        evidenceOk = false;
        issues.push(`hallucinated sourceEmailId ${sourceEmailId}`);
        break;
      }
      const attId = asString(ev.sourceAttachmentId, 64);
      if (attId && !opts.allowedAttachmentIds.has(attId)) {
        evidenceOk = false;
        issues.push(`hallucinated sourceAttachmentId ${attId}`);
        break;
      }
      const roleRaw = asString(ev.sourceRole, 32)?.toUpperCase();
      const sourceRole =
        roleRaw === "QUOTED" || roleRaw === "ATTACHMENT" ? roleRaw : "PRIMARY";
      evidence.push({
        sourceEmailId,
        sourceAttachmentId: attId,
        excerpt,
        sourceRole,
      });
    }
    if (!evidenceOk || evidence.length === 0) {
      rejectedCount += 1;
      continue;
    }

    const eventDate = asString(item.eventDate, 40);
    const precisionRaw = asString(item.eventDatePrecision, 16)?.toUpperCase();
    const eventDatePrecision =
      precisionRaw === "DAY" ||
      precisionRaw === "MONTH" ||
      precisionRaw === "YEAR" ||
      precisionRaw === "UNKNOWN"
        ? precisionRaw
        : eventDate
          ? "DAY"
          : "UNKNOWN";

    const amount = asAmount(item.amount);
    // Never treat proposed/quote amounts as approved by rewriting kind.
    const primaryEmailId = evidence[0]?.sourceEmailId ?? null;
    const contentFingerprint = buildEventContentFingerprint({
      category,
      subtype: asString(item.subtype, 120),
      title,
      financialKind,
      amount,
      eventDate,
      primaryEmailId,
    });

    events.push({
      category,
      subtype: asString(item.subtype, 120),
      title,
      description,
      eventDate,
      eventDatePrecision,
      status,
      confidence: asConfidence(item.confidence),
      financialKind,
      amount,
      currency: asString(item.currency, 8)?.toUpperCase() ?? null,
      parties: asStringList(item.parties),
      fabricationItems: asStringList(item.fabricationItems),
      relatedFingerprintHint: asString(item.relatedFingerprintHint, 80),
      evidence,
      contentFingerprint,
    });
  }

  return {
    events,
    rejectedCount,
    issues: issues.slice(0, 40),
  };
}

export function emptyExtractionResult(): JobIntelligenceExtractionResult {
  return { events: [], rejectedCount: 0, issues: [] };
}

export { JOB_INTELLIGENCE_SCHEMA_VERSION };
