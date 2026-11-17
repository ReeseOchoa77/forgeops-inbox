/**
 * CONTEXT_AWARE_V2_5 — Job identity profiles.
 *
 * A profile describes which words/phrases in a Job title carry project identity
 * (distinctive name, shared family name, compound phrase, structure descriptor,
 * numbered structure id, generic vocabulary). Profiles are derived
 * deterministically from the Job title (+ aliases) and workspace document
 * frequency. An optional LLM enrichment (packages/ai) may produce the same
 * shape, but matching never depends on it — see `validateJobIdentityProfileAgainstTitle`.
 *
 * Never uses Job.jobNumber.
 */

import {
  canonicalizeJobNameTokens,
  isJobNameStopToken,
  isNumericJobNameToken,
} from "./job-name-normalize.js";
import {
  canonicalizeContextualToken,
  isContextualWeakDistinguishingToken,
} from "./job-contextual-word-search.js";
import {
  extractCompoundNumericIdentities,
  isCompoundNumericKey,
  resolveCompoundDescriptor,
} from "./job-contextual-compound-numeric.js";
import { isCommonConstructionIdentityToken } from "./job-name-identity-policy.js";

/** Profile schema + deterministic algorithm revision (cache key component). */
export const JOB_IDENTITY_PROFILE_VERSION = "v25-identity-profile-r1" as const;
/** Alias matching the spec name `PROFILE_VERSION`. */
export const PROFILE_VERSION = JOB_IDENTITY_PROFILE_VERSION;

export const JOB_IDENTITY_SEMANTIC_ROLES = [
  "DISTINCTIVE_PROJECT_NAME",
  "PROJECT_FAMILY_NAME",
  "COMPOUND_PROJECT_PHRASE",
  "STRUCTURE_DESCRIPTOR",
  "GENERIC_CONSTRUCTION_TERM",
  "NUMBERED_STRUCTURE_IDENTIFIER",
  "SUPPORTING_PROJECT_TERM",
] as const;
export type JobIdentitySemanticRole =
  (typeof JOB_IDENTITY_SEMANTIC_ROLES)[number];

export const JOB_IDENTITY_IMPORTANCE_LEVELS = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "NONE",
] as const;
export type JobIdentityImportance =
  (typeof JOB_IDENTITY_IMPORTANCE_LEVELS)[number];

export const JOB_IDENTITY_ANALYSIS_STATUSES = [
  "READY",
  "FALLBACK",
  "PENDING",
  "FAILED",
] as const;
export type JobIdentityAnalysisStatus =
  (typeof JOB_IDENTITY_ANALYSIS_STATUSES)[number];

export type JobIdentityProfileSource = "DETERMINISTIC" | "LLM";

export type JobIdentityProfileTerm = {
  /** Canonical text: `nova`, `parking ramp`, or `building:3`. */
  term: string;
  tokens: string[];
  role: JobIdentitySemanticRole;
  /** How identity-bearing the words are semantically (title-only view). */
  semanticImportance: JobIdentityImportance;
  /** How well the term separates this Job from peers (workspace DF view). */
  competitiveImportance: JobIdentityImportance;
  /** Eligible Jobs whose title contains this term when the profile was built. */
  documentFrequency: number;
  rationale: string;
};

export type JobIdentityProfile = {
  profileVersion: string;
  jobId: string;
  /** Display label (title tokens); not used for matching. */
  jobName: string;
  sourceFingerprint: string;
  analysisStatus: JobIdentityAnalysisStatus;
  source: JobIdentityProfileSource;
  modelIdentifier?: string | null;
  promptVersion?: string | null;
  terms: JobIdentityProfileTerm[];
};

/** Descriptor words naming a physical part of a site (never identity alone). */
export const JOB_IDENTITY_STRUCTURE_DESCRIPTOR_TOKENS = new Set([
  "building",
  "parking",
  "ramp",
  "stairs",
  "garage",
  "wing",
  "phase",
  "area",
  "unit",
  "floor",
  "level",
  "lot",
  "roof",
  "lobby",
  "entrance",
]);

/** Qualifiers that narrow a family but never identify a Job by themselves. */
export const JOB_IDENTITY_SUPPORTING_TOKENS = new Set([
  "north",
  "south",
  "east",
  "west",
  "exterior",
  "interior",
  "upper",
  "lower",
  "main",
  "annex",
  "addition",
]);

const MAX_PHRASE_TOKENS = 5;

/** Contextual canonical form; numerics untouched. */
export function canonicalIdentityToken(token: string): string {
  return isNumericJobNameToken(token)
    ? token
    : canonicalizeContextualToken(token.toLowerCase());
}

type BaseRole = JobIdentitySemanticRole | "OPEN";

