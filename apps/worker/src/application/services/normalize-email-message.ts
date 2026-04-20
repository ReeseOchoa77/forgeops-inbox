import { z } from "zod";

import {
  normalizedEmailSchema,
  type NormalizedEmail,
  type NormalizedEmailParticipant
} from "./email-analysis.schemas.js";

const MAX_NORMALIZED_BODY_LENGTH = 12_000;

const storedAddressSchema = z.object({
  name: z.string().min(1).nullable(),
  email: z.string().email(),
  raw: z.string().min(1).optional()
});

const storedAddressListSchema = z.array(storedAddressSchema);

const parseStoredAddresses = (value: unknown): z.infer<typeof storedAddressListSchema> =>
  storedAddressListSchema.parse(value ?? []);

const toParticipant = (
  input: z.infer<typeof storedAddressSchema>,
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
}): NormalizedEmail => {
  const senderEmail = input.senderEmail.trim().toLowerCase();
  const senderDomain = senderEmail.includes("@")
    ? senderEmail.split("@")[1] ?? null
    : null;
  const recipients = [
    ...parseStoredAddresses(input.toAddresses).map((address) =>
      toParticipant(address, "TO")
    ),
    ...parseStoredAddresses(input.ccAddresses).map((address) =>
      toParticipant(address, "CC")
    ),
    ...parseStoredAddresses(input.bccAddresses).map((address) =>
      toParticipant(address, "BCC")
    ),
    ...parseStoredAddresses(input.replyToAddresses).map((address) =>
      toParticipant(address, "REPLY_TO")
    )
  ];
  const cleanTextBody = cleanBodyText(input.bodyText);
  const labelHints = normalizeLabelHints(input.labelIds);
  const subject = input.subject?.trim() || input.threadSubject?.trim() || null;

  return normalizedEmailSchema.parse({
    sender: {
      name: input.senderName?.trim() || null,
      email: senderEmail,
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
