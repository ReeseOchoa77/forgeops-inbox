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
} from "./job-name-normalize.js";
import {
  normalizeProjectScopeToken,
  projectTokensEquivalent,
} from "./job-project-token-utils.js";
import type { IdentityPeerJob } from "./job-name-identity-policy.js";

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
    const c = canonicalizeContextualToken(t);
    if (seen.has(c)) continue;
    if (isContextualWeakDistinguishingToken(c) && !isNumericJobNameToken(c)) {
      // Keep weak terms only if they are the sole content after shared id — handled later.
      continue;
    }
    if (
      !isJobNameContentToken(t) &&
      !isDistinguishingJobNameToken(t) &&
      !isNumericJobNameToken(t) &&
      c !== "building" &&
      c !== "exterior"
    ) {
      continue;
    }
    seen.add(c);
    out.push(c);
  }
  // Always retain numeric distinguishers from the peer.
  for (const t of peer.distinguishingTokens) {
    const c = canonicalizeContextualToken(t);
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
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
    if (isContextualWeakDistinguishingToken(t)) continue;
    if (
      input.sharedIdentifiers.some((s) => contextualTokensEquivalent(s, t))
    ) {
      continue;
    }
    const onOther = input.competitors.some(
      (c) =>
        c.jobId !== input.peer.jobId &&
        extractContextualIdentityTerms(c).some((ct) =>
          contextualTokensEquivalent(ct, t)
        )
    );
    if (onOther) continue;
    const key = canonicalizeContextualToken(t);
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
  const left = hay.slice(Math.max(0, tokenIndex - 3), tokenIndex);
  if (left.some((t) => leftCues.has(t))) return true;
  // "concessions work is complete" / "stairs are finished"
  const right = hay.slice(tokenIndex + 1, tokenIndex + 5);
  if (right.some((t) => doneCues.has(t))) return true;
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
    for (let i = 0; i < input.subjectTokens.length; i += 1) {
      if (!contextualTokensEquivalent(input.subjectTokens[i]!, term)) continue;
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
      if (!contextualTokensEquivalent(input.bodyTokens[i]!, term)) continue;
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
    | null;
  sharedIdentifiers: string[];
  familyJobIds: string[];
  distinguishingByJob: Record<string, string[]>;
  matchedTerms: string[];
  evidenceField: "subject" | "body" | "mixed" | null;
  competingJobIds: string[];
  aiInvoked: boolean;
  changedBaseline: boolean;
};

/**
 * Unique eligible project name/alias phrases in subject and/or current body.
 * Does not require a shared family identifier.
 */
export function resolveFullBodyProjectIdentity(input: {
  peers: readonly IdentityPeerJob[];
  subjectTokens: readonly string[];
  bodyTokens: readonly string[];
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
            if (!contextualTokensEquivalent(hay[i + j]!, content[j]!)) {
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

  const uniqueJobs = [...new Set(hits.map((h) => h.peerJobId))];
  if (uniqueJobs.length === 0) return empty;
  if (uniqueJobs.length > 1) {
    return {
      ...empty,
      status: "AMBIGUOUS",
      reason: "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS",
      matchedTerms: hits.flatMap((h) => h.phrase),
      competingJobIds: uniqueJobs,
      evidenceField: "mixed",
      changedBaseline: true,
      familyJobIds: uniqueJobs,
    };
  }

  const winner = uniqueJobs[0]!;
  const winnerHits = hits.filter((h) => h.peerJobId === winner);
  const subjectHit = winnerHits.some((h) => h.field === "subject");
  return {
    ...empty,
    status: "MATCH",
    selectedJobId: winner,
    reason: "FULL_BODY_PROJECT_IDENTITY",
    matchedTerms: winnerHits.flatMap((h) => h.phrase),
    competingJobIds: input.peers
      .map((p) => p.jobId)
      .filter((id) => id !== winner),
    evidenceField: subjectHit
      ? winnerHits.some((h) => h.field === "body")
        ? "mixed"
        : "subject"
      : "body",
    changedBaseline: true,
    familyJobIds: [winner],
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

  const index = buildContextualFamilyIndex(input.peers);
  const familyInHay = index.families.filter((f) =>
    [...input.subjectTokens, ...input.bodyTokens].some((t) =>
      contextualTokensEquivalent(t, f.sharedId)
    )
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

    const allHits = competitors.flatMap((peer) =>
      findContextualDistinguishingHits({
        peer,
        competitors,
        sharedIdentifiers,
        subjectTokens: input.subjectTokens,
        bodyTokens: input.bodyTokens,
      })
    );

    const positiveHits = allHits.filter((h) => !h.negated && !h.incidental);
    const subjectPositive = positiveHits.filter((h) => h.field === "subject");
    const bodyPositive = positiveHits.filter((h) => h.field === "body");

    const uniqueJobIds = (hits: ContextualTermHit[]) => [
      ...new Set(hits.map((h) => h.peerJobId)),
    ];

    const baseMeta = {
      sharedIdentifiers,
      familyJobIds: competitors.map((c) => c.jobId),
      distinguishingByJob,
      aiInvoked: false,
      changedBaseline: true,
    };

    // Explicit correction across subject/body → conservative abstain.
    if (
      hasExplicitContextualCorrection([
        ...input.subjectTokens,
        ...input.bodyTokens,
      ]) &&
      uniqueJobIds(positiveHits).length >= 1 &&
      (allHits.some((h) => h.negated) || uniqueJobIds(positiveHits).length > 1)
    ) {
      return {
        ...empty,
        ...baseMeta,
        status: "AMBIGUOUS",
        reason: "EXPLICIT_PROJECT_CORRECTION",
        matchedTerms: positiveHits.map((h) => h.term),
        competingJobIds: uniqueJobIds(allHits),
        evidenceField: "mixed",
      };
    }

    // Strong subject distinguishing evidence for exactly one peer.
    const subjectWinners = uniqueJobIds(subjectPositive);
    if (subjectWinners.length === 1) {
      const winnerId = subjectWinners[0]!;
      return {
        ...empty,
        ...baseMeta,
        status: "MATCH",
        selectedJobId: winnerId,
        reason: "CONTEXTUAL_WORD_SEARCH_MATCH",
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
        return {
          ...empty,
          ...baseMeta,
          status: "MATCH",
          selectedJobId: winnerId,
          reason: "CONTEXTUAL_WORD_SEARCH_MATCH",
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
          const validated = validateContextualWordSearchAiDecision({
            decision: input.aiDecision,
            candidateJobIds: competitors.map((c) => c.jobId),
            subject: input.subjectTokens.join(" "),
            body: input.bodyTokens.join(" "),
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
