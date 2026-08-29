/**
 * Normalized classification inspection DTO for Email Classification Review.
 * Present persisted evidence only — never recompute BUSINESS/PERSONAL or invent markers.
 */

import {
  confirmedJobAssociationDecisionEffect,
  type JobAssociationMarker,
} from "./confirmed-job-association.js";
import {
  buildClassificationEvidenceViewModel,
  type ClassificationEvidenceViewModel,
} from "./classification-evidence-display.js";
import {
  buildPriorityDecisionViewModel,
  type PriorityDecisionViewModel,
} from "./priority-decision.js";

export type ClassificationHistoryStatus =
  | "AUTO"
  | "CONFIRMED"
  | "CORRECTED"
  | "DISMISSED";

/**
 * Product-facing history status. Requires-review / pending are treated as AUTO
 * (classified history) — not a user-facing "Needs Review" workflow.
 */
export function computeClassificationHistoryStatus(input: {
  reviewStatus: string;
  previousCategory: string | null | undefined;
}): ClassificationHistoryStatus {
  if (input.reviewStatus === "REJECTED") return "DISMISSED";
  if (input.reviewStatus === "APPROVED") {
    return input.previousCategory ? "CORRECTED" : "CONFIRMED";
  }
  return "AUTO";
}

export type ClassificationInspectionSignal = {
  key: string;
  label: string;
  /** BUSINESS / PERSONAL label when probability implies direction; null if N/A */
  direction: "BUSINESS" | "PERSONAL" | null;
  probabilityPct: number | null;
  strongFlag: boolean | null;
  points: number | null;
  explanation: string | null;
  includedInDecision: boolean;
  status: string | null;
  cumulativeAdjustment: number | null;
};

export type ClassificationInspectionPayload = {
  classification: {
    id: string;
    messageId: string;
    mailboxCategory: string | null;
    businessTypeKey: string | null;
    businessTypeConfidence: number | null;
    priority: string | null;
    confidence: number;
    containsActionRequest: boolean;
    summary: string | null;
    modelName: string | null;
    modelVersion: string | null;
    reviewStatus: string;
    historyStatus: ClassificationHistoryStatus;
    createdAt: string;
    processedAt: string | null;
  };
  decision: {
    rule: string | null;
    title: string | null;
    summary: string | null;
    category: "BUSINESS" | "PERSONAL" | null;
    format: string | null;
    cumulative: ClassificationEvidenceViewModel["cumulative"];
  } | null;
  signals: ClassificationInspectionSignal[];
  priorityDecision: PriorityDecisionViewModel | null;
  entities: {
    customer: { id: string; name: string } | null;
    vendor: { id: string; name: string } | null;
    job: { id: string; jobNumber: string | null; name: string } | null;
    entityMatchConfidence: number | null;
    matchEvidence: unknown[];
  };
  /**
   * Confirmed = EmailMessage/Classification attached to a real workspace Job.
   * Candidate = probabilistic job-reference / AI hint only.
   */
  jobAssociation: {
    status: "CONFIRMED";
    jobId: string;
    jobNumber: string | null;
    name: string;
    decisionEffect: string;
    source: string;
    forcedDecision: boolean;
  } | {
    status: "NONE";
  };
  jobCandidate: {
    status: "CANDIDATE";
    confidencePct: number | null;
    explanation: string | null;
    hintedJobId: string | null;
  } | {
    status: "NONE";
  };
  tasks: Array<{
    id: string;
    title: string;
    summary: string | null;
    dueAt: string | null;
    priority: string;
    status: string;
    confidence: number;
  }>;
  senderEvidence: {
    email: string;
    status: string;
    confidence: number;
    displayName: string | null;
    businessEvidenceCount: number;
    personalEvidenceCount: number;
    manualBusinessConfirmations: number;
    manualPersonalConfirmations: number;
  } | null;
  domainEvidence: {
    domain: string;
    status: string;
    confidence: number;
    isPublicDomain: boolean;
    businessEvidenceCount: number;
    personalEvidenceCount: number;
  } | null;
  corrections: Array<{
    id: string;
    originalMailboxCategory: string | null;
    correctedMailboxCategory: string | null;
    originalBusinessType: string | null;
    correctedBusinessType: string | null;
    originalJobId: string | null;
    correctedJobId: string | null;
    originalPriority: string | null;
    correctedPriority: string | null;
    reason: string | null;
    reviewedAt: string;
  }>;
  email: {
    fromName: string | null;
    fromEmail: string;
    to: unknown;
    subject: string | null;
    date: string | null;
    snippet: string | null;
    /** Present only when includeBody was requested. */
    bodyText?: string | null;
  };
  /** Stages present in evidence / persisted fields (for inspector sections). */
  availableStages: string[];
};

