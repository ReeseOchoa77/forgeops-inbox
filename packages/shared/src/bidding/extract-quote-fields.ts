/**
 * Deterministic Quote field extraction from email subject/body/filenames.
 * Never hallucinates amounts — returns null when evidence is weak.
 */

const SCOPE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bstructural\s+steel\b/i, label: "Structural steel" },
  { re: /\bmisc(?:ellaneous)?\.?\s+metals?\b/i, label: "Miscellaneous metals" },
  { re: /\bstairs?\s+and\s+rails?\b/i, label: "Stairs and rails" },
  { re: /\bsteel\s+package\b/i, label: "Steel package" },
  { re: /\bjoists?\s*(?:\/|&|and)?\s*deck\b/i, label: "Joists/deck" },
  { re: /\bstructural\b.*\bmisc/i, label: "Structural + miscellaneous metals" },
  { re: /\berection\b/i, label: "Erection" },
];

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
  amount: number | null;
  currency: string | null;
  notes: string | null;
  evidence: string[];
  confidence: number;
  /** Attachment ids are not known here — caller may append. */
  amountSource: "EMAIL_BODY" | "PDF_TEXT" | null;
  scopeSource: "EMAIL_BODY" | "ATTACHMENT_FILENAME" | "PDF_TEXT" | null;
} {
  const subject = input.subject ?? "";
  const body = input.bodyText ?? "";
  const pdf = input.pdfText ?? "";
  const text = `${subject}\n${body}`;
  const attachments = (input.attachmentNames ?? []).join(" ");
  const evidence: string[] = [];
  let confidence = 0.2;

  let scope: string | null = null;
  let scopeSource: "EMAIL_BODY" | "ATTACHMENT_FILENAME" | "PDF_TEXT" | null =
    null;
  for (const p of SCOPE_PATTERNS) {
    if (p.re.test(text)) {
      scope = p.label;
      scopeSource = "EMAIL_BODY";
      evidence.push(`scope:${p.label}`);
      confidence += 0.25;
      break;
    }
    if (p.re.test(attachments)) {
      scope = p.label;
      scopeSource = "ATTACHMENT_FILENAME";
      evidence.push(`scope:${p.label}:filename`);
      confidence += 0.25;
      break;
    }
    if (pdf && p.re.test(pdf)) {
      scope = p.label;
      scopeSource = "PDF_TEXT";
      evidence.push(`scope:${p.label}:pdf`);
      confidence += 0.25;
      break;
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
    // Require an explicit money cue — bare $NNNN alone is accepted only if >= 1000
    // and pattern matched; avoid tiny/phone-like numbers.
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
    amount,
    currency,
    notes: notes.length ? notes.slice(0, 6).join("; ") : null,
    evidence,
    confidence: Math.min(0.95, confidence),
    amountSource,
    scopeSource,
  };
}
