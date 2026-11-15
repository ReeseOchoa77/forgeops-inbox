/**
 * Workspace-aware project identity analysis.
 *
 * Builds a deterministic index over Job names + approved aliases so the matcher
 * can tell unique project phrases/tokens from shared or generic ones. Rebuilt
 * whenever the eligible Job set / aliases change (callers pass the current
 * snapshot — no global mutable cache).
 */

import {
  canonicalizeJobNameTokens,
  isDistinguishingJobNameToken,
  isJobNameContentToken,
  isJobNameStopToken,
} from "./job-name-normalize.js";
import {
  COMMON_CONSTRUCTION_IDENTITY_TOKENS,
  isCommonConstructionIdentityToken,
  type WorkspaceIdentityTokenStats,
} from "./job-name-identity-policy.js";
import type { JobAliasForMatch, JobRecordForMatch } from "./job-matcher.js";
import {
  PROJECT_SCOPE_INFLECTIONS,
  hayHasProjectToken,
  matchedJobTokensInHay,
  normalizeProjectScopeToken,
  projectTokensEquivalent,
} from "./job-project-token-utils.js";

export {
  PROJECT_SCOPE_INFLECTIONS,
  hayHasProjectToken,
  matchedJobTokensInHay,
  normalizeProjectScopeToken,
  projectTokensEquivalent,
};

export type ProjectTokenClass =
  | "PROJECT_SPECIFIC"
  | "SCOPE_SPECIFIC"
  | "GENERIC_INDUSTRY"
  | "AMBIGUOUS_ACRONYM"
  | "DISTINGUISHING"
  | "STOP";

export type JobProjectIdentityProfile = {
  jobId: string;
  customerId: string | null;
  fullProjectName: string;
  /** Content tokens across name + aliases (deduped). */
  contentTokens: string[];
  /** Distinguishing numeric / compass tokens. */
  distinguishingTokens: string[];
  /** Multiword content phrases (≥2 content tokens) derived from name/aliases. */
  projectPhrases: string[][];
  /** Tokens classified as project-specific for this Job (rare + non-generic). */
  distinctiveProjectTokens: string[];
  /** Scope / fabrication tokens present on this Job. */
  scopeTokens: string[];
  /** Approved abbreviation-like short tokens (≤4 chars, non-numeric). */
  abbreviationTokens: string[];
};

export type WorkspaceProjectIdentityIndex = {
  jobCount: number;
  profiles: JobProjectIdentityProfile[];
  /** Content-token → Jobs containing it. */
  tokenToJobIds: Map<string, string[]>;
  /** Contiguous phrase key → Jobs containing that phrase. */
  phraseToJobIds: Map<string, string[]>;
  workspaceStats: WorkspaceIdentityTokenStats;
};

export function classifyProjectToken(
  token: string,
  documentFrequency: number,
  jobCount: number
): ProjectTokenClass {
  if (isDistinguishingJobNameToken(token)) return "DISTINGUISHING";
  if (isJobNameStopToken(token)) return "STOP";
  if (isCommonConstructionIdentityToken(token)) return "SCOPE_SPECIFIC";
  if (COMMON_CONSTRUCTION_IDENTITY_TOKENS.has(token)) return "SCOPE_SPECIFIC";

  const isShort = token.length <= 3 && !/^\d+$/.test(token);
  if (isShort && documentFrequency > 1) return "AMBIGUOUS_ACRONYM";
  if (isShort && jobCount > 1 && documentFrequency === 1) {
    // Rare short token can still be project-specific (e.g. unique "CPAC").
    return "PROJECT_SPECIFIC";
  }
  if (documentFrequency === 1) return "PROJECT_SPECIFIC";
  if (documentFrequency > 1) return "AMBIGUOUS_ACRONYM";
  return "GENERIC_INDUSTRY";
}

function phraseKey(tokens: readonly string[]): string {
  return tokens.join(" ");
}

function extractContentPhrases(allTokens: string[]): string[][] {
  const content = allTokens.filter(isJobNameContentToken);
  if (content.length < 2) return [];
  const phrases: string[][] = [];
  for (let len = content.length; len >= 2; len -= 1) {
    for (let i = 0; i + len <= content.length; i += 1) {
      phrases.push(content.slice(i, i + len));
    }
  }
  return phrases;
}

/**
 * Build a fresh workspace project-identity index from the current eligible Jobs.
 */
