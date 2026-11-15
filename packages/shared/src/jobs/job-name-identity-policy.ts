/**
 * Marker 1 identity policy — BASELINE / V1 / V2 / V2.1 / V2.2 (experimental).
 *
 * BASELINE: unique OVERLAP may MATCH (historical behavior).
 * CONTEXT_AWARE_V1: unique weak identity must abstain (AMBIGUOUS), not MATCH.
 * CONTEXT_AWARE_V2: V1 + shared-family / generic multiword disambiguation;
 *   weak candidates cleared so they cannot steer Marker 2.
 * CONTEXT_AWARE_V2_1: V2 identity gates + weak candidates preserved for later
 *   markers (multi-job contact gate still blocks steered wrong matches).
 * CONTEXT_AWARE_V2_2: V2 gates (weak candidates cleared — not V2.1 preserve) +
 *   workspace-aware project-phrase / scope / distinguishing recovery.
 * Production default is CONTEXT_AWARE_V2 (V2.1 / V2.2 remain shadow/eval-only).
 */

import {
  isDistinguishingJobNameToken,
  isJobNameContentToken,
  phraseContained,
} from "./job-name-normalize.js";
import {
  findGapTolerantHayMatch,
  hayHasProjectToken,
  matchedJobTokensInHay,
  normalizeProjectScopeToken,
  projectTokensEquivalent,
} from "./job-project-token-utils.js";

export const JOB_MATCH_IDENTITY_POLICY_BASELINE = "BASELINE" as const;
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1 =
  "CONTEXT_AWARE_V1" as const;
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2 =
  "CONTEXT_AWARE_V2" as const;
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1 =
  "CONTEXT_AWARE_V2_1" as const;
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2 =
  "CONTEXT_AWARE_V2_2" as const;

export type JobMatchIdentityPolicy =
  | typeof JOB_MATCH_IDENTITY_POLICY_BASELINE
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2;

export const DEFAULT_JOB_MATCH_IDENTITY_POLICY: JobMatchIdentityPolicy =
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2;

export type JobNameIdentityStrength =
  | "STRONG"
  | "WEAK"
  | "AMBIGUOUS"
  | "CONFLICTING"
  | "NONE";

export type JobNameIdentityReasonCode =
  | "DISTINCTIVE_PROJECT_PHRASE"
  | "DISTINCTIVE_SINGLE_TOKEN"
  | "EXTERNAL_REF_IDENTITY"
  | "CONTIGUOUS_MULTIWORD_OVERLAP"
  | "GENERIC_TERM_ONLY"
  | "NON_CONTIGUOUS_TOKEN_OVERLAP"
  | "AMBIGUOUS_CANDIDATES"
  | "CONFLICTING_STRONG_IDENTITIES"
  | "NO_IDENTITY"
  | "BASELINE_UNIQUE_OVERLAP"
  | "BASELINE_UNIQUE_PHRASE"
  | "SHARED_CUSTOMER_IDENTITY"
  | "INSUFFICIENT_PROJECT_DISAMBIGUATION"
  | "GENERIC_MULTIWORD_OVERLAP"
  | "CONFLICTING_PROJECT_EVIDENCE"
  /** V2.2: unique multiword project phrase (contiguous / inflection-aware). */
  | "UNIQUE_PROJECT_PHRASE"
  /** V2.2: unique rare project token authorized the match alone. */
  | "UNIQUE_PROJECT_TOKEN"
  /** V2.2: unique project token + supporting scope evidence. */
  | "UNIQUE_TOKEN_SCOPE_MATCH"
  /** V2.2: identifier shared across Jobs — needs more evidence. */
  | "SHARED_PROJECT_IDENTIFIER"
  /** V2.2: shared project id + unique scope / distinguishing resolved the Job. */
  | "PROJECT_SCOPE_DISAMBIGUATION"
  /** V2.2: ordered project/scope terms matched across a controlled gap. */
  | "GAP_TOLERANT_PROJECT_MATCH"
  /** V2.2: short acronym alone is ambiguous (shared or non-authoritative). */
  | "ACRONYM_AMBIGUITY"
  /** V2.2: distinct project signals point at different Jobs. */
  | "CONTRADICTORY_PROJECT_EVIDENCE";

export type JobNameIdentityDiagnostics = {
  marker: "NAME";
  identityPolicy: JobMatchIdentityPolicy;
  identityStrength: JobNameIdentityStrength;
  matchedPhrase: string | null;
  matchedTerms: string[];
  weakTerms: string[];
  distinctiveTerms: string[];
  sharedIdentityTerms: string[];
  distinguishingIdentityTerms: string[];
  identityFamilyJobIds: string[];
  evidenceSource: string | null;
  evidenceType: string | null;
  matchKind: string | null;
  strongIdentityAnchor: boolean;
  candidateJobIds: string[];
  candidateCount: number;
  competingJobIds: string[];
  resolutionAllowed: boolean;
  reason: JobNameIdentityReasonCode;
  /** V2.2: intervening tokens between ordered project/scope terms (0 = contiguous). */
  tokenDistance?: number | null;
  /** V2.2: inflection / normalization pairs applied for this decision. */
  normalizationApplied?: string[];
  /** V2.2: where the decisive identity evidence was found. */
  evidenceField?: "subject" | "body" | "mixed" | null;
  /** V2.2: uniqueness of the primary project identifier vs the workspace. */
  projectTokenUniqueness?: "unique" | "shared" | "none" | null;
};

/**
 * Construction / generic vocabulary used as a *negative signal* for
 * single-token identity strength. Not a permanent stopword list — tokens
 * remain in the stream and may still participate in multiword phrases.
 */
export const COMMON_CONSTRUCTION_IDENTITY_TOKENS = new Set([
  "stairs",
  "stair",
  "beam",
  "beams",
  "steel",
  "up",
  "auto",
  "point",
  "frame",
  "frames",
  "platform",
  "platforms",
  "rtu",
  "shop",
  "rail",
  "rails",
  "plate",
  "plates",
  "weld",
  "welding",
  "deck",
  "decking",
  "metal",
  "fab",
  "fabrication",
  "column",
  "columns",
  "truss",
  "trusses",
  "joist",
  "joists",
  "panel",
  "panels",
  "door",
  "doors",
  "gate",
  "gates",
  "fence",
  "handrail",
  "guardrail",
  "ladder",
  "ladders",
  "catwalk",
  "mezzanine",
  "canopy",
  "awning",
  "grating",
  "grate",
  "fabrication",
  "submittal",
  "submittals",
  "approval",
  "approvals",
  "miscellaneous",
  "structural",
  "warehouse",
  "material",
  "materials",
  "certs",
  "certification",
  "certifications",
]);

export type WorkspaceIdentityTokenStats = {
  /** Eligible Job count used when computing document frequency. */
  jobCount: number;
  /** Content-token → number of Jobs whose identity phrases contain it. */
  documentFrequency: Map<string, number>;
};

