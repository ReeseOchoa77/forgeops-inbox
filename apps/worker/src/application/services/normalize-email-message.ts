import { z } from "zod";
import { safeOptionalEmail } from "@forgeops/shared";

import {
  normalizedEmailSchema,
  type NormalizedEmail,
  type NormalizedEmailParticipant
} from "./email-analysis.schemas.js";

const MAX_NORMALIZED_BODY_LENGTH = 12_000;

type StoredAddress = {
  name: string | null;
  email: string;
  raw?: string | undefined;
};

/**
 * Tolerant parse of EmailMessage to/cc/bcc/replyTo JSON.
 * Graph/provider may store address strings that are not RFC emails
 * (newsletters, undisclosed recipients, etc.). Invalid entries are dropped —
 * they must not fail classification.
 *
 * Production failure signature: Zod path [0, "email"] / "Invalid email"
 * from a strict z.array(z.object({ email: z.string().email() })).parse().
 */
export function parseStoredAddressesTolerant(
  value: unknown,
  options?: {
    field?: "to" | "cc" | "bcc" | "replyTo";
    emailMessageId?: string;
  }
): StoredAddress[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    console.warn(
      JSON.stringify({
        event: "normalize-recipients-skipped-non-array",
        field: options?.field ?? null,
        emailMessageId: options?.emailMessageId ?? null,
      })
    );
    return [];
  }

  const out: StoredAddress[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!item || typeof item !== "object") {
      console.info(
        JSON.stringify({
          event: "normalize-recipient-dropped",
          field: options?.field ?? null,
          emailMessageId: options?.emailMessageId ?? null,
          index: i,
          reason: "non_object",
        })
      );
      continue;
    }

    const record = item as Record<string, unknown>;
    const email = safeOptionalEmail(record.email);
    if (!email) {
      const preview =
        typeof record.email === "string"
          ? record.email.trim().slice(0, 80)
          : String(record.email ?? "").slice(0, 80);
      console.info(
        JSON.stringify({
          event: "normalize-recipient-dropped",
          field: options?.field ?? null,
          emailMessageId: options?.emailMessageId ?? null,
          index: i,
          reason: "invalid_email",
          emailPreview: preview,
        })
      );
      continue;
    }

    const nameRaw =
      typeof record.name === "string" ? record.name.trim() : null;
    const name = nameRaw && nameRaw.length > 0 ? nameRaw : null;
    const raw =
      typeof record.raw === "string" && record.raw.trim()
        ? record.raw.trim()
        : undefined;

    out.push({
      name,
      email,
      ...(raw ? { raw } : {}),
    });
  }

  return out;
}

const toParticipant = (
  input: StoredAddress,
  role: NormalizedEmailParticipant["role"]
): NormalizedEmailParticipant => ({
  name: input.name,
  email: input.email.toLowerCase(),
  role
});

const collapseWhitespace = (value: string): string =>
  value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const stripQuotedReplies = (value: string): string => {
  const lines = value.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^>+/.test(trimmed)) {
      continue;
    }

    if (
      /^on .+wrote:$/i.test(trimmed) ||
      /^from:\s/i.test(trimmed) ||
      /^sent:\s/i.test(trimmed)
    ) {
      break;
    }

    kept.push(line);
  }

  return kept.join("\n");
};

const stripMarketingFooters = (value: string): string => {
  const lines = value.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /unsubscribe/i.test(trimmed) ||
      /manage preferences/i.test(trimmed) ||
      /view in browser/i.test(trimmed)
    ) {
      break;
    }

    kept.push(line);
  }

  return kept.join("\n");
};

const cleanBodyText = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const cleaned = collapseWhitespace(stripMarketingFooters(stripQuotedReplies(value)));
  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, MAX_NORMALIZED_BODY_LENGTH);
};

const normalizeLabelHints = (labelIds: readonly string[]): string[] => {
  const hints = new Set<string>();

  for (const labelId of labelIds) {
    const normalized = labelId.trim().toUpperCase();
    if (!normalized) {
      continue;
    }

    switch (normalized) {
      case "INBOX":
        hints.add("inbox");
        break;
      case "UNREAD":
        hints.add("unread");
        break;
      case "IMPORTANT":
        hints.add("important");
        break;
      case "STARRED":
        hints.add("starred");
        break;
      case "CATEGORY_PERSONAL":
        hints.add("gmail-category:personal");
        break;
      case "CATEGORY_UPDATES":
        hints.add("gmail-category:updates");
        break;
      case "CATEGORY_FORUMS":
        hints.add("gmail-category:forums");
        break;
      case "CATEGORY_PROMOTIONS":
        hints.add("gmail-category:promotions");
        break;
      case "CATEGORY_SOCIAL":
        hints.add("gmail-category:social");
        break;
      default:
        hints.add(`gmail-label:${normalized.toLowerCase()}`);
        break;
    }
  }

  return [...hints].sort();
};

