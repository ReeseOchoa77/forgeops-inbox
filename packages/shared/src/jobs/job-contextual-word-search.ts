/**
 * V2.4 — Contextual Word Search (policy-scoped).
 *
 * Deterministic project-family + distinguishing-term search across subject and
 * current body. Optional precomputed AI decisions may be validated here; the
 * LLM client itself lives outside @forgeops/shared.
 */

import {
  isJobNameContentToken,
  isDistinguishingJobNameToken,
  isNumericJobNameToken,
  canonicalizeJobNameTokens,
} from "./job-name-normalize.js";
import {
  normalizeProjectScopeToken,
  projectTokensEquivalent,
} from "./job-project-token-utils.js";
import type { IdentityPeerJob } from "./job-name-identity-policy.js";
import {
  extractCompoundNumericIdentities,
  extractFamilyScopedNumericIdentities,
  extractPeerCompoundNumericIdentities,
  findNumericIdentityConflicts,
  hayContainsCompoundNumeric,
  isCompoundNumericKey,
  parseCompoundNumericKey,
  resolveCompoundDescriptor,
  resolveFamilyScopedNumericPeer,
} from "./job-contextual-compound-numeric.js";

function parseCompoundNumericValue(term: string): string | null {
  return parseCompoundNumericKey(term)?.value ?? null;
}

/** Generic construction / email vocabulary that is never strong alone. */
export const CONTEXTUAL_WEAK_DISTINGUISHING_TOKENS = new Set([
  "steel",
  "structural",
  "project",
  "update",
  "updates",
  "drawing",
  "drawings",
  "fabrication",
  "construction",
  "status",
  "delivery",
  "revised",
  "revision",
  "revisions",
  "shop",
  "shops",
  "submittal",
  "submittals",
  "connection",
  "connections",
  "area",
  "work",
  "please",
  "review",
  "attached",
  "see",
]);

/** Controlled V2.4-only abbreviation / morphology (does not alter global tokenize). */
const CONTEXTUAL_TOKEN_CANONICAL: Record<string, string> = {
  stair: "stairs",
  stairs: "stairs",
  concession: "concessions",
  concessions: "concessions",
  bldg: "building",
  bldgs: "building",
  building: "building",
  buildings: "building",
  ext: "exterior",
  exterior: "exterior",
  ave: "avenue",
  avenue: "avenue",
  st: "street",
  street: "street",
  rd: "road",
  road: "road",
};

export function canonicalizeContextualToken(token: string): string {
  const lower = token.toLowerCase();
  if (CONTEXTUAL_TOKEN_CANONICAL[lower]) return CONTEXTUAL_TOKEN_CANONICAL[lower]!;
  return normalizeProjectScopeToken(lower);
}

export function contextualTokensEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  if (projectTokensEquivalent(a, b)) return true;
  return canonicalizeContextualToken(a) === canonicalizeContextualToken(b);
}

export function isContextualWeakDistinguishingToken(token: string): boolean {
  const c = canonicalizeContextualToken(token);
  return (
    CONTEXTUAL_WEAK_DISTINGUISHING_TOKENS.has(token) ||
    CONTEXTUAL_WEAK_DISTINGUISHING_TOKENS.has(c)
  );
}

export type ContextualFamilyIndex = {
  sharedIdentifiers: string[];
  families: Array<{
    sharedId: string;
    jobIds: string[];
    peers: IdentityPeerJob[];
  }>;
};

export type ContextualPeerTerms = {
  peer: IdentityPeerJob;
  identityTerms: string[];
  distinguishingTerms: string[];
};

/**
 * Shared project identifiers among peers (non-weak, non-construction-ish content).
 */
export function buildContextualFamilyIndex(
  peers: readonly IdentityPeerJob[]
): ContextualFamilyIndex {
  const freq = new Map<string, { token: string; peers: IdentityPeerJob[] }>();
  for (const peer of peers) {
    const seen = new Set<string>();
    for (const t of peer.contentTokens) {
      if (!isJobNameContentToken(t)) continue;
      if (isContextualWeakDistinguishingToken(t)) continue;
      const key = canonicalizeContextualToken(t);
      if (seen.has(key)) continue;
      seen.add(key);
      const prev = freq.get(key);
      if (prev) prev.peers.push(peer);
      else freq.set(key, { token: t, peers: [peer] });
    }
  }
  const sharedIdentifiers: string[] = [];
  const families: ContextualFamilyIndex["families"] = [];
  for (const [, v] of freq) {
    if (v.peers.length < 2) continue;
    sharedIdentifiers.push(v.token);
    families.push({
      sharedId: v.token,
      jobIds: v.peers.map((p) => p.jobId),
      peers: v.peers,
    });
  }
  return { sharedIdentifiers, families };
}

export function extractContextualIdentityTerms(
  peer: IdentityPeerJob
): string[] {
  const phrase = peer.phraseTokenLists.find((p) => p.length > 0) ?? [
    ...peer.contentTokens,
    ...peer.distinguishingTokens,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of phrase) {
    if (!t) continue;
    // Standalone numbers are never identity terms — only compound keys.
    if (isNumericJobNameToken(t)) continue;
    const c = canonicalizeContextualToken(t);
    if (seen.has(c)) continue;
    if (isContextualWeakDistinguishingToken(c)) {
      // Descriptor words alone stay out; compounds added below.
      continue;
    }
    if (
      !isJobNameContentToken(t) &&
      !isDistinguishingJobNameToken(t) &&
      c !== "exterior"
    ) {
      continue;
    }
    seen.add(c);
    out.push(c);
  }
  // Compound numeric identifiers (building:3) — never bare "3".
  for (const compound of extractPeerCompoundNumericIdentities(peer)) {
    if (seen.has(compound.key)) continue;
    seen.add(compound.key);
    out.push(compound.key);
  }
  return out;
}

/**
 * Terms that distinguish peer from competitors sharing a family id.
 * Weak generics never qualify — even when unique to one Job.
 */
