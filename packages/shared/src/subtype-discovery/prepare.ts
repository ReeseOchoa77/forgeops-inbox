/**
 * Prepare email text for Subtype Discovery analysis.
 * Does not mutate stored EmailMessage / NormalizedEmail rows.
 */

import type { SubtypeDiscoveryPreparedEmail } from "./types.js";

export const SUBTYPE_DISCOVERY_MAX_ANALYSIS_CHARS = 1800;

export type PrepareEmailInput = {
  emailMessageId: string;
  subject: string | null;
  bodyText: string | null;
  cleanTextBody: string | null;
  snippet: string | null;
  mailboxCategory: string | null;
  businessTypeKey: string | null;
  inboxConnectionId: string | null;
  receivedAt: Date | string | null;
};

/**
 * Prefer NormalizedEmail.cleanTextBody; fall back to bodyText / snippet.
 * Strip remaining quoted-reply markers and collapse whitespace.
 * Truncate for embedding cost control.
 */
export function prepareEmailForDiscovery(
  input: PrepareEmailInput
): SubtypeDiscoveryPreparedEmail | null {
  const raw =
    (input.cleanTextBody && input.cleanTextBody.trim()) ||
    (input.bodyText && input.bodyText.trim()) ||
    (input.snippet && input.snippet.trim()) ||
    "";

  const cleaned = minimizeBoilerplate(raw);
  const subject = (input.subject ?? "").trim();
  if (!cleaned && !subject) {
    return null;
  }

  const analysisText = truncateAnalysisText(
    [subject ? `Subject: ${subject}` : null, cleaned || null]
      .filter(Boolean)
      .join("\n\n")
  );

  return {
    emailMessageId: input.emailMessageId,
    subject: input.subject,
    analysisText,
    mailboxCategory: input.mailboxCategory,
    businessTypeKey: input.businessTypeKey,
    inboxConnectionId: input.inboxConnectionId,
    receivedAt:
      input.receivedAt instanceof Date
        ? input.receivedAt.toISOString()
        : input.receivedAt,
  };
}

export function minimizeBoilerplate(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  // Quoted reply / forward dividers
  t = t.replace(
    /^-{2,}\s*Original Message\s*-{2,}[\s\S]*$/im,
    ""
  );
  t = t.replace(/^_{5,}[\s\S]*$/m, "");
  t = t.replace(/^From:\s.+\nSent:\s.+\nTo:\s.+\nSubject:\s.+$/gim, "");
  t = t.replace(/^On .+ wrote:\s*$/gim, "");
  t = t.replace(/^>+.*$/gm, "");
  // Common disclaimer / confidentiality footers
  t = t.replace(
    /This (e-?mail|message|communication)[\s\S]{0,400}(confidential|privileged|intended solely)[\s\S]*$/i,
    ""
  );
  t = t.replace(/unsubscribe|view this (email|message) in (a |your )?browser/gi, "");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export function truncateAnalysisText(
  text: string,
  maxChars = SUBTYPE_DISCOVERY_MAX_ANALYSIS_CHARS
): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

export function prepareEmailsForDiscovery(
  rows: PrepareEmailInput[]
): {
  prepared: SubtypeDiscoveryPreparedEmail[];
  excludedIds: string[];
} {
  const prepared: SubtypeDiscoveryPreparedEmail[] = [];
  const excludedIds: string[] = [];
  const seenText = new Set<string>();

  for (const row of rows) {
    const item = prepareEmailForDiscovery(row);
    if (!item) {
      excludedIds.push(row.emailMessageId);
      continue;
    }
    // Soft dedupe: identical analysis text keeps first id only for clustering.
    const key = item.analysisText.toLowerCase();
    if (seenText.has(key)) {
      excludedIds.push(row.emailMessageId);
      continue;
    }
    seenText.add(key);
    prepared.push(item);
  }
  return { prepared, excludedIds };
}