/**
 * Role decided from the token alone. "OPEN" tokens become DISTINCTIVE or
 * FAMILY depending on workspace document frequency.
 */
export function classifyIdentityTokenBase(canonical: string): BaseRole {
  if (JOB_IDENTITY_STRUCTURE_DESCRIPTOR_TOKENS.has(canonical)) {
    return "STRUCTURE_DESCRIPTOR";
  }
  if (JOB_IDENTITY_SUPPORTING_TOKENS.has(canonical)) {
    return "SUPPORTING_PROJECT_TERM";
  }
  if (
    isCommonConstructionIdentityToken(canonical) ||
    isContextualWeakDistinguishingToken(canonical) ||
    isJobNameStopToken(canonical)
  ) {
    return "GENERIC_CONSTRUCTION_TERM";
  }
  if (canonical.length < 3) return "SUPPORTING_PROJECT_TERM";
  return "OPEN";
}

/** FNV/cyrb53-style hash (isomorphic; no node:crypto). */
function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

export type JobIdentityProfileJobInput = {
  jobId: string;
  jobName?: string | null;
  aliases?: readonly string[];
  /** Pre-tokenized name/alias phrases (peers); takes precedence over jobName. */
  phraseTokenLists?: ReadonlyArray<ReadonlyArray<string>>;
};

function titleTokenLists(job: JobIdentityProfileJobInput): string[][] {
  if (job.phraseTokenLists && job.phraseTokenLists.length > 0) {
    return job.phraseTokenLists
      .map((l) => [...l])
      .filter((l) => l.length > 0);
  }
  const lists: string[][] = [];
  for (const raw of [job.jobName ?? "", ...(job.aliases ?? [])]) {
    const toks = canonicalizeJobNameTokens(raw);
    if (toks.length > 0) lists.push(toks);
  }
  return lists;
}

/**
 * Fingerprint of the *title inputs* only (name + aliases + profile version).
 * Competitive importance is recomputed from workspace DF at match time, so
 * workspace changes do not invalidate cached semantic profiles.
 */
export function jobIdentityProfileSourceFingerprint(
  job: JobIdentityProfileJobInput,
  profileVersion: string = JOB_IDENTITY_PROFILE_VERSION
): string {
  const canonical = titleTokenLists(job)
    .map((l) => l.map(canonicalIdentityToken).join(" "))
    .join("|");
  return `${profileVersion}:${hashString(canonical)}`;
}

type TermCandidate = {
  key: string;
  kind: "token" | "phrase" | "numbered";
  tokens: string[];
};

/** All candidate term keys a Job title contributes (role-independent). */
function extractTermCandidates(lists: string[][]): Map<string, TermCandidate> {
  const out = new Map<string, TermCandidate>();
  for (const list of lists) {
    const canon = list.map(canonicalIdentityToken);

    for (const c of extractCompoundNumericIdentities(list)) {
      if (!out.has(c.key)) {
        out.set(c.key, {
          key: c.key,
          kind: "numbered",
          tokens: [c.descriptor, c.value],
        });
      }
    }

    for (const t of canon) {
      if (isNumericJobNameToken(t) || t.length < 2) continue;
      if (!out.has(t)) out.set(t, { key: t, kind: "token", tokens: [t] });
    }

    const maxLen = Math.min(MAX_PHRASE_TOKENS, canon.length);
    for (let len = 2; len <= maxLen; len += 1) {
      for (let i = 0; i + len <= canon.length; i += 1) {
        const gram = canon.slice(i, i + len);
        if (gram.some((t) => isNumericJobNameToken(t))) continue;
        const bases = gram.map(classifyIdentityTokenBase);
        // Edge tokens must not be plain generic/stop filler.
        if (
          bases[0] === "GENERIC_CONSTRUCTION_TERM" ||
          bases[bases.length - 1] === "GENERIC_CONSTRUCTION_TERM"
        ) {
          continue;
        }
        if (bases.every((b) => b === "GENERIC_CONSTRUCTION_TERM")) continue;
        const key = gram.join(" ");
        if (!out.has(key)) out.set(key, { key, kind: "phrase", tokens: gram });
      }
    }
  }
  return out;
}

export type JobIdentityWorkspaceStats = {
  jobCount: number;
  /** term key (token | phrase | descriptor:n) → eligible Jobs containing it. */
  documentFrequency: ReadonlyMap<string, number>;
};

export function buildJobIdentityWorkspaceStats(
  jobs: ReadonlyArray<JobIdentityProfileJobInput>
): JobIdentityWorkspaceStats {
  const df = new Map<string, number>();
  for (const job of jobs) {
    const keys = extractTermCandidates(titleTokenLists(job));
    for (const key of keys.keys()) df.set(key, (df.get(key) ?? 0) + 1);
  }
  return { jobCount: jobs.length, documentFrequency: df };
}

