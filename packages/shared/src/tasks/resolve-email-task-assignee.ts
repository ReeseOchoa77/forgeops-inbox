/**
 * Deterministic EmailMessage TO → Workspace User assignment for Tasks.
 * Exact normalized email match only. No CC, no fuzzy names, no AI.
 */

import { normalizeEmail } from "../reference/normalize.js";

export type WorkspaceMemberEmail = {
  userId: string;
  email: string;
};

/** Extract email strings from EmailMessage.toAddresses JSON (objects or strings). */
export function extractToAddressEmails(toAddresses: unknown): string[] {
  if (!Array.isArray(toAddresses)) return [];
  const out: string[] = [];
  for (const item of toAddresses) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const email = (item as { email?: unknown }).email;
    if (typeof email === "string" && email.trim()) out.push(email.trim());
  }
  return out;
}

/**
 * If exactly one active workspace member appears in TO, return that userId.
 * Multiple distinct matches → null. Zero matches → null.
 * CC is intentionally ignored.
 */
export function resolveUniqueToAssigneeUserId(input: {
  toAddresses: unknown;
  members: WorkspaceMemberEmail[];
}): string | null {
  const toNorm = new Set(
    extractToAddressEmails(input.toAddresses)
      .map((e) => normalizeEmail(e))
      .filter(Boolean)
  );
  if (toNorm.size === 0) return null;

  const matched = new Map<string, string>();
  for (const member of input.members) {
    const norm = normalizeEmail(member.email);
    if (!norm || !toNorm.has(norm)) continue;
    matched.set(member.userId, norm);
  }

  if (matched.size !== 1) return null;
  return [...matched.keys()][0] ?? null;
}

/**
 * SENT commitment ownership: map sender → workspace user only when exact unique match.
 * Do not use for outbound requests (vendor asked to act).
 */
export function resolveUniqueSenderAssigneeUserId(input: {
  senderEmail: string | null | undefined;
  members: WorkspaceMemberEmail[];
}): string | null {
  const sender = normalizeEmail(input.senderEmail ?? "");
  if (!sender) return null;
  const matched = input.members.filter(
    (m) => normalizeEmail(m.email) === sender
  );
  if (matched.length !== 1) return null;
  return matched[0]!.userId;
}
