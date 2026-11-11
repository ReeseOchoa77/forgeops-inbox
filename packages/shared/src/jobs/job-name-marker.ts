import {
  stripQuotedHistory,
  type JobAliasForMatch,
  type JobMatchEvidence,
  type JobMatchEvidenceType,
  type JobRecordForMatch,
} from "./job-matcher.js";
import {
  alignSaintTokens,
  allTokensPresent,
  canonicalizeJobNameTokens,
  canonicalJobNamePhrase,
  isDistinguishingJobNameToken,
  isJobNameContentToken,
  phraseContained,
  stripSubjectPrefixes,
} from "./job-name-normalize.js";
import {
  applyJobNameIdentityPolicy,
  buildWorkspaceIdentityTokenStats,
  DEFAULT_JOB_MATCH_IDENTITY_POLICY,
  type JobMatchIdentityPolicy,
  type JobNameIdentityDiagnostics,
  type WorkspaceIdentityTokenStats,
} from "./job-name-identity-policy.js";

export const JOB_NAME_MARKER_VERSION = "job-name-marker-v3";

export type {
  JobMatchIdentityPolicy,
  JobNameIdentityDiagnostics,
  JobNameIdentityReasonCode,
  JobNameIdentityStrength,
} from "./job-name-identity-policy.js";
export {
  DEFAULT_JOB_MATCH_IDENTITY_POLICY,
  JOB_MATCH_IDENTITY_POLICY_BASELINE,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
} from "./job-name-identity-policy.js";

/** Marker 1 pool: live operational jobs. COMPLETE/BIDDING/LEAD are excluded. */
export const JOB_NAME_MARKER_ELIGIBLE_STATUSES = [
  "ACTIVE",
  "ON_HOLD",
  "AWARDED",
] as const;

/**
 * production: live matcher (ACTIVE / ON_HOLD / AWARDED).
 * evaluation: historical holdout eval may include COMPLETE / ARCHIVED / etc.
 * Evaluation mode must never be used by the production matcher path.
 */
export type JobMatchEligibilityMode = "production" | "evaluation";

export type JobNameMarkerStatus = "MATCH" | "AMBIGUOUS" | "NO_MATCH";

export type JobNameMatchKind = "EXACT" | "ALL_TOKENS" | "OVERLAP" | "NONE";

export type JobNameIdentitySource =
  | "NAME"
  | "ALIAS"
  | "SITE"
  | "EXTERNAL_REF";

export type JobNameMatchTier =
  | "EXACT_SUBJECT"
  | "ALL_TOKENS_SUBJECT"
  | "UNIQUE_SUBJECT"
  | "EXACT_BODY"
  | "ALL_TOKENS_BODY"
  | "UNIQUE_BODY"
  | "NONE";

const KIND_RANK: Record<JobNameMatchKind, number> = {
  EXACT: 3,
  ALL_TOKENS: 2,
  OVERLAP: 1,
  NONE: 0,
};

const TIER_CONFIDENCE: Record<JobNameMatchTier, number> = {
  EXACT_SUBJECT: 0.97,
  ALL_TOKENS_SUBJECT: 0.93,
  UNIQUE_SUBJECT: 0.88,
  EXACT_BODY: 0.86,
  ALL_TOKENS_BODY: 0.82,
  UNIQUE_BODY: 0.78,
  NONE: 0,
};

export type JobNameMarkerCandidate = {
  jobId: string;
  jobName: string;
  tier: JobNameMatchTier;
  evidence: JobMatchEvidence[];
};

export type JobNameMarkerResult = {
  status: JobNameMarkerStatus;
  selectedJobId: string | null;
  confidence: number;
  evidence: JobMatchEvidence[];
  /** Plausible identity set. MATCH is a one-element set. */
  candidateJobIds: string[];
  ambiguousCandidateIds: string[];
  candidates: JobNameMarkerCandidate[];
  eligibleJobCount: number;
  markerVersion: string;
  identityPolicy: JobMatchIdentityPolicy;
  identityDiagnostics: JobNameIdentityDiagnostics;
};

type PreparedPhrase = {
  label: string;
  tokens: string[];
  source: JobNameIdentitySource;
};

