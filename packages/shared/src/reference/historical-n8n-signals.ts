/**
 * Extract comparable n8n classification signals from persisted Classification / EmailMessage.
 * Read-only helpers — does not recompute decisions.
 */

import type {
  ClassificationEvidenceRecord,
  NewSignalEvidence,
} from "./classification-evidence-display.js";
import type { PriorityDecisionPayload } from "./priority-decision.js";

export type HistoricalMailboxCategory = "BUSINESS" | "PERSONAL";

export interface HistoricalN8nSignalExplanations {
  content: string | null;
  subject: string | null;
  signature: string | null;
  job: string | null;
  deadline: string | null;
}

export interface HistoricalN8nComparableSignals {
  contentBusinessProbability: number | null;
  subjectBusinessProbability: number | null;
  signatureCompanyMatchConfidence: number | null;
  jobReferenceConfidence: number | null;
  containsActionRequest: boolean | null;
  hasExplicitDeadline: boolean | null;
  deadlineUrgency: string | null;
  mailboxCategory: HistoricalMailboxCategory | null;
  decisionRule: string | null;
  summary: string | null;
  signalExplanations: HistoricalN8nSignalExplanations;
  /** Where each top-level comparable field was sourced from (if present). */
  fieldSources: Record<string, string | null>;
  unavailableFields: string[];
  /** True when at least mailboxCategory + one probability signal (or decisionRule) exist. */
  hasMeaningfulComparisonBasis: boolean;
}

