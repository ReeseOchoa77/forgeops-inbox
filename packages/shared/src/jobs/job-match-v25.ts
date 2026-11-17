/**
 * CONTEXT_AWARE_V2_5 — AI Identity Profiles: deterministic scoring + recovery.
 *
 * Independent of V2.1–V2.4 and V3 (does not call resolveContextualWordSearch
 * or tryContextualWordSearchRecovery, does not enable V3 feature flags).
 * Reuses low-level helpers only: compound-numeric extraction, family-scoped
 * numeric resolution, negation/incidental window checks.
 *
 * Scores are *evidence scores*, not probabilities.
 *
 * Never uses Job.jobNumber. Bare numbers are never identity evidence; numbers
 * count only as descriptor compounds (Building 3) or family+number adjacency
 * (Beltline #3) with a unique family peer.
 */

import { canonicalizeJobNameTokens, isNumericJobNameToken } from "./job-name-normalize.js";
import {
  extractCompoundNumericIdentities,
  extractFamilyScopedNumericIdentities,
  isCompoundNumericKey,
  parseCompoundNumericKey,
  resolveFamilyScopedNumericPeer,
} from "./job-contextual-compound-numeric.js";
import {
  hasExplicitContextualCorrection,
  isTokenIncidentalInContextualHay,
  isTokenNegatedInContextualHay,
} from "./job-contextual-word-search.js";
import {
  JOB_IDENTITY_PROFILE_VERSION,
  buildJobIdentityWorkspaceStats,
  buildDeterministicJobIdentityProfile,
  canonicalIdentityToken,
  openTokenRoleForDocumentFrequency,
  validateJobIdentityProfileAgainstTitle,
  type JobIdentityImportance,
  type JobIdentityProfile,
  type JobIdentityProfileJobInput,
  type JobIdentitySemanticRole,
} from "./job-identity-profile.js";
import type { IdentityPeerJob } from "./job-name-identity-policy.js";

export type V25ReasonCode =
  | "V25_DISTINCTIVE_TERM"
  | "V25_FAMILY_DISAMBIGUATION"
  | "V25_FAMILY_NUMERIC"
  | "V25_COMPOUND_PHRASE"
  | "V25_SHARED_FAMILY_AMBIGUOUS"
  | "V25_NUMERIC_CONFLICT"
  | "V25_PROFILE_FALLBACK";

export type V25EvidenceField = "subject" | "body" | "attachment";

/** Scoring constants (documented formulas — see resolveV25ProjectIdentity). */
export const V25_SCORING = {
  revision: "v25-scoring-r1",
  semanticWeight: { HIGH: 1, MEDIUM: 0.6, LOW: 0.3, NONE: 0 } as Record<
    JobIdentityImportance,
    number
  >,
  fieldWeight: { subject: 1, body: 0.7, attachment: 0.6 } as Record<
    V25EvidenceField,
    number
  >,
  roleWeight: {
    DISTINCTIVE_PROJECT_NAME: 1,
    PROJECT_FAMILY_NAME: 1,
    COMPOUND_PROJECT_PHRASE: 1,
    NUMBERED_STRUCTURE_IDENTIFIER: 0.9,
    STRUCTURE_DESCRIPTOR: 0.8,
    SUPPORTING_PROJECT_TERM: 0.8,
    GENERIC_CONSTRUCTION_TERM: 0,
  } as Record<JobIdentitySemanticRole, number>,
  /** Weight of a family-adjacent number (Beltline #3). */
  familyNumericRoleWeight: 1,
  /** Additional-field corroboration factor. */
  secondaryFieldFactor: 0.25,
  /** Minimum total evidence score to select. */
  minTotalScore: 0.45,
  /** Minimum lead over the next non-rejected candidate. */
  minMargin: 0.35,
} as const;

export type V25TermCapability =
  | "STANDALONE"
  | "FAMILY_SCOPED"
  | "FAMILY_TERM"
  | "NONE";

export type V25TermAnalysis = {
  term: string;
  role: JobIdentitySemanticRole;
  semanticImportance: JobIdentityImportance;
  competitiveImportance: JobIdentityImportance;
  /** Workspace document frequency (eligible Jobs owning the term). */
  documentFrequency: number;
  /** DF inside the Job's family (family-scoped capability only). */
  scopedDocumentFrequency: number | null;
  source: V25EvidenceField;
  matched: boolean;
  negated: boolean;
  incidental: boolean;
  jobIds: string[];
  /** Max per-owner evidence score contributed by this term/source. */
  score: number;
  capability: V25TermCapability;
  usedForResolution: boolean;
  note: string;
};

