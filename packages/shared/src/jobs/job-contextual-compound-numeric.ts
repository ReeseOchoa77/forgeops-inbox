/**
 * V2.4-only compound numeric identity.
 *
 * Standalone numbers are never project identity evidence. Numbers contribute
 * only when paired with an approved descriptor (Building 3 → building:3).
 */

import {
  isNumericJobNameToken,
  canonicalizeJobNameTokens,
} from "./job-name-normalize.js";
import type { IdentityPeerJob } from "./job-name-identity-policy.js";

/** Descriptor canonical form → accepted surface tokens (pre-canonical). */
export const COMPOUND_NUMERIC_DESCRIPTOR_ALIASES: Record<string, string[]> = {
  building: ["building", "buildings", "bldg", "bldgs"],
  phase: ["phase", "phases", "ph"],
  stair: ["stair", "stairs"],
  area: ["area", "areas"],
  unit: ["unit", "units"],
  floor: ["floor", "floors", "fl"],
  lot: ["lot", "lots"],
  wing: ["wing", "wings"],
};

const DESCRIPTOR_LOOKUP = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(
  COMPOUND_NUMERIC_DESCRIPTOR_ALIASES
)) {
  for (const a of aliases) {
    DESCRIPTOR_LOOKUP.set(a.toLowerCase(), canonical);
  }
}

export type CompoundNumericIdentity = {
  /** Stable key, e.g. building:3 */
  key: string;
  descriptor: string;
  value: string;
  /** Token span in the source stream (descriptor + number). */
  rawTokens: string[];
  startIndex: number;
};

export function isCompoundNumericKey(token: string): boolean {
  return /^[a-z]+:\d+$/.test(token);
}

export function parseCompoundNumericKey(
  key: string
): { descriptor: string; value: string } | null {
  if (!isCompoundNumericKey(key)) return null;
  const [descriptor, value] = key.split(":");
  if (!descriptor || !value) return null;
  return { descriptor, value };
}

export function formatCompoundNumericKey(
  descriptor: string,
  value: string
): string {
  return `${descriptor}:${value}`;
}

export function resolveCompoundDescriptor(
  token: string
): string | null {
  return DESCRIPTOR_LOOKUP.get(token.toLowerCase()) ?? null;
}

/**
 * Extract adjacent descriptor+number compounds from a token stream.
 * Only consecutive pairs after normal tokenization (punctuation already gone).
 */
export function extractCompoundNumericIdentities(
  tokens: readonly string[]
): CompoundNumericIdentity[] {
  const out: CompoundNumericIdentity[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const desc = resolveCompoundDescriptor(tokens[i]!);
    if (!desc) continue;
    const next = tokens[i + 1]!;
    if (!isNumericJobNameToken(next)) continue;
    const key = formatCompoundNumericKey(desc, next);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      descriptor: desc,
      value: next,
      rawTokens: [tokens[i]!, next],
      startIndex: i,
    });
  }
  return out;
}

export function extractPeerCompoundNumericIdentities(
  peer: IdentityPeerJob
): CompoundNumericIdentity[] {
  const out: CompoundNumericIdentity[] = [];
  const seen = new Set<string>();
  const phrases =
    peer.phraseTokenLists.length > 0
      ? peer.phraseTokenLists
      : [[...peer.contentTokens, ...peer.distinguishingTokens]];
  for (const phrase of phrases) {
    for (const c of extractCompoundNumericIdentities(phrase)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c);
    }
  }
  return out;
}

/** True when a haystack token stream contains this compound. */
export function hayContainsCompoundNumeric(
  hay: readonly string[],
  compoundKey: string
): { found: boolean; startIndex: number } {
  const parsed = parseCompoundNumericKey(compoundKey);
  if (!parsed) return { found: false, startIndex: -1 };
  const compounds = extractCompoundNumericIdentities(hay);
  const hit = compounds.find(
    (c) =>
      c.descriptor === parsed.descriptor && c.value === parsed.value
  );
  return hit
    ? { found: true, startIndex: hit.startIndex }
    : { found: false, startIndex: -1 };
}

/**
 * Competing compound keys for the same descriptor with different values.
 * Example: hay has building:2, peer has building:1 → conflict.
 */
