import { normalizeName } from "../reference/normalize.js";

/**
 * Construction/project abbreviation expansions.
 * Applied after normalizeName. Conservative: no fuzzy/edit-distance.
 * saint/st is aligned at compare-time (see alignSaintTokens), not globally.
 */
const TOKEN_CANONICAL: Record<string, string> = {
  bldg: "building",
  bldgs: "building",
  building: "building",
  buildings: "building",
  apt: "apartments",
  apts: "apartments",
  apartment: "apartments",
  apartments: "apartments",
  addn: "addition",
  addition: "addition",
};

/** Tokens that never identify a specific Job by themselves. Numeric tokens are never stopwords. */
export const JOB_NAME_STOP_TOKENS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "this",
  "that",
  "your",
  "our",
  "please",
  "see",
  "attached",
  "updated",
  "update",
  "drawings",
  "drawing",
  "project",
  "job",
  "jobs",
  "re",
  "fw",
  "fwd",
  "rfi",
  "rfq",
  "rfp",
  "po",
  "bid",
  "quote",
  "proposal",
  "addendum",
  "request",
  "review",
  "status",
  "following",
  "thanks",
  "thank",
  "hello",
  "hi",
  "regarding",
  "about",
  "new",
  "old",
  "latest",
  "revised",
  "revision",
  "info",
  "information",
  "hospital",
  "school",
  "center",
  "centre",
  "tower",
  "plaza",
  "park",
  "building",
  "buildings",
  "apartment",
  "apartments",
  "addition",
  "phase",
  "unit",
  "floor",
  "site",
  "street",
  "st",
  "rd",
  "ave",
  "blvd",
  "north",
  "south",
  "east",
  "west",
]);

export function isNumericJobNameToken(token: string): boolean {
  return /^\d+$/.test(token);
}

/** Cardinal / compass tokens that distinguish sibling Jobs and must not be dropped. */
export const JOB_NAME_DISTINGUISHING_DIRECTION_TOKENS = new Set([
  "north",
  "south",
  "east",
  "west",
]);

export function isJobNameStopToken(token: string): boolean {
  if (isNumericJobNameToken(token)) return false;
  return JOB_NAME_STOP_TOKENS.has(token);
}

/**
 * Tokens that disambiguate a shared project-name family (Building 1 vs 2, North vs South).
 * They must remain in the token stream. They do not generate candidates by themselves.
 */
export function isDistinguishingJobNameToken(token: string): boolean {
  return (
    isNumericJobNameToken(token) ||
    JOB_NAME_DISTINGUISHING_DIRECTION_TOKENS.has(token)
  );
}

/**
 * Project-identifying tokens used to generate the plausible Job set.
 * Distinguishing tokens (#1, North) are excluded so "sheet 2" cannot pull every Building 2 Job.
 */
export function isJobNameContentToken(token: string): boolean {
  if (!token) return false;
  if (isJobNameStopToken(token)) return false;
  if (isDistinguishingJobNameToken(token)) return false;
  return true;
}

/**
 * Normalize a job/project name (or email haystack) into comparable tokens.
 * Preserves numeric identifiers (#1 / 1) instead of dropping short tokens.
 */
export function canonicalizeJobNameTokens(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  let n = normalizeName(raw);
  n = n.replace(/#/g, " # ");
  n = n.replace(/\s+/g, " ").trim();
  if (!n) return [];

  const tokens: string[] = [];
  for (const part of n.split(" ")) {
    if (!part) continue;
    let token = part;
    if (token.startsWith("#")) token = token.slice(1);
    if (!token) continue;
    token = TOKEN_CANONICAL[token] ?? token;
    if (!token) continue;
    // Keep numeric identifiers of any length; other tokens need 2+ chars
    // so "st" can participate in saint alignment.
    if (!isNumericJobNameToken(token) && token.length < 2) continue;
    tokens.push(token);
  }
  return tokens;
}

export function canonicalJobNamePhrase(tokens: string[]): string {
  return tokens.join(" ");
}

/**
 * If a job name uses "saint X", treat haystack "st X" as the same token.
 * Does not rewrite every "st" (street) globally.
 */
export function alignSaintTokens(jobTokens: string[], hayTokens: string[]): string[] {
  const aligned = [...hayTokens];
  for (let i = 0; i < jobTokens.length; i++) {
    if (jobTokens[i] !== "saint") continue;
    const next = jobTokens[i + 1];
    for (let j = 0; j < aligned.length; j++) {
      if (aligned[j] !== "st") continue;
      if (next == null || aligned[j + 1] === next) {
        aligned[j] = "saint";
      }
    }
  }
  return aligned;
}

export function stripSubjectPrefixes(subject: string): string {
  return subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim();
}

export function phraseContained(hayTokens: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0 || hayTokens.length < phraseTokens.length) return false;
  const hay = hayTokens.join(" ");
  const phrase = phraseTokens.join(" ");
  if (hay === phrase) return true;
  return ` ${hay} `.includes(` ${phrase} `);
}

export function allTokensPresent(hayTokens: string[], jobTokens: string[]): boolean {
  if (jobTokens.length === 0) return false;
  const hay = new Set(hayTokens);
  return jobTokens.every((t) => hay.has(t));
}
