/**
 * Marker 1 identity policy — BASELINE / V1 / V2 / V2.1–V2.4 (experimental).
 *
 * BASELINE: unique OVERLAP may MATCH (historical behavior).
 * CONTEXT_AWARE_V1: unique weak identity must abstain (AMBIGUOUS), not MATCH.
 * CONTEXT_AWARE_V2: V1 + shared-family / generic multiword disambiguation;
 *   weak candidates cleared so they cannot steer Marker 2. Production default.
 * CONTEXT_AWARE_V2_1: independent experiment = current V2 + title-gap rule ONLY
 *   (gap-tolerant ordered project-title matching + shared-id subject/body
 *   disambiguation). Does NOT include unique-token promotion, weak-candidate
 *   preserve, or AUTH contact recovery.
 * CONTEXT_AWARE_V2_2: independent experiment = current V2 + unique project token
 *   rule ONLY. Does NOT include title-gap matching or V2.1-only contact deltas.
 * CONTEXT_AWARE_V2_3: independent experiment = current V2 + normalized subject
 *   identity ONLY (abbreviations, controlled compounds, subject>body precedence).
 *   Does NOT inherit V2.1 title-gap or V2.2 unique-token promotion.
 * CONTEXT_AWARE_V2_4: frozen experiment = V2 + full-body + contextual word
 *   search + attachment identity + descriptor compound numerics. Does NOT
 *   include V3 unique-term / family-scoped #N matching, or V2.1–V2.3 recoveries.
 * CONTEXT_AWARE_V3: independent experiment = V2.4 baseline + dynamic word
 *   importance + family-scoped numeric (Beltline #3). Not production.
 *
 * V2.1 / V2.2 / V2.3 / V2.4 / V3 each branch from V2 independently (not cumulative).
 */

import {
  isDistinguishingJobNameToken,
  isJobNameContentToken,
  phraseContained,
} from "./job-name-normalize.js";
import {
  resolveContextualWordSearch,
  type ContextualWordSearchAiDecision,
} from "./job-contextual-word-search.js";
import {
  buildProjectIdentityVocabulary,
  distinctiveProjectIdentityTermsInHay,
  extractProjectIdentityTerms,
  hayContainsAllProjectIdentityTerms,
  joinPoolAwareCompoundTokens,
  projectIdentityTokensEquivalent,
} from "./job-project-identity-normalize.js";
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
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3 =
  "CONTEXT_AWARE_V2_3" as const;
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4 =
  "CONTEXT_AWARE_V2_4" as const;
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3 =
  "CONTEXT_AWARE_V3" as const;

export type JobMatchIdentityPolicy =
  | typeof JOB_MATCH_IDENTITY_POLICY_BASELINE
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3;

export const DEFAULT_JOB_MATCH_IDENTITY_POLICY: JobMatchIdentityPolicy =
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2;

/**
 * Implementation revision for experimental V2.1–V2.3 semantics.
 * Older eval payloads without this field used prior algorithms under the same
 * CONTEXT_AWARE_V2_* labels — treat those as legacy.
 * V2.4 uses JOB_MATCH_V2_4_IMPLEMENTATION_REVISION separately so V2.1–V2.3
 * historical stamps remain valid when only V2.4 changes.
 */
export const JOB_MATCH_IDENTITY_EXPERIMENT_REVISION =
  "independent-v23-normalized-subject-identity-r1" as const;

/**
 * Frozen V2.4 algorithm: full-body + attachment + contextual word search +
 * descriptor compound numerics (Building 3 → building:3). Does not include
 * dynamic unique-term promotion or family-scoped Beltline #N matching.
 */
export const JOB_MATCH_V2_4_IMPLEMENTATION_REVISION =
  "V2_4_COMPOUND_NUMERIC_IDENTITY_R1" as const;

/**
 * Brief V2.4 stamp used while dynamic word importance lived under V2.4 before
 * promotion to V3 — historical evals remain viewable; do not re-run as current.
 */
export const JOB_MATCH_V2_4_PRIOR_DYNAMIC_WORD_IMPORTANCE_REVISION =
  "V2_4_DYNAMIC_WORD_IMPORTANCE_R1" as const;

/** Prior V2.4 full-body + attachment identity revision (historical). */
export const JOB_MATCH_V2_4_PRIOR_FULL_BODY_ATTACHMENT_REVISION =
  "V2_4_FULL_BODY_ATTACHMENT_IDENTITY_R1" as const;

/** First V2.4 contextual-word-search-only revision (historical). */
export const JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION =
  "V2_4_CONTEXTUAL_WORD_SEARCH" as const;

/** Label for any prior V2.4 implementation stored under the same policy id. */
export const JOB_MATCH_V2_4_LEGACY_IMPLEMENTATION_REVISION =
  "V2_4_LEGACY" as const;

/** Attachment text / title-block extraction pipeline revision (eval metadata). */
export const JOB_MATCH_V2_4_ATTACHMENT_EXTRACTION_REVISION =
  "attachment-identity-extract-r1" as const;

/**
 * Current V3 algorithm: V2.4 compound-numeric baseline + dynamic word
 * importance + family-scoped numeric (Beltline #3).
 */
export const JOB_MATCH_V3_IMPLEMENTATION_REVISION =
  "V3_DYNAMIC_WORD_IMPORTANCE_R1" as const;

export type JobMatchIdentityExperimentRevision =
  | typeof JOB_MATCH_IDENTITY_EXPERIMENT_REVISION
  | typeof JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
  | typeof JOB_MATCH_V3_IMPLEMENTATION_REVISION;

/** Experiment revision stamped on eval bundles for a given policy. */
export function experimentRevisionForIdentityPolicy(
  policy: JobMatchIdentityPolicy
): string | null {
  if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3) {
    return JOB_MATCH_V3_IMPLEMENTATION_REVISION;
  }
  if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4) {
    return JOB_MATCH_V2_4_IMPLEMENTATION_REVISION;
  }
  if (
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3
  ) {
    return JOB_MATCH_IDENTITY_EXPERIMENT_REVISION;
  }
  return null;
}

/** True for experimental policies that share V2.4 contextual recovery plumbing. */
export function isContextualWordSearchPolicy(
  policy: JobMatchIdentityPolicy
): boolean {
  return (
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3
  );
}

