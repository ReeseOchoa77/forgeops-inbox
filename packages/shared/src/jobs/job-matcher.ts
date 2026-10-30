import { normalizeName } from "../reference/normalize.js";

export const JOB_MATCHER_VERSION = "job-matcher-v1";

export type JobMatchEvidenceType =
  | "SUBJECT_JOB_NUMBER"
  | "SUBJECT_JOB_NAME"
  | "SUBJECT_JOB_ALIAS"
  | "SUBJECT_JOB_SITE"
  | "SUBJECT_JOB_EXTERNAL_REF"
  | "SUBJECT_JOB_DESCRIPTION"
  | "CONTENT_JOB_NUMBER"
  | "CONTENT_JOB_NAME"
  | "CONTENT_JOB_ALIAS"
  | "CONTENT_JOB_SITE"
  | "CONTENT_JOB_EXTERNAL_REF"
  | "CONTENT_JOB_DESCRIPTION"
  | "SENDER_CUSTOMER_LINK"
  | "SENDER_JOB_CONTACT"
  | "THREAD_JOB_HINT"
  | "THREAD_JOB_AUTHORITATIVE"
  | "N8N_COMPAT_HINT";

export type JobMatchEvidence = {
  type: JobMatchEvidenceType;
  value: string;
  confidence: number;
};

export type JobMatchAssignmentSource =
  | "AI_AUTO_ASSIGNED"
  | "AI_SUGGESTED"
  /** Historical provenance only. The live matcher never emits this. */
  | "JOB_NUMBER_MATCH";

export type JobMatchInput = {
  workspaceId: string;
  emailMessageId?: string;
  inboxConnectionId?: string | null;
  subject: string | null | undefined;
  normalizedSubject?: string | null;
  bodyText?: string | null;
  cleanBody?: string | null;
  senderEmail?: string | null;
  senderDomain?: string | null;
  recipients?: string[];
  threadId?: string | null;
  /** Outlook/Gmail conversation id. Not globally unique — scope with inboxConnectionId. */
  providerThreadId?: string | null;
  /** Weak compatibility hint from n8n — never authoritative. */
  n8nSelectedJobIdHint?: string | null;
  /**
   * production (default): ACTIVE / ON_HOLD / AWARDED only.
   * evaluation: historical eval may include completed/archived Jobs.
   * Must not be set by the live matcher path.
   */
  eligibilityMode?: "production" | "evaluation";
};

export type JobRecordForMatch = {
  id: string;
  jobNumber: string | null;
  name: string;
  normalizedName: string;
  customerId: string | null;
  externalRef: string | null;
  /** Site / campus name. Canonical identity, not a Job.description alias. */
  siteName?: string | null;
  /** Free text. Short lines and "Also known as:" lists are alternate names. */
  description?: string | null;
  /** Used by Marker 1 to restrict the eligible pool. Omitted = eligible. */
  status?: string | null;
};

export type JobAliasForMatch = {
  jobId: string;
  normalizedAlias: string;
  alias: string;
};

export type JobMatchCandidateScore = {
  jobId: string;
  score: number;
  subjectScore: number;
  contentScore: number;
  senderScore: number;
  evidence: JobMatchEvidence[];
};

export type JobMatchDecision =
  | "MATCH"
  | "AMBIGUOUS"
  | "NO_MATCH"
  | "CONFLICT";

export type JobMatchMarkerId = "NAME" | "CONTACT" | "THREAD";

export type JobMatchMarkerTrace = {
  marker: JobMatchMarkerId;
  status: JobMatchDecision;
  selectedJobId: string | null;
  candidateJobIds: string[];
};

export type JobMatchResult = {
  selectedJobId: string | null;
  confidence: number;
  evidence: JobMatchEvidence[];
  ambiguousCandidateIds: string[];
  /**
   * Plausible Jobs after the last executed marker.
   * MATCH: the unique Job. AMBIGUOUS/CONFLICT: the remaining set. NO_MATCH: [].
   */
  candidateJobIds?: string[];
  decision?: JobMatchDecision;
  markerTrace?: JobMatchMarkerTrace[];
  requiresReview: boolean;
  assignmentSource: JobMatchAssignmentSource | null;
  candidateCount: number;
  matcherVersion: string;
};

const SUBJECT_WEIGHT = 0.5;
const CONTENT_WEIGHT = 0.35;
const SENDER_WEIGHT = 0.15;

const AUTO_LINK_THRESHOLD = 0.9;
const SUGGEST_THRESHOLD = 0.7;
const AMBIGUITY_GAP = 0.12;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textHasNameToken(text: string, normalizedName: string): boolean {
  if (!normalizedName || normalizedName.length < 3 || !text) return false;
  const hay = normalizeName(text);
  if (!hay) return false;
  if (hay === normalizedName) return true;
  if (hay.includes(normalizedName)) return true;
  // token overlap for multi-word names
  const nameTokens = normalizedName.split(/\s+/).filter((t) => t.length >= 3);
  if (nameTokens.length === 0) return false;
  return nameTokens.every((t) => hay.includes(t));
}