type PreparedJob = {
  job: JobRecordForMatch;
  phrases: PreparedPhrase[];
  contentTokens: Set<string>;
  distinguishingTokens: Set<string>;
};

type PhraseHit = {
  kind: Exclude<JobNameMatchKind, "NONE" | "OVERLAP">;
  field: "subject" | "body";
  phrase: PreparedPhrase;
};

type JobHit = {
  job: PreparedJob;
  kind: JobNameMatchKind;
  field: "subject" | "body" | null;
  phrase: PreparedPhrase | null;
  phraseHits: PhraseHit[];
  evidence: JobMatchEvidence[];
  distinguishingHits: string[];
  /** Content tokens shared with the email (identity overlap evidence). */
  matchedContentTokens: string[];
};

export function isJobMatcherEligibleStatus(
  status: string | null | undefined,
  mode: JobMatchEligibilityMode = "production"
): boolean {
  if (status == null || status === "") return true;
  if (mode === "evaluation") return true;
  return (JOB_NAME_MARKER_ELIGIBLE_STATUSES as readonly string[]).includes(
    status
  );
}

function isEligibleJob(
  job: JobRecordForMatch,
  mode: JobMatchEligibilityMode = "production"
): boolean {
  return isJobMatcherEligibleStatus(job.status, mode);
}