export interface HistoricalClassificationSnapshot {
  mailboxCategory?: string | null | undefined;
  summary?: string | null | undefined;
  containsActionRequest?: boolean | null | undefined;
  modelName?: string | null | undefined;
  modelVersion?: string | null | undefined;
  classificationEvidence?: unknown;
  rawAiPayload?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFiniteProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function signalProbability(
  evidence: ClassificationEvidenceRecord | null,
  key: "content" | "subject" | "signature" | "job"
): number | null {
  const signal = evidence?.[key] as NewSignalEvidence | undefined;
  return asFiniteProbability(signal?.probability);
}

function signalExplanation(
  evidence: ClassificationEvidenceRecord | null,
  key: "content" | "subject" | "signature" | "job"
): string | null {
  const signal = evidence?.[key] as NewSignalEvidence | undefined;
  return asNonEmptyString(signal?.explanation);
}

function extractPriorityDecision(
  evidence: ClassificationEvidenceRecord | null,
  raw: Record<string, unknown> | null
): PriorityDecisionPayload | null {
  const fromEvidence = asRecord(evidence?.priorityDecision);
  if (fromEvidence) return fromEvidence as PriorityDecisionPayload;
  const fromRaw = asRecord(raw?.priorityDecision);
  if (fromRaw) return fromRaw as PriorityDecisionPayload;
  return null;
}

/**
 * Pull n8n-comparable fields from persisted Classification (+ optional message category fallback).
 *
 * Persistence map (verified against n8n-ingest):
 * - mailboxCategory → Classification.mailboxCategory / EmailMessage.mailboxCategory
 * - summary → Classification.summary (+ rawAiPayload.summary)
 * - containsActionRequest → Classification.containsActionRequest
 * - probabilities → classificationEvidence.*.probability OR rawAiPayload.*Probability fields
 * - decisionRule → classificationEvidence.decisionRule / classificationDecision.rule
 * - explanations → classificationEvidence.*.explanation (not a `signalExplanations` object)
 * - hasExplicitDeadline / deadlineUrgency → classificationEvidence.priorityDecision (optional)
 * - signalExplanations.deadline → generally NOT persisted historically
 */
export function extractHistoricalN8nComparableSignals(input: {
  classification: HistoricalClassificationSnapshot | null | undefined;
  messageMailboxCategory?: string | null | undefined;
}): HistoricalN8nComparableSignals {
  const classification = input.classification ?? null;
  const evidence = asRecord(classification?.classificationEvidence) as
    | ClassificationEvidenceRecord
    | null;
  const raw = asRecord(classification?.rawAiPayload);
  const fieldSources: Record<string, string | null> = {};
  const unavailableFields: string[] = [];

  const pickProbability = (
    field: string,
    evidenceKey: "content" | "subject" | "signature" | "job",
    rawKey: string
  ): number | null => {
    const fromEvidence = signalProbability(evidence, evidenceKey);
    if (fromEvidence != null) {
      fieldSources[field] = `classificationEvidence.${evidenceKey}.probability`;
      return fromEvidence;
    }
    const fromRaw = asFiniteProbability(raw?.[rawKey]);
    if (fromRaw != null) {
      fieldSources[field] = `rawAiPayload.${rawKey}`;
      return fromRaw;
    }
    fieldSources[field] = null;
    unavailableFields.push(field);
    return null;
  };

  const contentBusinessProbability = pickProbability(
    "contentBusinessProbability",
    "content",
    "contentBusinessProbability"
  );
  const subjectBusinessProbability = pickProbability(
    "subjectBusinessProbability",
    "subject",
    "subjectBusinessProbability"
  );
  const signatureCompanyMatchConfidence = pickProbability(
    "signatureCompanyMatchConfidence",
    "signature",
    "signatureCompanyMatchConfidence"
  );
  const jobReferenceConfidence = pickProbability(
    "jobReferenceConfidence",
    "job",
    "jobReferenceConfidence"
  );

  let containsActionRequest: boolean | null = null;
  if (typeof classification?.containsActionRequest === "boolean") {
    containsActionRequest = classification.containsActionRequest;
    fieldSources.containsActionRequest = "Classification.containsActionRequest";
  } else if (typeof raw?.containsActionRequest === "boolean") {
    containsActionRequest = raw.containsActionRequest;
    fieldSources.containsActionRequest = "rawAiPayload.containsActionRequest";
  } else {
    fieldSources.containsActionRequest = null;
    unavailableFields.push("containsActionRequest");
  }

  const priorityDecision = extractPriorityDecision(evidence, raw);
  let hasExplicitDeadline: boolean | null = null;
  if (typeof priorityDecision?.hasExplicitDeadline === "boolean") {
    hasExplicitDeadline = priorityDecision.hasExplicitDeadline;
    fieldSources.hasExplicitDeadline =
      evidence?.priorityDecision != null
        ? "classificationEvidence.priorityDecision.hasExplicitDeadline"
        : "rawAiPayload.priorityDecision.hasExplicitDeadline";
  } else {
    fieldSources.hasExplicitDeadline = null;
    unavailableFields.push("hasExplicitDeadline");
  }

  let deadlineUrgency: string | null = null;
  if (typeof priorityDecision?.deadlineUrgency === "string") {
    deadlineUrgency = priorityDecision.deadlineUrgency;
    fieldSources.deadlineUrgency =
      evidence?.priorityDecision != null
        ? "classificationEvidence.priorityDecision.deadlineUrgency"
        : "rawAiPayload.priorityDecision.deadlineUrgency";
  } else {
    fieldSources.deadlineUrgency = null;
    unavailableFields.push("deadlineUrgency");
  }

  let mailboxCategory: HistoricalMailboxCategory | null = null;
  const categoryCandidate =
    classification?.mailboxCategory ?? input.messageMailboxCategory ?? null;
  if (categoryCandidate === "BUSINESS" || categoryCandidate === "PERSONAL") {
    mailboxCategory = categoryCandidate;
    fieldSources.mailboxCategory = classification?.mailboxCategory
      ? "Classification.mailboxCategory"
      : "EmailMessage.mailboxCategory";
  } else {
    fieldSources.mailboxCategory = null;
    unavailableFields.push("mailboxCategory");
  }

  let decisionRule: string | null = null;
  const evidenceRule = asNonEmptyString(evidence?.decisionRule);
  const decisionPayloadRule = asNonEmptyString(
    asRecord(evidence?.classificationDecision)?.rule
  );
  if (evidenceRule) {
    decisionRule = evidenceRule;
    fieldSources.decisionRule = "classificationEvidence.decisionRule";
  } else if (decisionPayloadRule) {
    decisionRule = decisionPayloadRule;
    fieldSources.decisionRule = "classificationEvidence.classificationDecision.rule";
  } else {
    fieldSources.decisionRule = null;
    unavailableFields.push("decisionRule");
  }

  let summary: string | null = null;
  const columnSummary = asNonEmptyString(classification?.summary);
  const rawSummary = asNonEmptyString(raw?.summary);
  if (columnSummary) {
    summary = columnSummary;
    fieldSources.summary = "Classification.summary";
  } else if (rawSummary) {
    summary = rawSummary;
    fieldSources.summary = "rawAiPayload.summary";
  } else {
    fieldSources.summary = null;
    unavailableFields.push("summary");
  }

  const signalExplanations: HistoricalN8nSignalExplanations = {
    content: signalExplanation(evidence, "content"),
    subject: signalExplanation(evidence, "subject"),
    signature: signalExplanation(evidence, "signature"),
    job: signalExplanation(evidence, "job"),
    deadline: null,
  };

  // n8n does not persist a `signalExplanations` object; explanations live on each signal.
  // Deadline explanation is not stored historically (priorityDecision has no explanation text).
  for (const key of ["content", "subject", "signature", "job", "deadline"] as const) {
    const field = `signalExplanations.${key}`;
    if (signalExplanations[key] == null) {
      fieldSources[field] = null;
      unavailableFields.push(field);
    } else {
      fieldSources[field] = `classificationEvidence.${key}.explanation`;
    }
  }

  const probabilityPresent =
    contentBusinessProbability != null ||
    subjectBusinessProbability != null ||
    jobReferenceConfidence != null;

  const hasMeaningfulComparisonBasis =
    mailboxCategory != null && (probabilityPresent || decisionRule != null);

  return {
    contentBusinessProbability,
    subjectBusinessProbability,
    signatureCompanyMatchConfidence,
    jobReferenceConfidence,
    containsActionRequest,
    hasExplicitDeadline,
    deadlineUrgency,
    mailboxCategory,
    decisionRule,
    summary,
    signalExplanations,
    fieldSources,
    unavailableFields,
    hasMeaningfulComparisonBasis,
  };
}