export function extractContextualDistinguishingTerms(input: {
  peer: IdentityPeerJob;
  competitors: readonly IdentityPeerJob[];
  sharedIdentifiers: readonly string[];
}): string[] {
  const peerTerms = extractContextualIdentityTerms(input.peer);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of peerTerms) {
    // Never promote a bare number.
    if (isNumericJobNameToken(t)) continue;
    if (!isCompoundNumericKey(t) && isContextualWeakDistinguishingToken(t)) {
      continue;
    }
    if (
      !isCompoundNumericKey(t) &&
      input.sharedIdentifiers.some((s) => contextualTokensEquivalent(s, t))
    ) {
      continue;
    }
    const onOther = input.competitors.some(
      (c) =>
        c.jobId !== input.peer.jobId &&
        extractContextualIdentityTerms(c).some((ct) =>
          isCompoundNumericKey(t) || isCompoundNumericKey(ct)
            ? ct === t
            : contextualTokensEquivalent(ct, t)
        )
    );
    if (onOther) continue;
    const key = isCompoundNumericKey(t) ? t : canonicalizeContextualToken(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function isTokenNegatedInContextualHay(
  hay: readonly string[],
  tokenIndex: number
): boolean {
  if (tokenIndex < 0 || tokenIndex >= hay.length) return false;
  const start = Math.max(0, tokenIndex - 5);
  const window = hay.slice(start, tokenIndex);
  if (window.some((t) => t === "not" || t === "no")) return true;
  if (window.some((t) => t === "arent" || t === "isnt" || t === "wasnt")) {
    return true;
  }
  return false;
}

/**
 * Soft incidental cues local to the term's clause.
 * Avoid wide windows that let "complete" from another clause taint a later term.
 */
export function isTokenIncidentalInContextualHay(
  hay: readonly string[],
  tokenIndex: number
): boolean {
  if (tokenIndex < 0 || tokenIndex >= hay.length) return false;
  const leftCues = new Set([
    "previously",
    "already",
    "earlier",
    "separately",
    "separate",
    "former",
    "old",
  ]);
  const doneCues = new Set([
    "complete",
    "completed",
    "finished",
    "done",
  ]);
  const exampleCues = new Set([
    "example",
    "examples",
    "sample",
    "samples",
    "typical",
    "similar",
  ]);
  const left = hay.slice(Math.max(0, tokenIndex - 4), tokenIndex);
  if (left.some((t) => leftCues.has(t) || exampleCues.has(t))) return true;
  if (left.some((t) => t === "see" || t === "like")) return true;
  // "concessions work is complete" / "stairs are finished"
  const right = hay.slice(tokenIndex + 1, tokenIndex + 6);
  if (right.some((t) => doneCues.has(t) || exampleCues.has(t))) return true;
  // "Nova … from another project"
  if (
    right.some((t) => t === "another") &&
    right.some((t) => t === "project" || t === "projects")
  ) {
    return true;
  }
  return false;
}

/**
 * Drop common email signature blocks for V2.4 contextual body analysis.
 * Does not alter production V2 scoring text.
 */
export function stripEmailSignatureForContextualSearch(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^--\s*$/.test(line.trim())) break;
    if (/^_{2,}\s*$/.test(line.trim())) break;
    if (/^sent from my /i.test(line.trim())) break;
    if (
      kept.length >= 1 &&
      /^(thanks|thank you|regards|best regards|sincerely)[,!]?\s*$/i.test(
        line.trim()
      )
    ) {
      // Keep the closing line, drop following signature lines.
      kept.push(line);
      break;
    }
    kept.push(line);
  }
  return kept.join("\n").trim() || body.slice(0, 2000);
}

export function hasExplicitContextualCorrection(hay: readonly string[]): boolean {
  return hay.some((t) =>
    ["correction", "actually", "instead", "wrong"].includes(t)
  );
}

export type ContextualTermHit = {
  peerJobId: string;
  term: string;
  field: "subject" | "body";
  negated: boolean;
  incidental: boolean;
};

export function findContextualDistinguishingHits(input: {
  peer: IdentityPeerJob;
  competitors: readonly IdentityPeerJob[];
  sharedIdentifiers: readonly string[];
  subjectTokens: readonly string[];
  bodyTokens: readonly string[];
}): ContextualTermHit[] {
  const terms = extractContextualDistinguishingTerms(input);
  const hits: ContextualTermHit[] = [];
  for (const term of terms) {
    // Standalone numbers never hit.
    if (isNumericJobNameToken(term)) continue;

    if (isCompoundNumericKey(term)) {
      const subj = hayContainsCompoundNumeric(input.subjectTokens, term);
      if (subj.found) {
        hits.push({
          peerJobId: input.peer.jobId,
          term,
          field: "subject",
          negated: isTokenNegatedInContextualHay(
            input.subjectTokens,
            subj.startIndex
          ),
          incidental: false,
        });
      }
      const body = hayContainsCompoundNumeric(input.bodyTokens, term);
      if (body.found) {
        hits.push({
          peerJobId: input.peer.jobId,
          term,
          field: "body",
          negated: isTokenNegatedInContextualHay(
            input.bodyTokens,
            body.startIndex
          ),
          incidental: isTokenIncidentalInContextualHay(
            input.bodyTokens,
            body.startIndex
          ),
        });
      }
      continue;
    }

    for (let i = 0; i < input.subjectTokens.length; i += 1) {
      const tok = input.subjectTokens[i]!;
      if (isNumericJobNameToken(tok)) continue;
      if (!contextualTokensEquivalent(tok, term)) continue;
      hits.push({
        peerJobId: input.peer.jobId,
        term,
        field: "subject",
        negated: isTokenNegatedInContextualHay(input.subjectTokens, i),
        incidental: false,
      });
      break;
    }
    for (let i = 0; i < input.bodyTokens.length; i += 1) {
      const tok = input.bodyTokens[i]!;
      if (isNumericJobNameToken(tok)) continue;
      if (!contextualTokensEquivalent(tok, term)) continue;
      hits.push({
        peerJobId: input.peer.jobId,
        term,
        field: "body",
        negated: isTokenNegatedInContextualHay(input.bodyTokens, i),
        incidental: isTokenIncidentalInContextualHay(input.bodyTokens, i),
      });
      break;
    }
  }
  return hits;
}

