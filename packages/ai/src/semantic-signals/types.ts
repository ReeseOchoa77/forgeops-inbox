/**
 * Production n8n semantic-signal contract.
 * AI returns signals only — never final BUSINESS/PERSONAL or priority.
 */

export type DeadlineUrgency = "NONE" | "STANDARD" | "URGENT";

export const DEADLINE_URGENCY_VALUES = [
  "NONE",
  "STANDARD",
  "URGENT",
] as const satisfies readonly DeadlineUrgency[];

export interface SemanticSignalExplanations {
  content: string;
  subject: string;
  signature: string;
  job: string;
  deadline: string;
}

/** Exact structured output from the n8n / ForgeOps semantic extractor. */
export interface SemanticSignals {
  contentBusinessProbability: number;
  subjectBusinessProbability: number;
  signatureCompanyMatchConfidence: number;
  jobReferenceConfidence: number;
  summary: string;
  containsActionRequest: boolean;
  hasExplicitDeadline: boolean;
  deadlineUrgency: DeadlineUrgency;
  signalExplanations: SemanticSignalExplanations;
}

/** Email fields currently supplied to the n8n OpenAI user message. */
export interface SemanticSignalEmailInput {
  normalizedSubject: string;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | null | undefined;
  cleanBody: string;
  attachmentNames?: string[] | undefined;
}

export interface SemanticSignalSenderEvidence {
  status?: string | null | undefined;
  confidence?: number | null | undefined;
  businessCount?: number | null | undefined;
  personalCount?: number | null | undefined;
}

export interface SemanticSignalDomainEvidence {
  status?: string | null | undefined;
  confidence?: number | null | undefined;
  isPublicDomain?: boolean | null | undefined;
}

export interface SemanticSignalCandidateRow {
  id: string;
  name: string;
  score?: number | undefined;
  matchedOn?: string[] | undefined;
  evidence?: string[] | undefined;
}

export interface SemanticSignalApprovedJobAlias {
  jobId?: string | null | undefined;
  alias?: string | undefined;
  normalizedAlias?: string | undefined;
}

/** Supporting workspace evidence block (same payload n8n injects into the user message). */
export interface SemanticSignalSupportingEvidence {
  senderEvidence?: SemanticSignalSenderEvidence | null | undefined;
  domainEvidence?: SemanticSignalDomainEvidence | null | undefined;
  knownSender: boolean;
  customerCandidates: SemanticSignalCandidateRow[];
  vendorCandidates: SemanticSignalCandidateRow[];
  jobCandidates: SemanticSignalCandidateRow[];
  approvedJobAliases: SemanticSignalApprovedJobAlias[];
  classificationInstructions: Array<{ title: string; content: string }>;
  candidateLookupFailed: boolean;
}

export type ExtractSemanticSignalsInput = SemanticSignalEmailInput &
  SemanticSignalSupportingEvidence;

export class SemanticSignalValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      issues.length === 1
        ? `Invalid semantic signals: ${issues[0]}`
        : `Invalid semantic signals: ${issues.join("; ")}`
    );
    this.name = "SemanticSignalValidationError";
    this.issues = issues;
  }
}

const REQUIRED_TOP_LEVEL = [
  "contentBusinessProbability",
  "subjectBusinessProbability",
  "signatureCompanyMatchConfidence",
  "jobReferenceConfidence",
  "summary",
  "containsActionRequest",
  "hasExplicitDeadline",
  "deadlineUrgency",
  "signalExplanations",
] as const;

