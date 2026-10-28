import type { Prisma } from "@prisma/client";
import { normalizeEmail } from "@forgeops/shared";

const MAX_PARTICIPANT_EMAILS = 25;

export function normalizeParticipantEmails(emails: string[] | undefined): string[] {
  if (!emails?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const n = normalizeEmail(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_PARTICIPANT_EMAILS) break;
  }
  return out;
}

/** Sender IN (...) — OR across tokens. Case-insensitive. */
export function buildSenderEmailsWhere(
  emails: string[]
): Prisma.EmailMessageWhereInput | null {
  const list = normalizeParticipantEmails(emails);
  if (list.length === 0) return null;
  const only = list[0];
  if (list.length === 1 && only) {
    return { senderEmail: { equals: only, mode: "insensitive" } };
  }
  return {
    OR: list.map((email) => ({
      senderEmail: { equals: email, mode: "insensitive" },
    })),
  };
}

/** To/Cc JSON contains any of the emails — OR across tokens. */
export function buildRecipientEmailsWhere(
  emails: string[]
): Prisma.EmailMessageWhereInput | null {
  const list = normalizeParticipantEmails(emails);
  if (list.length === 0) return null;
  const or: Prisma.EmailMessageWhereInput[] = [];
  for (const email of list) {
    or.push({ toAddresses: { string_contains: email } });
    or.push({ ccAddresses: { string_contains: email } });
  }
  return { OR: or };
}
