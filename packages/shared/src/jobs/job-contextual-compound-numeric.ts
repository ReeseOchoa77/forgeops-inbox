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