function competitiveFor(
  role: JobIdentitySemanticRole,
  df: number
): JobIdentityImportance {
  if (role === "GENERIC_CONSTRUCTION_TERM") return "NONE";
  return df <= 1 ? "HIGH" : "LOW";
}

/** Role for a single OPEN token given its DF. */
export function openTokenRoleForDocumentFrequency(
  df: number
): "DISTINCTIVE_PROJECT_NAME" | "PROJECT_FAMILY_NAME" {
  return df <= 1 ? "DISTINCTIVE_PROJECT_NAME" : "PROJECT_FAMILY_NAME";
}

/**
 * Deterministic profile from a Job title (+ aliases) and workspace DF.
 *
 * Heuristics:
 * - OPEN token, DF==1 → DISTINCTIVE_PROJECT_NAME (semantic HIGH, competitive HIGH)
 * - OPEN token, DF>=2 → PROJECT_FAMILY_NAME (semantic HIGH, competitive LOW alone)
 * - contiguous multiword phrase → COMPOUND_PROJECT_PHRASE
 * - building/parking/ramp/stairs… → STRUCTURE_DESCRIPTOR (MEDIUM)
 * - descriptor+number → NUMBERED_STRUCTURE_IDENTIFIER (building:3)
 * - construction vocabulary → GENERIC_CONSTRUCTION_TERM (NONE)
 */
export function buildDeterministicJobIdentityProfile(
  job: JobIdentityProfileJobInput,
  workspace: JobIdentityWorkspaceStats
): JobIdentityProfile {
  const lists = titleTokenLists(job);
  const candidates = extractTermCandidates(lists);
  const terms: JobIdentityProfileTerm[] = [];

  for (const cand of candidates.values()) {
    const df = Math.max(1, workspace.documentFrequency.get(cand.key) ?? 1);

    if (cand.kind === "numbered") {
      terms.push({
        term: cand.key,
        tokens: cand.tokens,
        role: "NUMBERED_STRUCTURE_IDENTIFIER",
        semanticImportance: "HIGH",
        competitiveImportance: competitiveFor(
          "NUMBERED_STRUCTURE_IDENTIFIER",
          df
        ),
        documentFrequency: df,
        rationale: `Descriptor+number compound (${cand.key}); valid only with a family term.`,
      });
      continue;
    }

    if (cand.kind === "phrase") {
      const bases = cand.tokens.map(classifyIdentityTokenBase);
      const hasOpen = bases.includes("OPEN");
      terms.push({
        term: cand.key,
        tokens: cand.tokens,
        role: "COMPOUND_PROJECT_PHRASE",
        semanticImportance: hasOpen ? "HIGH" : "MEDIUM",
        competitiveImportance: competitiveFor("COMPOUND_PROJECT_PHRASE", df),
        documentFrequency: df,
        rationale: hasOpen
          ? "Contiguous multiword title phrase containing project-name words."
          : "Contiguous descriptor/qualifier phrase; scoped to a family.",
      });
      continue;
    }

    const base = classifyIdentityTokenBase(cand.tokens[0]!);
    const role: JobIdentitySemanticRole =
      base === "OPEN" ? openTokenRoleForDocumentFrequency(df) : base;
    const semantic: JobIdentityImportance =
      role === "GENERIC_CONSTRUCTION_TERM"
        ? "NONE"
        : role === "STRUCTURE_DESCRIPTOR"
          ? "MEDIUM"
          : role === "SUPPORTING_PROJECT_TERM"
            ? "LOW"
            : "HIGH";
    terms.push({
      term: cand.key,
      tokens: cand.tokens,
      role,
      semanticImportance: semantic,
      competitiveImportance: competitiveFor(role, df),
      documentFrequency: df,
      rationale:
        role === "DISTINCTIVE_PROJECT_NAME"
          ? "Appears in exactly one eligible Job title."
          : role === "PROJECT_FAMILY_NAME"
            ? `Shared by ${df} eligible Job titles; needs a distinguishing term.`
            : role === "STRUCTURE_DESCRIPTOR"
              ? "Structure descriptor; never identity alone."
              : role === "SUPPORTING_PROJECT_TERM"
                ? "Qualifier; narrows a family only."
                : "Generic construction vocabulary; cannot identify a Job.",
    });
  }

  terms.sort((a, b) => a.term.localeCompare(b.term));

  const jobName =
    (job.jobName ?? "").trim() || (lists[0] ? lists[0].join(" ") : "");

  return {
    profileVersion: JOB_IDENTITY_PROFILE_VERSION,
    jobId: job.jobId,
    jobName,
    sourceFingerprint: jobIdentityProfileSourceFingerprint(job),
    analysisStatus: terms.length > 0 ? "READY" : "FAILED",
    source: "DETERMINISTIC",
    modelIdentifier: null,
    promptVersion: null,
    terms,
  };
}

