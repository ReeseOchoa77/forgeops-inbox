/**
 * V2.3 project-identity normalization (policy-scoped).
 *
 * Controlled abbreviation + compound joining for subject identity matching.
 * Does NOT alter global canonicalizeJobNameTokens used by V2 / V2.1 / V2.2.
 */

import {
  canonicalizeJobNameTokens,
  isDistinguishingJobNameToken,
  isJobNameContentToken,
  isJobNameStopToken,
  isNumericJobNameToken,
} from "./job-name-normalize.js";
import { normalizeProjectScopeToken } from "./job-project-token-utils.js";

/**
 * Abbreviation equivalences (canonical form on the left).
 * Applied only inside V2.3 identity comparison.
 */
export const PROJECT_ABBREVIATION_CANONICAL: Record<string, string> = {
  bldg: "building",
  bldgs: "building",
  building: "building",
  buildings: "building",
  ave: "avenue",
  avenue: "avenue",
  st: "street",
  street: "street",
  rd: "road",
  road: "road",
  no: "number",
  number: "number",
  nbr: "number",
  num: "number",
};

/** Descriptive / email boilerplate that never forms project identity. */
export const PROJECT_IDENTITY_NOISE_TOKENS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "this",
  "that",
  "re",
  "fw",
  "fwd",
  "updated",
  "update",
  "updates",
  "drawing",
  "drawings",
  "revision",
  "revisions",
  "revised",
  "approval",
  "review",
  "please",
  "see",
  "attached",
  "structural",
  "shops",
  "shop",
  "fabrication",
  "status",
  "delivery",
  "project",
  "job",
  "info",
  "information",
  "regarding",
  "about",
  "new",
  "latest",
]);

/**
 * Tokens that remain identity-bearing in V2.3 even when they are stop tokens
 * for candidate generation (e.g. "building" in "Beltline Bldg #1").
 */
export const PROJECT_IDENTITY_RETAINED_STOP_TOKENS = new Set([
  "building",
  "buildings",
]);

export function canonicalizeProjectAbbreviation(token: string): string {
  const lower = token.toLowerCase();
  return PROJECT_ABBREVIATION_CANONICAL[lower] ?? lower;
}

export function projectIdentityTokensEquivalent(
  a: string,
  b: string
): boolean {
  if (a === b) return true;
  const ca = canonicalizeProjectAbbreviation(a);
  const cb = canonicalizeProjectAbbreviation(b);
  if (ca === cb) return true;
  if (normalizeProjectScopeToken(ca) === normalizeProjectScopeToken(cb)) {
    return true;
  }
  // #1 / 1 already stripped by canonicalizeJobNameTokens; keep numeric equality.
  if (isNumericJobNameToken(ca) && isNumericJobNameToken(cb) && ca === cb) {
    return true;
  }
  return false;
}

export function isProjectIdentityNoiseToken(token: string): boolean {
  const c = canonicalizeProjectAbbreviation(token);
  if (PROJECT_IDENTITY_RETAINED_STOP_TOKENS.has(c)) return false;
  if (isDistinguishingJobNameToken(c) || isNumericJobNameToken(c)) return false;
  if (PROJECT_IDENTITY_NOISE_TOKENS.has(c)) return true;
  if (isJobNameStopToken(c) && !isJobNameContentToken(c)) return true;
  return false;
}

/**
 * Whether a token may form part of a Job's required subject identity.
 */
export function isProjectIdentityBearingToken(token: string): boolean {
  if (!token) return false;
  if (isProjectIdentityNoiseToken(token)) return false;
  const c = canonicalizeProjectAbbreviation(token);
  if (PROJECT_IDENTITY_RETAINED_STOP_TOKENS.has(c)) return true;
  if (isDistinguishingJobNameToken(c) || isNumericJobNameToken(c)) return true;
  if (isJobNameContentToken(c)) return true;
  // Non-stop, non-noise leftovers (e.g. parking, ramp, beltline).
  return !isJobNameStopToken(c);
}