export type V25CandidateAnalysis = {
  jobId: string;
  jobLabel: string;
  /** familyScore + distinguishingScore (0 when rejected). Evidence score, not probability. */
  score: number;
  familyScore: number;
  distinguishingScore: number;
  status: "SELECTED" | "CANDIDATE" | "REJECTED";
  reason: string;
  matchedTerms: string[];
  contradictions: string[];
};

export type V25ProfileSource = "DETERMINISTIC" | "SUPPLIED" | "MIXED";

export type V25IdentityDiagnostics = {
  profileVersion: string;
  scoringRevision: string;
  status: "MATCH" | "AMBIGUOUS" | "CONFLICT" | null;
  reason: V25ReasonCode;
  resolutionReason: string;
  selectedJobId: string | null;
  familyJobIds: string[];
  candidates: V25CandidateAnalysis[];
  termAnalyses: V25TermAnalysis[];
  profileSource: V25ProfileSource;
  fallbackProfileJobIds: string[];
  winnerScore: number | null;
  runnerUpScore: number | null;
  margin: number | null;
};

export type V25Resolution = V25IdentityDiagnostics & {
  matchedTerms: string[];
  competingJobIds: string[];
  evidenceField: V25EvidenceField | "mixed" | null;
};

export type V25AttachmentInput = {
  attachmentId: string;
  tokens?: readonly string[];
  text?: string | null;
};

type ProfilesInput =
  | ReadonlyMap<string, JobIdentityProfile>
  | Readonly<Record<string, JobIdentityProfile>>
  | null
  | undefined;

type Stream = {
  field: V25EvidenceField;
  raw: string[];
  canon: string[];
  compounds: ReturnType<typeof extractCompoundNumericIdentities>;
};

type TermKind = "token" | "phrase" | "numbered";

type TermMeta = {
  key: string;
  kind: TermKind;
  tokens: string[];
  role: JobIdentitySemanticRole;
  semantic: JobIdentityImportance;
  owners: string[];
};

type FieldHit = {
  positive: boolean;
  negated: boolean;
  incidental: boolean;
};

type TermState = {
  meta: TermMeta;
  hits: Partial<Record<V25EvidenceField, FieldHit>>;
};