/** Batch deterministic profiles for the eligible Job pool. */
export function buildWorkspaceIdentityProfiles(input: {
  jobs: ReadonlyArray<JobIdentityProfileJobInput>;
}): Map<string, JobIdentityProfile> {
  const stats = buildJobIdentityWorkspaceStats(input.jobs);
  const out = new Map<string, JobIdentityProfile>();
  for (const job of input.jobs) {
    out.set(job.jobId, buildDeterministicJobIdentityProfile(job, stats));
  }
  return out;
}

export type JobIdentityProfileValidation = {
  ok: boolean;
  errors: string[];
};

function phraseInList(list: readonly string[], gram: readonly string[]): boolean {
  if (gram.length === 0 || list.length < gram.length) return false;
  for (let i = 0; i + gram.length <= list.length; i += 1) {
    if (gram.every((t, j) => list[i + j] === t)) return true;
  }
  return false;
}

/**
 * Validate a (possibly LLM-authored or cached) profile against the Job title.
 * Rejects invented terms, bare numbers, unknown roles, and generic terms
 * presented as identity-bearing.
 */
export function validateJobIdentityProfileAgainstTitle(
  profile: JobIdentityProfile,
  job: JobIdentityProfileJobInput
): JobIdentityProfileValidation {
  const errors: string[] = [];
  const lists = titleTokenLists(job).map((l) => l.map(canonicalIdentityToken));
  const titleTokens = new Set(lists.flat());
  const titleCompounds = new Set(
    titleTokenLists(job).flatMap((l) =>
      extractCompoundNumericIdentities(l).map((c) => c.key)
    )
  );

  if (profile.profileVersion !== JOB_IDENTITY_PROFILE_VERSION) {
    errors.push(`profile version ${profile.profileVersion} is not current`);
  }
  if (profile.jobId !== job.jobId) errors.push("profile jobId mismatch");
  if (!Array.isArray(profile.terms) || profile.terms.length === 0) {
    errors.push("profile has no terms");
    return { ok: false, errors };
  }

  for (const t of profile.terms) {
    if (!JOB_IDENTITY_SEMANTIC_ROLES.includes(t.role)) {
      errors.push(`unknown role for "${t.term}"`);
      continue;
    }
    if (
      !JOB_IDENTITY_IMPORTANCE_LEVELS.includes(t.semanticImportance) ||
      !JOB_IDENTITY_IMPORTANCE_LEVELS.includes(t.competitiveImportance)
    ) {
      errors.push(`unknown importance for "${t.term}"`);
    }
    if (isNumericJobNameToken(t.term)) {
      errors.push(`bare number "${t.term}" is not an identity term`);
      continue;
    }
    if (t.role === "NUMBERED_STRUCTURE_IDENTIFIER") {
      if (!isCompoundNumericKey(t.term) || !titleCompounds.has(t.term)) {
        errors.push(`numbered identifier "${t.term}" not in title`);
      }
      continue;
    }
    if (t.role === "COMPOUND_PROJECT_PHRASE") {
      const gram = t.term.split(" ").map(canonicalIdentityToken);
      if (gram.length < 2 || !lists.some((l) => phraseInList(l, gram))) {
        errors.push(`phrase "${t.term}" is not contiguous in the title`);
      }
      continue;
    }
    const tok = canonicalIdentityToken(t.term);
    if (!titleTokens.has(tok)) {
      errors.push(`term "${t.term}" not in title`);
      continue;
    }
    if (t.role === "GENERIC_CONSTRUCTION_TERM") {
      if (
        t.semanticImportance === "HIGH" ||
        t.competitiveImportance === "HIGH"
      ) {
        errors.push(`generic term "${t.term}" marked identity-bearing`);
      }
      continue;
    }
    // Words known to be generic / descriptors cannot be claimed as names.
    const base = classifyIdentityTokenBase(tok);
    if (
      (t.role === "DISTINCTIVE_PROJECT_NAME" ||
        t.role === "PROJECT_FAMILY_NAME") &&
      base !== "OPEN"
    ) {
      errors.push(`"${t.term}" is ${base} vocabulary, not a project name`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Descriptor compound helper re-exported for tests / callers. */
export function isStructureDescriptorToken(token: string): boolean {
  return (
    resolveCompoundDescriptor(token) != null ||
    JOB_IDENTITY_STRUCTURE_DESCRIPTOR_TOKENS.has(canonicalIdentityToken(token))
  );
}