/**
 * Join adjacent tokens when their concatenation appears in the Job vocabulary.
 * Example: ["belt","line"] + vocab{beltline} → ["beltline"].
 * Controlled — never joins unless the compound is a known Job identity token.
 */
export function joinPoolAwareCompoundTokens(
  tokens: readonly string[],
  poolVocabulary: ReadonlySet<string>
): { tokens: string[]; compoundsJoined: string[] } {
  if (tokens.length === 0) return { tokens: [], compoundsJoined: [] };
  const out: string[] = [];
  const compoundsJoined: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const a = tokens[i]!;
    const b = tokens[i + 1];
    if (b) {
      const joined = `${a}${b}`;
      const joinedCanon = canonicalizeProjectAbbreviation(joined);
      if (
        poolVocabulary.has(joined) ||
        poolVocabulary.has(joinedCanon) ||
        [...poolVocabulary].some((v) =>
          projectIdentityTokensEquivalent(v, joined)
        )
      ) {
        out.push(joinedCanon);
        compoundsJoined.push(`${a}+${b}->${joinedCanon}`);
        i += 2;
        continue;
      }
    }
    out.push(canonicalizeProjectAbbreviation(a));
    i += 1;
  }
  return { tokens: out, compoundsJoined };
}

/**
 * Build vocabulary of joinable / comparable Job identity tokens from peers.
 */
export function buildProjectIdentityVocabulary(
  phraseTokenLists: readonly (readonly string[])[]
): Set<string> {
  const vocab = new Set<string>();
  for (const phrase of phraseTokenLists) {
    for (const t of phrase) {
      if (!t) continue;
      const c = canonicalizeProjectAbbreviation(t);
      vocab.add(t);
      vocab.add(c);
    }
  }
  return vocab;
}

/**
 * Normalize haystack tokens for V2.3 subject/body identity matching.
 * Starts from standard canonicalizeJobNameTokens, then applies abbreviation
 * canonicalization and pool-aware compound joining.
 */
export function normalizeProjectIdentityHayTokens(
  raw: string | null | undefined,
  poolVocabulary: ReadonlySet<string>
): {
  tokens: string[];
  compoundsJoined: string[];
  abbreviationsApplied: string[];
} {
  const base = canonicalizeJobNameTokens(raw);
  const abbreviationsApplied: string[] = [];
  for (const t of base) {
    const c = canonicalizeProjectAbbreviation(t);
    if (c !== t) abbreviationsApplied.push(`${t}->${c}`);
  }
  const joined = joinPoolAwareCompoundTokens(base, poolVocabulary);
  return {
    tokens: joined.tokens,
    compoundsJoined: joined.compoundsJoined,
    abbreviationsApplied: [...new Set(abbreviationsApplied)],
  };
}

/**
 * Required identity tokens for a Job phrase (V2.3).
 * Keeps building + numeric distinguishers; drops email/descriptive noise.
 */
export function extractProjectIdentityTerms(
  phraseTokens: readonly string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of phraseTokens) {
    if (!isProjectIdentityBearingToken(t)) continue;
    const c = canonicalizeProjectAbbreviation(t);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * True when every required identity term appears in hay (equivalence-aware).
 */
export function hayContainsAllProjectIdentityTerms(
  hay: readonly string[],
  required: readonly string[]
): boolean {
  if (required.length === 0) return false;
  return required.every((req) =>
    hay.some((h) => projectIdentityTokensEquivalent(h, req))
  );
}

/**
 * Identity terms present in hay that are exclusive to this peer vs competitors.
 */
export function distinctiveProjectIdentityTermsInHay(input: {
  peerTerms: readonly string[];
  competitorTerms: readonly (readonly string[])[];
  hay: readonly string[];
}): string[] {
  const out: string[] = [];
  for (const term of input.peerTerms) {
    if (!input.hay.some((h) => projectIdentityTokensEquivalent(h, term))) {
      continue;
    }
    const onOther = input.competitorTerms.some((terms) =>
      terms.some((t) => projectIdentityTokensEquivalent(t, term))
    );
    if (onOther) continue;
    out.push(term);
  }
  return out;
}