/** V3-only: unique title terms + family-scoped #N matching. */
export function contextualWordSearchFeatureOptions(
  policy: JobMatchIdentityPolicy
): {
  enableUniqueProjectTerms: boolean;
  enableFamilyScopedNumeric: boolean;
} {
  const v3 = policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3;
  return {
    enableUniqueProjectTerms: v3,
    enableFamilyScopedNumeric: v3,
  };
}

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
  | "CONTRADICTORY_PROJECT_EVIDENCE"
  /**
   * V2.1: title-gap match authorized by title terms that distinguish one Job
   * among peers sharing a project identifier.
   */
  | "DISTINGUISHING_TITLE_EVIDENCE"
  /**
   * V2.1: shared project identifier present without sufficient distinguishing
   * title evidence for a confident assignment.
   */
  | "INSUFFICIENT_DISAMBIGUATION"
  /**
   * V2.1: email contains distinguishing title evidence for multiple competing
   * Jobs that share a project identifier.
   */
  | "COMPETING_TITLE_EVIDENCE"
  /**
   * V2.1: shared project identifier in subject; unique distinguishing Job term
   * found in the current message body (not quoted history).
   */
  | "UNIQUE_BODY_DISAMBIGUATION"
  /**
   * V2.3: normalized subject fully identifies one eligible Job.
   */
  | "NORMALIZED_SUBJECT_IDENTITY"
  /** V2.3: controlled abbreviation equivalence contributed to the match. */
  | "ABBREVIATION_EQUIVALENCE"
  /** V2.3: controlled compound / alias normalization contributed to the match. */
  | "PROJECT_ALIAS_NORMALIZATION"
  /** V2.3: multiple Jobs remain plausible after normalized subject analysis. */
  | "COMPETING_PROJECT_CANDIDATES"
  /** V2.3: body mention existed but was treated as incidental vs subject. */
  | "INCIDENTAL_BODY_REFERENCE"
  /** V2.3: body explicitly contradicts the subject identity. */
  | "EXPLICIT_BODY_CONTRADICTION"
  /** V2.3: shared family without enough distinguishing subject evidence. */
  | "INSUFFICIENT_DISTINGUISHING_EVIDENCE"
  /** V2.3: subject carries distinctive terms that uniquely identify one Job. */
  | "DISTINCTIVE_SUBJECT_TERMS"
  /** V2.4: contextual word search uniquely resolved a shared-family Job. */
  | "CONTEXTUAL_WORD_SEARCH_MATCH"
  /** V2.4: contextual word search found competing distinguishing references. */
  | "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS"
  /** V2.4: contextual word search found conflicting project references. */
  | "CONTEXTUAL_WORD_SEARCH_CONFLICT"
  /** V2.4: validated AI contextual disambiguation selected a candidate. */
  | "AI_CONTEXTUAL_DISAMBIGUATION"
  /** V2.4: AI abstained or validation rejected the AI decision. */
  | "AI_CONTEXTUAL_ABSTENTION"
  /** V2.4: distinguishing term was negated in context. */
  | "NEGATED_PROJECT_REFERENCE"
  /** V2.4: body mention treated as incidental vs stronger subject/current work. */
  | "INCIDENTAL_PROJECT_REFERENCE"
  /** V2.4: explicit correction language triggered conservative abstention. */
  | "EXPLICIT_PROJECT_CORRECTION"
  /** V2.4: unique eligible project name/alias in current body (no subject id required). */
  | "FULL_BODY_PROJECT_IDENTITY"
  /** V2.4: attachment identity uniquely resolved a Job. */
  | "ATTACHMENT_IDENTITY_MATCH"
  /** V2.4: attachment identity competing / unresolved. */
  | "ATTACHMENT_IDENTITY_AMBIGUOUS"
  /** V2.4: subject/body vs attachment project conflict. */
  | "ATTACHMENT_IDENTITY_CONFLICT"
  /** V2.4: attachments present but extraction pending/unavailable. */
  | "ATTACHMENT_EXTRACTION_UNAVAILABLE"
  /** V2.4: contradictory compound numeric identities (e.g. Building 1 vs Building 2). */
  | "NUMERIC_IDENTITY_CONFLICT"
  /** V2.4: compound numeric identifier contributed to the match. */
  | "COMPOUND_NUMERIC_IDENTITY"
  /** V2.4: standalone number ignored as identity evidence. */
  | "STANDALONE_NUMBER_IGNORED"
  /** V2.4: descriptor alias normalized into a compound key. */
  | "NUMERIC_DESCRIPTOR_NORMALIZED"
  /** V2.4: family word + component number (Beltline #3). */
  | "FAMILY_NUMERIC_IDENTITY"
  /** V2.4: unique title term identified one Job (Nova → Nova Classical). */
  | "SINGLE_WORD_PROJECT_IDENTITY"
  /** V2.4: candidate-relative unique project term evidence. */
  | "UNIQUE_PROJECT_TERM"
  /** V2.4: shared project-family identifier without disambiguation. */
  | "SHARED_PROJECT_FAMILY"
  /** V2.4: dynamic word-importance classification recorded. */
  | "DYNAMIC_WORD_IMPORTANCE"
  /** V2.4: generic/weak term suppressed as independent identity. */
  | "GENERIC_TERM_SUPPRESSED";

