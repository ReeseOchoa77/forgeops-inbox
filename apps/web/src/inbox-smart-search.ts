import type { InboxParticipant } from "@forgeops/shared/inbox-participant-match";
import { findKnownParticipantToCommit } from "@forgeops/shared/inbox-participant-match";

export type InboxParticipantRole = "sender" | "recipient";

export const MAX_INBOX_PARTICIPANT_TOKENS = 25;

export function participantRoleForInbox(sentOnly: boolean): InboxParticipantRole {
  return sentOnly ? "recipient" : "sender";
}

export function sortedNormalizedEmails(emails: string[] | undefined): string[] {
  if (!emails?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const n = raw.trim().toLowerCase();
    if (!n.includes("@") || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort();
  return out;
}

export function participantEmailsCacheKey(emails: string[] | undefined): string {
  return sortedNormalizedEmails(emails).join(",");
}

export function applyParticipantToken(
  tokens: InboxParticipant[],
  next: InboxParticipant
): InboxParticipant[] {
  const email = next.email.trim();
  if (!email.includes("@")) return tokens;
  const key = email.toLowerCase();
  if (tokens.some((t) => t.email.toLowerCase() === key)) return tokens;
  if (tokens.length >= MAX_INBOX_PARTICIPANT_TOKENS) return tokens;
  return [...tokens, { email, name: (next.name ?? "").trim() || null }];
}

export function removeParticipantToken(
  tokens: InboxParticipant[],
  email: string
): InboxParticipant[] {
  const key = email.trim().toLowerCase();
  return tokens.filter((t) => t.email.toLowerCase() !== key);
}

export function handleEmptyBackspace(
  tokens: InboxParticipant[],
  highlightedEmail: string | null
): { tokens: InboxParticipant[]; highlightedEmail: string | null } {
  if (tokens.length === 0) return { tokens, highlightedEmail: null };
  const last = tokens[tokens.length - 1]!;
  if (
    highlightedEmail &&
    highlightedEmail.toLowerCase() === last.email.toLowerCase()
  ) {
    return { tokens: tokens.slice(0, -1), highlightedEmail: null };
  }
  return { tokens, highlightedEmail: last.email };
}

export { findKnownParticipantToCommit };
