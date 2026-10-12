/**
 * Deterministic Quote field extraction from email subject/body/filenames/PDF text.
 * Never hallucinates amounts or detailed scope items.
 */

import {
  extractDetailedScopeDeterministic,
  scopeSummaryString,
  type DetailedScope,
} from "./scope-detail.js";

const AMOUNT_PATTERNS: RegExp[] = [
  /(?:total|quote|amount|price|sum)\s*[:#]?\s*\$?\s*([\d,]{2,}(?:\.\d{2})?)/i,
  /\$\s*([\d,]{3,}(?:\.\d{2})?)\b/,
];

const NOTE_PATTERNS: Array<{ re: RegExp; note: string }> = [
  { re: /\brevised\s+pricing\b/i, note: "Revised pricing" },
  { re: /\baddendum\s*#?\s*\d+/i, note: "Addendum referenced" },
  { re: /\bexcludes?\s+erection\b/i, note: "Excludes erection" },
  { re: /\bfreight\s+included\b/i, note: "Freight included" },
  { re: /\balternate\s+pricing\b/i, note: "Alternate pricing included" },
  { re: /\brevision\s*#?\s*\d+/i, note: "Revision referenced" },
  { re: /\bvalid\s+for\s+\d+\s+days\b/i, note: "Validity period noted" },
];

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
  return Math.round(n * 100) / 100;
}

export function extractQuoteFieldsDeterministic(input: {
  subject?: string | null;
  bodyText?: string | null;
  attachmentNames?: string[];
  /** Bounded PDF plain text (already selected / capped by caller). */
  pdfText?: string | null;
}): {
  scope: string | null;
  scopeDetail: DetailedScope;
  amount: number | null;
  currency: string | null;
  notes: string | null;
  evidence: string[];
  confidence: number;
  amountSource: "EMAIL_BODY" | "PDF_TEXT" | null;
  scopeSource: "EMAIL_BODY" | "ATTACHMENT_FILENAME" | "PDF_TEXT" | null;
} {
  const subject = input.subject ?? "";
  const body = input.bodyText ?? "";
  const pdf = input.pdfText ?? "";
  const text = `${subject}\n${body}`;
  const evidence: string[] = [];
  let confidence = 0.2;

  const scopeDetail = extractDetailedScopeDeterministic({
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.bodyText !== undefined ? { bodyText: input.bodyText } : {}),
    ...(input.attachmentNames !== undefined
      ? { attachmentNames: input.attachmentNames }
      : {}),
    ...(input.pdfText !== undefined ? { pdfText: input.pdfText } : {}),
  });
  const scope = scopeSummaryString(scopeDetail);
  let scopeSource: "EMAIL_BODY" | "ATTACHMENT_FILENAME" | "PDF_TEXT" | null =
    null;
  if (scopeDetail.items.length || scopeDetail.work.length || scopeDetail.tradeCategory) {
    const src =
      scopeDetail.items[0]?.source ??
      scopeDetail.work[0]?.source ??
      "EMAIL_BODY";
    if (src === "PDF_TEXT") scopeSource = "PDF_TEXT";
    else if (src === "ATTACHMENT_FILENAME") scopeSource = "ATTACHMENT_FILENAME";
    else scopeSource = "EMAIL_BODY";
    if (scopeDetail.detailedComplete) {
      evidence.push(`scope_items:${scopeDetail.items.length}`);
      confidence += 0.3;
    } else if (scopeDetail.tradeCategory) {
      evidence.push(`scope_trade:${scopeDetail.tradeCategory}`);
      confidence += 0.1;
    }
  }

  let amount: number | null = null;
  let currency: string | null = null;
  let amountSource: "EMAIL_BODY" | "PDF_TEXT" | null = null;
  for (const re of AMOUNT_PATTERNS) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const parsed = parseMoney(m[1]);
    if (parsed == null) continue;
    if (parsed < 100) continue;
    amount = parsed;
    currency = "USD";
    amountSource = "EMAIL_BODY";
    evidence.push("amount:body");
    confidence += 0.35;
    break;
  }
  if (amount == null && pdf) {
    for (const re of AMOUNT_PATTERNS) {
      const m = pdf.match(re);
      if (!m?.[1]) continue;
      const parsed = parseMoney(m[1]);
      if (parsed == null || parsed < 100) continue;
      amount = parsed;
      currency = "USD";
      amountSource = "PDF_TEXT";
      evidence.push("amount:pdf");
      confidence += 0.35;
      break;
    }
  }

  const notes: string[] = [];
  const noteHaystack = `${text}\n${pdf}`;
  for (const p of NOTE_PATTERNS) {
    if (p.re.test(noteHaystack)) {
      notes.push(p.note);
      evidence.push(`note:${p.note}`);
    }
  }

  return {
    scope,
    scopeDetail,
    amount,
    currency,
    notes: notes.length ? notes.slice(0, 6).join("; ") : null,
    evidence,
    confidence: Math.min(0.95, confidence),
    amountSource,
    scopeSource,
  };
}
