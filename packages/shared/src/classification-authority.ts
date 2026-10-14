/**
 * Classification subtype authority.
 *
 * Precedence (highest wins):
 *   USER_EXPLICIT > SYSTEM_DETERMINISTIC > AI
 *
 * AI must never overwrite a stronger authority.
 */

export const CLASSIFICATION_AUTHORITIES = [
  "USER_EXPLICIT",
  "SYSTEM_DETERMINISTIC",
  "AI",
] as const;

export type ClassificationAuthority =
  (typeof CLASSIFICATION_AUTHORITIES)[number];

const AUTHORITY_RANK: Record<ClassificationAuthority, number> = {
  USER_EXPLICIT: 3,
  SYSTEM_DETERMINISTIC: 2,
  AI: 1,
};

export function isClassificationAuthority(
  value: unknown
): value is ClassificationAuthority {
  return (
    typeof value === "string" &&
    (CLASSIFICATION_AUTHORITIES as readonly string[]).includes(value)
  );
}

/** Read authority from Classification.routingHints (+ reviewedByUserId fallback). */
export function resolveClassificationAuthority(input: {
  routingHints: unknown;
  reviewedByUserId?: string | null | undefined;
}): ClassificationAuthority {
  const hints =
    input.routingHints &&
    typeof input.routingHints === "object" &&
    !Array.isArray(input.routingHints)
      ? (input.routingHints as Record<string, unknown>)
      : null;

  if (hints && isClassificationAuthority(hints.authority)) {
    return hints.authority;
  }

  // Legacy Phase 3/4 deterministic folder provenance.
  if (
    hints?.deterministic === true ||
    hints?.source === "bid_invites_folder" ||
    hints?.source === "quotes_folder"
  ) {
    return "SYSTEM_DETERMINISTIC";
  }

  // Human review / manual correction without explicit authority field.
  if (input.reviewedByUserId) {
    return "USER_EXPLICIT";
  }

  return "AI";
}

export function authorityRank(authority: ClassificationAuthority): number {
  return AUTHORITY_RANK[authority];
}

/**
 * True when `incoming` may replace the subtype of `existing`.
 * Equal authority: allow update (same-level refresh). Stronger existing: block.
 */
export function canReplaceClassificationAuthority(input: {
  existing: ClassificationAuthority;
  incoming: ClassificationAuthority;
}): boolean {
  return (
    AUTHORITY_RANK[input.incoming] >= AUTHORITY_RANK[input.existing]
  );
}

/** Merge routingHints while setting authority + source provenance. */
export function withClassificationAuthority(
  priorHints: unknown,
  authority: ClassificationAuthority,
  source: string,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const base =
    priorHints &&
    typeof priorHints === "object" &&
    !Array.isArray(priorHints)
      ? { ...(priorHints as Record<string, unknown>) }
      : {};
  return {
    ...base,
    ...(extra ?? {}),
    authority,
    source,
    deterministic: authority === "SYSTEM_DETERMINISTIC" ? true : base.deterministic,
  };
}
