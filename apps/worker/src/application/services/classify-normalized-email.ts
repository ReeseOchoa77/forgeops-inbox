import type { Priority } from "@prisma/client";

import {
  classifiedEmailSchema,
  type ClassifiedEmail,
  type NormalizedEmail
} from "./email-analysis.schemas.js";

const summarizeText = (input: {
  subject: string | null;
  snippet: string | null;
  cleanTextBody: string | null;
}): string => {
  const firstBodySentence =
    input.cleanTextBody
      ?.split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .find(Boolean) ?? null;

  return (
    input.snippet ??
    firstBodySentence ??
    input.subject ??
    "Email imported and awaiting review."
  ).slice(0, 280);
};

const countKeywordMatches = (haystack: string, patterns: readonly RegExp[]): number =>
  patterns.reduce((count, pattern) => count + (pattern.test(haystack) ? 1 : 0), 0);

const inferPriority = (haystack: string, emailType: ClassifiedEmail["emailType"]): Priority => {
  if (/(urgent|asap|immediately|critical|sev1|outage)/i.test(haystack)) {
    return "URGENT";
  }

  if (/(today|by eod|deadline|blocked|customer escalat)/i.test(haystack)) {
    return "HIGH";
  }

  if (emailType === "SUPPORT_CUSTOMER_ISSUE" || emailType === "ACTIONABLE_REQUEST") {
    return "HIGH";
  }

  if (emailType === "SALES_MARKETING" || emailType === "FYI_UPDATE") {
    return "LOW";
  }

  return "MEDIUM";
};

export const classifyNormalizedEmail = (input: {
  email: NormalizedEmail;
  inboxEmail: string;
  classificationThreshold: number;
}): ClassifiedEmail => {
  const inboxDomain = input.inboxEmail.toLowerCase().split("@")[1] ?? null;
  const haystack = [
    input.email.subject ?? "",
    input.email.snippet ?? "",
    input.email.cleanTextBody ?? "",
    input.email.sender.email,
    ...input.email.recipients.map((recipient) => recipient.email),
    ...input.email.labelHints,
    ...input.email.categoryHints
  ]
    .join("\n")
    .toLowerCase();

  const containsActionRequest =
    /(please|can you|could you|would you|need you to|action required|let me know|follow up|review and|send over|\?)/i.test(
      haystack
    ) && !/(unsubscribe|newsletter|special offer)/i.test(haystack);

  const internalRecipientCount = inboxDomain
    ? input.email.recipients.filter((recipient) =>
        recipient.email.endsWith(`@${inboxDomain}`)
      ).length
    : 0;
  const allInternal =
    inboxDomain !== null &&
    input.email.sender.email.endsWith(`@${inboxDomain}`) &&
    internalRecipientCount > 0 &&
    internalRecipientCount === input.email.recipients.length;

  const scores = {
    ACTIONABLE_REQUEST:
      countKeywordMatches(haystack, [
        /action required/i,
        /please/i,
        /can you/i,
        /could you/i,
        /need you to/i,
        /asap/i
      ]) + (containsActionRequest ? 2 : 0),
    FYI_UPDATE:
      countKeywordMatches(haystack, [
        /\bfyi\b/i,
        /heads up/i,
        /status update/i,
        /\bupdate\b/i,
        /resolved/i,
        /completed/i
      ]) + (input.email.labelHints.includes("gmail-category:updates") ? 2 : 0),
    SALES_MARKETING:
      countKeywordMatches(haystack, [
        /unsubscribe/i,
        /newsletter/i,
        /webinar/i,
        /free trial/i,
        /pricing/i,
        /special offer/i,
        /demo/i
      ]) + (input.email.labelHints.includes("gmail-category:promotions") ? 3 : 0),
    SUPPORT_CUSTOMER_ISSUE:
      countKeywordMatches(haystack, [
        /support/i,
        /customer/i,
        /issue/i,
        /incident/i,
        /bug/i,
        /help/i,
        /refund/i,
        /complaint/i,
        /error/i
      ]),
    RECRUITING_HIRING:
      countKeywordMatches(haystack, [
        /recruit/i,
        /candidate/i,
        /interview/i,
        /resume/i,
        /applicant/i,
        /hiring/i
      ]),
    INTERNAL_COORDINATION:
      countKeywordMatches(haystack, [
        /team/i,
        /sync/i,
        /standup/i,
        /project/i,
        /meeting/i,
        /coordination/i,
        /follow-up/i
      ]) + (allInternal ? 2 : 0),
    NEEDS_REVIEW: 1
  } as const;

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [topCategory, topScore] = ranked[0] as [ClassifiedEmail["emailType"], number];
  const runnerUpScore = ranked[1]?.[1] ?? 0;
  const chosenCategory =
    topScore <= 1 ? "NEEDS_REVIEW" : topCategory;
  const margin = Math.max(0, topScore - runnerUpScore);
  const baseConfidence = chosenCategory === "NEEDS_REVIEW" ? 0.42 : 0.58;
  const confidence = Math.min(0.96, baseConfidence + topScore * 0.06 + margin * 0.05);
  const requiresReview = confidence < input.classificationThreshold;
  const routingHints = new Set<string>(input.email.categoryHints);

  if (containsActionRequest) {
    routingHints.add("contains-action-request");
  }

  if (allInternal) {
    routingHints.add("all-participants-match-inbox-domain");
  }

  routingHints.add(`classification:${chosenCategory.toLowerCase()}`);

  return classifiedEmailSchema.parse({
    emailType: chosenCategory,
    priority: inferPriority(haystack, chosenCategory),
    itemStatus: requiresReview ? "NEEDS_REVIEW" : "NEW",
    summary: summarizeText(input.email),
    containsActionRequest,
    confidence,
    requiresReview,
    routingHints: [...routingHints].sort(),
    categoryHints: input.email.categoryHints
  });
};