export type ContextualWordSearchAiDecision = {
  selectedJobId: string | null;
  decision: "MATCH" | "AMBIGUOUS" | "CONFLICT" | "NO_MATCH";
  supportingEvidence: string[];
  competingJobIds: string[];
  interpretation:
    | "PRIMARY"
    | "INCIDENTAL"
    | "NEGATED"
    | "CORRECTION"
    | "UNCERTAIN";
  explanation: string;
  confidence: number;
};

/**
 * Validate an AI decision against candidates and email text.
 * Rejects invented Jobs, unsupported excerpts, and empty MATCH without evidence.
 */
export function validateContextualWordSearchAiDecision(input: {
  decision: ContextualWordSearchAiDecision;
  candidateJobIds: readonly string[];
  subject: string;
  body: string;
  /** Optional peer compounds for numeric contradiction checks. */
  peerCompoundsByJob?: Record<string, string[]>;
}): { ok: true; decision: ContextualWordSearchAiDecision } | { ok: false; reason: string } {
  const allowed = new Set(input.candidateJobIds);
  const d = input.decision;
  if (!["MATCH", "AMBIGUOUS", "CONFLICT", "NO_MATCH"].includes(d.decision)) {
    return { ok: false, reason: "INVALID_DECISION" };
  }
  if (d.selectedJobId != null && !allowed.has(d.selectedJobId)) {
    return { ok: false, reason: "JOB_NOT_IN_CANDIDATES" };
  }
  for (const id of d.competingJobIds ?? []) {
    if (!allowed.has(id)) return { ok: false, reason: "COMPETING_NOT_IN_CANDIDATES" };
  }
  const hay = `${input.subject}\n${input.body}`.toLowerCase();
  for (const excerpt of d.supportingEvidence ?? []) {
    if (!excerpt || typeof excerpt !== "string") {
      return { ok: false, reason: "EMPTY_EVIDENCE" };
    }
    if (!hay.includes(excerpt.toLowerCase().slice(0, 200))) {
      return { ok: false, reason: "EVIDENCE_NOT_IN_TEXT" };
    }
  }
  // AI must not promote standalone digits into identity evidence.
  const evidenceLooksNumericOnly = (d.supportingEvidence ?? []).every((e) =>
    /^\s*\d+\s*$/.test(e)
  );
  if (
    d.decision === "MATCH" &&
    (d.supportingEvidence ?? []).length > 0 &&
    evidenceLooksNumericOnly
  ) {
    return { ok: false, reason: "STANDALONE_NUMBER_EVIDENCE" };
  }
  if (d.decision === "MATCH" && d.selectedJobId && input.peerCompoundsByJob) {
    const hayCompounds = extractCompoundNumericIdentities(
      canonicalizeJobNameTokens(`${input.subject} ${input.body}`)
    );
    const peerKeys = input.peerCompoundsByJob[d.selectedJobId] ?? [];
    const peerCompounds = peerKeys
      .filter(isCompoundNumericKey)
      .map((key) => {
        const [descriptor, value] = key.split(":");
        return {
          key,
          descriptor: descriptor ?? "",
          value: value ?? "",
          rawTokens: [] as string[],
          startIndex: 0,
        };
      });
    const conflicts = findNumericIdentityConflicts({
      hayCompounds,
      peerCompounds,
    });
    if (conflicts.length > 0) {
      return { ok: false, reason: "NUMERIC_IDENTITY_CONFLICT" };
    }
  }
  if (d.decision === "MATCH") {
    if (!d.selectedJobId) return { ok: false, reason: "MATCH_WITHOUT_JOB" };
    if ((d.supportingEvidence ?? []).length === 0) {
      return { ok: false, reason: "MATCH_WITHOUT_EVIDENCE" };
    }
    if (d.interpretation === "NEGATED" || d.interpretation === "UNCERTAIN") {
      return { ok: false, reason: "MATCH_WITH_WEAK_INTERPRETATION" };
    }
  }
  if (d.decision !== "MATCH" && d.selectedJobId != null) {
    // Abstention / conflict may still name competitors; clear selected for safety.
    return {
      ok: true,
      decision: { ...d, selectedJobId: null },
    };
  }
  return { ok: true, decision: d };
}

export type CompoundNumericDiagnostic = {
  code:
    | "COMPOUND_NUMERIC_IDENTITY"
    | "STANDALONE_NUMBER_IGNORED"
    | "NUMERIC_IDENTITY_CONFLICT"
    | "NUMERIC_DESCRIPTOR_NORMALIZED"
    | "FAMILY_NUMERIC_IDENTITY";
  rawText: string;
  normalizedKey: string | null;
  descriptor: string | null;
  numericValue: string | null;
  evidenceSource: "subject" | "body" | "attachment" | "mixed";
  candidateJobId: string | null;
  conflictingKeys: string[];
  contributedToResolution: boolean;
};

export type WordImportanceDiagnostic = {
  code:
    | "DYNAMIC_WORD_IMPORTANCE"
    | "UNIQUE_PROJECT_TERM"
    | "SHARED_PROJECT_FAMILY"
    | "GENERIC_TERM_SUPPRESSED"
    | "SINGLE_WORD_PROJECT_IDENTITY";
  matchedTerm: string;
  sourceField: "subject" | "body" | "mixed";
  importance:
    | "unique"
    | "shared_family"
    | "generic"
    | "distinguishing"
    | "suppressed";
  eligibleJobIds: string[];
  candidateJobIds: string[];
  projectFamily: string | null;
  numericComponent: string | null;
  competingNumericComponents: string[];
  sufficientForResolution: boolean;
  acceptRejectReason: string;
};

