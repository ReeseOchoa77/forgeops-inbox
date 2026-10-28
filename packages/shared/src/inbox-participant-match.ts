/**
 * Deterministic Inbox participant matching (autocomplete ranking + token commit).
 * No AI / fuzzy matching.
 */

export type InboxParticipant = {
  email: string;
  name: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isCompleteEmailAddress(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function scoreInboxParticipantMatch(
  query: string,
  email: string,
  name: string | null | undefined
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const em = email.trim().toLowerCase();
  if (!em) return 0;
  const nm = (name ?? "").trim().toLowerCase();
  const at = em.indexOf("@");
  const user = at >= 0 ? em.slice(0, at) : em;
  const domain = at >= 0 ? em.slice(at + 1) : "";

  if (em === q) return 1000;
  if (em.startsWith(q)) return 900;
  if (q.endsWith("@")) {
    const local = q.slice(0, -1);
    if (local && user.startsWith(local)) return 900;
  }
  if (nm && nm.startsWith(q)) return 800;
  if (user.includes(q)) return 700;
  if (domain.includes(q)) return 600;
  if (nm && nm.includes(q)) return 500;
  return 0;
}

export function rankInboxParticipants(
  query: string,
  candidates: InboxParticipant[],
  limit = 8
): InboxParticipant[] {
  const map = new Map<string, InboxParticipant & { score: number }>();
  for (const c of candidates) {
    const email = c.email.trim();
    if (!email || !email.includes("@")) continue;
    const key = email.toLowerCase();
    const score = scoreInboxParticipantMatch(query, email, c.name);
    if (score <= 0) continue;
    const existing = map.get(key);
    if (!existing || score > existing.score) {
      const name = (c.name ?? "").trim() || existing?.name || null;
      map.set(key, { email, name, score });
    } else if (existing && !existing.name && c.name?.trim()) {
      existing.name = c.name.trim();
    }
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .slice(0, Math.min(Math.max(limit, 1), 10))
    .map(({ score: _s, ...rest }) => rest);
}

/** Pull {email,name} from EmailMessage toAddresses / ccAddresses JSON. */
export function extractAddressRecords(
  value: unknown
): InboxParticipant[] {
  if (!Array.isArray(value)) return [];
  const out: InboxParticipant[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push({ email: item.trim(), name: null });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const email =
      typeof (item as { email?: unknown }).email === "string"
        ? (item as { email: string }).email.trim()
        : "";
    if (!email) continue;
    const nameRaw = (item as { name?: unknown }).name;
    const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
    out.push({ email, name });
  }
  return out;
}

/** Commit typed text as a token only when it is a complete known address. */
export function findKnownParticipantToCommit(
  draft: string,
  suggestions: InboxParticipant[]
): InboxParticipant | null {
  const q = draft.trim();
  if (!isCompleteEmailAddress(q)) return null;
  const key = q.toLowerCase();
  return suggestions.find((s) => s.email.toLowerCase() === key) ?? null;
}

export function compactParticipantTokenLabel(
  participant: InboxParticipant,
  usedNames: Set<string>
): string {
  const name = (participant.name ?? "").trim();
  if (name && name.length <= 28 && !usedNames.has(name.toLowerCase())) {
    return name;
  }
  return participant.email;
}
