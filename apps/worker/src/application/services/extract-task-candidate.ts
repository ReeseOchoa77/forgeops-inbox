import type { ClassifiedEmail, ExtractedTaskCandidate, NormalizedEmail } from "./email-analysis.schemas.js";
import { extractedTaskCandidateSchema } from "./email-analysis.schemas.js";

interface WorkspaceMemberReference {
  name: string | null;
  email: string;
}

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
] as const;

const truncate = (value: string, length: number): string =>
  value.length <= length ? value : `${value.slice(0, length - 1)}…`;

const inferTaskTitle = (email: NormalizedEmail): string => {
  const subject = email.normalizedSubject ?? email.subject;
  if (subject) {
    return truncate(subject, 120);
  }

  const sentence =
    email.cleanTextBody
      ?.split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .find((part) => part.length >= 8) ?? "Review email request";

  return truncate(sentence, 120);
};

const inferTaskSummary = (email: NormalizedEmail): string => {
  const bodySentences =
    email.cleanTextBody
      ?.split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" ") ?? null;

  return truncate(bodySentences ?? email.snippet ?? "Email imported for follow-up.", 280);
};

const normalizeMemberName = (value: string | null): string[] => {
  if (!value) {
    return [];
  }

  const collapsed = value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  if (!collapsed) {
    return [];
  }

  const firstName = collapsed.split(/\s+/)[0];
  return firstName && firstName !== collapsed ? [collapsed, firstName] : [collapsed];
};

const guessAssignee = (
  email: NormalizedEmail,
  members: readonly WorkspaceMemberReference[]
): string | null => {
  const haystack = [email.cleanTextBody ?? "", email.snippet ?? "", email.subject ?? ""]
    .join("\n")
    .toLowerCase();

  for (const member of members) {
    const candidateNames = normalizeMemberName(member.name);
    const emailLocalPart = member.email.toLowerCase().split("@")[0];

    for (const candidateName of [...candidateNames, emailLocalPart]) {
      if (!candidateName) {
        continue;
      }

      const escaped = candidateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        new RegExp(`(^|\\b)${escaped},`, "i").test(haystack) ||
        new RegExp(`(^|\\b)${escaped}\\s+can\\s+you`, "i").test(haystack) ||
        new RegExp(`@${escaped}(\\b|$)`, "i").test(haystack)
      ) {
        return member.name ?? member.email;
      }
    }
  }

  return null;
};

const parseExplicitDueDate = (email: NormalizedEmail, now: Date): Date | null => {
  const haystack = [email.subject ?? "", email.cleanTextBody ?? "", email.snippet ?? ""].join(
    "\n"
  );

  const isoMatch = haystack.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) {
    const parsed = new Date(`${isoMatch[1]}T17:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const usMatch = haystack.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const year = Number(usMatch[3] ?? now.getUTCFullYear());
    const normalizedYear = year < 100 ? 2000 + year : year;
    const parsed = new Date(Date.UTC(normalizedYear, month - 1, day, 17, 0, 0));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const monthPattern = monthNames.join("|");
  const monthMatch = haystack.match(
    new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:,\\s*(20\\d{2}))?\\b`, "i")
  );
  if (monthMatch?.[1] && monthMatch[2]) {
    const monthIndex = monthNames.indexOf(
      monthMatch[1].toLowerCase() as (typeof monthNames)[number]
    );
    const day = Number(monthMatch[2]);
    const year = Number(monthMatch[3] ?? now.getUTCFullYear());
    const parsed = new Date(Date.UTC(year, monthIndex, day, 17, 0, 0));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (/\btomorrow\b/i.test(haystack)) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 17, 0, 0));
  }

  if (/\btoday\b/i.test(haystack) || /\bby eod\b/i.test(haystack)) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0));
  }

  return null;
};

export const extractTaskCandidate = (input: {
  email: NormalizedEmail;
  classification: ClassifiedEmail;
  members: readonly WorkspaceMemberReference[];
  taskThreshold: number;
  now?: Date;
}): ExtractedTaskCandidate | null => {
  const eligibleCategory =
    input.classification.emailType === "ACTIONABLE_REQUEST" ||
    input.classification.emailType === "SUPPORT_CUSTOMER_ISSUE" ||
    input.classification.emailType === "RECRUITING_HIRING" ||
    input.classification.emailType === "INTERNAL_COORDINATION";

  if (!input.classification.containsActionRequest && !eligibleCategory) {
    return null;
  }

  const dueAt = parseExplicitDueDate(input.email, input.now ?? new Date());
  const assigneeGuess = guessAssignee(input.email, input.members);
  const confidence = Math.min(
    0.97,
    input.classification.confidence +
      (dueAt ? 0.08 : 0) +
      (assigneeGuess ? 0.05 : 0) +
      (input.classification.containsActionRequest ? 0.04 : 0)
  );
  const requiresReview = confidence < input.taskThreshold;

  return extractedTaskCandidateSchema.parse({
    title: inferTaskTitle(input.email),
    summary: inferTaskSummary(input.email),
    assigneeGuess,
    dueAt,
    priority: input.classification.priority,
    confidence,
    requiresReview
  });
};