const DESCRIPTION_LABEL =
  /^(?:also\s+known\s+as|a\.?k\.?a\.?|aka|alternate\s+names?|aliases|also\s+called)\s*[:\-]\s*(.*)$/i;

/**
 * Names listed in a job description. Labeled lines ("Also known as: Nova, NOVA")
 * and other short lines are alternate names. Long prose is ignored.
 */
export function extractJobDescriptionNames(
  description: string | null | undefined
): string[] {
  if (!description?.trim()) return [];
  const names: string[] = [];
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const labeled = line.match(DESCRIPTION_LABEL);
    const source = labeled ? (labeled[1] ?? "").trim() : line;
    if (!source) continue;
    if (!labeled && source.length > 80) continue;
    for (const part of source.split(/\s*(?:,|;|\/|\bor\b)\s*/i)) {
      const name = part.trim().replace(/^["']|["']$/g, "");
      if (name.length < 3 || name.length > 80) continue;
      if (name.split(/\s+/).length > 12) continue;
      names.push(name);
    }
  }
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = normalizeName(name);
    if (!key || key.length < 3 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function stripQuotedHistory(body: string): string {
  // Prefer current content: drop common quoted reply blocks for matching
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .+ wrote:\s*$/i.test(line)) break;
    if (/^\s*From:\s+/i.test(line) && kept.length > 2) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n").trim() || body.slice(0, 2000);
}

function pushEvidence(
  list: JobMatchEvidence[],
  type: JobMatchEvidenceType,
  value: string,
  confidence: number
): void {
  list.push({ type, value: value.slice(0, 200), confidence });
}

export function scoreJobAgainstEmail(input: {
  subject: string;
  body: string;
  senderDomain: string | null;
  job: JobRecordForMatch;
  aliases: JobAliasForMatch[];
  threadJobId: string | null;
  senderCustomerJobIds: Set<string>;
}): JobMatchCandidateScore {
  const evidence: JobMatchEvidence[] = [];
  let subjectScore = 0;
  let contentScore = 0;
  let senderScore = 0;

  const { job, subject, body } = input;
  const jobAliases = input.aliases.filter((a) => a.jobId === job.id);

  if (textHasNameToken(subject, job.normalizedName)) {
    subjectScore = Math.max(subjectScore, 0.88);
    pushEvidence(evidence, "SUBJECT_JOB_NAME", job.name, 0.88);
  }
  for (const alias of jobAliases) {
    if (textHasNameToken(subject, alias.normalizedAlias)) {
      subjectScore = Math.max(subjectScore, 0.9);
      pushEvidence(evidence, "SUBJECT_JOB_ALIAS", alias.alias, 0.9);
    }
  }
  for (const alt of extractJobDescriptionNames(job.description)) {
    if (textHasNameToken(subject, normalizeName(alt))) {
      subjectScore = Math.max(subjectScore, 0.9);
      pushEvidence(evidence, "SUBJECT_JOB_DESCRIPTION", alt, 0.9);
    }
  }

  if (textHasNameToken(body, job.normalizedName)) {
    contentScore = Math.max(contentScore, 0.7);
    pushEvidence(evidence, "CONTENT_JOB_NAME", job.name, 0.7);
  }
  for (const alias of jobAliases) {
    if (textHasNameToken(body, alias.normalizedAlias)) {
      contentScore = Math.max(contentScore, 0.72);
      pushEvidence(evidence, "CONTENT_JOB_ALIAS", alias.alias, 0.72);
    }
  }
  for (const alt of extractJobDescriptionNames(job.description)) {
    if (textHasNameToken(body, normalizeName(alt))) {
      contentScore = Math.max(contentScore, 0.72);
      pushEvidence(evidence, "CONTENT_JOB_DESCRIPTION", alt, 0.72);
    }
  }

  if (input.senderCustomerJobIds.has(job.id)) {
    senderScore = Math.max(senderScore, 0.55);
    pushEvidence(
      evidence,
      "SENDER_CUSTOMER_LINK",
      input.senderDomain ?? "sender",
      0.55
    );
  }

  if (input.threadJobId && input.threadJobId === job.id) {
    senderScore = Math.max(senderScore, 0.4);
    pushEvidence(evidence, "THREAD_JOB_HINT", job.id, 0.4);
  }

  const score =
    SUBJECT_WEIGHT * subjectScore +
    CONTENT_WEIGHT * contentScore +
    SENDER_WEIGHT * senderScore;

  // Unique subject name/alias is strong. Internal Job.jobNumber is never evidence.
  const boosted =
    subjectScore >= 1
      ? Math.max(score, 0.96)
      : subjectScore >= 0.88 && contentScore >= 0.7
        ? Math.max(score, 0.92)
        : subjectScore >= 0.9
          ? Math.max(score, 0.91)
          : subjectScore >= 0.88
            ? Math.max(score, 0.88)
            : contentScore >= 0.7
              ? Math.max(score, 0.9)
              : score;

  return {
    jobId: job.id,
    score: Math.min(1, boosted),
    subjectScore,
    contentScore,
    senderScore,
    evidence,
  };
}

export function selectJobMatchFromCandidates(
  ranked: JobMatchCandidateScore[],
  options?: { n8nHintJobId?: string | null }
): JobMatchResult {
  const candidateCount = ranked.length;
  if (ranked.length === 0) {
    return {
      selectedJobId: null,
      confidence: 0,
      evidence: [],
      ambiguousCandidateIds: [],
      requiresReview: false,
      assignmentSource: null,
      candidateCount,
      matcherVersion: JOB_MATCHER_VERSION,
    };
  }

  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  const second = sorted[1];
  const gap = second ? top.score - second.score : 1;

  // Weak n8n hint: only if already among strong candidates
  if (
    options?.n8nHintJobId &&
    top.jobId !== options.n8nHintJobId &&
    top.score < SUGGEST_THRESHOLD
  ) {
    const hinted = sorted.find((c) => c.jobId === options.n8nHintJobId);
    if (hinted && hinted.score >= top.score - 0.05) {
      hinted.evidence.push({
        type: "N8N_COMPAT_HINT",
        value: options.n8nHintJobId,
        confidence: 0.2,
      });
    }
  }

  const ambiguous =
    Boolean(second) && gap < AMBIGUITY_GAP && second!.score >= SUGGEST_THRESHOLD;

  if (top.score >= AUTO_LINK_THRESHOLD && !ambiguous) {
    return {
      selectedJobId: top.jobId,
      confidence: top.score,
      evidence: top.evidence,
      ambiguousCandidateIds: [],
      requiresReview: false,
      assignmentSource: "AI_AUTO_ASSIGNED",
      candidateCount,
      matcherVersion: JOB_MATCHER_VERSION,
    };
  }

  if (top.score >= SUGGEST_THRESHOLD) {
    return {
      selectedJobId: top.jobId,
      confidence: top.score,
      evidence: top.evidence,
      ambiguousCandidateIds: ambiguous
        ? sorted
            .filter((c) => top.score - c.score < AMBIGUITY_GAP)
            .map((c) => c.jobId)
        : [],
      requiresReview: true,
      assignmentSource: "AI_SUGGESTED",
      candidateCount,
      matcherVersion: JOB_MATCHER_VERSION,
    };
  }

  return {
    selectedJobId: null,
    confidence: top.score,
    evidence: top.evidence,
    ambiguousCandidateIds: ambiguous
      ? sorted.slice(0, 3).map((c) => c.jobId)
      : [],
    requiresReview: ambiguous,
    assignmentSource: null,
    candidateCount,
    matcherVersion: JOB_MATCHER_VERSION,
  };
}

/**
 * Score active jobs against email signals. Returns top N candidates (default 10).
 * Shared by JobMatcherService and legacy classification-candidates endpoints.
 */
export function rankJobMatchCandidates(input: {
  subject: string | null | undefined;
  bodyText?: string | null | undefined;
  cleanBody?: string | null | undefined;
  senderDomain?: string | null | undefined;
  jobs: JobRecordForMatch[];
  aliases: JobAliasForMatch[];
  threadJobId?: string | null | undefined;
  senderCustomerJobIds?: Set<string>;
  limit?: number;
}): JobMatchCandidateScore[] {
  const subject = input.subject ?? "";
  const rawBody = input.cleanBody ?? input.bodyText ?? "";
  const body = stripQuotedHistory(rawBody).slice(0, 8000);
  const senderCustomerJobIds = input.senderCustomerJobIds ?? new Set<string>();
  const limit = input.limit ?? 10;

  const scored: JobMatchCandidateScore[] = [];
  for (const job of input.jobs) {
    const candidate = scoreJobAgainstEmail({
      subject,
      body,
      senderDomain: input.senderDomain ?? null,
      job,
      aliases: input.aliases,
      threadJobId: input.threadJobId ?? null,
      senderCustomerJobIds,
    });
    if (candidate.score > 0.05 || candidate.evidence.length > 0) {
      scored.push(candidate);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Deterministic job matcher (no LLM). Works when OpenAI is unavailable.
 */
export function matchJobsDeterministic(input: {
  subject: string | null | undefined;
  bodyText?: string | null | undefined;
  cleanBody?: string | null | undefined;
  senderDomain?: string | null | undefined;
  jobs: JobRecordForMatch[];
  aliases: JobAliasForMatch[];
  threadJobId?: string | null | undefined;
  /** jobIds linked to sender's customer */
  senderCustomerJobIds?: Set<string>;
  n8nSelectedJobIdHint?: string | null | undefined;
}): JobMatchResult {
  const top = rankJobMatchCandidates(input);

  return selectJobMatchFromCandidates(top, {
    n8nHintJobId: input.n8nSelectedJobIdHint ?? null,
  });
}