export function buildWorkspaceIdentityTokenStats(
  jobContentTokenSets: ReadonlyArray<ReadonlySet<string>>
): WorkspaceIdentityTokenStats {
  const documentFrequency = new Map<string, number>();
  for (const tokens of jobContentTokenSets) {
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  return {
    jobCount: jobContentTokenSets.length,
    documentFrequency,
  };
}

export function isCommonConstructionIdentityToken(token: string): boolean {
  return COMMON_CONSTRUCTION_IDENTITY_TOKENS.has(token);
}

/**
 * Workspace-rare: appears in exactly one eligible Job's identity phrases.
 * Rarity alone never authorizes a MATCH — it only supports single-token
 * EXACT/ALL_TOKENS when the token is also not common construction vocabulary.
 */
export function isWorkspaceRareIdentityToken(
  token: string,
  stats: WorkspaceIdentityTokenStats
): boolean {
  return (stats.documentFrequency.get(token) ?? 0) === 1;
}

export type IdentityHitAssessmentInput = {
  kind: "EXACT" | "ALL_TOKENS" | "OVERLAP" | "NONE";
  field: "subject" | "body" | null;
  phraseLabel: string | null;
  phraseSource: string | null;
  phraseTokens: string[];
  allPhraseTokenLists?: string[][];
  /** Content tokens from the winning hit that also appear in the email. */
  matchedContentTokens: string[];
  subjectTokens: string[];
  bodyTokens: string[];
  workspaceStats: WorkspaceIdentityTokenStats;
};

function contentTokensOf(tokens: string[]): string[] {
  return tokens.filter(isJobNameContentToken);
}

/**
 * True when ≥2 content tokens form a contiguous run inside a job phrase and
 * that same run appears contiguously in the email (subject or body).
 * Matched-token set must cover the run (coincidental distant tokens do not count).
 */
export function hasContiguousMultiwordOverlap(input: {
  matchedContentTokens: string[];
  phraseTokens: string[];
  /** Optional alternate phrases on the same Job (aliases / site / etc.). */
  allPhraseTokenLists?: string[][];
  subjectTokens: string[];
  bodyTokens: string[];
}): boolean {
  const matchedSet = new Set(contentTokensOf(input.matchedContentTokens));
  if (matchedSet.size < 2) return false;

  const phraseLists = [
    input.phraseTokens,
    ...(input.allPhraseTokenLists ?? []),
  ];

  for (const phraseTokens of phraseLists) {
    const phraseContent = contentTokensOf(phraseTokens);
    if (phraseContent.length < 2) continue;
    for (let len = phraseContent.length; len >= 2; len -= 1) {
      for (let i = 0; i + len <= phraseContent.length; i += 1) {
        const run = phraseContent.slice(i, i + len);
        if (!run.every((t) => matchedSet.has(t))) continue;
        if (
          phraseContained(input.subjectTokens, run) ||
          phraseContained(input.bodyTokens, run)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export function assessIdentityHitStrength(
  input: IdentityHitAssessmentInput
): {
  strength: JobNameIdentityStrength;
  reason: JobNameIdentityReasonCode;
  strongIdentityAnchor: boolean;
  weakTerms: string[];
  distinctiveTerms: string[];
} {
  const matched = contentTokensOf(input.matchedContentTokens);
  const weakTerms = matched.filter(isCommonConstructionIdentityToken);
  const distinctiveTerms = matched.filter(
    (t) =>
      !isCommonConstructionIdentityToken(t) &&
      isWorkspaceRareIdentityToken(t, input.workspaceStats)
  );

  if (input.kind === "NONE") {
    return {
      strength: "NONE",
      reason: "NO_IDENTITY",
      strongIdentityAnchor: false,
      weakTerms,
      distinctiveTerms,
    };
  }

  if (input.phraseSource === "EXTERNAL_REF" && input.kind !== "OVERLAP") {
    return {
      strength: "STRONG",
      reason: "EXTERNAL_REF_IDENTITY",
      strongIdentityAnchor: true,
      weakTerms,
      distinctiveTerms,
    };
  }

  if (input.kind === "EXACT" || input.kind === "ALL_TOKENS") {
    const phraseContent = contentTokensOf(input.phraseTokens);
    if (phraseContent.length >= 2) {
      return {
        strength: "STRONG",
        reason: "DISTINCTIVE_PROJECT_PHRASE",
        strongIdentityAnchor: true,
        weakTerms,
        distinctiveTerms,
      };
    }
    // Single-token full phrase (e.g. alias "MGCC").
    const token = phraseContent[0] ?? matched[0];
    if (
      token &&
      !isCommonConstructionIdentityToken(token) &&
      isWorkspaceRareIdentityToken(token, input.workspaceStats)
    ) {
      return {
        strength: "STRONG",
        reason: "DISTINCTIVE_SINGLE_TOKEN",
        strongIdentityAnchor: true,
        weakTerms,
        distinctiveTerms,
      };
    }
    return {
      strength: "WEAK",
      reason: "GENERIC_TERM_ONLY",
      strongIdentityAnchor: false,
      weakTerms: token ? [token] : weakTerms,
      distinctiveTerms,
    };
  }

  // OVERLAP
  if (
    hasContiguousMultiwordOverlap({
      matchedContentTokens: matched,
      phraseTokens: input.phraseTokens,
      ...(input.allPhraseTokenLists
        ? { allPhraseTokenLists: input.allPhraseTokenLists }
        : {}),
      subjectTokens: input.subjectTokens,
      bodyTokens: input.bodyTokens,
    })
  ) {
    // V1 treats contiguous multiword OVERLAP as strong; V2 re-checks below.
    return {
      strength: "STRONG",
      reason: "CONTIGUOUS_MULTIWORD_OVERLAP",
      strongIdentityAnchor: true,
      weakTerms,
      distinctiveTerms,
    };
  }

  if (matched.length >= 2) {
    return {
      strength: "WEAK",
      reason: "NON_CONTIGUOUS_TOKEN_OVERLAP",
      strongIdentityAnchor: false,
      weakTerms,
      distinctiveTerms,
    };
  }

  return {
    strength: "WEAK",
    reason: "GENERIC_TERM_ONLY",
    strongIdentityAnchor: false,
    weakTerms: matched.length > 0 ? matched : weakTerms,
    distinctiveTerms,
  };
}

/** Lightweight peer Job identity for V2 family disambiguation. */
export type IdentityPeerJob = {
  jobId: string;
  customerId: string | null;
  contentTokens: string[];
  /** Numeric / compass tokens that disambiguate sibling Jobs. */
  distinguishingTokens: string[];
  phraseTokenLists: string[][];
  matchedContentTokens: string[];
  kind: "EXACT" | "ALL_TOKENS" | "OVERLAP" | "NONE";
};

export type ApplyIdentityPolicyInput = {
  policy: JobMatchIdentityPolicy;
  status: "MATCH" | "AMBIGUOUS" | "NO_MATCH";
  selectedJobIds: string[];
  hit: IdentityHitAssessmentInput | null;
  competingJobIds?: string[];
  /** All scored Jobs (V2 family / distinguishing analysis). */
  peerJobs?: IdentityPeerJob[];
  subjectTokens?: string[];
  bodyTokens?: string[];
};

export type ApplyIdentityPolicyResult = {
  status: "MATCH" | "AMBIGUOUS" | "NO_MATCH";
  /**
   * When demoting MATCH→AMBIGUOUS:
   * V1: keep candidates (preserveCandidates=true).
   * V2 weak: clear candidates so Marker 2/3 can expand freely.
   */
  preserveCandidates: boolean;
  /** Explicit candidate override (e.g. V2 clear or family reselect). */
  candidateJobIdsOverride?: string[];
  selectedJobIdOverride?: string | null;
  diagnostics: JobNameIdentityDiagnostics;
};

function emptyDiagnostics(
  policy: JobMatchIdentityPolicy,
  status: "MATCH" | "AMBIGUOUS" | "NO_MATCH",
  selectedJobIds: string[]
): JobNameIdentityDiagnostics {
  return {
    marker: "NAME",
    identityPolicy: policy,
    identityStrength: status === "NO_MATCH" ? "NONE" : "AMBIGUOUS",
    matchedPhrase: null,
    matchedTerms: [],
    weakTerms: [],
    distinctiveTerms: [],
    sharedIdentityTerms: [],
    distinguishingIdentityTerms: [],
    identityFamilyJobIds: [],
    evidenceSource: null,
    evidenceType: null,
    matchKind: null,
    strongIdentityAnchor: false,
    candidateJobIds: selectedJobIds,
    candidateCount: selectedJobIds.length,
    competingJobIds: [],
    resolutionAllowed: false,
    reason: status === "NO_MATCH" ? "NO_IDENTITY" : "AMBIGUOUS_CANDIDATES",
  };
}

function hayHasToken(subject: string[], body: string[], token: string): boolean {
  return subject.includes(token) || body.includes(token);
}

/**
 * Jobs that share a significant identity token/phrase with the selected match.
 * Workspace-derived — no hardcoded project families.
 */
export function findIdentityFamilyPeers(input: {
  selectedJobId: string;
  matchedContentTokens: string[];
  peers: IdentityPeerJob[];
}): {
  familyJobIds: string[];
  sharedTerms: string[];
} {
  const selected = input.peers.find((p) => p.jobId === input.selectedJobId);
  const seedTokens = contentTokensOf(
    selected?.contentTokens?.length
      ? selected.contentTokens
      : input.matchedContentTokens
  );
  const matchedSet = new Set(seedTokens);
  const sharedTerms: string[] = [];
  const familyJobIds: string[] = [];

  for (const peer of input.peers) {
    if (peer.jobId === input.selectedJobId) continue;

    // Same customer is authoritative family evidence (workspace data).
    if (
      selected?.customerId &&
      peer.customerId &&
      selected.customerId === peer.customerId
    ) {
      familyJobIds.push(peer.jobId);
      continue;
    }

    const shared = peer.contentTokens.filter((t) => matchedSet.has(t));
    if (shared.length === 0) continue;
    // Significant share: any shared content token that is not purely numeric.
    const significant = shared.filter((t) => !/^\d+$/.test(t));
    if (significant.length === 0) continue;
    familyJobIds.push(peer.jobId);
    for (const t of significant) {
      if (!sharedTerms.includes(t)) sharedTerms.push(t);
    }
  }
  return { familyJobIds, sharedTerms };
}

/**
 * Distinguishing tokens for a Job relative to family peers that appear in hay.
 */
export function distinguishingTermsInEmail(input: {
  job: IdentityPeerJob;
  familyPeers: IdentityPeerJob[];
  subjectTokens: string[];
  bodyTokens: string[];
}): string[] {
  const familyTokenUnion = new Set<string>();
  for (const peer of input.familyPeers) {
    if (peer.jobId === input.job.jobId) continue;
    for (const t of peer.contentTokens) familyTokenUnion.add(t);
    for (const t of peer.distinguishingTokens) familyTokenUnion.add(t);
  }
  const candidates = [
    ...input.job.contentTokens.filter((t) => !familyTokenUnion.has(t)),
    ...input.job.distinguishingTokens.filter(
      (t) =>
        !familyTokenUnion.has(t) ||
        isDistinguishingJobNameToken(t) ||
        /^\d+$/.test(t)
    ),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of candidates) {
    if (seen.has(t)) continue;
    if (!hayHasToken(input.subjectTokens, input.bodyTokens, t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function isGenericMultiwordRun(run: string[]): boolean {
  if (run.length < 2) return true;
  return run.every(
    (t) => isCommonConstructionIdentityToken(t) || isJobNameStopish(t)
  );
}

function isJobNameStopish(token: string): boolean {
  // Lightweight overlap with stop-ish construction/business words that are
  // not always in COMMON_CONSTRUCTION but still weak as phrase anchors.
  return (
    token === "delivery" ||
    token === "revised" ||
    token === "revision" ||
    token === "update" ||
    token === "drawings" ||
    token === "drawing"
  );
}

/**
 * Contiguous multiword OVERLAP is strong under V1; V2 requires the run not be
 * entirely generic construction vocabulary and not be shared across Jobs.
 */
export function assessV2MultiwordOverlap(input: {
  matchedContentTokens: string[];
  phraseTokens: string[];
  allPhraseTokenLists?: string[][];
  subjectTokens: string[];
  bodyTokens: string[];
  peers: IdentityPeerJob[];
  selectedJobId: string;
}): { ok: boolean; reason: JobNameIdentityReasonCode; run: string[] } {
  const matchedSet = new Set(contentTokensOf(input.matchedContentTokens));
  if (matchedSet.size < 2) {
    return { ok: false, reason: "GENERIC_TERM_ONLY", run: [] };
  }
  const phraseLists = [
    input.phraseTokens,
    ...(input.allPhraseTokenLists ?? []),
  ];
  let bestRun: string[] = [];
  for (const phraseTokens of phraseLists) {
    const phraseContent = contentTokensOf(phraseTokens);
    for (let len = phraseContent.length; len >= 2; len -= 1) {
      for (let i = 0; i + len <= phraseContent.length; i += 1) {
        const run = phraseContent.slice(i, i + len);
        if (!run.every((t) => matchedSet.has(t))) continue;
        if (
          !phraseContained(input.subjectTokens, run) &&
          !phraseContained(input.bodyTokens, run)
        ) {
          continue;
        }
        if (run.length > bestRun.length) bestRun = run;
      }
    }
  }
  if (bestRun.length < 2) {
    return { ok: false, reason: "NON_CONTIGUOUS_TOKEN_OVERLAP", run: [] };
  }
  if (isGenericMultiwordRun(bestRun)) {
    return { ok: false, reason: "GENERIC_MULTIWORD_OVERLAP", run: bestRun };
  }
  // Shared across another Job's phrases → not distinctive enough alone.
  for (const peer of input.peers) {
    if (peer.jobId === input.selectedJobId) continue;
    for (const phrase of peer.phraseTokenLists) {
      if (phraseContained(contentTokensOf(phrase), bestRun)) {
        return { ok: false, reason: "SHARED_CUSTOMER_IDENTITY", run: bestRun };
      }
    }
  }
  return { ok: true, reason: "CONTIGUOUS_MULTIWORD_OVERLAP", run: bestRun };
}

function diagBase(
  policy: JobMatchIdentityPolicy,
  hit: IdentityHitAssessmentInput | null,
  assessed: ReturnType<typeof assessIdentityHitStrength> | null,
  selectedJobIds: string[],
  extras?: Partial<JobNameIdentityDiagnostics>
): JobNameIdentityDiagnostics {
  return {
    marker: "NAME",
    identityPolicy: policy,
    identityStrength: assessed?.strength ?? "NONE",
    matchedPhrase: hit?.phraseLabel ?? null,
    matchedTerms: hit?.matchedContentTokens ?? [],
    weakTerms: assessed?.weakTerms ?? [],
    distinctiveTerms: assessed?.distinctiveTerms ?? [],
    sharedIdentityTerms: [],
    distinguishingIdentityTerms: [],
    identityFamilyJobIds: [],
    evidenceSource: hit?.phraseSource ?? null,
    evidenceType: null,
    matchKind: hit?.kind ?? null,
    strongIdentityAnchor: assessed?.strongIdentityAnchor ?? false,
    candidateJobIds: selectedJobIds,
    candidateCount: selectedJobIds.length,
    competingJobIds: [],
    resolutionAllowed: false,
    reason: assessed?.reason ?? "NO_IDENTITY",
    ...extras,
  };
}

/**
 * Apply identity-policy safety gate after decideFromHits.
 * BASELINE: pass-through (diagnostics only).
 * CONTEXT_AWARE_V1: demote unique WEAK MATCH to AMBIGUOUS (candidates preserved).
 * CONTEXT_AWARE_V2: V1 + family/generic multiword checks; weak clears candidates.
 */
export function applyJobNameIdentityPolicy(
  input: ApplyIdentityPolicyInput
): ApplyIdentityPolicyResult {
  const { policy, status, selectedJobIds } = input;

  if (status === "NO_MATCH") {
    return {
      status: "NO_MATCH",
      preserveCandidates: false,
      diagnostics: emptyDiagnostics(policy, status, selectedJobIds),
    };
  }

  if (status === "AMBIGUOUS") {
    const assessed = input.hit
      ? assessIdentityHitStrength(input.hit)
      : null;
    const ambiguousResult: ApplyIdentityPolicyResult = {
      status: "AMBIGUOUS",
      preserveCandidates: true,
      diagnostics: diagBase(policy, input.hit, assessed, selectedJobIds, {
        identityStrength:
          selectedJobIds.length > 1 && assessed?.strength === "STRONG"
            ? "CONFLICTING"
            : "AMBIGUOUS",
        competingJobIds: input.competingJobIds ?? selectedJobIds,
        resolutionAllowed: false,
        reason:
          selectedJobIds.length > 1 && assessed?.strength === "STRONG"
            ? "CONFLICTING_STRONG_IDENTITIES"
            : "AMBIGUOUS_CANDIDATES",
      }),
    };
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2) {
      const recovered = tryProjectIdentityCoverageRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: ambiguousResult.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(ambiguousResult, input);
    }
    return ambiguousResult;
  }

  // Unique MATCH from decideFromHits
  if (!input.hit) {
    return {
      status: "MATCH",
      preserveCandidates: true,
      diagnostics: {
        ...emptyDiagnostics(policy, status, selectedJobIds),
        identityStrength: "STRONG",
        resolutionAllowed: true,
        reason: "BASELINE_UNIQUE_PHRASE",
        strongIdentityAnchor: true,
      },
    };
  }

  const assessed = assessIdentityHitStrength(input.hit);

  if (policy === JOB_MATCH_IDENTITY_POLICY_BASELINE) {
    const baselineReason: JobNameIdentityReasonCode =
      input.hit.kind === "OVERLAP"
        ? "BASELINE_UNIQUE_OVERLAP"
        : "BASELINE_UNIQUE_PHRASE";
    return {
      status: "MATCH",
      preserveCandidates: true,
      diagnostics: diagBase(policy, input.hit, assessed, selectedJobIds, {
        identityStrength: assessed.strength,
        strongIdentityAnchor: assessed.strongIdentityAnchor,
        resolutionAllowed: true,
        reason: baselineReason,
      }),
    };
  }

  // CONTEXT_AWARE_V1 — unchanged semantics
  if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1) {
    if (assessed.strength === "STRONG") {
      return {
        status: "MATCH",
        preserveCandidates: true,
        diagnostics: diagBase(policy, input.hit, assessed, selectedJobIds, {
          identityStrength: "STRONG",
          strongIdentityAnchor: true,
          resolutionAllowed: true,
          reason: assessed.reason,
        }),
      };
    }
    return {
      status: "AMBIGUOUS",
      preserveCandidates: true,
      diagnostics: diagBase(policy, input.hit, assessed, selectedJobIds, {
        identityStrength: "WEAK",
        strongIdentityAnchor: false,
        resolutionAllowed: false,
        reason: assessed.reason,
      }),
    };
  }

  // CONTEXT_AWARE_V2 / V2.1 / V2.2 (shared identity gates; weak/recovery differs)
  if (
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2
  ) {
    const v2Result = applyContextAwareV2IdentityPolicy({
      input,
      assessed,
      selectedJobIds,
      /**
       * V2 / V2.2 clear weak candidates (prevents steering).
       * V2.1 preserves them so Marker 2/3 can narrow; multi-job contact
       * safety still blocks unique MATCH from multi-job contacts.
       * V2.2 must NOT reintroduce V2.1 weak-preserve behavior.
       */
      preserveWeakCandidates:
        policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      policyId: policy,
    });
    if (
      policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2 &&
      v2Result.status !== "MATCH"
    ) {
      const recovered = tryProjectIdentityCoverageRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: v2Result.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(v2Result, input);
    }
    return v2Result;
  }

  // Unknown policy → treat as BASELINE pass-through
  return {
    status: "MATCH",
    preserveCandidates: true,
    diagnostics: diagBase(policy, input.hit, assessed, selectedJobIds, {
      identityStrength: assessed.strength,
      strongIdentityAnchor: assessed.strongIdentityAnchor,
      resolutionAllowed: true,
      reason:
        input.hit.kind === "OVERLAP"
          ? "BASELINE_UNIQUE_OVERLAP"
          : "BASELINE_UNIQUE_PHRASE",
    }),
  };
}

function applyContextAwareV2IdentityPolicy(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength>;
  selectedJobIds: string[];
  preserveWeakCandidates: boolean;
  policyId:
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2;
}): ApplyIdentityPolicyResult {
  const { input, assessed, selectedJobIds, preserveWeakCandidates, policyId } =
    args;
  const hit = input.hit!;
  const peers = input.peerJobs ?? [];
  const subjectTokens = input.subjectTokens ?? hit.subjectTokens;
  const bodyTokens = input.bodyTokens ?? hit.bodyTokens;
  const selectedId = selectedJobIds[0]!;

  let strength = assessed.strength;
  let reason = assessed.reason;
  let strongAnchor = assessed.strongIdentityAnchor;

  // Re-validate contiguous multiword OVERLAP under V2.
  if (
    strength === "STRONG" &&
    assessed.reason === "CONTIGUOUS_MULTIWORD_OVERLAP"
  ) {
    const multi = assessV2MultiwordOverlap({
      matchedContentTokens: hit.matchedContentTokens,
      phraseTokens: hit.phraseTokens,
      ...(hit.allPhraseTokenLists
        ? { allPhraseTokenLists: hit.allPhraseTokenLists }
        : {}),
      subjectTokens,
      bodyTokens,
      peers,
      selectedJobId: selectedId,
    });
    if (!multi.ok) {
      strength = "WEAK";
      reason = multi.reason;
      strongAnchor = false;
    }
  }

  // Shared family / customer identity disambiguation for unique strong matches.
  const family = findIdentityFamilyPeers({
    selectedJobId: selectedId,
    matchedContentTokens: hit.matchedContentTokens,
    peers,
  });
  const selectedPeer = peers.find((p) => p.jobId === selectedId);
  const familyPeers = peers.filter((p) =>
    family.familyJobIds.includes(p.jobId)
  );

  let distinguishing: string[] = [];
  if (selectedPeer && family.familyJobIds.length > 0 && strength === "STRONG") {
    distinguishing = distinguishingTermsInEmail({
      job: selectedPeer,
      familyPeers: [selectedPeer, ...familyPeers],
      subjectTokens,
      bodyTokens,
    });
    const matched = contentTokensOf(hit.matchedContentTokens);
    const sharedWithSibling = matched.filter((t) =>
      familyPeers.some((p) => p.contentTokens.includes(t))
    );
    const uniqueInMatched = matched.filter(
      (t) => !familyPeers.some((p) => p.contentTokens.includes(t))
    );

    const competitorsWithDistinguishing = familyPeers
      .map((peer) => ({
        peer,
        terms: distinguishingTermsInEmail({
          job: peer,
          familyPeers: [selectedPeer, ...familyPeers],
          subjectTokens,
          bodyTokens,
        }),
      }))
      .filter((row) => row.terms.length > 0);

    const familyCandidateIds = [selectedId, ...family.familyJobIds];

    // Umbrella/customer-only name (no tokens shared with siblings in the match).
    if (uniqueInMatched.length > 0 && sharedWithSibling.length === 0) {
      if (competitorsWithDistinguishing.length === 1) {
        const winner = competitorsWithDistinguishing[0]!;
        return {
          status: "MATCH",
          preserveCandidates: true,
          selectedJobIdOverride: winner.peer.jobId,
          candidateJobIdsOverride: [winner.peer.jobId],
          diagnostics: diagBase(
            policyId,
            hit,
            assessed,
            [winner.peer.jobId],
            {
              identityStrength: "STRONG",
              strongIdentityAnchor: true,
              sharedIdentityTerms: family.sharedTerms,
              distinguishingIdentityTerms: winner.terms,
              identityFamilyJobIds: family.familyJobIds,
              resolutionAllowed: true,
              reason: "DISTINCTIVE_PROJECT_PHRASE",
              matchedTerms: [...matched, ...winner.terms],
            }
          ),
        };
      }
      if (competitorsWithDistinguishing.length > 1) {
        const ids = competitorsWithDistinguishing.map((c) => c.peer.jobId);
        return {
          status: "AMBIGUOUS",
          preserveCandidates: true,
          candidateJobIdsOverride: ids,
          diagnostics: diagBase(
            policyId,
            hit,
            assessed,
            ids,
            {
              identityStrength: "AMBIGUOUS",
              strongIdentityAnchor: false,
              sharedIdentityTerms: family.sharedTerms,
              distinguishingIdentityTerms: [],
              identityFamilyJobIds: family.familyJobIds,
              competingJobIds: ids,
              resolutionAllowed: false,
              reason: "INSUFFICIENT_PROJECT_DISAMBIGUATION",
            }
          ),
        };
      }
      return {
        status: "AMBIGUOUS",
        preserveCandidates: true,
        candidateJobIdsOverride: familyCandidateIds,
        diagnostics: diagBase(
          policyId,
          hit,
          assessed,
          familyCandidateIds,
          {
            identityStrength: "AMBIGUOUS",
            strongIdentityAnchor: false,
            sharedIdentityTerms: family.sharedTerms,
            distinguishingIdentityTerms: [],
            identityFamilyJobIds: family.familyJobIds,
            competingJobIds: familyCandidateIds,
            resolutionAllowed: false,
            reason: "SHARED_CUSTOMER_IDENTITY",
          }
        ),
      };
    }

    // Shared prefix + project-specific token in the matched phrase (e.g. SAT Concessions).
    if (uniqueInMatched.length > 0 && sharedWithSibling.length > 0) {
      return {
        status: "MATCH",
        preserveCandidates: true,
        diagnostics: diagBase(
          policyId,
          hit,
          assessed,
          selectedJobIds,
          {
            identityStrength: "STRONG",
            strongIdentityAnchor: true,
            sharedIdentityTerms: sharedWithSibling,
            distinguishingIdentityTerms: uniqueInMatched,
            identityFamilyJobIds: family.familyJobIds,
            resolutionAllowed: true,
            reason: "DISTINCTIVE_PROJECT_PHRASE",
          }
        ),
      };
    }

    // Only shared tokens matched; sibling may still have distinguishing evidence.
    if (uniqueInMatched.length === 0) {
      if (competitorsWithDistinguishing.length === 1) {
        const winner = competitorsWithDistinguishing[0]!;
        return {
          status: "MATCH",
          preserveCandidates: true,
          selectedJobIdOverride: winner.peer.jobId,
          candidateJobIdsOverride: [winner.peer.jobId],
          diagnostics: diagBase(
            policyId,
            hit,
            assessed,
            [winner.peer.jobId],
            {
              identityStrength: "STRONG",
              strongIdentityAnchor: true,
              sharedIdentityTerms: family.sharedTerms,
              distinguishingIdentityTerms: winner.terms,
              identityFamilyJobIds: family.familyJobIds,
              resolutionAllowed: true,
              reason: "DISTINCTIVE_PROJECT_PHRASE",
              matchedTerms: [...matched, ...winner.terms],
            }
          ),
        };
      }
      return {
        status: "AMBIGUOUS",
        preserveCandidates: true,
        candidateJobIdsOverride: familyCandidateIds,
        diagnostics: diagBase(
          policyId,
          hit,
          assessed,
          familyCandidateIds,
          {
            identityStrength: "AMBIGUOUS",
            strongIdentityAnchor: false,
            sharedIdentityTerms: family.sharedTerms,
            distinguishingIdentityTerms: distinguishing,
            identityFamilyJobIds: family.familyJobIds,
            competingJobIds: familyCandidateIds,
            resolutionAllowed: false,
            reason:
              competitorsWithDistinguishing.length > 1
                ? "INSUFFICIENT_PROJECT_DISAMBIGUATION"
                : "SHARED_CUSTOMER_IDENTITY",
          }
        ),
      };
    }
  }

  if (strength === "STRONG") {
    return {
      status: "MATCH",
      preserveCandidates: true,
      diagnostics: diagBase(
        policyId,
        hit,
        assessed,
        selectedJobIds,
        {
          identityStrength: "STRONG",
          strongIdentityAnchor: true,
          sharedIdentityTerms: family.sharedTerms,
          distinguishingIdentityTerms: distinguishing,
          identityFamilyJobIds: family.familyJobIds,
          resolutionAllowed: true,
          reason,
        }
      ),
    };
  }

  // Weak unique identity → abstain.
  // V2 / V2.2 clear candidates so Marker 2 expands from empty; V2.1 preserves them.
  return {
    status: "AMBIGUOUS",
    preserveCandidates: preserveWeakCandidates,
    candidateJobIdsOverride: preserveWeakCandidates ? selectedJobIds : [],
    diagnostics: diagBase(
      policyId,
      hit,
      { ...assessed, strength: "WEAK", strongIdentityAnchor: false, reason },
      preserveWeakCandidates ? selectedJobIds : [],
      {
        identityStrength: "WEAK",
        strongIdentityAnchor: false,
        sharedIdentityTerms: family.sharedTerms,
        distinguishingIdentityTerms: distinguishing,
        identityFamilyJobIds: family.familyJobIds,
        competingJobIds: selectedJobIds,
        resolutionAllowed: false,
        reason,
        matchedTerms: hit.matchedContentTokens,
        matchedPhrase: hit.phraseLabel,
      }
    ),
  };
}

function contentTokensEquivMatch(
  jobTokens: readonly string[],
  hayTokens: ReadonlySet<string>
): string[] {
  const out: string[] = [];
  for (const jt of jobTokens) {
    for (const ht of hayTokens) {
      if (projectTokensEquivalent(jt, ht)) {
        out.push(jt);
        break;
      }
    }
  }
  return out;
}

/**
 * Gap-tolerant project phrase: matched content tokens appear in phrase order
 * (intervening unmatched job-phrase tokens allowed). The ordered run must
 * appear in the email either contiguously or within a controlled intervening
 * budget (e.g. "SAT TDP Stair" → sat + stairs).
 */
export function hasGapTolerantProjectPhraseOverlap(input: {
  matchedContentTokens: string[];
  phraseTokens: string[];
  allPhraseTokenLists?: string[][];
  subjectTokens: string[];
  bodyTokens: string[];
}): {
  ok: boolean;
  run: string[];
  intervening: number;
  contiguous: boolean;
  field: "subject" | "body" | null;
} {
  const haySet = new Set([
    ...contentTokensOf(input.matchedContentTokens),
    ...contentTokensOf(input.subjectTokens),
    ...contentTokensOf(input.bodyTokens),
  ]);
  const phraseLists = [
    input.phraseTokens,
    ...(input.allPhraseTokenLists ?? []),
  ];
  let best: {
    run: string[];
    intervening: number;
    contiguous: boolean;
    field: "subject" | "body";
  } | null = null;

  for (const phraseTokens of phraseLists) {
    const phraseContent = contentTokensOf(phraseTokens);
    const ordered = contentTokensEquivMatch(phraseContent, haySet);
    if (ordered.length < 2) continue;
    for (let len = ordered.length; len >= 2; len -= 1) {
      for (let i = 0; i + len <= ordered.length; i += 1) {
        const run = ordered.slice(i, i + len);
        // Prefer runs that include ≥1 non-generic project token.
        if (run.every((t) => isCommonConstructionIdentityToken(t))) continue;
        const hay = findGapTolerantHayMatch({
          needles: run,
          subjectTokens: input.subjectTokens,
          bodyTokens: input.bodyTokens,
        });
        if (!hay) continue;
        const candidate = {
          run,
          intervening: hay.intervening,
          contiguous: hay.contiguous,
          field: hay.field,
        };
        if (
          !best ||
          candidate.run.length > best.run.length ||
          (candidate.run.length === best.run.length &&
            candidate.intervening < best.intervening) ||
          (candidate.run.length === best.run.length &&
            candidate.intervening === best.intervening &&
            candidate.field === "subject" &&
            best.field !== "subject")
        ) {
          best = candidate;
        }
      }
    }
  }
  if (!best) {
    return {
      ok: false,
      run: [],
      intervening: 0,
      contiguous: false,
      field: null,
    };
  }
  return {
    ok: true,
    run: best.run,
    intervening: best.intervening,
    contiguous: best.contiguous,
    field: best.field,
  };
}

/**
 * Short unique tokens (≤3) may authorize a MATCH only when they head a Job
 * phrase (project acronym / lead identifier). Prevents "ext" alone matching
 * "SAT - 15 Ext Stairs" while allowing unique "SAT" / "CPAC".
 */
export function isAuthoritativeUniqueProjectToken(
  token: string,
  peer: IdentityPeerJob
): boolean {
  if (!token || isCommonConstructionIdentityToken(token)) return false;
  if (token.length > 3) return true;
  for (const phrase of peer.phraseTokenLists) {
    const content = contentTokensOf(phrase);
    if (content.length === 0) continue;
    if (projectTokensEquivalent(content[0]!, token)) return true;
  }
  return false;
}

function collectNormalizationApplied(
  matched: readonly string[],
  subjectTokens: readonly string[],
  bodyTokens: readonly string[]
): string[] {
  const applied: string[] = [];
  const hay = [...subjectTokens, ...bodyTokens];
  for (const jt of matched) {
    const norm = normalizeProjectScopeToken(jt);
    for (const ht of hay) {
      if (ht === jt) continue;
      if (projectTokensEquivalent(ht, jt) && normalizeProjectScopeToken(ht) === norm) {
        const label = `${ht}→${norm}`;
        if (!applied.includes(label)) applied.push(label);
      }
    }
  }
  return applied;
}

function annotateSharedProjectIdentifier(
  result: ApplyIdentityPolicyResult,
  input: ApplyIdentityPolicyInput
): ApplyIdentityPolicyResult {
  const hit = input.hit;
  if (!hit) return result;
  const matched = contentTokensOf(hit.matchedContentTokens);
  const peers = input.peerJobs ?? [];
  const shared = matched.filter((t) => {
    if (isCommonConstructionIdentityToken(t)) return false;
    const holders = peers.filter((p) =>
      p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
    );
    return holders.length > 1;
  });
  if (shared.length === 0) return result;
  if (
    result.diagnostics.reason === "AMBIGUOUS_CANDIDATES" ||
    result.diagnostics.reason === "GENERIC_TERM_ONLY" ||
    result.diagnostics.reason === "NON_CONTIGUOUS_TOKEN_OVERLAP" ||
    result.diagnostics.reason === "SHARED_CUSTOMER_IDENTITY"
  ) {
    return {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        sharedIdentityTerms: shared,
        reason:
          matched.every(
            (t) =>
              isCommonConstructionIdentityToken(t) ||
              t.length <= 3 ||
              shared.includes(t)
          ) && matched.some((t) => t.length <= 3)
            ? "ACRONYM_AMBIGUITY"
            : "SHARED_PROJECT_IDENTIFIER",
      },
    };
  }
  return result;
}

/**
 * CONTEXT_AWARE_V2_2 coverage recovery — deterministic, no GT labels.
 * Never preserves weak candidates (unlike V2.1). Only returns MATCH when
 * evidence uniquely identifies one Job.
 */
export function tryProjectIdentityCoverageRecovery(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
  priorReason: JobNameIdentityReasonCode;
}): ApplyIdentityPolicyResult | null {
  const { input, assessed, selectedJobIds } = args;
  const hit = input.hit;
  if (!hit) return null;

  const peers = input.peerJobs ?? [];
  const subjectTokens = input.subjectTokens ?? hit.subjectTokens;
  const bodyTokens = input.bodyTokens ?? hit.bodyTokens;
  const haySet = new Set([...subjectTokens, ...bodyTokens]);
  const workspaceStats = hit.workspaceStats;

  const matchResult = (
    jobId: string,
    reason: JobNameIdentityReasonCode,
    extras: Partial<JobNameIdentityDiagnostics>
  ): ApplyIdentityPolicyResult => ({
    status: "MATCH",
    preserveCandidates: true,
    selectedJobIdOverride: jobId,
    candidateJobIdsOverride: [jobId],
    diagnostics: diagBase(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      hit,
      assessed ??
        assessIdentityHitStrength(hit),
      [jobId],
      {
        identityStrength: "STRONG",
        strongIdentityAnchor: true,
        resolutionAllowed: true,
        reason,
        ...extras,
      }
    ),
  });

  // --- Contradictory strong project tokens across different Jobs ---
  const projectTokensInHay = [...haySet].filter(
    (t) =>
      isJobNameContentToken(t) &&
      !isCommonConstructionIdentityToken(t) &&
      isWorkspaceRareIdentityToken(normalizeProjectScopeToken(t), workspaceStats)
  );
  // Deduplicate by normalized form; count distinct rare project tokens that
  // map to disjoint Jobs.
  const rareTokenJobs = new Map<string, Set<string>>();
  for (const t of projectTokensInHay) {
    const holders = peers.filter((p) =>
      p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
    );
    if (holders.length !== 1) continue;
    const key = normalizeProjectScopeToken(t);
    const set = rareTokenJobs.get(key) ?? new Set();
    set.add(holders[0]!.jobId);
    rareTokenJobs.set(key, set);
  }
  const distinctRareJobs = new Set<string>();
  for (const set of rareTokenJobs.values()) {
    for (const id of set) distinctRareJobs.add(id);
  }
  if (distinctRareJobs.size > 1) {
    return {
      status: "AMBIGUOUS",
      preserveCandidates: true,
      candidateJobIdsOverride: [...distinctRareJobs],
      diagnostics: diagBase(
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
        hit,
        assessed,
        [...distinctRareJobs],
        {
          identityStrength: "CONFLICTING",
          strongIdentityAnchor: false,
          competingJobIds: [...distinctRareJobs],
          resolutionAllowed: false,
          reason: "CONTRADICTORY_PROJECT_EVIDENCE",
          matchedTerms: projectTokensInHay,
        }
      ),
    };
  }

  // Candidate pool: selected hits, else peers with any hay overlap.
  let poolIds =
    selectedJobIds.length > 0
      ? selectedJobIds
      : peers
          .filter(
            (p) =>
              matchedJobTokensInHay(p.contentTokens, subjectTokens, bodyTokens)
                .length > 0 ||
              p.distinguishingTokens.some((t) =>
                hayHasProjectToken(subjectTokens, bodyTokens, t)
              )
          )
          .map((p) => p.jobId);

  // Also include same-customer / shared-token family of any pool member.
  const poolPeers = peers.filter((p) => poolIds.includes(p.jobId));
  const expanded = new Set(poolIds);
  for (const seed of poolPeers) {
    const family = findIdentityFamilyPeers({
      selectedJobId: seed.jobId,
      matchedContentTokens: matchedJobTokensInHay(
        seed.contentTokens,
        subjectTokens,
        bodyTokens
      ),
      peers,
    });
    for (const id of family.familyJobIds) expanded.add(id);
    expanded.add(seed.jobId);
  }
  poolIds = [...expanded];
  const pool = peers.filter((p) => poolIds.includes(p.jobId));
  if (pool.length === 0) return null;

  // Score each pool Job.
  type GapInfo = {
    run: string[];
    intervening: number;
    contiguous: boolean;
    field: "subject" | "body" | null;
  };
  type Score = {
    peer: IdentityPeerJob;
    matchedContent: string[];
    projectTokens: string[];
    scopeTokens: string[];
    distinguishing: string[];
    gap: GapInfo | null;
    uniqueProject: string[];
    authoritativeUnique: string[];
  };
  const scores: Score[] = pool.map((peer) => {
    const matchedContent = matchedJobTokensInHay(
      peer.contentTokens,
      subjectTokens,
      bodyTokens
    );
    const projectTokens = matchedContent.filter(
      (t) => !isCommonConstructionIdentityToken(t)
    );
    const scopeTokens = matchedContent.filter((t) =>
      isCommonConstructionIdentityToken(t)
    );
    const distinguishing = peer.distinguishingTokens.filter((t) =>
      hayHasProjectToken(subjectTokens, bodyTokens, t)
    );
    let gap: GapInfo | null = null;
    for (const phrase of peer.phraseTokenLists) {
      const g = hasGapTolerantProjectPhraseOverlap({
        matchedContentTokens: matchedContent,
        phraseTokens: phrase,
        subjectTokens,
        bodyTokens,
      });
      if (!g.ok) continue;
      if (
        !gap ||
        g.run.length > gap.run.length ||
        (g.run.length === gap.run.length && g.intervening < gap.intervening)
      ) {
        gap = {
          run: g.run,
          intervening: g.intervening,
          contiguous: g.contiguous,
          field: g.field,
        };
      }
    }
    const uniqueProject = projectTokens.filter((t) =>
      isWorkspaceRareIdentityToken(normalizeProjectScopeToken(t), workspaceStats)
    );
    const authoritativeUnique = uniqueProject.filter((t) =>
      isAuthoritativeUniqueProjectToken(t, peer)
    );
    return {
      peer,
      matchedContent,
      projectTokens,
      scopeTokens,
      distinguishing,
      gap,
      uniqueProject,
      authoritativeUnique,
    };
  });

  // Case: unique gap-tolerant / contiguous project phrase → one Job.
  const phraseWinners = scores.filter((s) => {
    if (!s.gap || s.gap.run.length < 2) return false;
    return s.gap.run.some((t) => !isCommonConstructionIdentityToken(t));
  });
  if (phraseWinners.length === 1) {
    const w = phraseWinners[0]!;
    const competitors = scores.filter(
      (s) =>
        s.peer.jobId !== w.peer.jobId &&
        w.gap!.run.every((t) =>
          s.peer.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
        )
    );
    if (competitors.length === 0) {
      const contiguous = w.gap!.contiguous;
      const reason: JobNameIdentityReasonCode = contiguous
        ? "UNIQUE_PROJECT_PHRASE"
        : "GAP_TOLERANT_PROJECT_MATCH";
      return matchResult(w.peer.jobId, reason, {
        matchedTerms: w.gap!.run,
        distinctiveTerms: w.uniqueProject,
        weakTerms: w.scopeTokens,
        distinguishingIdentityTerms: w.distinguishing,
        evidenceType: contiguous ? "project_phrase" : "gap_tolerant_phrase",
        evidenceField: w.gap!.field,
        tokenDistance: w.gap!.intervening,
        projectTokenUniqueness: "unique",
        normalizationApplied: collectNormalizationApplied(
          w.gap!.run,
          subjectTokens,
          bodyTokens
        ),
      });
    }
  }

  // Feature A (V2.2 only): unique authoritative project token alone is STRONG.
  // Exact normalized token + workspace df=1 + non-generic (+ phrase-head for
  // short tokens). No second token required. Shared tokens do not use this path.
  const rareAlone = scores.filter((s) => s.authoritativeUnique.length > 0);
  if (rareAlone.length === 1 && pool.length === 1) {
    const w = rareAlone[0]!;
    const uniqueInHay = w.authoritativeUnique.filter((t) =>
      hayHasProjectToken(subjectTokens, bodyTokens, t)
    );
    if (uniqueInHay.length > 0) {
      const uniqueInSubject = uniqueInHay.filter((t) =>
        hayHasProjectToken(subjectTokens, [], t)
      );
      const primaryUnique =
        uniqueInSubject.length > 0 ? uniqueInSubject : uniqueInHay;
      const hasScopeSupport =
        w.scopeTokens.length > 0 ||
        (w.gap != null && w.gap.run.length >= 2) ||
        w.distinguishing.length > 0;
      const reason: JobNameIdentityReasonCode = hasScopeSupport
        ? "UNIQUE_TOKEN_SCOPE_MATCH"
        : "UNIQUE_PROJECT_TOKEN";
      let tokenDistance: number | null = null;
      let evidenceField: "subject" | "body" | "mixed" | null =
        uniqueInSubject.length > 0 ? "subject" : "body";
      if (hasScopeSupport && primaryUnique[0] && w.scopeTokens[0]) {
        const span = findGapTolerantHayMatch({
          needles: [primaryUnique[0], w.scopeTokens[0]],
          subjectTokens,
          bodyTokens,
        });
        if (span) {
          tokenDistance = span.intervening;
          evidenceField = span.field;
        }
      }
      return matchResult(w.peer.jobId, reason, {
        matchedTerms: [
          ...primaryUnique,
          ...w.scopeTokens,
          ...w.distinguishing,
        ],
        distinctiveTerms: primaryUnique,
        weakTerms: w.scopeTokens,
        distinguishingIdentityTerms: w.distinguishing,
        evidenceType: "project_token",
        evidenceField,
        tokenDistance,
        projectTokenUniqueness: "unique",
        normalizationApplied: collectNormalizationApplied(
          [...primaryUnique, ...w.scopeTokens],
          subjectTokens,
          bodyTokens
        ),
      });
    }
  }

  // Case: shared project identifier + unique scope / distinguishing among family.
  const withProject = scores.filter((s) => s.projectTokens.length > 0);
  if (withProject.length >= 1) {
    const sharedProjectTerms = new Set<string>();
    for (const s of withProject) {
      for (const t of s.projectTokens) {
        const holders = pool.filter((p) =>
          p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
        );
        if (holders.length > 1) sharedProjectTerms.add(t);
      }
    }

    const disambiguated = scores.filter((s) => {
      const hasShared =
        s.projectTokens.some((t) => sharedProjectTerms.has(t)) ||
        // Same-customer family without shared matched token still counts when
        // multiple pool members share a customer.
        (s.peer.customerId != null &&
          pool.filter((p) => p.customerId === s.peer.customerId).length > 1);
      if (!hasShared && pool.length > 1) {
        // Also allow: unique project among pool + scope
        const uniqueInPool = s.projectTokens.filter(
          (t) =>
            pool.filter((p) =>
              p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
            ).length === 1
        );
        if (uniqueInPool.length === 0 && s.distinguishing.length === 0) {
          return false;
        }
      }
      const scopeUnique =
        s.scopeTokens.length > 0 &&
        s.scopeTokens.every(
          (t) =>
            pool.filter((p) =>
              p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
            ).length === 1
        );
      const distinguishingUnique =
        s.distinguishing.length > 0 &&
        s.distinguishing.every(
          (t) =>
            pool.filter((p) => p.distinguishingTokens.includes(t)).length === 1
        );
      const uniqueProjectInPool = s.projectTokens.some(
        (t) =>
          isAuthoritativeUniqueProjectToken(t, s.peer) &&
          pool.filter((p) =>
            p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
          ).length === 1
      );
      return scopeUnique || distinguishingUnique || uniqueProjectInPool;
    });

    if (disambiguated.length === 1) {
      const w = disambiguated[0]!;
      // Must not be scope-only with zero project signal.
      if (w.projectTokens.length === 0 && w.distinguishing.length === 0) {
        return null;
      }
      // Reject generic-term-only: need project token or distinguishing.
      if (
        w.projectTokens.every((t) => isCommonConstructionIdentityToken(t)) &&
        w.distinguishing.length === 0
      ) {
        return null;
      }
      // Non-authoritative unique mid-phrase tokens (e.g. "ext") cannot resolve alone.
      const hasAuthoritative =
        w.authoritativeUnique.length > 0 ||
        w.distinguishing.length > 0 ||
        (w.scopeTokens.length > 0 &&
          w.projectTokens.some((t) => sharedProjectTerms.has(t)));
      if (!hasAuthoritative) {
        return null;
      }
      let tokenDistance: number | null = null;
      let evidenceField: "subject" | "body" | "mixed" | null = null;
      const sharedLead = [...sharedProjectTerms][0];
      const scopeLead = w.scopeTokens[0] ?? w.distinguishing[0];
      if (sharedLead && scopeLead) {
        const span = findGapTolerantHayMatch({
          needles: [sharedLead, scopeLead],
          subjectTokens,
          bodyTokens,
        });
        if (span) {
          tokenDistance = span.intervening;
          evidenceField = span.field;
        }
      }
      const reason: JobNameIdentityReasonCode =
        w.gap && !w.gap.contiguous
          ? "GAP_TOLERANT_PROJECT_MATCH"
          : "PROJECT_SCOPE_DISAMBIGUATION";
      return matchResult(w.peer.jobId, reason, {
        matchedTerms: [
          ...w.projectTokens,
          ...w.scopeTokens,
          ...w.distinguishing,
        ],
        sharedIdentityTerms: [...sharedProjectTerms],
        distinctiveTerms: w.uniqueProject,
        weakTerms: w.scopeTokens,
        distinguishingIdentityTerms: w.distinguishing,
        identityFamilyJobIds: pool
          .map((p) => p.jobId)
          .filter((id) => id !== w.peer.jobId),
        evidenceType: "project_scope",
        evidenceField,
        tokenDistance,
        projectTokenUniqueness: sharedProjectTerms.size > 0 ? "shared" : "unique",
        normalizationApplied: collectNormalizationApplied(
          [...w.projectTokens, ...w.scopeTokens],
          subjectTokens,
          bodyTokens
        ),
      });
    }

    if (disambiguated.length > 1) {
      // Check contradictory distinguishing
      const withDist = disambiguated.filter((s) => s.distinguishing.length > 0);
      if (withDist.length > 1) {
        return {
          status: "AMBIGUOUS",
          preserveCandidates: true,
          candidateJobIdsOverride: withDist.map((s) => s.peer.jobId),
          diagnostics: diagBase(
            JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
            hit,
            assessed,
            withDist.map((s) => s.peer.jobId),
            {
              identityStrength: "CONFLICTING",
              competingJobIds: withDist.map((s) => s.peer.jobId),
              resolutionAllowed: false,
              reason: "CONTRADICTORY_PROJECT_EVIDENCE",
            }
          ),
        };
      }
    }
  }

  // Case: unique selected Job via distinguishing token (Beltline Building #2)
  // when content match was only a shared/generic project token.
  if (selectedJobIds.length === 1) {
    const selected = scores.find((s) => s.peer.jobId === selectedJobIds[0]);
    if (selected && selected.distinguishing.length > 0) {
      const exclusive = selected.distinguishing.filter(
        (t) =>
          peers.filter((p) => p.distinguishingTokens.includes(t)).length === 1
      );
      if (exclusive.length > 0 && selected.projectTokens.length > 0) {
        // Project token may be shared; distinguishing resolves.
        const siblingsWithSameProject = peers.filter(
          (p) =>
            p.jobId !== selected.peer.jobId &&
            selected.projectTokens.some((t) =>
              p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
            )
        );
        const siblingAlsoDistinguished = siblingsWithSameProject.filter((p) =>
          p.distinguishingTokens.some((t) =>
            hayHasProjectToken(subjectTokens, bodyTokens, t)
          )
        );
        if (siblingAlsoDistinguished.length === 0) {
          return matchResult(
            selected.peer.jobId,
            "PROJECT_SCOPE_DISAMBIGUATION",
            {
              matchedTerms: [
                ...selected.projectTokens,
                ...selected.distinguishing,
              ],
              sharedIdentityTerms: selected.projectTokens.filter((t) =>
                siblingsWithSameProject.some((p) =>
                  p.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
                )
              ),
              distinguishingIdentityTerms: exclusive,
              identityFamilyJobIds: siblingsWithSameProject.map((p) => p.jobId),
              evidenceType: "distinguishing_token",
            }
          );
        }
      }
    }
  }

  return null;
}