export function findNumericIdentityConflicts(input: {
  hayCompounds: readonly CompoundNumericIdentity[];
  peerCompounds: readonly CompoundNumericIdentity[];
}): Array<{
  descriptor: string;
  hayValue: string;
  peerValue: string;
  hayKey: string;
  peerKey: string;
}> {
  const conflicts: Array<{
    descriptor: string;
    hayValue: string;
    peerValue: string;
    hayKey: string;
    peerKey: string;
  }> = [];
  for (const hay of input.hayCompounds) {
    for (const peer of input.peerCompounds) {
      if (hay.descriptor !== peer.descriptor) continue;
      if (hay.value === peer.value) continue;
      conflicts.push({
        descriptor: hay.descriptor,
        hayValue: hay.value,
        peerValue: peer.value,
        hayKey: hay.key,
        peerKey: peer.key,
      });
    }
  }
  return conflicts;
}

/** Convenience: compounds from raw text (subject/body/attachment). */
export function extractCompoundNumericIdentitiesFromText(
  text: string
): CompoundNumericIdentity[] {
  return extractCompoundNumericIdentities(canonicalizeJobNameTokens(text));
}

/**
 * Quantity / count followers that mean an adjacent number is not a project
 * component (e.g. "Beltline 3 drawings", "Beltline has 3 open RFIs" after
 * tokenization may still place a digit next to family — reject when the next
 * token is a clear quantity noun).
 */
export const FAMILY_NUMERIC_QUANTITY_FOLLOWERS = new Set([
  "drawing",
  "drawings",
  "attachment",
  "attachments",
  "sheet",
  "sheets",
  "page",
  "pages",
  "rfi",
  "rfis",
  "item",
  "items",
  "file",
  "files",
  "copy",
  "copies",
  "revision",
  "revisions",
  "open",
  "emails",
  "email",
  "hours",
  "days",
  "weeks",
]);

export type FamilyScopedNumericIdentity = {
  /** family:value e.g. beltline:3 */
  key: string;
  familyToken: string;
  value: string;
  rawTokens: string[];
  startIndex: number;
};

/**
 * Family word immediately followed by a number (Beltline #3 → beltline + 3).
 * Does not invent descriptor compounds; used for family-scoped resolution.
 */
export function extractFamilyScopedNumericIdentities(
  tokens: readonly string[],
  familyTokens: readonly string[],
  tokenEquivalent: (a: string, b: string) => boolean = (a, b) => a === b
): FamilyScopedNumericIdentity[] {
  if (familyTokens.length === 0 || tokens.length < 2) return [];
  const out: FamilyScopedNumericIdentity[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const fam = tokens[i]!;
    if (!familyTokens.some((ft) => tokenEquivalent(fam, ft))) continue;
    // Skip descriptor+number — those are handled as compounds.
    if (resolveCompoundDescriptor(fam)) continue;
    const next = tokens[i + 1]!;
    if (!isNumericJobNameToken(next)) continue;
    const follower = tokens[i + 2];
    if (follower && FAMILY_NUMERIC_QUANTITY_FOLLOWERS.has(follower)) {
      continue;
    }
    const key = `${fam.toLowerCase()}:${next}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      familyToken: fam,
      value: next,
      rawTokens: [fam, next],
      startIndex: i,
    });
  }
  return out;
}

/**
 * Among family peers, find the unique Job whose compound numeric value matches.
 * Returns null when zero or multiple peers share that component number.
 */
export function resolveFamilyScopedNumericPeer(input: {
  value: string;
  familyPeers: readonly IdentityPeerJob[];
}): {
  peer: IdentityPeerJob;
  compound: CompoundNumericIdentity;
} | null {
  const matches: Array<{
    peer: IdentityPeerJob;
    compound: CompoundNumericIdentity;
  }> = [];
  for (const peer of input.familyPeers) {
    const compounds = extractPeerCompoundNumericIdentities(peer);
    const hit = compounds.find((c) => c.value === input.value);
    if (!hit) continue;
    matches.push({ peer, compound: hit });
  }
  if (matches.length !== 1) return null;
  return matches[0]!;
}
