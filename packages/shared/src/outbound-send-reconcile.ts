/**
 * Conservative Sent Items ↔ ForgeOps-compose reconciliation.
 *
 * Graph sendMail returns 202 with no message id / internetMessageId.
 * We persist a local forgeops-sent-* EmailMessage, then when Sent Items sync
 * discovers the provider copy, we enrich the local row — never merge on
 * subject alone.
 */

export const FORGEOPS_SENT_ID_PREFIX = "forgeops-sent-";

/** Max |ΔsentAt| for subject+recipient bounded match (ms). */
export const FORGEOPS_SENT_RECONCILE_WINDOW_MS = 120_000;

export function isForgeOpsLocalSentMessageId(
  gmailMessageId: string | null | undefined
): boolean {
  return Boolean(
    gmailMessageId && gmailMessageId.startsWith(FORGEOPS_SENT_ID_PREFIX)
  );
}

export function normalizeOutboundSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .replace(/^(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim().toLowerCase());
      continue;
    }
    if (item && typeof item === "object" && "email" in item) {
      const e = String((item as { email?: unknown }).email ?? "")
        .trim()
        .toLowerCase();
      if (e) out.push(e);
    }
  }
  return [...new Set(out)].sort();
}

/**
 * Strong enough for reconciliation when Graph did not return message identity.
 * Requires: same primary To set, same normalized subject, sentAt within window.
 */
export function matchesForgeOpsOutboundCandidate(input: {
  localSubject: string | null | undefined;
  incomingSubject: string | null | undefined;
  localTo: unknown;
  incomingTo: unknown;
  localSentAt: Date | null | undefined;
  incomingSentAt: Date | null | undefined;
  windowMs?: number;
}): boolean {
  const windowMs = input.windowMs ?? FORGEOPS_SENT_RECONCILE_WINDOW_MS;
  const subjOk =
    normalizeOutboundSubject(input.localSubject) ===
      normalizeOutboundSubject(input.incomingSubject) &&
    normalizeOutboundSubject(input.localSubject).length > 0;
  if (!subjOk) return false;

  const localTo = normalizeEmailList(input.localTo);
  const incomingTo = normalizeEmailList(input.incomingTo);
  if (localTo.length === 0 || incomingTo.length === 0) return false;
  if (localTo.join("|") !== incomingTo.join("|")) return false;

  if (!input.localSentAt || !input.incomingSentAt) return false;
  const delta = Math.abs(
    input.localSentAt.getTime() - input.incomingSentAt.getTime()
  );
  return delta <= windowMs;
}
