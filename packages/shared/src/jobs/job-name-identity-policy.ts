/**
 * Marker 1 identity policy — BASELINE vs CONTEXT_AWARE_V1.
 *
 * BASELINE: unique OVERLAP may MATCH (historical behavior).
 * CONTEXT_AWARE_V1: unique weak identity must abstain (AMBIGUOUS), not MATCH.
 * Production default remains BASELINE until explicitly approved.
 */

import {
  isJobNameContentToken,
  phraseContained,
} from "./job-name-normalize.js";

export const JOB_MATCH_IDENTITY_POLICY_BASELINE = "BASELINE" as const;
export const JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1 =
  "CONTEXT_AWARE_V1" as const;

export type JobMatchIdentityPolicy =
  | typeof JOB_MATCH_IDENTITY_POLICY_BASELINE
  | typeof JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1;

export const DEFAULT_JOB_MATCH_IDENTITY_POLICY: JobMatchIdentityPolicy =
  JOB_MATCH_IDENTITY_POLICY_BASELINE;

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
  | "BASELINE_UNIQUE_PHRASE";

export type JobNameIdentityDiagnostics = {
  marker: "NAME";
  identityPolicy: JobMatchIdentityPolicy;
  identityStrength: JobNameIdentityStrength;
  matchedPhrase: string | null;
  matchedTerms: string[];
  weakTerms: string[];
  distinctiveTerms: string[];
  evidenceSource: string | null;
  evidenceType: string | null;
  matchKind: string | null;
  strongIdentityAnchor: boolean;
  candidateJobIds: string[];
  candidateCount: number;
  competingJobIds: string[];
  resolutionAllowed: boolean;
  reason: JobNameIdentityReasonCode;
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

export type ApplyIdentityPolicyInput = {
  policy: JobMatchIdentityPolicy;
  status: "MATCH" | "AMBIGUOUS" | "NO_MATCH";
  selectedJobIds: string[];
  hit: IdentityHitAssessmentInput | null;
  competingJobIds?: string[];
};

export type ApplyIdentityPolicyResult = {
  status: "MATCH" | "AMBIGUOUS" | "NO_MATCH";
  /** When demoting MATCH→AMBIGUOUS, keep the prior candidate set. */
  preserveCandidates: boolean;
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

/**
 * Apply identity-policy safety gate after decideFromHits.
 * BASELINE: pass-through (diagnostics only).
 * CONTEXT_AWARE_V1: demote unique WEAK MATCH to AMBIGUOUS (candidates preserved).
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
    return {
      status: "AMBIGUOUS",
      preserveCandidates: true,
      diagnostics: {
        marker: "NAME",
        identityPolicy: policy,
        identityStrength:
          selectedJobIds.length > 1 && assessed?.strength === "STRONG"
            ? "CONFLICTING"
            : "AMBIGUOUS",
        matchedPhrase: input.hit?.phraseLabel ?? null,
        matchedTerms: input.hit?.matchedContentTokens ?? [],
        weakTerms: assessed?.weakTerms ?? [],
        distinctiveTerms: assessed?.distinctiveTerms ?? [],
        evidenceSource: input.hit?.phraseSource ?? null,
        evidenceType: null,
        matchKind: input.hit?.kind ?? null,
        strongIdentityAnchor: assessed?.strongIdentityAnchor ?? false,
        candidateJobIds: selectedJobIds,
        candidateCount: selectedJobIds.length,
        competingJobIds: input.competingJobIds ?? selectedJobIds,
        resolutionAllowed: false,
        reason:
          selectedJobIds.length > 1 && assessed?.strength === "STRONG"
            ? "CONFLICTING_STRONG_IDENTITIES"
            : "AMBIGUOUS_CANDIDATES",
      },
    };
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
      diagnostics: {
        marker: "NAME",
        identityPolicy: policy,
        identityStrength: assessed.strength,
        matchedPhrase: input.hit.phraseLabel,
        matchedTerms: input.hit.matchedContentTokens,
        weakTerms: assessed.weakTerms,
        distinctiveTerms: assessed.distinctiveTerms,
        evidenceSource: input.hit.phraseSource,
        evidenceType: null,
        matchKind: input.hit.kind,
        strongIdentityAnchor: assessed.strongIdentityAnchor,
        candidateJobIds: selectedJobIds,
        candidateCount: selectedJobIds.length,
        competingJobIds: [],
        resolutionAllowed: true,
        reason: baselineReason,
      },
    };
  }

  // CONTEXT_AWARE_V1
  if (assessed.strength === "STRONG") {
    return {
      status: "MATCH",
      preserveCandidates: true,
      diagnostics: {
        marker: "NAME",
        identityPolicy: policy,
        identityStrength: "STRONG",
        matchedPhrase: input.hit.phraseLabel,
        matchedTerms: input.hit.matchedContentTokens,
        weakTerms: assessed.weakTerms,
        distinctiveTerms: assessed.distinctiveTerms,
        evidenceSource: input.hit.phraseSource,
        evidenceType: null,
        matchKind: input.hit.kind,
        strongIdentityAnchor: true,
        candidateJobIds: selectedJobIds,
        candidateCount: selectedJobIds.length,
        competingJobIds: [],
        resolutionAllowed: true,
        reason: assessed.reason,
      },
    };
  }

  // Weak unique identity → abstain but keep candidates for Marker 2/3
  return {
    status: "AMBIGUOUS",
    preserveCandidates: true,
    diagnostics: {
      marker: "NAME",
      identityPolicy: policy,
      identityStrength: "WEAK",
      matchedPhrase: input.hit.phraseLabel,
      matchedTerms: input.hit.matchedContentTokens,
      weakTerms: assessed.weakTerms,
      distinctiveTerms: assessed.distinctiveTerms,
      evidenceSource: input.hit.phraseSource,
      evidenceType: null,
      matchKind: input.hit.kind,
      strongIdentityAnchor: false,
      candidateJobIds: selectedJobIds,
      candidateCount: selectedJobIds.length,
      competingJobIds: [],
      resolutionAllowed: false,
      reason: assessed.reason,
    },
  };
}