type Evidence = {
  jobId: string;
  term: string;
  display: string;
  kind: "family" | "token" | "phrase" | "numbered" | "family_numeric";
  role: JobIdentitySemanticRole;
  tokens: string[];
  capability: V25TermCapability;
  scopedDf: number | null;
  /** Per-field evidence scores. */
  fieldScores: Partial<Record<V25EvidenceField, number>>;
  score: number;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function toProfileMap(p: ProfilesInput): Map<string, JobIdentityProfile> {
  if (!p) return new Map();
  if (p instanceof Map) return new Map(p);
  return new Map(Object.entries(p as Record<string, JobIdentityProfile>));
}

function peerToProfileJob(peer: IdentityPeerJob): JobIdentityProfileJobInput {
  return {
    jobId: peer.jobId,
    jobName: peer.jobName ?? null,
    phraseTokenLists: peer.phraseTokenLists,
  };
}

function containsSubgram(
  outer: readonly string[],
  inner: readonly string[]
): boolean {
  if (inner.length === 0 || inner.length > outer.length) return false;
  for (let i = 0; i + inner.length <= outer.length; i += 1) {
    if (inner.every((t, j) => outer[i + j] === t)) return true;
  }
  return false;
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Resolve project identity from subject/body (and optional attachment text)
 * using Job identity profiles.
 *
 * ## Scoring (evidence scores, not probabilities)
 *
 * For each Job j and matched, non-negated, non-incidental term t in field f:
 *
 *   termScore(j,t,f) = semW(t) × compW(j,t) × roleW(t) × fieldW(f)
 *
 * - semW: HIGH 1.0, MEDIUM 0.6, LOW 0.3, NONE 0
 * - compW: 1 / DF where DF is workspace document frequency for STANDALONE
 *   terms (DISTINCTIVE name, phrase with HIGH semantics and DF==1) and the
 *   *family-scoped* DF (owners inside j's present family) for family-scoped
 *   terms (structure descriptors, supporting qualifiers, descriptor-only
 *   phrases, Building N compounds, Beltline #N). Family terms themselves use
 *   workspace DF (so a shared family word is worth 1/DF alone).
 * - roleW: distinctive/family/phrase 1.0, numbered 0.9, structure/supporting 0.8
 * - fieldW: subject 1.0, body 0.7, attachment 0.6
 *
 * A term seen in several fields contributes max(field) + 0.25 × Σ(other fields).
 * Overlapping phrase matches keep only the longest; single tokens covered by a
 * longer matched phrase are dropped (family terms are never dropped).
 *
 *   candidate.score = familyScore + distinguishingScore
 *
 * Selection requires: a STANDALONE or FAMILY_SCOPED (capable) hit; score ≥ 0.45;
 * lead ≥ 0.35 over the next non-rejected candidate; no numeric contradiction.
 * Candidates whose descriptor numbers contradict positive hay numbers
 * (Building 2 in hay vs Building 3 on the Job) are REJECTED.
 */
export function resolveV25ProjectIdentity(input: {
  peers: readonly IdentityPeerJob[];
  subjectTokens: readonly string[];
  bodyTokens: readonly string[];
  profilesByJobId?: ProfilesInput;
  attachments?: ReadonlyArray<V25AttachmentInput>;
}): V25Resolution {
  const peers = input.peers;

  // ── 1. Profiles (supplied+valid, else deterministic fallback) ───────────
  const supplied = toProfileMap(input.profilesByJobId);
  const stats = buildJobIdentityWorkspaceStats(peers.map(peerToProfileJob));
  const profiles = new Map<string, JobIdentityProfile>();
  const fallbackProfileJobIds: string[] = [];
  let suppliedUsed = 0;
  let builtUsed = 0;
  for (const peer of peers) {
    const jobInput = peerToProfileJob(peer);
    const sup = supplied.get(peer.jobId);
    if (
      sup &&
      (sup.analysisStatus === "READY" || sup.analysisStatus === "FALLBACK") &&
      validateJobIdentityProfileAgainstTitle(sup, jobInput).ok
    ) {
      profiles.set(peer.jobId, sup);
      suppliedUsed += 1;
      continue;
    }
    if (sup) fallbackProfileJobIds.push(peer.jobId);
    profiles.set(
      peer.jobId,
      buildDeterministicJobIdentityProfile(jobInput, stats)
    );
    builtUsed += 1;
  }
  const profileSource: V25ProfileSource =
    suppliedUsed === 0
      ? "DETERMINISTIC"
      : builtUsed === 0
        ? "SUPPLIED"
        : "MIXED";

  const labelFor = (jobId: string): string =>
    profiles.get(jobId)?.jobName || jobId;

  // ── 2. Workspace term index (DF recomputed from current profiles) ───────
  const metas = new Map<string, TermMeta>();
  for (const peer of peers) {
    const profile = profiles.get(peer.jobId)!;
    for (const t of profile.terms) {
      const kind: TermKind = isCompoundNumericKey(t.term)
        ? "numbered"
        : t.term.includes(" ")
          ? "phrase"
          : "token";
      const existing = metas.get(t.term);
      if (existing) {
        if (!existing.owners.includes(peer.jobId)) {
          existing.owners.push(peer.jobId);
        }
        continue;
      }
      metas.set(t.term, {
        key: t.term,
        kind,
        tokens:
          kind === "numbered" ? [...t.tokens] : t.term.split(" ").filter(Boolean),
        role: t.role,
        semantic: t.semanticImportance,
        owners: [peer.jobId],
      });
    }
  }
  for (const meta of metas.values()) {
    if (
      meta.kind === "token" &&
      (meta.role === "DISTINCTIVE_PROJECT_NAME" ||
        meta.role === "PROJECT_FAMILY_NAME")
    ) {
      meta.role = openTokenRoleForDocumentFrequency(meta.owners.length);
    }
  }

  const competitiveOf = (meta: TermMeta): JobIdentityImportance =>
    meta.role === "GENERIC_CONSTRUCTION_TERM"
      ? "NONE"
      : meta.owners.length <= 1
        ? "HIGH"
        : "LOW";

  // ── 3. Hay streams ─────────────────────────────────────────────────────
  const mkStream = (
    field: V25EvidenceField,
    raw: readonly string[]
  ): Stream => ({
    field,
    raw: [...raw],
    canon: raw.map(canonicalIdentityToken),
    compounds: extractCompoundNumericIdentities(raw),
  });
  const streams: Stream[] = [
    mkStream("subject", input.subjectTokens),
    mkStream("body", input.bodyTokens),
  ];
  for (const a of input.attachments ?? []) {
    const toks = a.tokens
      ? [...a.tokens]
      : canonicalizeJobNameTokens(a.text ?? "");
    if (toks.length > 0) streams.push(mkStream("attachment", toks));
  }

  // ── 4. Term hits per field ─────────────────────────────────────────────
  const states = new Map<string, TermState>();
  for (const meta of metas.values()) {
    const hits: Partial<Record<V25EvidenceField, FieldHit>> = {};
    for (const s of streams) {
      const occurrences: number[] = [];
      if (meta.kind === "token") {
        const tok = meta.tokens[0]!;
        for (let i = 0; i < s.canon.length; i += 1) {
          if (s.canon[i] === tok && !isNumericJobNameToken(s.raw[i]!)) {
            occurrences.push(i);
          }
        }
      } else if (meta.kind === "phrase") {
        const n = meta.tokens.length;
        for (let i = 0; i + n <= s.canon.length; i += 1) {
          if (meta.tokens.every((t, j) => s.canon[i + j] === t)) {
            occurrences.push(i);
          }
        }
      } else {
        for (const c of s.compounds) {
          if (c.key === meta.key) occurrences.push(c.startIndex);
        }
      }
      if (occurrences.length === 0) continue;
      let positive = false;
      let negated = false;
      let incidental = false;
      for (const idx of occurrences) {
        const neg = isTokenNegatedInContextualHay(s.raw, idx);
        const inc =
          s.field !== "subject" && isTokenIncidentalInContextualHay(s.raw, idx);
        if (!neg && !inc) positive = true;
        negated = negated || neg;
        incidental = incidental || inc;
      }
      const prev = hits[s.field];
      hits[s.field] = {
        positive: (prev?.positive ?? false) || positive,
        negated: (prev?.negated ?? false) || negated,
        incidental: (prev?.incidental ?? false) || incidental,
      };
    }
    if (Object.keys(hits).length > 0) states.set(meta.key, { meta, hits });
  }

  const hasPositive = (st: TermState): boolean =>
    Object.values(st.hits).some((h) => h?.positive);

  // ── 5. Present family terms ───────────────────────────────────────────
  const presentFamilies: TermMeta[] = [];
  for (const st of states.values()) {
    if (st.meta.kind === "token" && st.meta.role === "PROJECT_FAMILY_NAME") {
      if (hasPositive(st)) presentFamilies.push(st.meta);
    }
  }
  const familyJobIds = uniq(presentFamilies.flatMap((f) => f.owners));
  const familiesOfJob = (jobId: string): TermMeta[] =>
    presentFamilies
      .filter((f) => f.owners.includes(jobId))
      .sort((a, b) => a.owners.length - b.owners.length);

  const peerById = new Map(peers.map((p) => [p.jobId, p]));

  // ── 6. Family-scoped numeric adjacency (Beltline #3) ──────────────────
  type FamilyNumericHit = {
    jobId: string;
    compoundKey: string;
    familyKey: string;
    field: V25EvidenceField;
    descriptor: string;
    value: string;
    display: string;
  };
  const familyNumericHits: FamilyNumericHit[] = [];
  const extraAnalyses: V25TermAnalysis[] = [];
  for (const fam of presentFamilies) {
    const familyPeers = fam.owners
      .map((id) => peerById.get(id))
      .filter((p): p is IdentityPeerJob => p != null);
    for (const s of streams) {
      const scoped = extractFamilyScopedNumericIdentities(
        s.canon,
        [fam.key],
        (a, b) => a === b
      );
      for (const fn of scoped) {
        const display = `${fam.key} #${fn.value}`;
        const negated = isTokenNegatedInContextualHay(s.raw, fn.startIndex);
        const incidental =
          s.field !== "subject" &&
          isTokenIncidentalInContextualHay(s.raw, fn.startIndex);
        const resolved = resolveFamilyScopedNumericPeer({
          value: fn.value,
          familyPeers,
        });
        if (!resolved) {
          extraAnalyses.push({
            term: display,
            role: "NUMBERED_STRUCTURE_IDENTIFIER",
            semanticImportance: "HIGH",
            competitiveImportance: "LOW",
            documentFrequency: familyPeers.length,
            scopedDocumentFrequency: null,
            source: s.field,
            matched: true,
            negated,
            incidental,
            jobIds: [],
            score: 0,
            capability: "NONE",
            usedForResolution: false,
            note: "Family + number did not map to exactly one family Job.",
          });
          continue;
        }
        if (negated || incidental) {
          extraAnalyses.push({
            term: display,
            role: "NUMBERED_STRUCTURE_IDENTIFIER",
            semanticImportance: "HIGH",
            competitiveImportance: "HIGH",
            documentFrequency: 1,
            scopedDocumentFrequency: 1,
            source: s.field,
            matched: true,
            negated,
            incidental,
            jobIds: [resolved.peer.jobId],
            score: 0,
            capability: "NONE",
            usedForResolution: false,
            note: negated
              ? "Family number negated in context."
              : "Family number treated as incidental.",
          });
          continue;
        }
        familyNumericHits.push({
          jobId: resolved.peer.jobId,
          compoundKey: resolved.compound.key,
          familyKey: fam.key,
          field: s.field,
          descriptor: resolved.compound.descriptor,
          value: fn.value,
          display,
        });
      }
    }
  }

  // ── 7. Per-job evidence ────────────────────────────────────────────────
  const evidence: Evidence[] = [];
  const { semanticWeight, fieldWeight, roleWeight } = V25_SCORING;

  const combineFields = (
    fieldScores: Partial<Record<V25EvidenceField, number>>
  ): number => {
    const vals = Object.values(fieldScores)
      .filter((v): v is number => typeof v === "number" && v > 0)
      .sort((a, b) => b - a);
    if (vals.length === 0) return 0;
    return (
      vals[0]! +
      V25_SCORING.secondaryFieldFactor * vals.slice(1).reduce((a, b) => a + b, 0)
    );
  };

  for (const st of states.values()) {
    const { meta } = st;
    if (!hasPositive(st)) continue;
    if (meta.role === "GENERIC_CONSTRUCTION_TERM") continue;
    for (const jobId of meta.owners) {
      let capability: V25TermCapability = "NONE";
      let scopedDf: number | null = null;
      let compW = 0;
      let kind: Evidence["kind"] = meta.kind === "numbered" ? "numbered" : meta.kind;

      if (meta.role === "PROJECT_FAMILY_NAME") {
        capability = "FAMILY_TERM";
        compW = 1 / meta.owners.length;
        kind = "family";
      } else if (
        meta.role === "DISTINCTIVE_PROJECT_NAME" ||
        (meta.kind === "phrase" &&
          meta.semantic === "HIGH" &&
          meta.owners.length === 1)
      ) {
        capability = "STANDALONE";
        compW = 1 / meta.owners.length;
      } else {
        const fams = familiesOfJob(jobId);
        if (fams.length > 0) {
          const fam = fams[0]!;
          scopedDf = meta.owners.filter((o) => fam.owners.includes(o)).length;
          capability = "FAMILY_SCOPED";
          compW = 1 / Math.max(1, scopedDf);
        }
      }
      if (capability === "NONE") continue;

      const fieldScores: Partial<Record<V25EvidenceField, number>> = {};
      for (const [field, hit] of Object.entries(st.hits) as Array<
        [V25EvidenceField, FieldHit]
      >) {
        if (!hit.positive) continue;
        fieldScores[field] =
          semanticWeight[meta.semantic] *
          compW *
          roleWeight[meta.role] *
          fieldWeight[field];
      }
      evidence.push({
        jobId,
        term: meta.key,
        display: meta.key,
        kind,
        role: meta.role,
        tokens: meta.tokens,
        capability,
        scopedDf,
        fieldScores,
        score: combineFields(fieldScores),
      });
    }
  }

  // Family-adjacent numeric evidence (Beltline #3 → building:3).
  const fnByJobKey = new Map<string, Evidence>();
  for (const h of familyNumericHits) {
    const key = `${h.jobId}|${h.compoundKey}|${h.familyKey}`;
    let ev = fnByJobKey.get(key);
    if (!ev) {
      ev = {
        jobId: h.jobId,
        term: h.compoundKey,
        display: `${h.display} → ${h.compoundKey}`,
        kind: "family_numeric",
        role: "NUMBERED_STRUCTURE_IDENTIFIER",
        tokens: [h.descriptor, h.value],
        capability: "FAMILY_SCOPED",
        scopedDf: 1,
        fieldScores: {},
        score: 0,
      };
      fnByJobKey.set(key, ev);
      evidence.push(ev);
    }
    ev.fieldScores[h.field] =
      semanticWeight.HIGH *
      1 *
      V25_SCORING.familyNumericRoleWeight *
      fieldWeight[h.field];
    ev.score = combineFields(ev.fieldScores);
  }

  // Phrase coverage: keep maximal phrases; drop covered non-family singles.
  const dropped = new Set<Evidence>();
  const byJob = new Map<string, Evidence[]>();
  for (const ev of evidence) {
    const list = byJob.get(ev.jobId) ?? [];
    list.push(ev);
    byJob.set(ev.jobId, list);
  }
  for (const list of byJob.values()) {
    const phrases = list.filter((e) => e.kind === "phrase");
    const maximal = phrases.filter(
      (p) =>
        !phrases.some(
          (q) =>
            q !== p &&
            q.tokens.length > p.tokens.length &&
            containsSubgram(q.tokens, p.tokens)
        )
    );
    for (const p of phrases) if (!maximal.includes(p)) dropped.add(p);
    for (const e of list) {
      if (e.kind !== "token" || e.capability === "FAMILY_TERM") continue;
      if (maximal.some((p) => containsSubgram(p.tokens, e.tokens))) {
        dropped.add(e);
      }
    }
  }
  const liveEvidence = evidence.filter((e) => !dropped.has(e));

  // ── 8. Numeric contradictions ─────────────────────────────────────────
  type HayCompound = { key: string; descriptor: string; value: string };
  const positiveHayCompounds: HayCompound[] = [];
  for (const s of streams) {
    for (const c of s.compounds) {
      const neg = isTokenNegatedInContextualHay(s.raw, c.startIndex);
      const inc =
        s.field !== "subject" &&
        isTokenIncidentalInContextualHay(s.raw, c.startIndex);
      if (neg || inc) continue;
      positiveHayCompounds.push({
        key: c.key,
        descriptor: c.descriptor,
        value: c.value,
      });
    }
  }
  for (const h of familyNumericHits) {
    positiveHayCompounds.push({
      key: h.compoundKey,
      descriptor: h.descriptor,
      value: h.value,
    });
  }

  const jobCompounds = (jobId: string): Array<{ key: string; descriptor: string; value: string }> => {
    const profile = profiles.get(jobId);
    if (!profile) return [];
    const out: Array<{ key: string; descriptor: string; value: string }> = [];
    for (const t of profile.terms) {
      if (t.role !== "NUMBERED_STRUCTURE_IDENTIFIER") continue;
      const p = parseCompoundNumericKey(t.term);
      if (p) out.push({ key: t.term, descriptor: p.descriptor, value: p.value });
    }
    return out;
  };

  const contradictions = new Map<string, string[]>();
  const consideredJobs = uniq([
    ...liveEvidence.map((e) => e.jobId),
    ...familyJobIds,
  ]);
  for (const jobId of consideredJobs) {
    const own = jobCompounds(jobId);
    if (own.length === 0) continue;
    for (const hc of positiveHayCompounds) {
      const ownSame = own.filter((o) => o.descriptor === hc.descriptor);
      if (ownSame.length === 0) continue;
      if (ownSame.some((o) => o.value === hc.value)) continue;
      const list = contradictions.get(jobId) ?? [];
      list.push(
        `hay ${hc.key} contradicts Job ${ownSame.map((o) => o.key).join("/")}`
      );
      contradictions.set(jobId, list);
    }
  }

  // ── 9. Candidate scoring ──────────────────────────────────────────────
  type Cand = {
    jobId: string;
    familyScore: number;
    distScore: number;
    capableEvidence: Evidence[];
    allEvidence: Evidence[];
    rejected: boolean;
  };
  const cands = new Map<string, Cand>();
  const ensureCand = (jobId: string): Cand => {
    let c = cands.get(jobId);
    if (!c) {
      c = {
        jobId,
        familyScore: 0,
        distScore: 0,
        capableEvidence: [],
        allEvidence: [],
        rejected: false,
      };
      cands.set(jobId, c);
    }
    return c;
  };
  for (const ev of liveEvidence) {
    const c = ensureCand(ev.jobId);
    c.allEvidence.push(ev);
    if (ev.capability === "FAMILY_TERM") c.familyScore += ev.score;
    else {
      c.distScore += ev.score;
      c.capableEvidence.push(ev);
    }
  }
  for (const jobId of contradictions.keys()) {
    if (cands.has(jobId) || familyJobIds.includes(jobId)) {
      ensureCand(jobId).rejected = true;
    }
  }
  for (const jobId of familyJobIds) ensureCand(jobId);

  const total = (c: Cand): number => c.familyScore + c.distScore;
  const live = [...cands.values()].filter((c) => !c.rejected);
  const capable = live
    .filter((c) => c.capableEvidence.length > 0)
    .sort((a, b) => total(b) - total(a) || a.jobId.localeCompare(b.jobId));

  // ── 10. Decision ───────────────────────────────────────────────────────
  let status: V25Resolution["status"] = null;
  let reason: V25ReasonCode = "V25_PROFILE_FALLBACK";
  let resolutionReason =
    "No identity-bearing profile term matched; deferring to V2 baseline.";
  let selectedJobId: string | null = null;
  let competingJobIds: string[] = [];
  let evidenceField: V25Resolution["evidenceField"] = null;
  let winnerScore: number | null = null;
  let runnerUpScore: number | null = null;
  let margin: number | null = null;
  const usedTerms = new Set<string>();

  const anyNegatedIdentityTerm = [...states.values()].some(
    (st) =>
      st.meta.role !== "GENERIC_CONSTRUCTION_TERM" &&
      Object.values(st.hits).some((h) => h?.negated)
  );
  const correctionCue = hasExplicitContextualCorrection(
    streams.flatMap((s) => s.raw)
  );

  const hasFamilyHit = familyJobIds.length > 0;
  const rejectedWithFamily = [...cands.values()].filter((c) => c.rejected);

  if (capable.length === 0) {
    if (rejectedWithFamily.length > 0) {
      status = "CONFLICT";
      reason = "V25_NUMERIC_CONFLICT";
      resolutionReason =
        "Descriptor numbers in the email contradict every plausible Job.";
      competingJobIds = rejectedWithFamily.map((c) => c.jobId);
    } else if (hasFamilyHit) {
      status = "AMBIGUOUS";
      reason = "V25_SHARED_FAMILY_AMBIGUOUS";
      resolutionReason =
        "Shared family term present without a distinguishing phrase, structure or number.";
      competingJobIds = familyJobIds;
    }
  } else {
    const winner = capable[0]!;
    const runnerUp =
      live
        .filter((c) => c.jobId !== winner.jobId)
        .sort((a, b) => total(b) - total(a))[0] ?? null;
    winnerScore = round3(total(winner));
    runnerUpScore = runnerUp ? round3(total(runnerUp)) : null;
    margin = round3(total(winner) - (runnerUp ? total(runnerUp) : 0));
    const strongEnough =
      total(winner) >= V25_SCORING.minTotalScore &&
      total(winner) - (runnerUp ? total(runnerUp) : 0) >=
        V25_SCORING.minMargin;

    if (correctionCue && anyNegatedIdentityTerm) {
      status = "AMBIGUOUS";
      reason = "V25_SHARED_FAMILY_AMBIGUOUS";
      resolutionReason =
        "Explicit correction/negation language; conservative abstention.";
      competingJobIds = uniq([...capable.map((c) => c.jobId), ...familyJobIds]);
    } else if (!strongEnough) {
      status = "AMBIGUOUS";
      reason = "V25_SHARED_FAMILY_AMBIGUOUS";
      resolutionReason =
        "Multiple Jobs have comparable evidence; lead below required margin.";
      competingJobIds = uniq(
        live
          .filter((c) => total(winner) - total(c) < V25_SCORING.minMargin)
          .map((c) => c.jobId)
      );
    } else {
      status = "MATCH";
      selectedJobId = winner.jobId;
      competingJobIds = familyJobIds.filter((id) => id !== winner.jobId);
      const fields = uniq(
        winner.capableEvidence.flatMap(
          (e) => Object.keys(e.fieldScores) as V25EvidenceField[]
        )
      );
      evidenceField = fields.length === 1 ? fields[0]! : "mixed";
      for (const e of winner.capableEvidence) usedTerms.add(e.term);
      const familyContext = familiesOfJob(winner.jobId).length > 0;
      const hasAdjacency = winner.capableEvidence.some(
        (e) => e.kind === "family_numeric"
      );
      const hasPhrase = winner.capableEvidence.some((e) => e.kind === "phrase");
      if (hasAdjacency) {
        reason = "V25_FAMILY_NUMERIC";
        resolutionReason =
          "Family term + component number resolved to a single family Job.";
      } else if (familyContext) {
        reason = "V25_FAMILY_DISAMBIGUATION";
        resolutionReason =
          "Shared family term disambiguated by phrase/structure/number/distinctive term.";
      } else if (hasPhrase) {
        reason = "V25_COMPOUND_PHRASE";
        resolutionReason = "Multiword title phrase identified one Job.";
      } else {
        reason = "V25_DISTINCTIVE_TERM";
        resolutionReason =
          "Distinctive title term (workspace DF=1) identified one Job.";
      }
    }
  }

  // ── 11. Diagnostics ───────────────────────────────────────────────────
  const matchedTermsFor = (c: Cand): string[] =>
    uniq(c.allEvidence.map((e) => e.display));

  const candidates: V25CandidateAnalysis[] = [...cands.values()]
    .map((c): V25CandidateAnalysis => {
      const isSel = c.jobId === selectedJobId;
      const contra = contradictions.get(c.jobId) ?? [];
      const sc = c.rejected ? 0 : total(c);
      let why: string;
      if (c.rejected) why = `Rejected: ${contra.join("; ")}`;
      else if (isSel) why = resolutionReason;
      else if (c.capableEvidence.length === 0)
        why = "Family term only; no distinguishing evidence.";
      else if (selectedJobId) why = "Outscored by selected Job.";
      else why = "Comparable evidence; no unique winner.";
      return {
        jobId: c.jobId,
        jobLabel: labelFor(c.jobId),
        score: round3(sc),
        familyScore: round3(c.familyScore),
        distinguishingScore: round3(c.distScore),
        status: c.rejected ? "REJECTED" : isSel ? "SELECTED" : "CANDIDATE",
        reason: why,
        matchedTerms: matchedTermsFor(c),
        contradictions: contra,
      };
    })
    .sort(
      (a, b) =>
        (a.status === "SELECTED" ? -1 : 0) - (b.status === "SELECTED" ? -1 : 0) ||
        b.score - a.score ||
        a.jobId.localeCompare(b.jobId)
    )
    .slice(0, 25);

  const scoreByTermJob = new Map<string, number>();
  for (const ev of liveEvidence) {
    for (const [field, score] of Object.entries(ev.fieldScores)) {
      const k = `${ev.term}|${field}`;
      scoreByTermJob.set(k, Math.max(scoreByTermJob.get(k) ?? 0, score ?? 0));
    }
  }

  const termAnalyses: V25TermAnalysis[] = [];
  for (const st of states.values()) {
    const { meta } = st;
    for (const [field, hit] of Object.entries(st.hits) as Array<
      [V25EvidenceField, FieldHit]
    >) {
      const familyOwner = meta.owners.map((o) => familiesOfJob(o)[0]).find(Boolean);
      const generic = meta.role === "GENERIC_CONSTRUCTION_TERM";
      const sc = scoreByTermJob.get(`${meta.key}|${field}`) ?? 0;
      const capability: V25TermCapability = generic
        ? "NONE"
        : meta.role === "PROJECT_FAMILY_NAME"
          ? "FAMILY_TERM"
          : meta.role === "DISTINCTIVE_PROJECT_NAME" ||
              (meta.kind === "phrase" &&
                meta.semantic === "HIGH" &&
                meta.owners.length === 1)
            ? "STANDALONE"
            : familyOwner
              ? "FAMILY_SCOPED"
              : "NONE";
      const scopedDf =
        capability === "FAMILY_SCOPED" && familyOwner
          ? meta.owners.filter((o) => familyOwner.owners.includes(o)).length
          : null;
      let note: string;
      if (hit.negated && !hit.positive) note = "Negated in context.";
      else if (hit.incidental && !hit.positive) note = "Incidental mention.";
      else if (generic) note = "Generic construction term; cannot resolve alone.";
      else if (capability === "NONE")
        note = "Needs a shared family term in the email; ignored alone.";
      else if (capability === "FAMILY_TERM")
        note = `Shared by ${meta.owners.length} Jobs; context only.`;
      else if (sc === 0) note = "Matched but dropped (covered by longer phrase).";
      else note = "Contributed evidence score.";
      termAnalyses.push({
        term: meta.key,
        role: meta.role,
        semanticImportance: meta.semantic,
        competitiveImportance: competitiveOf(meta),
        documentFrequency: meta.owners.length,
        scopedDocumentFrequency: scopedDf,
        source: field,
        matched: hit.positive,
        negated: hit.negated,
        incidental: hit.incidental,
        jobIds: meta.owners.slice(0, 12),
        score: round3(sc),
        capability,
        usedForResolution: usedTerms.has(meta.key) && sc > 0,
        note,
      });
    }
  }
  for (const a of extraAnalyses) termAnalyses.push(a);
  for (const h of familyNumericHits) {
    termAnalyses.push({
      term: `${h.display} → ${h.compoundKey}`,
      role: "NUMBERED_STRUCTURE_IDENTIFIER",
      semanticImportance: "HIGH",
      competitiveImportance: "HIGH",
      documentFrequency: 1,
      scopedDocumentFrequency: 1,
      source: h.field,
      matched: true,
      negated: false,
      incidental: false,
      jobIds: [h.jobId],
      score: round3(
        semanticWeight.HIGH * V25_SCORING.familyNumericRoleWeight * fieldWeight[h.field]
      ),
      capability: "FAMILY_SCOPED",
      usedForResolution: usedTerms.has(h.compoundKey),
      note: "Family term followed by a component number mapped to one family Job.",
    });
  }
  termAnalyses.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.matched) - Number(a.matched) ||
      a.term.localeCompare(b.term)
  );

  const matchedTerms = selectedJobId
    ? matchedTermsFor(cands.get(selectedJobId)!)
    : uniq(
        liveEvidence
          .filter((e) => e.capability !== "NONE")
          .map((e) => e.display)
      );

  return {
    profileVersion: JOB_IDENTITY_PROFILE_VERSION,
    scoringRevision: V25_SCORING.revision,
    status,
    reason,
    resolutionReason,
    selectedJobId,
    familyJobIds,
    candidates,
    termAnalyses: termAnalyses.slice(0, 60),
    profileSource,
    fallbackProfileJobIds,
    winnerScore,
    runnerUpScore,
    margin,
    matchedTerms,
    competingJobIds,
    evidenceField,
  };
}

/** Strip resolver-only fields for persistence on identity diagnostics. */
export function toV25IdentityDiagnostics(
  r: V25Resolution
): V25IdentityDiagnostics {
  const {
    matchedTerms: _m,
    competingJobIds: _c,
    evidenceField: _e,
    ...rest
  } = r;
  return rest;
}