function signalDirection(
  key: string,
  probabilityPct: number | null
): "BUSINESS" | "PERSONAL" | null {
  if (key === "sender" || key === "signature") return null;
  if (probabilityPct == null) return null;
  return probabilityPct >= 50 ? "BUSINESS" : "PERSONAL";
}

export function buildInspectionSignals(
  vm: ClassificationEvidenceViewModel | null
): ClassificationInspectionSignal[] {
  if (!vm) return [];
  return vm.signals.map((s) => ({
    key: s.key,
    label: s.label,
    direction: signalDirection(s.key, s.probabilityPct),
    probabilityPct: s.probabilityPct,
    strongFlag: s.strongFlag,
    points: s.points,
    explanation: s.explanation,
    includedInDecision: s.includedInDecision,
    status: s.status,
    cumulativeAdjustment: s.cumulativeAdjustment,
  }));
}

export function buildPriorityInspection(
  evidence: unknown,
  storedPriority: string | null
): PriorityDecisionViewModel | null {
  return buildPriorityDecisionViewModel({
    priority: storedPriority,
    evidence,
  });
}

export function listAvailableInspectionStages(input: {
  hasSignals: boolean;
  hasSubtype: boolean;
  hasEntities: boolean;
  hasTasks: boolean;
  hasPriorityDecision: boolean;
}): string[] {
  const stages: string[] = [];
  if (input.hasSignals) stages.push("semantic_business_personal");
  if (input.hasSubtype) stages.push("subtype");
  if (input.hasEntities) stages.push("entity_job");
  if (input.hasTasks) stages.push("tasks");
  if (input.hasPriorityDecision) stages.push("priority");
  return stages;
}

/** Read persisted jobAssociation / jobCandidate markers; derive CONFIRMED from linked job when missing. */
export function resolveInspectionJobMarkers(input: {
  evidence: unknown;
  linkedJob: { id: string; jobNumber: string | null; name: string } | null;
}): {
  jobAssociation: Extract<JobAssociationMarker, { status: "CONFIRMED" }> | { status: "NONE" };
  jobCandidate: Extract<JobAssociationMarker, { status: "CANDIDATE" }> | { status: "NONE" };
} {
  const evidence =
    input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence)
      ? (input.evidence as Record<string, unknown>)
      : {};

  const rawAssoc = evidence.jobAssociation;
  const rawCand = evidence.jobCandidate;

  let jobAssociation:
    | Extract<JobAssociationMarker, { status: "CONFIRMED" }>
    | { status: "NONE" } = { status: "NONE" };

  if (
    rawAssoc &&
    typeof rawAssoc === "object" &&
    !Array.isArray(rawAssoc) &&
    (rawAssoc as { status?: string }).status === "CONFIRMED" &&
    typeof (rawAssoc as { jobId?: unknown }).jobId === "string"
  ) {
    const a = rawAssoc as Extract<JobAssociationMarker, { status: "CONFIRMED" }>;
    jobAssociation = a;
  } else if (input.linkedJob) {
    jobAssociation = {
      status: "CONFIRMED",
      jobId: input.linkedJob.id,
      jobNumber: input.linkedJob.jobNumber,
      name: input.linkedJob.name,
      decisionEffect: confirmedJobAssociationDecisionEffect(input.linkedJob),
      source: "linked_classification_job",
      forcedDecision: false,
    };
  }

  let jobCandidate:
    | Extract<JobAssociationMarker, { status: "CANDIDATE" }>
    | { status: "NONE" } = { status: "NONE" };
  if (
    rawCand &&
    typeof rawCand === "object" &&
    !Array.isArray(rawCand) &&
    (rawCand as { status?: string }).status === "CANDIDATE"
  ) {
    jobCandidate = rawCand as Extract<JobAssociationMarker, { status: "CANDIDATE" }>;
  }

  return { jobAssociation, jobCandidate };
}