export type ContextualResolution = {
  status: "MATCH" | "AMBIGUOUS" | "CONFLICT" | null;
  selectedJobId: string | null;
  reason:
    | "CONTEXTUAL_WORD_SEARCH_MATCH"
    | "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS"
    | "CONTEXTUAL_WORD_SEARCH_CONFLICT"
    | "AI_CONTEXTUAL_DISAMBIGUATION"
    | "AI_CONTEXTUAL_ABSTENTION"
    | "NEGATED_PROJECT_REFERENCE"
    | "INCIDENTAL_PROJECT_REFERENCE"
    | "EXPLICIT_PROJECT_CORRECTION"
    | "SHARED_PROJECT_IDENTIFIER"
    | "FULL_BODY_PROJECT_IDENTITY"
    | "NUMERIC_IDENTITY_CONFLICT"
    | "FAMILY_NUMERIC_IDENTITY"
    | "SINGLE_WORD_PROJECT_IDENTITY"
    | null;
  sharedIdentifiers: string[];
  familyJobIds: string[];
  distinguishingByJob: Record<string, string[]>;
  matchedTerms: string[];
  evidenceField: "subject" | "body" | "mixed" | null;
  competingJobIds: string[];
  aiInvoked: boolean;
  changedBaseline: boolean;
  compoundNumericDiagnostics?: CompoundNumericDiagnostic[];
  wordImportanceDiagnostics?: WordImportanceDiagnostic[];
};

export type ContextualWordSearchFeatures = {
  /** V3: unique title terms (Nova → Nova Classical). */
  enableUniqueProjectTerms?: boolean;
  /** V3: family word + bare number (Beltline #3). */
  enableFamilyScopedNumeric?: boolean;
};

/**
 * Unique eligible project name/alias phrases in subject and/or current body.
 * Does not require a shared family identifier.
 */
