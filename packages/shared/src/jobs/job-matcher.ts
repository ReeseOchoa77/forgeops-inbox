import { normalizeName } from "../reference/normalize.js";

export const JOB_MATCHER_VERSION = "job-matcher-v1";

export type JobMatchEvidenceType =
  | "SUBJECT_JOB_NUMBER"
  | "SUBJECT_JOB_NAME"
  | "SUBJECT_JOB_ALIAS"
  | "CONTENT_JOB_NUMBER"
  | "CONTENT_JOB_NAME"
  | "CONTENT_JOB_ALIAS"
  | "SENDER_CUSTOMER_LINK"
  | "THREAD_JOB_HINT"
  | "N8N_COMPAT_HINT";

export type JobMatchEvidence = {
  type: JobMatchEvidenceType;
  value: string;
  confidence: number;
};

export type JobMatchAssignmentSource =
  | "AI_AUTO_ASSIGNED"
  | "AI_SUGGESTED"
  | "JOB_NUMBER_MATCH";

export type JobMatchInput = {
  workspaceId: string;
  emailMessageId?: string;
  subject: string | null | undefined;
  normalizedSubject?: string | null;
  bodyText?: string | null;
  cleanBody?: string | null;
  senderEmail?: string | null;
  senderDomain?: string | null;
  recipients?: string[];
  threadId?: string | null;
  /** Weak compatibility hint from n8n — never authoritative. */
  n8nSelectedJobIdHint?: string | null;
};

export type JobRecordForMatch = {
  id: string;
  jobNumber: string | null;
  name: string;
  normalizedName: string;
  customerId: string | null;
  externalRef: string | null;
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

export type JobMatchResult = {
  selectedJobId: string | null;
  confidence: number;
  evidence: JobMatchEvidence[];
  ambiguousCandidateIds: string[];
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

/** Prefer #2198 / Job 2198 / Project 2198 style tokens. */
export function extractJobNumberCandidates(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const patterns = [
    /#\s*(\d{2,8})\b/g,
    /\b(?:job|project|po|p\.?o\.?)\s*[#:-]?\s*(\d{2,8})\b/gi,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

function textHasJobNumber(text: string, jobNumber: string): boolean {
  const n = jobNumber.trim();
  if (!n || !text) return false;
  const lower = text.toLowerCase();
  const num = n.toLowerCase();
  if (lower.includes(`#${num}`)) return true;
  const labeled = new RegExp(
    `\\b(?:job|project|po|p\\.?o\\.?)\\s*[#:-]?\\s*${escapeRegExp(num)}\\b`,
    "i"
  );
  if (labeled.test(text)) return true;
  // bare number token (subject-friendly; still exact job number)
  return new RegExp(`(?:^|[^0-9])${escapeRegExp(num)}(?:[^0-9]|$)`, "i").test(
    text
  );
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

function stripQuotedHistory(body: string): string {
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

  if (job.jobNumber && textHasJobNumber(subject, job.jobNumber)) {
    subjectScore = Math.max(subjectScore, 1);
    pushEvidence(evidence, "SUBJECT_JOB_NUMBER", job.jobNumber, 1);
  }
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

  if (job.jobNumber && textHasJobNumber(body, job.jobNumber)) {
    contentScore = Math.max(contentScore, 0.82);
    pushEvidence(evidence, "CONTENT_JOB_NUMBER", job.jobNumber, 0.82);
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

  // Exact unique-style subject job number should dominate
  // Unique subject name/alias is also strong (conservative boost, still ≤ job#)
  const boosted =
    subjectScore >= 1
      ? Math.max(score, 0.96)
      : subjectScore >= 0.88 && contentScore >= 0.7
        ? Math.max(score, 0.92)
        : subjectScore >= 0.9
          ? Math.max(score, 0.91)
          : subjectScore >= 0.88
            ? Math.max(score, 0.88)
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
    const source: JobMatchAssignmentSource =
      top.subjectScore >= 1 ? "JOB_NUMBER_MATCH" : "AI_AUTO_ASSIGNED";
    return {
      selectedJobId: top.jobId,
      confidence: top.score,
      evidence: top.evidence,
      ambiguousCandidateIds: [],
      requiresReview: false,
      assignmentSource: source,
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