function sameTokenSequence(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

function pushUniquePhrase(phrases: PreparedPhrase[], next: PreparedPhrase): void {
  if (next.tokens.length === 0) return;
  if (phrases.some((p) => sameTokenSequence(p.tokens, next.tokens))) return;
  phrases.push(next);
}

function prepareJobs(
  jobs: JobRecordForMatch[],
  aliases: JobAliasForMatch[],
  mode: JobMatchEligibilityMode = "production"
): PreparedJob[] {
  const aliasesByJob = new Map<string, JobAliasForMatch[]>();
  for (const alias of aliases) {
    const list = aliasesByJob.get(alias.jobId) ?? [];
    list.push(alias);
    aliasesByJob.set(alias.jobId, list);
  }

  const prepared: PreparedJob[] = [];
  for (const job of jobs) {
    if (!isEligibleJob(job, mode)) continue;
    const phrases: PreparedPhrase[] = [];
    pushUniquePhrase(phrases, {
      label: job.name,
      tokens: canonicalizeJobNameTokens(job.name),
      source: "NAME",
    });
    for (const alias of aliasesByJob.get(job.id) ?? []) {
      pushUniquePhrase(phrases, {
        label: alias.alias,
        tokens: canonicalizeJobNameTokens(alias.alias),
        source: "ALIAS",
      });
    }
    if (job.siteName?.trim()) {
      pushUniquePhrase(phrases, {
        label: job.siteName,
        tokens: canonicalizeJobNameTokens(job.siteName),
        source: "SITE",
      });
    }
    if (job.externalRef?.trim()) {
      pushUniquePhrase(phrases, {
        label: job.externalRef,
        tokens: canonicalizeJobNameTokens(job.externalRef),
        source: "EXTERNAL_REF",
      });
    }
    if (phrases.length === 0) continue;

    const contentTokens = new Set<string>();
    const distinguishingTokens = new Set<string>();
    for (const phrase of phrases) {
      for (const t of phrase.tokens) {
        if (isJobNameContentToken(t)) contentTokens.add(t);
        if (isDistinguishingJobNameToken(t)) distinguishingTokens.add(t);
      }
    }
    prepared.push({ job, phrases, contentTokens, distinguishingTokens });
  }
  return prepared;
}

function hayTokensFor(jobTokens: string[], rawHayTokens: string[]): string[] {
  return alignSaintTokens(jobTokens, rawHayTokens);
}

function evidenceType(
  field: "subject" | "body",
  source: JobNameIdentitySource
): JobMatchEvidenceType {
  const prefix = field === "subject" ? "SUBJECT" : "CONTENT";
  switch (source) {
    case "ALIAS":
      return `${prefix}_JOB_ALIAS`;
    case "SITE":
      return `${prefix}_JOB_SITE`;
    case "EXTERNAL_REF":
      return `${prefix}_JOB_EXTERNAL_REF`;
    default:
      return `${prefix}_JOB_NAME`;
  }
}

function evidenceFor(
  field: "subject" | "body",
  phrase: PreparedPhrase,
  kind: JobNameMatchKind
): JobMatchEvidence {
  const confidence =
    kind === "EXACT" ? 0.97 : kind === "ALL_TOKENS" ? 0.93 : 0.7;
  return {
    type: evidenceType(field, phrase.source),
    value: phrase.label.slice(0, 200),
    confidence,
  };
}

function collectPhraseHits(
  phrases: PreparedPhrase[],
  field: "subject" | "body",
  rawHayTokens: string[]
): PhraseHit[] {
  const hits: PhraseHit[] = [];
  for (const phrase of phrases) {
    const hay = hayTokensFor(phrase.tokens, rawHayTokens);
    if (phraseContained(hay, phrase.tokens)) {
      hits.push({ kind: "EXACT", field, phrase });
      continue;
    }
    if (allTokensPresent(hay, phrase.tokens)) {
      hits.push({ kind: "ALL_TOKENS", field, phrase });
    }
  }
  return hits;
}

function bestKind(hits: PhraseHit[]): PhraseHit | null {
  let best: PhraseHit | null = null;
  for (const hit of hits) {
    if (!best || KIND_RANK[hit.kind] > KIND_RANK[best.kind]) {
      best = hit;
      continue;
    }
    if (
      best &&
      KIND_RANK[hit.kind] === KIND_RANK[best.kind] &&
      hit.field === "subject" &&
      best.field !== "subject"
    ) {
      best = hit;
    }
  }
  return best;
}

function tokenSubset(subset: string[], superset: string[]): boolean {
  if (subset.length === 0 || subset.length >= superset.length) return false;
  const superSet = new Set(superset);
  return subset.every((t) => superSet.has(t));
}

function strongPhraseHits(hit: JobHit): PhraseHit[] {
  return hit.phraseHits.filter(
    (h) => h.kind === "EXACT" || h.kind === "ALL_TOKENS"
  );
}

function hasExclusiveIdentifierHit(loser: JobHit, winner: JobHit): boolean {
  const winnerHits = strongPhraseHits(winner);
  for (const hit of strongPhraseHits(loser)) {
    if (hit.phrase.source !== "EXTERNAL_REF") {
      continue;
    }
    const shared = winnerHits.some(
      (other) =>
        other.phrase.source === hit.phrase.source &&
        other.phrase.label === hit.phrase.label
    );
    if (!shared) return true;
  }
  return false;
}

/**
 * A more specific identity (Building 2) dominates a shared shorter identity
 * (campus site name) when its matched tokens are a proper superset.
 * externalRef hits on a different Job are conflicts, not subsets.
 */
function isDominatedBy(loser: JobHit, winner: JobHit): boolean {
  if (hasExclusiveIdentifierHit(loser, winner)) return false;
  const loserHits = strongPhraseHits(loser);
  const winnerHits = strongPhraseHits(winner);
  if (loserHits.length === 0 || winnerHits.length === 0) return false;
  const loserLongest = loserHits.reduce((a, b) =>
    a.phrase.tokens.length >= b.phrase.tokens.length ? a : b
  );
  const winnerLongest = winnerHits.reduce((a, b) =>
    a.phrase.tokens.length >= b.phrase.tokens.length ? a : b
  );
  return tokenSubset(loserLongest.phrase.tokens, winnerLongest.phrase.tokens);
}

function distinguishingHitsFor(
  job: PreparedJob,
  subjectTokens: string[],
  bodyTokens: string[]
): string[] {
  if (job.distinguishingTokens.size === 0) return [];
  const hay = new Set([
    ...hayTokensFor([...job.distinguishingTokens], subjectTokens),
    ...hayTokensFor([...job.distinguishingTokens], bodyTokens),
  ]);
  const hits: string[] = [];
  for (const token of job.distinguishingTokens) {
    if (hay.has(token)) hits.push(token);
  }
  return hits;
}

function scoreJob(input: {
  job: PreparedJob;
  subjectTokens: string[];
  bodyTokens: string[];
}): JobHit {
  const phraseHits = [
    ...collectPhraseHits(input.job.phrases, "subject", input.subjectTokens),
    ...collectPhraseHits(input.job.phrases, "body", input.bodyTokens),
  ];
  const evidence: JobMatchEvidence[] = [];
  const seen = new Set<string>();
  for (const hit of phraseHits) {
    const key = `${hit.field}:${hit.phrase.source}:${hit.phrase.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push(evidenceFor(hit.field, hit.phrase, hit.kind));
  }

  const hayContent = new Set([
    ...input.subjectTokens.filter(isJobNameContentToken),
    ...input.bodyTokens.filter(isJobNameContentToken),
  ]);
  const overlapTokens: string[] = [];
  for (const token of input.job.contentTokens) {
    if (hayContent.has(token)) overlapTokens.push(token);
  }

  const best = bestKind(phraseHits);
  if (best) {
    const phraseContentMatched = best.phrase.tokens.filter(
      (t) => isJobNameContentToken(t) && hayContent.has(t)
    );
    return {
      job: input.job,
      kind: best.kind,
      field: best.field,
      phrase: best.phrase,
      phraseHits,
      evidence,
      distinguishingHits: distinguishingHitsFor(
        input.job,
        input.subjectTokens,
        input.bodyTokens
      ),
      matchedContentTokens:
        phraseContentMatched.length > 0 ? phraseContentMatched : overlapTokens,
    };
  }

  if (overlapTokens.length > 0) {
    const phrase = input.job.phrases[0]!;
    evidence.push({
      type: evidenceType("subject", phrase.source),
      value: overlapTokens.join(" ").slice(0, 200),
      confidence: 0.55,
    });
    return {
      job: input.job,
      kind: "OVERLAP",
      field: overlapTokens.some((t) => input.subjectTokens.includes(t))
        ? "subject"
        : "body",
      phrase,
      phraseHits: [],
      evidence,
      distinguishingHits: distinguishingHitsFor(
        input.job,
        input.subjectTokens,
        input.bodyTokens
      ),
      matchedContentTokens: overlapTokens,
    };
  }

  return {
    job: input.job,
    kind: "NONE",
    field: null,
    phrase: null,
    phraseHits: [],
    evidence: [],
    distinguishingHits: [],
    matchedContentTokens: [],
  };
}

function hitToAssessmentInput(
  hit: JobHit,
  subjectTokens: string[],
  bodyTokens: string[],
  workspaceStats: WorkspaceIdentityTokenStats
) {
  return {
    kind: hit.kind,
    field: hit.field,
    phraseLabel: hit.phrase?.label ?? null,
    phraseSource: hit.phrase?.source ?? null,
    phraseTokens: hit.phrase?.tokens ?? [],
    allPhraseTokenLists: hit.job.phrases.map((p) => p.tokens),
    matchedContentTokens: hit.matchedContentTokens,
    subjectTokens,
    bodyTokens,
    workspaceStats,
  } as const;
}

function toCandidate(hit: JobHit): JobNameMarkerCandidate {
  const tier: JobNameMatchTier =
    hit.kind === "EXACT" && hit.field === "subject"
      ? "EXACT_SUBJECT"
      : hit.kind === "ALL_TOKENS" && hit.field === "subject"
        ? "ALL_TOKENS_SUBJECT"
        : hit.kind === "OVERLAP" && hit.field === "subject"
          ? "UNIQUE_SUBJECT"
          : hit.kind === "EXACT" && hit.field === "body"
            ? "EXACT_BODY"
            : hit.kind === "ALL_TOKENS" && hit.field === "body"
              ? "ALL_TOKENS_BODY"
              : hit.kind === "OVERLAP" && hit.field === "body"
                ? "UNIQUE_BODY"
                : "NONE";
  return {
    jobId: hit.job.job.id,
    jobName: hit.job.job.name,
    tier,
    evidence: hit.evidence,
  };
}

function decideFromHits(hits: JobHit[]): {
  status: JobNameMarkerStatus;
  selected: JobHit[];
} {
  const plausible = hits.filter((h) => h.kind !== "NONE");
  if (plausible.length === 0) return { status: "NO_MATCH", selected: [] };

  let strongest = KIND_RANK.OVERLAP;
  for (const hit of plausible) {
    strongest = Math.max(strongest, KIND_RANK[hit.kind]);
  }
  let selected = plausible.filter((h) => KIND_RANK[h.kind] === strongest);

  if (strongest >= KIND_RANK.ALL_TOKENS) {
    selected = selected.filter(
      (hit) => !selected.some((other) => other !== hit && isDominatedBy(hit, other))
    );
  }

  if (selected.length === 1) {
    return { status: "MATCH", selected };
  }

  const withDistinguishing = selected.filter((h) => h.distinguishingHits.length > 0);
  if (withDistinguishing.length === 1) {
    return { status: "MATCH", selected: withDistinguishing };
  }
  if (withDistinguishing.length > 1) {
    const uniqueByToken = new Map<string, JobHit[]>();
    for (const hit of withDistinguishing) {
      for (const token of hit.distinguishingHits) {
        const list = uniqueByToken.get(token) ?? [];
        list.push(hit);
        uniqueByToken.set(token, list);
      }
    }
    const exclusive = withDistinguishing.filter((hit) =>
      hit.distinguishingHits.some(
        (token) => (uniqueByToken.get(token) ?? []).length === 1
      )
    );
    if (exclusive.length === 1) {
      return { status: "MATCH", selected: exclusive };
    }
    if (exclusive.length > 1) {
      return { status: "AMBIGUOUS", selected: exclusive };
    }
    return { status: "AMBIGUOUS", selected: withDistinguishing };
  }

  return { status: "AMBIGUOUS", selected };
}

export function runJobNameMarker(input: {
  subject: string | null | undefined;
  bodyText?: string | null | undefined;
  cleanBody?: string | null | undefined;
  jobs: JobRecordForMatch[];
  aliases?: JobAliasForMatch[];
  eligibilityMode?: JobMatchEligibilityMode;
  /**
   * BASELINE (default): historical Marker 1 resolution rules.
   * CONTEXT_AWARE_V1: weak unique identity abstains (AMBIGUOUS); not production default.
   */
  identityPolicy?: JobMatchIdentityPolicy;
}): JobNameMarkerResult {
  const identityPolicy =
    input.identityPolicy ?? DEFAULT_JOB_MATCH_IDENTITY_POLICY;
  const prepared = prepareJobs(
    input.jobs,
    input.aliases ?? [],
    input.eligibilityMode ?? "production"
  );
  const workspaceStats = buildWorkspaceIdentityTokenStats(
    prepared.map((p) => p.contentTokens)
  );
  const empty = (status: JobNameMarkerStatus): JobNameMarkerResult => {
    const gated = applyJobNameIdentityPolicy({
      policy: identityPolicy,
      status,
      selectedJobIds: [],
      hit: null,
    });
    return {
      status,
      selectedJobId: null,
      confidence: 0,
      evidence: [],
      candidateJobIds: [],
      ambiguousCandidateIds: [],
      candidates: [],
      eligibleJobCount: prepared.length,
      markerVersion: JOB_NAME_MARKER_VERSION,
      identityPolicy,
      identityDiagnostics: gated.diagnostics,
    };
  };

  if (prepared.length === 0) return empty("NO_MATCH");

  const subject = stripSubjectPrefixes(input.subject ?? "");
  const rawBody = input.cleanBody ?? input.bodyText ?? "";
  const body = stripQuotedHistory(rawBody).slice(0, 8000);
  const subjectTokens = canonicalizeJobNameTokens(subject);
  const bodyTokens = canonicalizeJobNameTokens(body);

  const hits = prepared.map((job) =>
    scoreJob({
      job,
      subjectTokens,
      bodyTokens,
    })
  );

  const ranked = hits
    .map(toCandidate)
    .sort((a, b) => {
      const rank = (t: JobNameMatchTier) =>
        t === "EXACT_SUBJECT"
          ? 8
          : t === "ALL_TOKENS_SUBJECT"
            ? 7
            : t === "UNIQUE_SUBJECT"
              ? 6
              : t === "EXACT_BODY"
                ? 5
                : t === "ALL_TOKENS_BODY"
                  ? 4
                  : t === "UNIQUE_BODY"
                    ? 3
                    : 0;
      return rank(b.tier) - rank(a.tier);
    });

  const decision = decideFromHits(hits);
  const selectedIds = decision.selected.map((h) => h.job.job.id);
  const primaryHit = decision.selected[0] ?? null;
  const peerJobs = hits.map((h) => ({
    jobId: h.job.job.id,
    customerId: h.job.job.customerId,
    contentTokens: [...h.job.contentTokens],
    distinguishingTokens: [...h.job.distinguishingTokens],
    phraseTokenLists: h.job.phrases.map((p) => p.tokens),
    matchedContentTokens: h.matchedContentTokens,
    kind: h.kind,
  }));
  const gated = applyJobNameIdentityPolicy({
    policy: identityPolicy,
    status: decision.status,
    selectedJobIds: selectedIds,
    hit: primaryHit
      ? hitToAssessmentInput(
          primaryHit,
          subjectTokens,
          bodyTokens,
          workspaceStats
        )
      : null,
    competingJobIds: selectedIds.length > 1 ? selectedIds : [],
    peerJobs,
    subjectTokens,
    bodyTokens,
  });

  const finalStatus = gated.status;
  const finalIds =
    gated.candidateJobIdsOverride !== undefined
      ? gated.candidateJobIdsOverride
      : finalStatus === "NO_MATCH"
        ? []
        : gated.preserveCandidates
          ? selectedIds
          : [];
  const selectedOverride = gated.selectedJobIdOverride;
  const evidence = (
    finalStatus === "MATCH"
      ? decision.selected.filter((h) =>
          finalIds.includes(h.job.job.id)
        )
      : finalStatus === "AMBIGUOUS"
        ? decision.selected
        : []
  ).flatMap((h) => h.evidence);
  const topCandidate = ranked.find((c) => finalIds.includes(c.jobId));
  const confidence =
    finalStatus === "NO_MATCH"
      ? 0
      : topCandidate
        ? TIER_CONFIDENCE[topCandidate.tier]
        : 0.4;

  if (finalStatus === "MATCH" && finalIds[0]) {
    const winnerId = selectedOverride ?? finalIds[0];
    const winnerHit =
      hits.find((h) => h.job.job.id === winnerId) ?? primaryHit;
    return {
      status: "MATCH",
      selectedJobId: winnerId,
      confidence,
      evidence: winnerHit?.evidence ?? evidence,
      candidateJobIds: [winnerId],
      ambiguousCandidateIds: [],
      candidates: ranked,
      eligibleJobCount: prepared.length,
      markerVersion: JOB_NAME_MARKER_VERSION,
      identityPolicy,
      identityDiagnostics: gated.diagnostics,
    };
  }

  if (finalStatus === "AMBIGUOUS") {
    return {
      status: "AMBIGUOUS",
      selectedJobId: null,
      confidence,
      evidence:
        evidence.length > 0
          ? evidence
          : [
              {
                type: "SUBJECT_JOB_NAME",
                value: "shared project-name identity",
                confidence: 0.4,
              },
            ],
      candidateJobIds: finalIds,
      ambiguousCandidateIds: finalIds,
      candidates: ranked,
      eligibleJobCount: prepared.length,
      markerVersion: JOB_NAME_MARKER_VERSION,
      identityPolicy,
      identityDiagnostics: gated.diagnostics,
    };
  }

  return {
    status: "NO_MATCH",
    selectedJobId: null,
    confidence: 0,
    evidence: [],
    candidateJobIds: [],
    ambiguousCandidateIds: [],
    candidates: ranked,
    eligibleJobCount: prepared.length,
    markerVersion: JOB_NAME_MARKER_VERSION,
    identityPolicy,
    identityDiagnostics: gated.diagnostics,
  };
}

export function jobNameMarkerDebugPhrase(name: string): string {
  return canonicalJobNamePhrase(canonicalizeJobNameTokens(name));
}