export function resolveFullBodyProjectIdentity(input: {
  peers: readonly IdentityPeerJob[];
  subjectTokens: readonly string[];
  bodyTokens: readonly string[];
  features?: ContextualWordSearchFeatures;
}): ContextualResolution {
  const empty: ContextualResolution = {
    status: null,
    selectedJobId: null,
    reason: null,
    sharedIdentifiers: [],
    familyJobIds: [],
    distinguishingByJob: {},
    matchedTerms: [],
    evidenceField: null,
    competingJobIds: [],
    aiInvoked: false,
    changedBaseline: false,
  };
  if (
    (input.subjectTokens.length === 0 && input.bodyTokens.length === 0) ||
    input.peers.length === 0
  ) {
    return empty;
  }

  type Hit = {
    peerJobId: string;
    phrase: string[];
    field: "subject" | "body";
  };
  const hits: Hit[] = [];

  const scanField = (
    field: "subject" | "body",
    hay: readonly string[]
  ): void => {
    if (hay.length === 0) return;
    for (const peer of input.peers) {
      const phrases =
        peer.phraseTokenLists.length > 0
          ? peer.phraseTokenLists
          : [peer.contentTokens];
      for (const phrase of phrases) {
        const content = phrase.filter(
          (t) =>
            isJobNameContentToken(t) ||
            isDistinguishingJobNameToken(t) ||
            isNumericJobNameToken(t)
        );
        if (content.length === 0) continue;
        // Standalone numbers never identify a Job via full-body search.
        if (content.length === 1 && isNumericJobNameToken(content[0]!)) {
          continue;
        }
        if (
          content.length === 1 &&
          isContextualWeakDistinguishingToken(content[0]!)
        ) {
          continue;
        }
        if (content.length === 1) {
          const token = content[0]!;
          const holders = input.peers.filter((p) =>
            p.contentTokens.some((ct) => contextualTokensEquivalent(ct, token))
          );
          if (holders.length > 1) continue;
        }
        for (let i = 0; i <= hay.length - content.length; i += 1) {
          let ok = true;
          for (let j = 0; j < content.length; j += 1) {
            const needle = content[j]!;
            const hayTok = hay[i + j]!;
            // Bare numeric tokens only match inside a descriptor+number span.
            if (isNumericJobNameToken(needle)) {
              if (!isNumericJobNameToken(hayTok) || hayTok !== needle) {
                ok = false;
                break;
              }
              const prev = j > 0 ? content[j - 1]! : null;
              if (
                !prev ||
                !resolveCompoundDescriptor(prev) ||
                !resolveCompoundDescriptor(hay[i + j - 1]!)
              ) {
                ok = false;
                break;
              }
              continue;
            }
            if (!contextualTokensEquivalent(hayTok, needle)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          if (isTokenNegatedInContextualHay(hay, i)) continue;
          if (
            field === "body" &&
            isTokenIncidentalInContextualHay(hay, i)
          ) {
            continue;
          }
          hits.push({ peerJobId: peer.jobId, phrase: content, field });
          break;
        }
      }
    }
  };

  scanField("subject", input.subjectTokens);
  scanField("body", input.bodyTokens);

  const familyIndex = buildContextualFamilyIndex(input.peers);
  const sharedKeys = new Set(
    familyIndex.sharedIdentifiers.map((s) => canonicalizeContextualToken(s))
  );

  // Candidate-relative unique project terms (e.g. Nova → Nova Classical).
  type UniqueTermHit = {
    peerJobId: string;
    term: string;
    field: "subject" | "body";
  };
  const uniqueTermHits: UniqueTermHit[] = [];
  const wordDiags: WordImportanceDiagnostic[] = [];

  const holdersForToken = (token: string): IdentityPeerJob[] =>
    input.peers.filter((p) =>
      extractContextualIdentityTerms(p).some(
        (t) =>
          !isCompoundNumericKey(t) && contextualTokensEquivalent(t, token)
      )
    );

  const peerIdentityKeys = new Set(
    input.peers.flatMap((p) =>
      extractContextualIdentityTerms(p)
        .filter((t) => !isCompoundNumericKey(t))
        .map((t) => canonicalizeContextualToken(t))
    )
  );

  const scanUniqueTerms = (
    field: "subject" | "body",
    hay: readonly string[]
  ): void => {
    for (let i = 0; i < hay.length; i += 1) {
      const tok = hay[i]!;
      if (isNumericJobNameToken(tok)) continue;
      const key = canonicalizeContextualToken(tok);
      // Only diagnose / consider tokens that appear in eligible Job titles.
      if (!peerIdentityKeys.has(key) && !sharedKeys.has(key)) continue;

      if (resolveCompoundDescriptor(tok) || isContextualWeakDistinguishingToken(tok)) {
        wordDiags.push({
          code: "GENERIC_TERM_SUPPRESSED",
          matchedTerm: tok,
          sourceField: field,
          importance: "generic",
          eligibleJobIds: holdersForToken(tok).map((p) => p.jobId),
          candidateJobIds: [],
          projectFamily: null,
          numericComponent: null,
          competingNumericComponents: [],
          sufficientForResolution: false,
          acceptRejectReason: "descriptor_or_weak_alone",
        });
        continue;
      }
      if (sharedKeys.has(key)) {
        wordDiags.push({
          code: "SHARED_PROJECT_FAMILY",
          matchedTerm: tok,
          sourceField: field,
          importance: "shared_family",
          eligibleJobIds: holdersForToken(tok).map((p) => p.jobId),
          candidateJobIds: holdersForToken(tok).map((p) => p.jobId),
          projectFamily: tok,
          numericComponent: null,
          competingNumericComponents: [],
          sufficientForResolution: false,
          acceptRejectReason: "shared_family_not_unique",
        });
        continue;
      }
      const holders = holdersForToken(tok);
      wordDiags.push({
        code: "DYNAMIC_WORD_IMPORTANCE",
        matchedTerm: tok,
        sourceField: field,
        importance: holders.length === 1 ? "unique" : "shared_family",
        eligibleJobIds: holders.map((p) => p.jobId),
        candidateJobIds: holders.map((p) => p.jobId),
        projectFamily: null,
        numericComponent: null,
        competingNumericComponents: [],
        sufficientForResolution: false,
        acceptRejectReason:
          holders.length === 1
            ? "unique_among_eligible"
            : "not_unique_among_eligible",
      });
      if (holders.length !== 1) continue;
      if (isTokenNegatedInContextualHay(hay, i)) continue;
      if (field === "body" && isTokenIncidentalInContextualHay(hay, i)) {
        continue;
      }
      uniqueTermHits.push({
        peerJobId: holders[0]!.jobId,
        term: key,
        field,
      });
      wordDiags.push({
        code: "UNIQUE_PROJECT_TERM",
        matchedTerm: tok,
        sourceField: field,
        importance: "unique",
        eligibleJobIds: [holders[0]!.jobId],
        candidateJobIds: [holders[0]!.jobId],
        projectFamily: null,
        numericComponent: null,
        competingNumericComponents: [],
        sufficientForResolution: true,
        acceptRejectReason: "unique_title_term",
      });
    }
  };

  // Prefer full-phrase hits; only use unique terms when phrases did not resolve.
  // Unique-term promotion is V3-only (frozen V2.4 keeps phrase/compound behavior).
  if (hits.length === 0 && input.features?.enableUniqueProjectTerms) {
    scanUniqueTerms("subject", input.subjectTokens);
    scanUniqueTerms("body", input.bodyTokens);
  }

  const phraseJobs = [...new Set(hits.map((h) => h.peerJobId))];
  const termJobs = [...new Set(uniqueTermHits.map((h) => h.peerJobId))];
  const uniqueJobs =
    phraseJobs.length > 0 ? phraseJobs : termJobs;
  if (uniqueJobs.length === 0) {
    return {
      ...empty,
      wordImportanceDiagnostics: wordDiags.slice(0, 24),
    };
  }
  if (uniqueJobs.length > 1) {
    return {
      ...empty,
      status: "AMBIGUOUS",
      reason: "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS",
      matchedTerms:
        phraseJobs.length > 0
          ? hits.flatMap((h) => h.phrase)
          : uniqueTermHits.map((h) => h.term),
      competingJobIds: uniqueJobs,
      evidenceField: "mixed",
      changedBaseline: true,
      familyJobIds: uniqueJobs,
      wordImportanceDiagnostics: wordDiags.slice(0, 24),
    };
  }

  const winner = uniqueJobs[0]!;
  const usedUniqueTerms =
    phraseJobs.length === 0 && termJobs.includes(winner);
  const winnerPhraseHits = hits.filter((h) => h.peerJobId === winner);
  const winnerTermHits = uniqueTermHits.filter((h) => h.peerJobId === winner);
  const subjectHit = usedUniqueTerms
    ? winnerTermHits.some((h) => h.field === "subject")
    : winnerPhraseHits.some((h) => h.field === "subject");
  const bodyHit = usedUniqueTerms
    ? winnerTermHits.some((h) => h.field === "body")
    : winnerPhraseHits.some((h) => h.field === "body");
  if (usedUniqueTerms) {
    wordDiags.push({
      code: "SINGLE_WORD_PROJECT_IDENTITY",
      matchedTerm: winnerTermHits[0]?.term ?? "",
      sourceField: subjectHit ? (bodyHit ? "mixed" : "subject") : "body",
      importance: "unique",
      eligibleJobIds: [winner],
      candidateJobIds: [winner],
      projectFamily: null,
      numericComponent: null,
      competingNumericComponents: [],
      sufficientForResolution: true,
      acceptRejectReason: "resolved_unique_project_term",
    });
  }
  return {
    ...empty,
    status: "MATCH",
    selectedJobId: winner,
    reason: usedUniqueTerms
      ? "SINGLE_WORD_PROJECT_IDENTITY"
      : "FULL_BODY_PROJECT_IDENTITY",
    matchedTerms: usedUniqueTerms
      ? winnerTermHits.map((h) => h.term)
      : winnerPhraseHits.flatMap((h) => h.phrase),
    competingJobIds: input.peers
      .map((p) => p.jobId)
      .filter((id) => id !== winner),
    evidenceField: subjectHit
      ? bodyHit
        ? "mixed"
        : "subject"
      : "body",
    changedBaseline: true,
    familyJobIds: [winner],
    wordImportanceDiagnostics: wordDiags.slice(0, 24),
  };
}

/**
 * Deterministic contextual resolution for a shared project family.
 */
export function resolveContextualWordSearch(input: {
  peers: readonly IdentityPeerJob[];
  subjectTokens: readonly string[];
  bodyTokens: readonly string[];
  /** Optional validated AI decision for AI-worthy cases. */
  aiDecision?: ContextualWordSearchAiDecision | null;
  features?: ContextualWordSearchFeatures;
}): ContextualResolution {
  const empty: ContextualResolution = {
    status: null,
    selectedJobId: null,
    reason: null,
    sharedIdentifiers: [],
    familyJobIds: [],
    distinguishingByJob: {},
    matchedTerms: [],
    evidenceField: null,
    competingJobIds: [],
    aiInvoked: false,
    changedBaseline: false,
    compoundNumericDiagnostics: [],
  };

  const hayTokens = [...input.subjectTokens, ...input.bodyTokens];
  const hayCompounds = extractCompoundNumericIdentities(hayTokens);
  const standaloneIgnored: CompoundNumericDiagnostic[] = [];
  for (let i = 0; i < hayTokens.length; i += 1) {
    const t = hayTokens[i]!;
    if (!isNumericJobNameToken(t)) continue;
    const covered = hayCompounds.some(
      (c) => c.startIndex === i - 1 || c.startIndex + 1 === i
    );
    if (covered) continue;
    // Only record when a peer has a same-value compound (would have been false evidence).
    const peersWithValue = input.peers.filter((p) =>
      extractPeerCompoundNumericIdentities(p).some((c) => c.value === t)
    );
    if (peersWithValue.length === 0) continue;
    standaloneIgnored.push({
      code: "STANDALONE_NUMBER_IGNORED",
      rawText: t,
      normalizedKey: null,
      descriptor: null,
      numericValue: t,
      evidenceSource:
        i < input.subjectTokens.length ? "subject" : "body",
      candidateJobId: peersWithValue[0]?.jobId ?? null,
      conflictingKeys: [],
      contributedToResolution: false,
    });
  }

  const index = buildContextualFamilyIndex(input.peers);
  const familyInHay = index.families.filter((f) =>
    hayTokens.some((t) => contextualTokensEquivalent(t, f.sharedId))
  );

  if (familyInHay.length > 0) {
    // Prefer subject-established family when present.
    const subjectFamilies = familyInHay.filter((f) =>
      input.subjectTokens.some((t) => contextualTokensEquivalent(t, f.sharedId))
    );
    const activeFamilies =
      subjectFamilies.length > 0 ? subjectFamilies : familyInHay;
    const family = activeFamilies[0]!;
    const competitors = family.peers;
    const sharedIdentifiers = [family.sharedId];
    const distinguishingByJob: Record<string, string[]> = {};
    for (const peer of competitors) {
      distinguishingByJob[peer.jobId] = extractContextualDistinguishingTerms({
        peer,
        competitors,
        sharedIdentifiers,
      });
    }

    const compoundDiags: CompoundNumericDiagnostic[] = [...standaloneIgnored];
    for (const c of hayCompounds) {
      const matchingPeers = competitors.filter((p) =>
        extractPeerCompoundNumericIdentities(p).some((pc) => pc.key === c.key)
      );
      const evidenceSource: "subject" | "body" =
        c.startIndex < input.subjectTokens.length ? "subject" : "body";
      compoundDiags.push({
        code: "COMPOUND_NUMERIC_IDENTITY",
        rawText: c.rawTokens.join(" "),
        normalizedKey: c.key,
        descriptor: c.descriptor,
        numericValue: c.value,
        evidenceSource,
        candidateJobId: matchingPeers[0]?.jobId ?? null,
        conflictingKeys: [],
        contributedToResolution: matchingPeers.length === 1,
      });
      compoundDiags.push({
        code: "NUMERIC_DESCRIPTOR_NORMALIZED",
        rawText: c.rawTokens[0] ?? c.descriptor,
        normalizedKey: c.key,
        descriptor: c.descriptor,
        numericValue: c.value,
        evidenceSource,
        candidateJobId: matchingPeers[0]?.jobId ?? null,
        conflictingKeys: [],
        contributedToResolution: false,
      });
    }

    // Peer-relative numeric contradictions: hay building:2 vs peer building:1.
    const conflictPeers: string[] = [];
    for (const peer of competitors) {
      const peerCompounds = extractPeerCompoundNumericIdentities(peer);
      const conflicts = findNumericIdentityConflicts({
        hayCompounds,
        peerCompounds,
      });
      if (conflicts.length === 0) continue;
      conflictPeers.push(peer.jobId);
      for (const conf of conflicts) {
        compoundDiags.push({
          code: "NUMERIC_IDENTITY_CONFLICT",
          rawText: conf.hayKey,
          normalizedKey: conf.hayKey,
          descriptor: conf.descriptor,
          numericValue: conf.hayValue,
          evidenceSource: "mixed",
          candidateJobId: peer.jobId,
          conflictingKeys: [conf.peerKey],
          contributedToResolution: true,
        });
      }
    }

    const allHits = competitors.flatMap((peer) =>
      findContextualDistinguishingHits({
        peer,
        competitors,
        sharedIdentifiers,
        subjectTokens: input.subjectTokens,
        bodyTokens: input.bodyTokens,
      })
    );

    // Family-scoped numeric: "Beltline #3" → unique peer with component 3 (V3).
    const familyScopedHits: ContextualTermHit[] = [];
    const scanFamilyNumeric = (
      field: "subject" | "body",
      hay: readonly string[]
    ): void => {
      const scoped = extractFamilyScopedNumericIdentities(
        hay,
        [family.sharedId],
        contextualTokensEquivalent
      );
      for (const fn of scoped) {
        const resolved = resolveFamilyScopedNumericPeer({
          value: fn.value,
          familyPeers: competitors,
        });
        if (!resolved) {
          // Multiple or zero peers share this component number.
          const holders = competitors.filter((p) =>
            extractPeerCompoundNumericIdentities(p).some(
              (c) => c.value === fn.value
            )
          );
          compoundDiags.push({
            code: "FAMILY_NUMERIC_IDENTITY",
            rawText: fn.rawTokens.join(" "),
            normalizedKey: fn.key,
            descriptor: null,
            numericValue: fn.value,
            evidenceSource: field,
            candidateJobId: holders[0]?.jobId ?? null,
            conflictingKeys: holders.map((h) => h.jobId),
            contributedToResolution: false,
          });
          continue;
        }
        if (isTokenNegatedInContextualHay(hay, fn.startIndex)) continue;
        if (
          field === "body" &&
          isTokenIncidentalInContextualHay(hay, fn.startIndex)
        ) {
          continue;
        }
        familyScopedHits.push({
          peerJobId: resolved.peer.jobId,
          term: resolved.compound.key,
          field,
          negated: false,
          incidental: false,
        });
        compoundDiags.push({
          code: "FAMILY_NUMERIC_IDENTITY",
          rawText: fn.rawTokens.join(" "),
          normalizedKey: resolved.compound.key,
          descriptor: resolved.compound.descriptor,
          numericValue: fn.value,
          evidenceSource: field,
          candidateJobId: resolved.peer.jobId,
          conflictingKeys: [],
          contributedToResolution: true,
        });
        // Explicit #N contradicts siblings with other component numbers.
        for (const peer of competitors) {
          if (peer.jobId === resolved.peer.jobId) continue;
          const peerCompounds = extractPeerCompoundNumericIdentities(peer);
          const contradicted = peerCompounds.some(
            (c) =>
              c.descriptor === resolved.compound.descriptor &&
              c.value !== fn.value
          );
          if (!contradicted) continue;
          if (!conflictPeers.includes(peer.jobId)) {
            conflictPeers.push(peer.jobId);
          }
          compoundDiags.push({
            code: "NUMERIC_IDENTITY_CONFLICT",
            rawText: fn.rawTokens.join(" "),
            normalizedKey: resolved.compound.key,
            descriptor: resolved.compound.descriptor,
            numericValue: fn.value,
            evidenceSource: field,
            candidateJobId: peer.jobId,
            conflictingKeys: peerCompounds.map((c) => c.key),
            contributedToResolution: true,
          });
        }
      }
    };
    if (input.features?.enableFamilyScopedNumeric) {
      scanFamilyNumeric("subject", input.subjectTokens);
      scanFamilyNumeric("body", input.bodyTokens);
    }

    const mergedHits = [...allHits, ...familyScopedHits];

    // Drop hits for peers with contradictory numeric identity in hay.
    const conflictPeerSet = new Set(conflictPeers);
    const filteredHits = mergedHits.filter(
      (h) =>
        !conflictPeerSet.has(h.peerJobId) ||
        (isCompoundNumericKey(h.term) &&
          (hayCompounds.some((c) => c.key === h.term) ||
            familyScopedHits.some(
              (fh) => fh.peerJobId === h.peerJobId && fh.term === h.term
            )))
    );

    const positiveHits = filteredHits.filter(
      (h) => !h.negated && !h.incidental
    );
    const subjectPositive = positiveHits.filter((h) => h.field === "subject");
    const bodyPositive = positiveHits.filter((h) => h.field === "body");

    const uniqueJobIds = (hits: ContextualTermHit[]) => [
      ...new Set(hits.map((h) => h.peerJobId)),
    ];

    // Drop standalone-ignored noise when family-scoped adjacency resolved the value.
    const familyResolvedValues = new Set(
      familyScopedHits
        .map((h) => parseCompoundNumericValue(h.term))
        .filter((v): v is string => v != null)
    );
    const prunedCompoundDiags = compoundDiags.filter(
      (d) =>
        !(
          d.code === "STANDALONE_NUMBER_IGNORED" &&
          d.numericValue != null &&
          familyResolvedValues.has(d.numericValue)
        )
    );

    const matchReasonFor = (
      winnerId: string,
      hits: ContextualTermHit[]
    ):
      | "CONTEXTUAL_WORD_SEARCH_MATCH"
      | "FAMILY_NUMERIC_IDENTITY" => {
      const fromFamily = familyScopedHits.some(
        (h) =>
          h.peerJobId === winnerId &&
          hits.some((ph) => ph.term === h.term && ph.field === h.field)
      );
      return fromFamily
        ? "FAMILY_NUMERIC_IDENTITY"
        : "CONTEXTUAL_WORD_SEARCH_MATCH";
    };

    const baseMeta = {
      sharedIdentifiers,
      familyJobIds: competitors.map((c) => c.jobId),
      distinguishingByJob,
      aiInvoked: false,
      changedBaseline: true,
      compoundNumericDiagnostics: prunedCompoundDiags,
    };

    // Explicit numeric conflict without a matching compound winner → CONFLICT.
    if (conflictPeers.length > 0) {
      const compoundWinners = uniqueJobIds(
        positiveHits.filter((h) => isCompoundNumericKey(h.term))
      );
      const nonConflictWinners = compoundWinners.filter(
        (id) => !conflictPeerSet.has(id)
      );
      if (nonConflictWinners.length !== 1) {
        return {
          ...empty,
          ...baseMeta,
          status: "CONFLICT",
          reason: "NUMERIC_IDENTITY_CONFLICT",
          matchedTerms: [
            ...hayCompounds.map((c) => c.key),
            ...familyScopedHits.map((h) => h.term),
          ],
          competingJobIds: competitors.map((c) => c.jobId),
          evidenceField: "mixed",
        };
      }
    }

    // Explicit correction across subject/body → conservative abstain.
    if (
      hasExplicitContextualCorrection([
        ...input.subjectTokens,
        ...input.bodyTokens,
      ]) &&
      uniqueJobIds(positiveHits).length >= 1 &&
      (filteredHits.some((h) => h.negated) ||
        uniqueJobIds(positiveHits).length > 1)
    ) {
      return {
        ...empty,
        ...baseMeta,
        status: "AMBIGUOUS",
        reason: "EXPLICIT_PROJECT_CORRECTION",
        matchedTerms: positiveHits.map((h) => h.term),
        competingJobIds: uniqueJobIds(filteredHits),
        evidenceField: "mixed",
      };
    }

    // Strong subject distinguishing evidence for exactly one peer.
    const subjectWinners = uniqueJobIds(subjectPositive);
    if (subjectWinners.length === 1) {
      const winnerId = subjectWinners[0]!;
      const hasCompoundEvidence = subjectPositive.some(
        (h) =>
          isCompoundNumericKey(h.term) &&
          (hayCompounds.some((c) => c.key === h.term) ||
            familyScopedHits.some(
              (fh) => fh.peerJobId === winnerId && fh.term === h.term
            ))
      );
      if (conflictPeerSet.has(winnerId) && !hasCompoundEvidence) {
        return {
          ...empty,
          ...baseMeta,
          status: "CONFLICT",
          reason: "NUMERIC_IDENTITY_CONFLICT",
          matchedTerms: subjectPositive.map((h) => h.term),
          competingJobIds: competitors.map((c) => c.jobId),
          evidenceField: "subject",
        };
      }
      return {
        ...empty,
        ...baseMeta,
        status: "MATCH",
        selectedJobId: winnerId,
        reason: matchReasonFor(winnerId, subjectPositive),
        matchedTerms: subjectPositive.map((h) => h.term),
        competingJobIds: competitors
          .map((c) => c.jobId)
          .filter((id) => id !== winnerId),
        evidenceField: "subject",
      };
    }

    if (subjectWinners.length > 1) {
      return {
        ...empty,
        ...baseMeta,
        status: "AMBIGUOUS",
        reason: "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS",
        matchedTerms: subjectPositive.map((h) => h.term),
        competingJobIds: subjectWinners,
        evidenceField: "subject",
      };
    }

    // Body distinguishing evidence — family may be in subject OR current body.
    // Do not require the shared identifier in the subject.
    const familyInSubjectOrBody = [...input.subjectTokens, ...input.bodyTokens].some(
      (t) => contextualTokensEquivalent(t, family.sharedId)
    );
    if (familyInSubjectOrBody) {
      const bodyWinners = uniqueJobIds(bodyPositive);
      if (bodyWinners.length === 1) {
        const winnerId = bodyWinners[0]!;
        const hasCompoundEvidence = bodyPositive.some(
          (h) =>
            h.peerJobId === winnerId &&
            isCompoundNumericKey(h.term) &&
            (hayCompounds.some((c) => c.key === h.term) ||
              familyScopedHits.some(
                (fh) => fh.peerJobId === winnerId && fh.term === h.term
              ))
        );
        if (conflictPeerSet.has(winnerId) && !hasCompoundEvidence) {
          return {
            ...empty,
            ...baseMeta,
            status: "CONFLICT",
            reason: "NUMERIC_IDENTITY_CONFLICT",
            matchedTerms: bodyPositive.map((h) => h.term),
            competingJobIds: competitors.map((c) => c.jobId),
            evidenceField: "body",
          };
        }
        return {
          ...empty,
          ...baseMeta,
          status: "MATCH",
          selectedJobId: winnerId,
          reason: matchReasonFor(
            winnerId,
            bodyPositive.filter((h) => h.peerJobId === winnerId)
          ),
          matchedTerms: bodyPositive
            .filter((h) => h.peerJobId === winnerId)
            .map((h) => h.term),
          competingJobIds: competitors
            .map((c) => c.jobId)
            .filter((id) => id !== winnerId),
          evidenceField: "body",
        };
      }
      if (bodyWinners.length > 1) {
        if (input.aiDecision) {
          const peerCompoundsByJob: Record<string, string[]> = {};
          for (const peer of competitors) {
            peerCompoundsByJob[peer.jobId] = extractPeerCompoundNumericIdentities(
              peer
            ).map((c) => c.key);
          }
          const validated = validateContextualWordSearchAiDecision({
            decision: input.aiDecision,
            candidateJobIds: competitors.map((c) => c.jobId),
            subject: input.subjectTokens.join(" "),
            body: input.bodyTokens.join(" "),
            peerCompoundsByJob,
          });
          if (validated.ok && validated.decision.decision === "MATCH") {
            return {
              ...empty,
              ...baseMeta,
              status: "MATCH",
              selectedJobId: validated.decision.selectedJobId,
              reason: "AI_CONTEXTUAL_DISAMBIGUATION",
              matchedTerms: bodyPositive.map((h) => h.term),
              competingJobIds: validated.decision.competingJobIds,
              evidenceField: "mixed",
              aiInvoked: true,
            };
          }
          if (validated.ok) {
            return {
              ...empty,
              ...baseMeta,
              status: "AMBIGUOUS",
              reason: "AI_CONTEXTUAL_ABSTENTION",
              matchedTerms: bodyPositive.map((h) => h.term),
              competingJobIds: bodyWinners,
              evidenceField: "body",
              aiInvoked: true,
            };
          }
        }
        return {
          ...empty,
          ...baseMeta,
          status: "AMBIGUOUS",
          reason: "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS",
          matchedTerms: bodyPositive.map((h) => h.term),
          competingJobIds: bodyWinners,
          evidenceField: "body",
        };
      }

      if (allHits.some((h) => h.negated) && bodyWinners.length === 0) {
        const positiveAfterNegation = uniqueJobIds(
          allHits.filter((h) => !h.negated && !h.incidental)
        );
        if (positiveAfterNegation.length === 1) {
          return {
            ...empty,
            ...baseMeta,
            status: "MATCH",
            selectedJobId: positiveAfterNegation[0]!,
            reason: "NEGATED_PROJECT_REFERENCE",
            matchedTerms: allHits
              .filter((h) => !h.negated)
              .map((h) => h.term),
            competingJobIds: competitors
              .map((c) => c.jobId)
              .filter((id) => id !== positiveAfterNegation[0]),
            evidenceField: "mixed",
          };
        }
        return {
          ...empty,
          ...baseMeta,
          status: "AMBIGUOUS",
          reason: "NEGATED_PROJECT_REFERENCE",
          matchedTerms: allHits.map((h) => h.term),
          competingJobIds: competitors.map((c) => c.jobId),
          evidenceField: "mixed",
        };
      }

      // Shared family with no distinguishing terms — try full-body unique names
      // before abstaining (covers unique siblings named without shared-id phrases).
      const fullBody = resolveFullBodyProjectIdentity(input);
      if (fullBody.status === "MATCH") return fullBody;

      return {
        ...empty,
        ...baseMeta,
        status: "AMBIGUOUS",
        reason: "SHARED_PROJECT_IDENTIFIER",
        matchedTerms: sharedIdentifiers,
        competingJobIds: competitors.map((c) => c.jobId),
        evidenceField: input.subjectTokens.some((t) =>
          contextualTokensEquivalent(t, family.sharedId)
        )
          ? "subject"
          : "body",
      };
    }
  }

  // No shared-family path — unique project name/alias in current body (e.g. Exodus).
  return resolveFullBodyProjectIdentity(input);
}