export type CompoundNumericIdentityDiagnostic = {
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

export type WordImportanceIdentityDiagnostic = {
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
  /** V2.4: whether contextual AI was invoked for this decision. */
  contextualAiInvoked?: boolean;
  /** V2.4: whether contextual layer changed the V2 baseline decision. */
  contextualChangedBaseline?: boolean;
  /** V2.4: compound numeric identity diagnostics (not every unrelated digit). */
  compoundNumericDiagnostics?: CompoundNumericIdentityDiagnostic[];
  /** V2.4: dynamic word-importance diagnostics. */
  wordImportanceDiagnostics?: WordImportanceIdentityDiagnostic[];
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
 * Tokens that must not independently resolve competing Jobs that share a
 * project identifier (V2.1 title-gap disambiguation). Scope words like
 * "stairs" / "concessions" are intentionally excluded — they can distinguish
 * sibling Jobs even when they are common construction vocabulary.
 */
export const WEAK_TITLE_DISAMBIGUATION_TOKENS = new Set([
  "steel",
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
  "structural",
]);

export function isWeakTitleDisambiguationToken(token: string): boolean {
  const norm = normalizeProjectScopeToken(token);
  return (
    WEAK_TITLE_DISAMBIGUATION_TOKENS.has(token) ||
    WEAK_TITLE_DISAMBIGUATION_TOKENS.has(norm)
  );
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
  /**
   * Optional pre-validated AI decision for V2.4 contextual word search.
   * Produced outside @forgeops/shared (API / AI package); never invents Jobs.
   */
  contextualAiDecision?: ContextualWordSearchAiDecision | null;
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
    const noMatchResult: ApplyIdentityPolicyResult = {
      status: "NO_MATCH",
      preserveCandidates: false,
      diagnostics: emptyDiagnostics(policy, status, selectedJobIds),
    };
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3) {
      const recovered = tryNormalizedSubjectIdentityRecovery({
        input,
        assessed: null,
        selectedJobIds,
        priorReason: "NO_IDENTITY",
      });
      if (recovered) return recovered;
    }
    if (isContextualWordSearchPolicy(policy)) {
      const recovered = tryContextualWordSearchRecovery({
        input,
        assessed: null,
        selectedJobIds,
        priorReason: "NO_IDENTITY",
        policyId: policy,
      });
      if (recovered) return recovered;
    }
    return noMatchResult;
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
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1) {
      const recovered = tryTitleGapProjectRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: ambiguousResult.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(ambiguousResult, input);
    }
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2) {
      const recovered = tryUniqueProjectTokenRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: ambiguousResult.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(ambiguousResult, input);
    }
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3) {
      const recovered = tryNormalizedSubjectIdentityRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: ambiguousResult.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(ambiguousResult, input);
    }
    if (isContextualWordSearchPolicy(policy)) {
      const recovered = tryContextualWordSearchRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: ambiguousResult.diagnostics.reason,
        policyId: policy,
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

  // CONTEXT_AWARE_V2 / V2.1–V2.4 — shared V2 gates; experiments add one rule each.
  // Experiments clear weak candidates (identical to production V2).
  if (
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3
  ) {
    const v2Result = applyContextAwareV2IdentityPolicy({
      input,
      assessed,
      selectedJobIds,
      preserveWeakCandidates: false,
      policyId: policy,
    });
    if (v2Result.status === "MATCH") {
      // V2.4 / V3: preserve strong V2 identity; shadow contextual diagnostics only.
      if (isContextualWordSearchPolicy(policy)) {
        return annotateContextualShadowOnStrongV2Match(v2Result, input, policy);
      }
      return v2Result;
    }
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1) {
      const recovered = tryTitleGapProjectRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: v2Result.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(v2Result, input);
    }
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2) {
      const recovered = tryUniqueProjectTokenRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: v2Result.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(v2Result, input);
    }
    if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3) {
      const recovered = tryNormalizedSubjectIdentityRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: v2Result.diagnostics.reason,
      });
      if (recovered) return recovered;
      return annotateSharedProjectIdentifier(v2Result, input);
    }
    if (isContextualWordSearchPolicy(policy)) {
      const recovered = tryContextualWordSearchRecovery({
        input,
        assessed,
        selectedJobIds,
        priorReason: v2Result.diagnostics.reason,
        policyId: policy,
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
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3;
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

type ProjectIdentityGapInfo = {
  run: string[];
  intervening: number;
  contiguous: boolean;
  field: "subject" | "body" | null;
};

type ProjectIdentityScore = {
  peer: IdentityPeerJob;
  matchedContent: string[];
  projectTokens: string[];
  scopeTokens: string[];
  distinguishing: string[];
  gap: ProjectIdentityGapInfo | null;
  uniqueProject: string[];
  authoritativeUnique: string[];
};

type ProjectIdentityRecoveryContext = {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
  hit: NonNullable<ApplyIdentityPolicyInput["hit"]>;
  peers: IdentityPeerJob[];
  subjectTokens: string[];
  bodyTokens: string[];
  pool: IdentityPeerJob[];
  scores: ProjectIdentityScore[];
};

function buildProjectIdentityRecoveryContext(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
}): ProjectIdentityRecoveryContext | null {
  const { input, assessed, selectedJobIds } = args;
  const hit = input.hit;
  if (!hit) return null;

  const peers = input.peerJobs ?? [];
  const subjectTokens = input.subjectTokens ?? hit.subjectTokens;
  const bodyTokens = input.bodyTokens ?? hit.bodyTokens;
  const workspaceStats = hit.workspaceStats;

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

  const scores: ProjectIdentityScore[] = pool.map((peer) => {
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
    let gap: ProjectIdentityGapInfo | null = null;
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

  return {
    input,
    assessed,
    selectedJobIds,
    hit,
    peers,
    subjectTokens,
    bodyTokens,
    pool,
    scores,
  };
}

function contradictoryProjectEvidenceResult(
  ctx: ProjectIdentityRecoveryContext,
  policyId:
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2
): ApplyIdentityPolicyResult | null {
  const { hit, assessed, peers, subjectTokens, bodyTokens } = ctx;
  const haySet = new Set([...subjectTokens, ...bodyTokens]);
  const workspaceStats = hit.workspaceStats;
  const projectTokensInHay = [...haySet].filter(
    (t) =>
      isJobNameContentToken(t) &&
      !isCommonConstructionIdentityToken(t) &&
      isWorkspaceRareIdentityToken(normalizeProjectScopeToken(t), workspaceStats)
  );
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
  if (distinctRareJobs.size <= 1) return null;
  return {
    status: "AMBIGUOUS",
    preserveCandidates: true,
    candidateJobIdsOverride: [...distinctRareJobs],
    diagnostics: diagBase(policyId, hit, assessed, [...distinctRareJobs], {
      identityStrength: "CONFLICTING",
      strongIdentityAnchor: false,
      competingJobIds: [...distinctRareJobs],
      resolutionAllowed: false,
      reason: "CONTRADICTORY_PROJECT_EVIDENCE",
      matchedTerms: projectTokensInHay,
    }),
  };
}

function experimentalMatchResult(
  ctx: ProjectIdentityRecoveryContext,
  policyId:
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
    | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  jobId: string,
  reason: JobNameIdentityReasonCode,
  extras: Partial<JobNameIdentityDiagnostics>
): ApplyIdentityPolicyResult {
  const assessed = ctx.assessed ?? assessIdentityHitStrength(ctx.hit);
  return {
    status: "MATCH",
    preserveCandidates: true,
    selectedJobIdOverride: jobId,
    candidateJobIdsOverride: [jobId],
    diagnostics: diagBase(policyId, ctx.hit, assessed, [jobId], {
      identityStrength: "STRONG",
      strongIdentityAnchor: true,
      resolutionAllowed: true,
      reason,
      ...extras,
    }),
  };
}

/**
 * Project identifiers shared by ≥2 pool peers (non-construction, non-weak).
 */
function sharedProjectIdentifiersAmongPeers(
  peers: readonly IdentityPeerJob[]
): string[] {
  const freq = new Map<string, { token: string; count: number }>();
  for (const peer of peers) {
    const seen = new Set<string>();
    for (const t of peer.contentTokens) {
      if (!isJobNameContentToken(t)) continue;
      if (isCommonConstructionIdentityToken(t)) continue;
      if (isWeakTitleDisambiguationToken(t)) continue;
      const key = normalizeProjectScopeToken(t);
      if (seen.has(key)) continue;
      seen.add(key);
      const prev = freq.get(key);
      if (prev) prev.count += 1;
      else freq.set(key, { token: t, count: 1 });
    }
  }
  return [...freq.values()].filter((v) => v.count > 1).map((v) => v.token);
}

/**
 * Job content tokens that distinguish `peer` from other competitors sharing a
 * project identifier. Weak generics never count — even when unique to one Job.
 */
export function distinguishingTermsForPeer(input: {
  peer: IdentityPeerJob;
  competitors: readonly IdentityPeerJob[];
  sharedIdentifiers: readonly string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of input.peer.contentTokens) {
    if (!isJobNameContentToken(t)) continue;
    if (isWeakTitleDisambiguationToken(t)) continue;
    if (
      input.sharedIdentifiers.some((s) => projectTokensEquivalent(s, t))
    ) {
      continue;
    }
    const onOther = input.competitors.some(
      (c) =>
        c.jobId !== input.peer.jobId &&
        c.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
    );
    if (onOther) continue;
    const key = normalizeProjectScopeToken(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Title terms in a gap run that distinguish `peer` from other competitors
 * sharing a project identifier. Weak generics (steel, project, update, …)
 * never count — even when unique to one Job.
 */
export function distinguishingTitleEvidenceInRun(input: {
  run: readonly string[];
  peer: IdentityPeerJob;
  competitors: readonly IdentityPeerJob[];
  sharedIdentifiers: readonly string[];
}): string[] {
  const allowed = new Set(
    distinguishingTermsForPeer({
      peer: input.peer,
      competitors: input.competitors,
      sharedIdentifiers: input.sharedIdentifiers,
    }).map((t) => normalizeProjectScopeToken(t))
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of input.run) {
    const key = normalizeProjectScopeToken(t);
    if (!allowed.has(key)) continue;
    if (seen.has(key)) continue;
    // Retain the surface form from the run when equivalent.
    if (
      !input.peer.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
    ) {
      continue;
    }
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Lightweight negation check: "not … concessions" / "no concessions" within a
 * short left window. Intentionally narrow — abstain rather than over-parse.
 */
export function isTokenNegatedInHay(
  hay: readonly string[],
  tokenIndex: number
): boolean {
  if (tokenIndex < 0 || tokenIndex >= hay.length) return false;
  const start = Math.max(0, tokenIndex - 4);
  const window = hay.slice(start, tokenIndex);
  if (window.some((t) => t === "not" || t === "no")) return true;
  // "aren't" / "isnt" style tokens after normalization may appear as "arent" /
  // "isnt" depending on tokenizer — treat common forms as negation cues.
  if (window.some((t) => t === "arent" || t === "isnt" || t === "wasnt")) {
    return true;
  }
  return false;
}

/**
 * Locate distinguishing peer terms in subject and/or body (whole-token,
 * inflection-aware). Negated body hits are ignored.
 */
export function findDistinguishingEvidenceInFields(input: {
  peer: IdentityPeerJob;
  competitors: readonly IdentityPeerJob[];
  sharedIdentifiers: readonly string[];
  subjectTokens: readonly string[];
  bodyTokens: readonly string[];
}): {
  terms: string[];
  subjectTerms: string[];
  bodyTerms: string[];
  evidenceField: "subject" | "body" | "mixed" | null;
} {
  const candidates = distinguishingTermsForPeer({
    peer: input.peer,
    competitors: input.competitors,
    sharedIdentifiers: input.sharedIdentifiers,
  });
  const subjectTerms: string[] = [];
  const bodyTerms: string[] = [];
  const seenSubject = new Set<string>();
  const seenBody = new Set<string>();

  for (const term of candidates) {
    for (let i = 0; i < input.subjectTokens.length; i += 1) {
      if (!projectTokensEquivalent(input.subjectTokens[i]!, term)) continue;
      const key = normalizeProjectScopeToken(term);
      if (seenSubject.has(key)) continue;
      seenSubject.add(key);
      subjectTerms.push(term);
      break;
    }
    for (let i = 0; i < input.bodyTokens.length; i += 1) {
      if (!projectTokensEquivalent(input.bodyTokens[i]!, term)) continue;
      if (isTokenNegatedInHay(input.bodyTokens, i)) continue;
      const key = normalizeProjectScopeToken(term);
      if (seenBody.has(key)) continue;
      seenBody.add(key);
      bodyTerms.push(term);
      break;
    }
  }

  const terms = [...new Set([...subjectTerms, ...bodyTerms])];
  let evidenceField: "subject" | "body" | "mixed" | null = null;
  if (subjectTerms.length > 0 && bodyTerms.length > 0) evidenceField = "mixed";
  else if (subjectTerms.length > 0) evidenceField = "subject";
  else if (bodyTerms.length > 0) evidenceField = "body";

  return { terms, subjectTerms, bodyTerms, evidenceField };
}

function titleGapAmbiguousResult(
  ctx: ProjectIdentityRecoveryContext,
  reason: JobNameIdentityReasonCode,
  extras: Partial<JobNameIdentityDiagnostics>
): ApplyIdentityPolicyResult {
  const assessed = ctx.assessed ?? assessIdentityHitStrength(ctx.hit);
  const competing =
    extras.competingJobIds ??
    ctx.pool.map((p) => p.jobId);
  return {
    status: "AMBIGUOUS",
    preserveCandidates: true,
    candidateJobIdsOverride: competing,
    diagnostics: diagBase(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      ctx.hit,
      assessed,
      competing,
      {
        identityStrength:
          reason === "COMPETING_TITLE_EVIDENCE" ? "CONFLICTING" : "AMBIGUOUS",
        strongIdentityAnchor: false,
        resolutionAllowed: false,
        reason,
        competingJobIds: competing,
        projectTokenUniqueness: "shared",
        ...extras,
      }
    ),
  };
}

/**
 * Lightweight explicit contradiction: body negates subject-winner distinctive
 * terms while positively naming a competing Job's exclusive terms.
 */
function hasExplicitNormalizedBodyContradiction(input: {
  subjectWinnerTerms: readonly string[];
  distinctiveWinnerTerms: readonly string[];
  bodyTokens: readonly string[];
  competingPeerTerms: readonly string[];
}): boolean {
  const body = input.bodyTokens;
  if (body.length === 0) return false;
  const competingInBody = input.competingPeerTerms.filter((t) =>
    body.some((h) => projectIdentityTokensEquivalent(h, t))
  );
  if (competingInBody.length === 0) return false;
  // Require negation near at least one distinctive winner term.
  let negatedWinner = false;
  for (let i = 0; i < body.length; i += 1) {
    const tok = body[i]!;
    if (
      !input.distinctiveWinnerTerms.some((t) =>
        projectIdentityTokensEquivalent(t, tok)
      )
    ) {
      continue;
    }
    if (isTokenNegatedInHay(body, i)) {
      negatedWinner = true;
      break;
    }
  }
  if (!negatedWinner) return false;
  // Soft cue words often accompany corrections.
  const correctionCue = body.some((t) =>
    ["correction", "actually", "instead", "wrong"].includes(t)
  );
  return correctionCue || competingInBody.length > 0;
}

/**
 * Strong V2 MATCH under V2.4 / V3: keep the V2 decision; attach shadow contextual
 * diagnostics when the word-search layer sees competing/shared family signals.
 */
function annotateContextualShadowOnStrongV2Match(
  v2Result: ApplyIdentityPolicyResult,
  input: ApplyIdentityPolicyInput,
  policyId: JobMatchIdentityPolicy
): ApplyIdentityPolicyResult {
  const peers = input.peerJobs ?? [];
  const subjectTokens = input.subjectTokens ?? [];
  const bodyTokens = input.bodyTokens ?? [];
  if (peers.length === 0 || (subjectTokens.length === 0 && bodyTokens.length === 0)) {
    return {
      ...v2Result,
      diagnostics: {
        ...v2Result.diagnostics,
        contextualAiInvoked: false,
        contextualChangedBaseline: false,
      },
    };
  }
  const shadow = resolveContextualWordSearch({
    peers,
    subjectTokens,
    bodyTokens,
    aiDecision: input.contextualAiDecision ?? null,
    features: contextualWordSearchFeatureOptions(policyId),
  });
  const competingShadow =
    shadow.status === "AMBIGUOUS" ||
    shadow.status === "CONFLICT" ||
    (shadow.status === "MATCH" &&
      shadow.selectedJobId != null &&
      shadow.selectedJobId !== v2Result.selectedJobIdOverride &&
      shadow.selectedJobId !== input.selectedJobIds[0]);
  return {
    ...v2Result,
    diagnostics: {
      ...v2Result.diagnostics,
      sharedIdentityTerms:
        shadow.sharedIdentifiers.length > 0
          ? shadow.sharedIdentifiers
          : v2Result.diagnostics.sharedIdentityTerms,
      identityFamilyJobIds:
        shadow.familyJobIds.length > 0
          ? shadow.familyJobIds
          : v2Result.diagnostics.identityFamilyJobIds,
      contextualAiInvoked: shadow.aiInvoked,
      contextualChangedBaseline: false,
      ...(competingShadow
        ? {
            evidenceType:
              v2Result.diagnostics.evidenceType ?? "contextual_word_search_shadow",
          }
        : {}),
    },
  };
}

/**
 * CONTEXT_AWARE_V2_4 / V3 — contextual word search recovery.
 * Does not inherit V2.1 title-gap, V2.2 unique-token, or V2.3 normalized-subject.
 * V3 enables unique-term + family-scoped numeric via feature options.
 */
export function tryContextualWordSearchRecovery(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
  priorReason: JobNameIdentityReasonCode;
  policyId: JobMatchIdentityPolicy;
}): ApplyIdentityPolicyResult | null {
  const peers = args.input.peerJobs ?? [];
  if (peers.length === 0) return null;
  const subjectTokens = args.input.subjectTokens ?? [];
  const bodyTokens = args.input.bodyTokens ?? [];
  if (subjectTokens.length === 0 && bodyTokens.length === 0) return null;

  const policyId = isContextualWordSearchPolicy(args.policyId)
    ? args.policyId
    : JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4;

  const resolved = resolveContextualWordSearch({
    peers,
    subjectTokens,
    bodyTokens,
    aiDecision: args.input.contextualAiDecision ?? null,
    features: contextualWordSearchFeatureOptions(policyId),
  });
  if (!resolved.status || !resolved.reason) return null;

  const distinguishingFlat = Object.values(resolved.distinguishingByJob).flat();

  if (resolved.status === "MATCH" && resolved.selectedJobId) {
    return {
      status: "MATCH",
      preserveCandidates: true,
      selectedJobIdOverride: resolved.selectedJobId,
      candidateJobIdsOverride: [resolved.selectedJobId],
      diagnostics: diagBase(
        policyId,
        args.input.hit,
        args.assessed,
        [resolved.selectedJobId],
        {
          identityStrength: "STRONG",
          strongIdentityAnchor: true,
          resolutionAllowed: true,
          reason: resolved.reason,
          matchedTerms: resolved.matchedTerms,
          distinguishingIdentityTerms: distinguishingFlat.filter((t) =>
            resolved.matchedTerms.some((m) =>
              projectTokensEquivalent(m, t) || m === t
            )
          ),
          sharedIdentityTerms: resolved.sharedIdentifiers,
          identityFamilyJobIds: resolved.familyJobIds,
          competingJobIds: resolved.competingJobIds,
          evidenceType: "contextual_word_search",
          evidenceField: resolved.evidenceField,
          projectTokenUniqueness:
            resolved.sharedIdentifiers.length > 0 ? "shared" : "unique",
          contextualAiInvoked: resolved.aiInvoked,
          contextualChangedBaseline: resolved.changedBaseline,
          ...(resolved.compoundNumericDiagnostics?.length
            ? {
                compoundNumericDiagnostics:
                  resolved.compoundNumericDiagnostics,
              }
            : {}),
          ...(resolved.wordImportanceDiagnostics?.length
            ? {
                wordImportanceDiagnostics:
                  resolved.wordImportanceDiagnostics,
              }
            : {}),
        }
      ),
    };
  }

  return {
    status: "AMBIGUOUS",
    preserveCandidates: true,
    candidateJobIdsOverride:
      resolved.competingJobIds.length > 0
        ? resolved.competingJobIds
        : resolved.familyJobIds,
    diagnostics: diagBase(
      policyId,
      args.input.hit,
      args.assessed,
      resolved.competingJobIds.length > 0
        ? resolved.competingJobIds
        : resolved.familyJobIds,
      {
        identityStrength:
          resolved.reason === "CONTEXTUAL_WORD_SEARCH_CONFLICT" ||
          resolved.reason === "NUMERIC_IDENTITY_CONFLICT"
            ? "CONFLICTING"
            : "AMBIGUOUS",
        strongIdentityAnchor: false,
        resolutionAllowed: false,
        reason: resolved.reason,
        matchedTerms: resolved.matchedTerms,
        sharedIdentityTerms: resolved.sharedIdentifiers,
        distinguishingIdentityTerms: distinguishingFlat,
        identityFamilyJobIds: resolved.familyJobIds,
        competingJobIds:
          resolved.competingJobIds.length > 0
            ? resolved.competingJobIds
            : resolved.familyJobIds,
        evidenceType: "contextual_word_search",
        evidenceField: resolved.evidenceField,
        projectTokenUniqueness: "shared",
        contextualAiInvoked: resolved.aiInvoked,
        contextualChangedBaseline: resolved.changedBaseline,
        ...(resolved.compoundNumericDiagnostics?.length
          ? {
              compoundNumericDiagnostics:
                resolved.compoundNumericDiagnostics,
            }
          : {}),
        ...(resolved.wordImportanceDiagnostics?.length
          ? {
              wordImportanceDiagnostics:
                resolved.wordImportanceDiagnostics,
            }
          : {}),
      }
    ),
  };
}

/**
 * CONTEXT_AWARE_V2_3 — normalized subject identity recovery ONLY.
 * Does not apply V2.1 title-gap or V2.2 unique-token promotion.
 * Subject evidence outranks incidental body mentions; explicit contradictions abstain.
 */
export function tryNormalizedSubjectIdentityRecovery(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
  priorReason: JobNameIdentityReasonCode;
}): ApplyIdentityPolicyResult | null {
  const peers = args.input.peerJobs ?? [];
  if (peers.length === 0) return null;

  const vocab = buildProjectIdentityVocabulary(
    peers.flatMap((p) => p.phraseTokenLists)
  );
  const subjectRaw = args.input.subjectTokens ?? [];
  const bodyRaw = args.input.bodyTokens ?? [];
  const subjectNorm = joinPoolAwareCompoundTokens(subjectRaw, vocab);
  const bodyNorm = joinPoolAwareCompoundTokens(bodyRaw, vocab);
  const subjectHay = subjectNorm.tokens;
  const bodyHay = bodyNorm.tokens;
  if (subjectHay.length === 0 && bodyHay.length === 0) return null;

  type PeerCoverage = {
    peer: IdentityPeerJob;
    identityTerms: string[];
    subjectComplete: boolean;
    bodyComplete: boolean;
    distinctiveInSubject: string[];
    distinctiveInBody: string[];
  };

  const coverages: PeerCoverage[] = peers.map((peer) => {
    const phrase =
      peer.phraseTokenLists.find((p) => p.length > 0) ?? peer.contentTokens;
    const identityTerms = extractProjectIdentityTerms(phrase);
    const competitorTerms = peers
      .filter((p) => p.jobId !== peer.jobId)
      .map((p) =>
        extractProjectIdentityTerms(
          p.phraseTokenLists.find((x) => x.length > 0) ?? p.contentTokens
        )
      );
    return {
      peer,
      identityTerms,
      subjectComplete: hayContainsAllProjectIdentityTerms(
        subjectHay,
        identityTerms
      ),
      bodyComplete: hayContainsAllProjectIdentityTerms(bodyHay, identityTerms),
      distinctiveInSubject: distinctiveProjectIdentityTermsInHay({
        peerTerms: identityTerms,
        competitorTerms,
        hay: subjectHay,
      }),
      distinctiveInBody: distinctiveProjectIdentityTermsInHay({
        peerTerms: identityTerms,
        competitorTerms,
        hay: bodyHay,
      }),
    };
  });

  const subjectWinners = coverages.filter(
    (c) => c.subjectComplete && c.identityTerms.length >= 2
  );

  const normalizationApplied = [
    ...subjectNorm.compoundsJoined.map((c) => `compound:${c}`),
    ...bodyNorm.compoundsJoined.map((c) => `compound:${c}`),
  ];

  const sharedIdentityTerms = (() => {
    const freq = new Map<string, number>();
    for (const c of coverages) {
      const seen = new Set<string>();
      for (const t of c.identityTerms) {
        if (seen.has(t)) continue;
        seen.add(t);
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    return [...freq.entries()].filter(([, n]) => n >= 2).map(([t]) => t);
  })();

  const familyJobIds = coverages
    .filter((c) =>
      c.identityTerms.some((t) =>
        sharedIdentityTerms.some((s) => projectIdentityTokensEquivalent(s, t))
      )
    )
    .map((c) => c.peer.jobId);

  const finishAmbiguous = (
    reason: JobNameIdentityReasonCode,
    extras: Partial<JobNameIdentityDiagnostics>
  ): ApplyIdentityPolicyResult => ({
    status: "AMBIGUOUS",
    preserveCandidates: true,
    candidateJobIdsOverride:
      extras.competingJobIds ??
      (familyJobIds.length > 0 ? familyJobIds : peers.map((p) => p.jobId)),
    diagnostics: diagBase(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
      args.input.hit,
      args.assessed,
      extras.competingJobIds ??
        (familyJobIds.length > 0 ? familyJobIds : peers.map((p) => p.jobId)),
      {
        identityStrength: "AMBIGUOUS",
        strongIdentityAnchor: false,
        resolutionAllowed: false,
        reason,
        sharedIdentityTerms,
        identityFamilyJobIds: familyJobIds,
        evidenceField: "subject",
        ...(normalizationApplied.length > 0
          ? { normalizationApplied }
          : {}),
        ...extras,
      }
    ),
  });

  if (subjectWinners.length > 1) {
    return finishAmbiguous("COMPETING_PROJECT_CANDIDATES", {
      competingJobIds: subjectWinners.map((c) => c.peer.jobId),
      distinguishingIdentityTerms: subjectWinners.flatMap(
        (c) => c.distinctiveInSubject
      ),
      matchedTerms: subjectWinners.flatMap((c) => c.identityTerms),
    });
  }

  if (subjectWinners.length === 1) {
    const winner = subjectWinners[0]!;
    const bodyCompetitors = coverages.filter(
      (c) =>
        c.peer.jobId !== winner.peer.jobId &&
        (c.bodyComplete || c.distinctiveInBody.length > 0)
    );
    const contradiction = bodyCompetitors.some((comp) =>
      hasExplicitNormalizedBodyContradiction({
        subjectWinnerTerms: winner.identityTerms,
        distinctiveWinnerTerms: winner.distinctiveInSubject,
        bodyTokens: bodyHay,
        competingPeerTerms: comp.distinctiveInBody.length
          ? comp.distinctiveInBody
          : comp.identityTerms.filter(
              (t) =>
                !sharedIdentityTerms.some((s) =>
                  projectIdentityTokensEquivalent(s, t)
                )
            ),
      })
    );
    if (contradiction) {
      return finishAmbiguous("EXPLICIT_BODY_CONTRADICTION", {
        competingJobIds: [
          winner.peer.jobId,
          ...bodyCompetitors.map((c) => c.peer.jobId),
        ],
        distinguishingIdentityTerms: winner.distinctiveInSubject,
        matchedTerms: winner.identityTerms,
        evidenceField: "mixed",
      });
    }

    const incidentalBody = bodyCompetitors.length > 0;
    const usedCompound = subjectNorm.compoundsJoined.length > 0;
    const usedAbbrev = winner.identityTerms.some((t) => t === "building");
    let reason: JobNameIdentityReasonCode = "NORMALIZED_SUBJECT_IDENTITY";
    if (incidentalBody) reason = "INCIDENTAL_BODY_REFERENCE";
    else if (usedCompound) reason = "PROJECT_ALIAS_NORMALIZATION";
    else if (usedAbbrev && winner.distinctiveInSubject.includes("building")) {
      reason = "ABBREVIATION_EQUIVALENCE";
    } else if (winner.distinctiveInSubject.length > 0) {
      reason = "DISTINCTIVE_SUBJECT_TERMS";
    }

    return {
      status: "MATCH",
      preserveCandidates: true,
      selectedJobIdOverride: winner.peer.jobId,
      candidateJobIdsOverride: [winner.peer.jobId],
      diagnostics: diagBase(
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
        args.input.hit,
        args.assessed,
        [winner.peer.jobId],
        {
          identityStrength: "STRONG",
          strongIdentityAnchor: true,
          resolutionAllowed: true,
          reason,
          matchedTerms: winner.identityTerms,
          distinctiveTerms: winner.distinctiveInSubject,
          distinguishingIdentityTerms: winner.distinctiveInSubject,
          sharedIdentityTerms,
          identityFamilyJobIds: familyJobIds,
          competingJobIds: peers
            .map((p) => p.jobId)
            .filter((id) => id !== winner.peer.jobId),
          evidenceType: incidentalBody
            ? "normalized_subject_over_incidental_body"
            : usedCompound
              ? "normalized_subject_compound"
              : "normalized_subject_identity",
          evidenceField: incidentalBody ? "mixed" : "subject",
          projectTokenUniqueness:
            sharedIdentityTerms.length > 0 ? "shared" : "unique",
          ...(normalizationApplied.length > 0
            ? { normalizationApplied }
            : {}),
        }
      ),
    };
  }

  // No complete subject winner — require shared family in subject + unique
  // distinctive subject terms for exactly one peer (partial subject path).
  const familyInSubject = sharedIdentityTerms.some((s) =>
    subjectHay.some((h) => projectIdentityTokensEquivalent(h, s))
  );
  if (familyInSubject) {
    const partial = coverages.filter(
      (c) =>
        c.distinctiveInSubject.length > 0 &&
        c.identityTerms.some((t) =>
          sharedIdentityTerms.some((s) =>
            projectIdentityTokensEquivalent(s, t)
          )
        ) &&
        // Every distinctive term for this peer that appears in its identity
        // must be present; shared family alone is not enough.
        c.identityTerms
          .filter(
            (t) =>
              !sharedIdentityTerms.some((s) =>
                projectIdentityTokensEquivalent(s, t)
              )
          )
          .every((t) =>
            subjectHay.some((h) => projectIdentityTokensEquivalent(h, t))
          )
    );
    if (partial.length === 1) {
      const winner = partial[0]!;
      return {
        status: "MATCH",
        preserveCandidates: true,
        selectedJobIdOverride: winner.peer.jobId,
        candidateJobIdsOverride: [winner.peer.jobId],
        diagnostics: diagBase(
          JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
          args.input.hit,
          args.assessed,
          [winner.peer.jobId],
          {
            identityStrength: "STRONG",
            strongIdentityAnchor: true,
            resolutionAllowed: true,
            reason: "DISTINCTIVE_SUBJECT_TERMS",
            matchedTerms: [
              ...sharedIdentityTerms.filter((s) =>
                subjectHay.some((h) => projectIdentityTokensEquivalent(h, s))
              ),
              ...winner.distinctiveInSubject,
            ],
            distinguishingIdentityTerms: winner.distinctiveInSubject,
            sharedIdentityTerms,
            identityFamilyJobIds: familyJobIds,
            competingJobIds: familyJobIds.filter(
              (id) => id !== winner.peer.jobId
            ),
            evidenceType: "distinctive_subject_terms",
            evidenceField: "subject",
            projectTokenUniqueness: "shared",
            ...(normalizationApplied.length > 0
              ? { normalizationApplied }
              : {}),
          }
        ),
      };
    }
    if (partial.length > 1) {
      return finishAmbiguous("COMPETING_PROJECT_CANDIDATES", {
        competingJobIds: partial.map((c) => c.peer.jobId),
        distinguishingIdentityTerms: partial.flatMap(
          (c) => c.distinctiveInSubject
        ),
      });
    }
    return finishAmbiguous("INSUFFICIENT_DISTINGUISHING_EVIDENCE", {
      competingJobIds: familyJobIds,
      matchedTerms: sharedIdentityTerms,
    });
  }

  // No recoverable normalized subject identity.
  void args.priorReason;
  return null;
}

/**
 * CONTEXT_AWARE_V2_1 — title-gap / ordered project-phrase recovery ONLY.
 * Does not promote unique single tokens. Never preserves weak candidates.
 * When multiple eligible Jobs share a project identifier present in the email,
 * requires distinguishing title or current-body evidence (not weak generics)
 * before MATCH. Body hits ignore lightweight negation windows.
 */
export function tryTitleGapProjectRecovery(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
  priorReason: JobNameIdentityReasonCode;
}): ApplyIdentityPolicyResult | null {
  // Preserve V2 family / umbrella abstentions — title-gap must not promote a
  // customer-only name when sibling Jobs exist under the same customer.
  if (
    args.priorReason === "SHARED_CUSTOMER_IDENTITY" ||
    args.priorReason === "INSUFFICIENT_PROJECT_DISAMBIGUATION"
  ) {
    return null;
  }

  const ctx = buildProjectIdentityRecoveryContext(args);
  if (!ctx) return null;

  const { scores, subjectTokens, bodyTokens, pool } = ctx;
  const phraseCandidates = scores.filter((s) => {
    if (!s.gap || s.gap.run.length < 2) return false;
    return s.gap.run.some((t) => !isCommonConstructionIdentityToken(t));
  });

  // Prefer subject-established project family (body may supply disambiguation).
  // Runs before rare-token contradiction so lightweight negation can drop false
  // competing hits (e.g. "not for concessions … exterior stairs").
  const sharedInSubject = sharedProjectIdentifiersAmongPeers(pool).filter((id) =>
    hayHasProjectToken(subjectTokens, [], id)
  );
  const sharedIdentifiers =
    sharedInSubject.length > 0
      ? sharedInSubject
      : sharedProjectIdentifiersAmongPeers(pool).filter((id) =>
          hayHasProjectToken(subjectTokens, bodyTokens, id)
        );

  if (sharedIdentifiers.length > 0) {
    const competitors = pool.filter((p) =>
      sharedIdentifiers.some((id) =>
        p.contentTokens.some((ct) => projectTokensEquivalent(ct, id))
      )
    );
    if (competitors.length >= 2) {
      // Path A: ordered gap/title phrase already carries distinguishing terms.
      const withPhraseDistinguishing = phraseCandidates
        .map((s) => ({
          score: s,
          distinguishingInRun: distinguishingTitleEvidenceInRun({
            run: s.gap!.run,
            peer: s.peer,
            competitors,
            sharedIdentifiers,
          }),
        }))
        .filter((row) => row.distinguishingInRun.length > 0);

      if (withPhraseDistinguishing.length === 1) {
        const winner = withPhraseDistinguishing[0]!;
        const w = winner.score;
        const contiguous = w.gap!.contiguous;
        return experimentalMatchResult(
          ctx,
          JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
          w.peer.jobId,
          "DISTINGUISHING_TITLE_EVIDENCE",
          {
            matchedTerms: w.gap!.run,
            distinctiveTerms: w.uniqueProject,
            weakTerms: w.scopeTokens.filter((t) =>
              isWeakTitleDisambiguationToken(t)
            ),
            sharedIdentityTerms: sharedIdentifiers,
            distinguishingIdentityTerms: winner.distinguishingInRun,
            identityFamilyJobIds: competitors.map((c) => c.jobId),
            competingJobIds: competitors
              .map((c) => c.jobId)
              .filter((id) => id !== w.peer.jobId),
            evidenceType: contiguous
              ? "distinguishing_title_phrase"
              : "gap_tolerant_distinguishing_phrase",
            evidenceField: w.gap!.field,
            tokenDistance: w.gap!.intervening,
            projectTokenUniqueness: "shared",
            normalizationApplied: collectNormalizationApplied(
              w.gap!.run,
              subjectTokens,
              bodyTokens
            ),
          }
        );
      }

      if (withPhraseDistinguishing.length > 1) {
        return titleGapAmbiguousResult(ctx, "COMPETING_TITLE_EVIDENCE", {
          sharedIdentityTerms: sharedIdentifiers,
          distinguishingIdentityTerms: withPhraseDistinguishing.flatMap(
            (r) => r.distinguishingInRun
          ),
          competingJobIds: withPhraseDistinguishing.map(
            (r) => r.score.peer.jobId
          ),
          identityFamilyJobIds: competitors.map((c) => c.jobId),
          matchedTerms: withPhraseDistinguishing.flatMap(
            (r) => r.score.gap!.run
          ),
        });
      }

      // Path B: subject established the shared family; search subject + body
      // for candidate-specific distinguishing terms (body-only is allowed).
      const fieldHits = competitors.map((peer) => {
        const found = findDistinguishingEvidenceInFields({
          peer,
          competitors,
          sharedIdentifiers,
          subjectTokens,
          bodyTokens,
        });
        return { peer, ...found };
      });
      const withFieldEvidence = fieldHits.filter((h) => h.terms.length > 0);

      if (withFieldEvidence.length === 0) {
        return titleGapAmbiguousResult(ctx, "INSUFFICIENT_DISAMBIGUATION", {
          sharedIdentityTerms: sharedIdentifiers,
          distinguishingIdentityTerms: [],
          competingJobIds: competitors.map((c) => c.jobId),
          identityFamilyJobIds: competitors.map((c) => c.jobId),
          matchedTerms: sharedIdentifiers,
          evidenceField: null,
        });
      }

      if (withFieldEvidence.length > 1) {
        return titleGapAmbiguousResult(ctx, "COMPETING_TITLE_EVIDENCE", {
          sharedIdentityTerms: sharedIdentifiers,
          distinguishingIdentityTerms: withFieldEvidence.flatMap((h) => h.terms),
          competingJobIds: withFieldEvidence.map((h) => h.peer.jobId),
          identityFamilyJobIds: competitors.map((c) => c.jobId),
          matchedTerms: withFieldEvidence.flatMap((h) => h.terms),
          evidenceField: "mixed",
        });
      }

      const hit = withFieldEvidence[0]!;
      const bodyOnly =
        hit.evidenceField === "body" && hit.subjectTerms.length === 0;
      return experimentalMatchResult(
        ctx,
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
        hit.peer.jobId,
        bodyOnly ? "UNIQUE_BODY_DISAMBIGUATION" : "DISTINGUISHING_TITLE_EVIDENCE",
        {
          matchedTerms: [...sharedIdentifiers, ...hit.terms],
          sharedIdentityTerms: sharedIdentifiers,
          distinguishingIdentityTerms: hit.terms,
          identityFamilyJobIds: competitors.map((c) => c.jobId),
          competingJobIds: competitors
            .map((c) => c.jobId)
            .filter((id) => id !== hit.peer.jobId),
          evidenceType: bodyOnly
            ? "unique_body_disambiguation"
            : "distinguishing_title_term",
          evidenceField: hit.evidenceField,
          projectTokenUniqueness: "shared",
          normalizationApplied: collectNormalizationApplied(
            hit.terms,
            subjectTokens,
            bodyTokens
          ),
        }
      );
    }
  }

  const contradiction = contradictoryProjectEvidenceResult(
    ctx,
    JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
  );
  if (contradiction) return contradiction;

  // No shared-identifier competition among eligible peers — prior sole-winner path.
  if (phraseCandidates.length !== 1) return null;
  const w = phraseCandidates[0]!;
  const fullRunCompetitors = scores.filter(
    (s) =>
      s.peer.jobId !== w.peer.jobId &&
      w.gap!.run.every((t) =>
        s.peer.contentTokens.some((ct) => projectTokensEquivalent(ct, t))
      )
  );
  if (fullRunCompetitors.length > 0) return null;

  const contiguous = w.gap!.contiguous;
  const reason: JobNameIdentityReasonCode = contiguous
    ? "UNIQUE_PROJECT_PHRASE"
    : "GAP_TOLERANT_PROJECT_MATCH";
  return experimentalMatchResult(
    ctx,
    JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    w.peer.jobId,
    reason,
    {
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
    }
  );
}

/**
 * CONTEXT_AWARE_V2_2 — unique authoritative project-token recovery ONLY.
 * Does not apply title-gap phrase matching. Never preserves weak candidates.
 */
export function tryUniqueProjectTokenRecovery(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
  priorReason: JobNameIdentityReasonCode;
}): ApplyIdentityPolicyResult | null {
  const ctx = buildProjectIdentityRecoveryContext(args);
  if (!ctx) return null;

  const contradiction = contradictoryProjectEvidenceResult(
    ctx,
    JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2
  );
  if (contradiction) return contradiction;

  const { scores, pool, subjectTokens, bodyTokens } = ctx;
  // Unique token alone: exactly one pool Job with authoritative unique tokens.
  const rareAlone = scores.filter((s) => s.authoritativeUnique.length > 0);
  if (rareAlone.length !== 1 || pool.length !== 1) return null;
  const w = rareAlone[0]!;
  const uniqueInHay = w.authoritativeUnique.filter((t) =>
    hayHasProjectToken(subjectTokens, bodyTokens, t)
  );
  if (uniqueInHay.length === 0) return null;

  const uniqueInSubject = uniqueInHay.filter((t) =>
    hayHasProjectToken(subjectTokens, [], t)
  );
  const primaryUnique =
    uniqueInSubject.length > 0 ? uniqueInSubject : uniqueInHay;
  // Optional scope/distinguishing decoration — does not invoke title-gap MATCH.
  const hasScopeSupport =
    w.scopeTokens.length > 0 || w.distinguishing.length > 0;
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
  return experimentalMatchResult(
    ctx,
    JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    w.peer.jobId,
    reason,
    {
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
    }
  );
}

/**
 * @deprecated Old bundled V2.2 recovery (title-gap + unique-token + scope/family).
 * Kept as a no-op alias for import compatibility — active dispatch uses
 * tryTitleGapProjectRecovery (V2.1) and tryUniqueProjectTokenRecovery (V2.2).
 */
export function tryProjectIdentityCoverageRecovery(args: {
  input: ApplyIdentityPolicyInput;
  assessed: ReturnType<typeof assessIdentityHitStrength> | null;
  selectedJobIds: string[];
  priorReason: JobNameIdentityReasonCode;
}): ApplyIdentityPolicyResult | null {
  void args;
  return null;
}