export function buildWorkspaceProjectIdentityIndex(input: {
  jobs: ReadonlyArray<JobRecordForMatch>;
  aliases?: ReadonlyArray<JobAliasForMatch>;
}): WorkspaceProjectIdentityIndex {
  const aliasesByJob = new Map<string, JobAliasForMatch[]>();
  for (const a of input.aliases ?? []) {
    const list = aliasesByJob.get(a.jobId) ?? [];
    list.push(a);
    aliasesByJob.set(a.jobId, list);
  }

  const tokenToJobIds = new Map<string, string[]>();
  const phraseToJobIds = new Map<string, string[]>();
  const contentSets: Array<Set<string>> = [];
  const profiles: JobProjectIdentityProfile[] = [];

  for (const job of input.jobs) {
    const rawPhrases: string[] = [job.name];
    if (job.siteName) rawPhrases.push(job.siteName);
    if (job.externalRef) rawPhrases.push(job.externalRef);
    for (const a of aliasesByJob.get(job.id) ?? []) {
      if (a.alias?.trim()) rawPhrases.push(a.alias);
    }

    const contentTokens = new Set<string>();
    const distinguishingTokens = new Set<string>();
    const projectPhrases: string[][] = [];
    const seenPhrase = new Set<string>();

    for (const raw of rawPhrases) {
      const tokens = canonicalizeJobNameTokens(raw);
      for (const t of tokens) {
        if (isDistinguishingJobNameToken(t)) distinguishingTokens.add(t);
        if (isJobNameContentToken(t)) contentTokens.add(t);
      }
      for (const phrase of extractContentPhrases(tokens)) {
        const key = phraseKey(phrase);
        if (seenPhrase.has(key)) continue;
        seenPhrase.add(key);
        projectPhrases.push(phrase);
      }
    }

    contentSets.push(contentTokens);

    for (const t of contentTokens) {
      const list = tokenToJobIds.get(t) ?? [];
      if (!list.includes(job.id)) list.push(job.id);
      tokenToJobIds.set(t, list);
    }
    for (const phrase of projectPhrases) {
      const key = phraseKey(phrase);
      const list = phraseToJobIds.get(key) ?? [];
      if (!list.includes(job.id)) list.push(job.id);
      phraseToJobIds.set(key, list);
    }

    profiles.push({
      jobId: job.id,
      customerId: job.customerId ?? null,
      fullProjectName: job.name,
      contentTokens: [...contentTokens],
      distinguishingTokens: [...distinguishingTokens],
      projectPhrases,
      // Filled after DF is known.
      distinctiveProjectTokens: [],
      scopeTokens: [],
      abbreviationTokens: [],
    });
  }

  const documentFrequency = new Map<string, number>();
  for (const set of contentSets) {
    for (const t of set) {
      documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1);
    }
  }
  const jobCount = profiles.length;
  const workspaceStats: WorkspaceIdentityTokenStats = {
    jobCount,
    documentFrequency,
  };

  for (const profile of profiles) {
    const distinctive: string[] = [];
    const scope: string[] = [];
    const abbrev: string[] = [];
    for (const t of profile.contentTokens) {
      const df = documentFrequency.get(t) ?? 0;
      const klass = classifyProjectToken(t, df, jobCount);
      if (klass === "PROJECT_SPECIFIC") distinctive.push(t);
      if (klass === "SCOPE_SPECIFIC" || isCommonConstructionIdentityToken(t)) {
        scope.push(t);
      }
      if (t.length <= 4 && !/^\d+$/.test(t) && !isCommonConstructionIdentityToken(t)) {
        abbrev.push(t);
      }
    }
    profile.distinctiveProjectTokens = distinctive;
    profile.scopeTokens = scope;
    profile.abbreviationTokens = abbrev;
  }

  return {
    jobCount,
    profiles,
    tokenToJobIds,
    phraseToJobIds,
    workspaceStats,
  };
}

export function isUniqueProjectPhrase(
  index: WorkspaceProjectIdentityIndex,
  phrase: readonly string[]
): boolean {
  if (phrase.length < 2) return false;
  const contiguous = index.phraseToJobIds.get(phraseKey(phrase)) ?? [];
  if (contiguous.length === 1) return true;
  if (contiguous.length > 1) return false;
  // Gap-tolerant: exactly one Job contains the phrase tokens as an ordered
  // subsequence of its content tokens (e.g. sat … stairs).
  const holders: string[] = [];
  for (const profile of index.profiles) {
    let pi = 0;
    for (const t of profile.contentTokens) {
      if (
        pi < phrase.length &&
        projectTokensEquivalent(t, phrase[pi]!)
      ) {
        pi += 1;
      }
    }
    if (pi === phrase.length) holders.push(profile.jobId);
  }
  return holders.length === 1;
}

export function isSharedProjectIdentifier(
  index: WorkspaceProjectIdentityIndex,
  token: string
): boolean {
  return (index.tokenToJobIds.get(token) ?? []).length > 1;
}

/** Distinct Jobs that contain this content token (document frequency holders). */
export function competingJobIdsForToken(
  index: WorkspaceProjectIdentityIndex,
  token: string
): string[] {
  return [...(index.tokenToJobIds.get(token) ?? [])];
}

/**
 * Rebuild-friendly uniqueness: adding/removing eligible Jobs changes whether
 * a token is unique without hardcoded project families.
 */
export function projectTokenUniqueness(
  index: WorkspaceProjectIdentityIndex,
  token: string
): "unique" | "shared" | "absent" {
  const n = (index.tokenToJobIds.get(token) ?? []).length;
  if (n === 0) return "absent";
  if (n === 1) return "unique";
  return "shared";
}