const REQUIRED_EXPLANATIONS = [
  "content",
  "subject",
  "signature",
  "job",
  "deadline",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireProbability(
  value: unknown,
  field: string,
  issues: string[]
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${field} must be a finite number`);
    return null;
  }
  if (value < 0 || value > 1) {
    issues.push(`${field} must be between 0 and 1 (got ${value})`);
    return null;
  }
  return value;
}

function requireBoolean(
  value: unknown,
  field: string,
  issues: string[]
): boolean | null {
  if (typeof value !== "boolean") {
    issues.push(`${field} must be a boolean`);
    return null;
  }
  return value;
}

function requireString(
  value: unknown,
  field: string,
  issues: string[],
  opts?: { maxLength?: number }
): string | null {
  if (typeof value !== "string") {
    issues.push(`${field} must be a string`);
    return null;
  }
  if (opts?.maxLength != null && value.length > opts.maxLength) {
    issues.push(
      `${field} must be ≤${opts.maxLength} characters (got ${value.length})`
    );
    return null;
  }
  return value;
}

/**
 * Strict runtime validation of the production n8n semantic-signal schema.
 * Rejects malformed output — does not clamp or invent defaults.
 */
export function parseSemanticSignals(raw: unknown): SemanticSignals {
  const issues: string[] = [];

  if (!isPlainObject(raw)) {
    throw new SemanticSignalValidationError([
      "response must be a JSON object",
    ]);
  }

  for (const key of Object.keys(raw)) {
    if (
      !(REQUIRED_TOP_LEVEL as readonly string[]).includes(key)
    ) {
      issues.push(`unexpected top-level property "${key}"`);
    }
  }

  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in raw)) {
      issues.push(`missing required field "${key}"`);
    }
  }

  const contentBusinessProbability = requireProbability(
    raw.contentBusinessProbability,
    "contentBusinessProbability",
    issues
  );
  const subjectBusinessProbability = requireProbability(
    raw.subjectBusinessProbability,
    "subjectBusinessProbability",
    issues
  );
  const signatureCompanyMatchConfidence = requireProbability(
    raw.signatureCompanyMatchConfidence,
    "signatureCompanyMatchConfidence",
    issues
  );
  const jobReferenceConfidence = requireProbability(
    raw.jobReferenceConfidence,
    "jobReferenceConfidence",
    issues
  );

  const summary = requireString(raw.summary, "summary", issues, {
    maxLength: 300,
  });
  const containsActionRequest = requireBoolean(
    raw.containsActionRequest,
    "containsActionRequest",
    issues
  );
  const hasExplicitDeadline = requireBoolean(
    raw.hasExplicitDeadline,
    "hasExplicitDeadline",
    issues
  );

  let deadlineUrgency: DeadlineUrgency | null = null;
  if (typeof raw.deadlineUrgency !== "string") {
    issues.push("deadlineUrgency must be a string");
  } else if (
    !(DEADLINE_URGENCY_VALUES as readonly string[]).includes(
      raw.deadlineUrgency
    )
  ) {
    issues.push(
      `deadlineUrgency must be one of NONE | STANDARD | URGENT (got "${raw.deadlineUrgency}")`
    );
  } else {
    deadlineUrgency = raw.deadlineUrgency as DeadlineUrgency;
  }

  if (
    hasExplicitDeadline === false &&
    deadlineUrgency != null &&
    deadlineUrgency !== "NONE"
  ) {
    issues.push(
      'when hasExplicitDeadline is false, deadlineUrgency must be "NONE"'
    );
  }

  let signalExplanations: SemanticSignalExplanations | null = null;
  if (!isPlainObject(raw.signalExplanations)) {
    issues.push("signalExplanations must be an object");
  } else {
    for (const key of Object.keys(raw.signalExplanations)) {
      if (!(REQUIRED_EXPLANATIONS as readonly string[]).includes(key)) {
        issues.push(`unexpected signalExplanations property "${key}"`);
      }
    }

    const explanations: Partial<SemanticSignalExplanations> = {};
    let ok = true;
    for (const key of REQUIRED_EXPLANATIONS) {
      const value = raw.signalExplanations[key];
      if (typeof value !== "string") {
        issues.push(`signalExplanations.${key} must be a string`);
        ok = false;
      } else {
        explanations[key] = value;
      }
    }
    if (ok) {
      signalExplanations = explanations as SemanticSignalExplanations;
    }
  }

  if (
    issues.length > 0 ||
    contentBusinessProbability == null ||
    subjectBusinessProbability == null ||
    signatureCompanyMatchConfidence == null ||
    jobReferenceConfidence == null ||
    summary == null ||
    containsActionRequest == null ||
    hasExplicitDeadline == null ||
    deadlineUrgency == null ||
    signalExplanations == null
  ) {
    throw new SemanticSignalValidationError(
      issues.length > 0 ? issues : ["incomplete semantic signal payload"]
    );
  }

  return {
    contentBusinessProbability,
    subjectBusinessProbability,
    signatureCompanyMatchConfidence,
    jobReferenceConfidence,
    summary,
    containsActionRequest,
    hasExplicitDeadline,
    deadlineUrgency,
    signalExplanations,
  };
}