const deriveCategoryHints = (input: {
  labelHints: readonly string[];
  senderDomain: string | null;
  snippet: string | null;
  subject: string | null;
  cleanTextBody: string | null;
}): string[] => {
  const haystack = [
    input.subject ?? "",
    input.snippet ?? "",
    input.cleanTextBody ?? "",
    input.senderDomain ?? ""
  ]
    .join("\n")
    .toLowerCase();
  const hints = new Set<string>();

  if (input.labelHints.includes("gmail-category:promotions")) {
    hints.add("marketing-signal");
  }

  if (/(unsubscribe|newsletter|webinar|pricing|special offer|free trial)/i.test(haystack)) {
    hints.add("marketing-signal");
  }

  if (/(support|customer|issue|bug|incident|help|refund|complaint)/i.test(haystack)) {
    hints.add("support-signal");
  }

  if (/(recruit|candidate|interview|resume|applicant|hiring)/i.test(haystack)) {
    hints.add("recruiting-signal");
  }

  if (/(please|can you|could you|action required|asap|by eod|follow up)/i.test(haystack)) {
    hints.add("action-signal");
  }

  if (/(fyi|heads up|status update|update|for your information)/i.test(haystack)) {
    hints.add("fyi-signal");
  }

  return [...hints].sort();
};

/**
 * Normalize persisted EmailMessage fields for classification persistence.
 * Recipient lists are sanitized (invalid optional emails dropped).
 * Canonical senderEmail is validated for NormalizedEmail shape; callers should
 * only pass already-ingested EmailMessage.senderEmail (not rewritten here beyond trim/lower).
 */
export const normalizeEmailMessage = (input: {
  subject: string | null;
  threadSubject: string | null;
  snippet: string | null;
  bodyText: string | null;
  receivedAt: Date | null;
  senderName: string | null;
  senderEmail: string;
  toAddresses: unknown;
  ccAddresses: unknown;
  bccAddresses: unknown;
  replyToAddresses: unknown;
  labelIds: readonly string[];
  emailMessageId?: string;
}): NormalizedEmail => {
  const senderEmailRaw = input.senderEmail.trim().toLowerCase();
  // Canonical sender must remain classifiable; if somehow invalid, keep a stable
  // placeholder domain marker rather than crashing optional recipient parsing.
  // Product path: ingest already requires a sender — this is defense in depth.
  const senderEmail = safeOptionalEmail(senderEmailRaw) ?? senderEmailRaw;
  const senderDomain = senderEmail.includes("@")
    ? senderEmail.split("@")[1] ?? null
    : null;

  const idOpts = input.emailMessageId
    ? { emailMessageId: input.emailMessageId }
    : {};

  const recipients = [
    ...parseStoredAddressesTolerant(input.toAddresses, {
      field: "to",
      ...idOpts,
    }).map((address) => toParticipant(address, "TO")),
    ...parseStoredAddressesTolerant(input.ccAddresses, {
      field: "cc",
      ...idOpts,
    }).map((address) => toParticipant(address, "CC")),
    ...parseStoredAddressesTolerant(input.bccAddresses, {
      field: "bcc",
      ...idOpts,
    }).map((address) => toParticipant(address, "BCC")),
    ...parseStoredAddressesTolerant(input.replyToAddresses, {
      field: "replyTo",
      ...idOpts,
    }).map((address) => toParticipant(address, "REPLY_TO")),
  ];
  const cleanTextBody = cleanBodyText(input.bodyText);
  const labelHints = normalizeLabelHints(input.labelIds);
  const subject = input.subject?.trim() || input.threadSubject?.trim() || null;

  // Sender email for NormalizedEmail must pass schema; if canonical sender is
  // structurally invalid, omit crashing by using a parse that only requires shape
  // when valid — otherwise throw a clear core error (rare for ingested mail).
  const senderParsed = z
    .string()
    .email()
    .safeParse(senderEmail);
  if (!senderParsed.success) {
    throw new Error(
      `CLASSIFICATION_PERSIST_FAILED: EmailMessage.senderEmail is not a valid email (${senderEmailRaw.slice(0, 80)})`
    );
  }

  return normalizedEmailSchema.parse({
    sender: {
      name: input.senderName?.trim() || null,
      email: senderParsed.data,
      role: "FROM"
    },
    recipients,
    subject,
    normalizedSubject: subject?.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim() || null,
    snippet: input.snippet?.trim() || null,
    receivedAt: input.receivedAt,
    cleanTextBody,
    labelHints,
    categoryHints: deriveCategoryHints({
      labelHints,
      senderDomain,
      snippet: input.snippet?.trim() || null,
      subject,
      cleanTextBody
    }),
    senderDomain
  });
};
