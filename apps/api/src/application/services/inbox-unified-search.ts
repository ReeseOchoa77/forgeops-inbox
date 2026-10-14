import type { Prisma } from "@prisma/client";

/**
 * Unified Inbox search OR predicate.
 *
 * Matches ANY of: sender name/email, To/Cc JSON (address + name text),
 * subject, snippet, bodyText, normalized cleanTextBody.
 *
 * Composed by callers with AND against other Inbox filters.
 * searchIn=sender is intentionally NOT a separate mode — always OR.
 */
export function buildUnifiedInboxSearchOr(
  term: string
): Prisma.EmailMessageWhereInput {
  const q = term.trim();
  if (!q) return {};

  const jsonVariants = Array.from(new Set([q, q.toLowerCase()]));
  const recipientJson: Prisma.EmailMessageWhereInput[] = [];
  for (const v of jsonVariants) {
    recipientJson.push({ toAddresses: { string_contains: v } });
    recipientJson.push({ ccAddresses: { string_contains: v } });
  }

  return {
    OR: [
      { senderEmail: { contains: q, mode: "insensitive" } },
      { senderName: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { snippet: { contains: q, mode: "insensitive" } },
      { bodyText: { contains: q, mode: "insensitive" } },
      ...recipientJson,
      {
        normalizedEmail: {
          is: {
            cleanTextBody: { contains: q, mode: "insensitive" },
          },
        },
      },
    ],
  };
}
