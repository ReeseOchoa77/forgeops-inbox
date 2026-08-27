/**
 * n8n priority decision contract + Email Review display helpers.
 *
 * ForgeOps does NOT recalculate priority on ingest — n8n's analysis.priority
 * remains canonical. These helpers document the n8n rule table and present
 * persisted priorityDecision JSON for diagnostics.
 */

export const N8N_JOB_PRIORITY_THRESHOLD = 0.8;

export type N8nPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

/** Persisted ForgeOps / Prisma enum (NORMAL maps to MEDIUM on ingest). */
export type StoredPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type PriorityDecisionRule =
  | "NO_CONFIDENT_JOB_MATCH"
  | "JOB_WITHOUT_ACTION_REQUEST"
  | "JOB_WITH_ACTION_NO_DEADLINE"
  | "JOB_WITH_ACTION_DEADLINE"
  | "JOB_WITH_ACTION_URGENT_DEADLINE"
  | string;

export type DeadlineUrgency = "NONE" | "STANDARD" | "URGENT" | string;

export interface PriorityDecisionPayload {
  rule?: PriorityDecisionRule;
  jobRelated?: boolean;
  jobReferenceConfidence?: number;
  jobThreshold?: number;
  containsActionRequest?: boolean;
  hasExplicitDeadline?: boolean;
  deadlineUrgency?: DeadlineUrgency;
}

export interface PriorityDecisionViewModel {
  /** Badge label for UI (stored MEDIUM → application Normal). */
  displayLabel: "Low" | "Normal" | "High" | "Urgent" | string;
  reason: string;
  jobConfidencePct: number | null;
  jobThresholdPct: number | null;
  actionRequestedLabel: "Yes" | "No" | null;
  deadlineLabel: "None" | "Yes" | "Urgent" | null;
  showJobConfidence: boolean;
  showActionRequested: boolean;
  showDeadline: boolean;
}

/**
 * Documents the n8n deterministic priority table and returns full diagnostics.
 * Use for native read-only classification and contract tests.
 * Do not override analysis.priority on n8n ingest.
 */
export function computeN8nPriorityFromDecisionInputs(input: {
  jobReferenceConfidence: number;
  containsActionRequest: boolean;
  hasExplicitDeadline: boolean;
  deadlineUrgency: DeadlineUrgency;
  jobThreshold?: number;
}): N8nPriority {
  return decideMailboxPriority(input).priority;
}

/**
 * Deterministic priority decision used by the native classification pipeline.
 * AI subtype/entity/task stages must not overwrite this result.
 */
export function decideMailboxPriority(input: {
  jobReferenceConfidence: number;
  containsActionRequest: boolean;
  hasExplicitDeadline: boolean;
  deadlineUrgency: DeadlineUrgency;
  jobThreshold?: number;
}): PriorityDecisionPayload & { priority: N8nPriority } {
  const threshold = input.jobThreshold ?? N8N_JOB_PRIORITY_THRESHOLD;
  const jobReferenceConfidence = Number.isFinite(input.jobReferenceConfidence)
    ? Math.max(0, Math.min(1, input.jobReferenceConfidence))
    : 0;
  const jobRelated = jobReferenceConfidence >= threshold;
  const containsActionRequest = input.containsActionRequest === true;
  const hasExplicitDeadline = input.hasExplicitDeadline === true;
  const deadlineUrgency = input.deadlineUrgency ?? "NONE";

  let priority: N8nPriority;
  let rule: PriorityDecisionRule;

  if (!jobRelated) {
    priority = "LOW";
    rule = "NO_CONFIDENT_JOB_MATCH";
  } else if (!containsActionRequest) {
    priority = "LOW";
    rule = "JOB_WITHOUT_ACTION_REQUEST";
  } else if (!hasExplicitDeadline) {
    priority = "NORMAL";
    rule = "JOB_WITH_ACTION_NO_DEADLINE";
  } else if (deadlineUrgency === "URGENT") {
    priority = "URGENT";
    rule = "JOB_WITH_ACTION_URGENT_DEADLINE";
  } else {
    // STANDARD (or any non-URGENT explicit deadline)
    priority = "HIGH";
    rule = "JOB_WITH_ACTION_DEADLINE";
  }

  return {
    priority,
    rule,
    jobRelated,
    jobReferenceConfidence,
    jobThreshold: threshold,
    containsActionRequest,
    hasExplicitDeadline,
    deadlineUrgency,
  };
}

/** Map n8n priority → stored enum (existing ingest behavior). */
export function mapN8nPriorityToStored(priority: string): StoredPriority {
  switch (priority) {
    case "URGENT":
      return "URGENT";
    case "HIGH":
      return "HIGH";
    case "NORMAL":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    case "MEDIUM":
      return "MEDIUM";
    default:
      return "MEDIUM";
  }
}

/** Map stored Prisma priority → n8n vocabulary for parity comparisons. */
export function mapStoredPriorityToN8n(
  priority: string | null | undefined
): N8nPriority | null {
  if (!priority) return null;
  switch (priority) {
    case "URGENT":
      return "URGENT";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
    case "NORMAL":
      return "NORMAL";
    case "LOW":
      return "LOW";
    default:
      return null;
  }
}

/** UI label for application-facing priority (NORMAL, not MEDIUM). */
export function priorityDisplayLabel(priority: string | null | undefined): string {
  if (!priority) return "Not set";
  switch (priority) {
    case "URGENT":
      return "Urgent";
    case "HIGH":
      return "High";
    case "NORMAL":
    case "MEDIUM":
      return "Normal";
    case "LOW":
      return "Low";
    default:
      return priority;
  }
}

const RULE_REASONS: Record<string, string> = {
  NO_CONFIDENT_JOB_MATCH: "No confident job match",
  JOB_WITHOUT_ACTION_REQUEST: "Job-related email with no action request",
  JOB_WITH_ACTION_NO_DEADLINE: "Job-related action with no deadline",
  JOB_WITH_ACTION_DEADLINE: "Job-related action with deadline",
  JOB_WITH_ACTION_URGENT_DEADLINE: "Job-related action with urgent deadline",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Pull priorityDecision from Classification.classificationEvidence JSON. */
export function extractPriorityDecision(evidence: unknown): PriorityDecisionPayload | null {
  const root = asRecord(evidence);
  if (!root) return null;
  const raw = root.priorityDecision;
  const pd = asRecord(raw);
  if (!pd) return null;
  return pd as PriorityDecisionPayload;
}

function pct(value: number | null | undefined): number | null {
  if (value == null || typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

/**
 * Build Email Review "Priority Reason" view model from persisted evidence.
 * Returns null when priorityDecision is absent (historical records).
 */
export function buildPriorityDecisionViewModel(input: {
  priority?: string | null;
  evidence?: unknown;
  priorityDecision?: PriorityDecisionPayload | null;
}): PriorityDecisionViewModel | null {
  const decision =
    input.priorityDecision ?? extractPriorityDecision(input.evidence);
  if (!decision || typeof decision !== "object") return null;

  const rule = typeof decision.rule === "string" ? decision.rule : "";
  const reason =
    RULE_REASONS[rule] ??
    (rule
      ? rule.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
      : "Priority decision recorded");

  const jobConfidencePct = pct(decision.jobReferenceConfidence);
  const jobThresholdPct = pct(
    typeof decision.jobThreshold === "number"
      ? decision.jobThreshold
      : N8N_JOB_PRIORITY_THRESHOLD
  );

  const actionRequestedLabel =
    typeof decision.containsActionRequest === "boolean"
      ? decision.containsActionRequest
        ? "Yes"
        : "No"
      : null;

  let deadlineLabel: PriorityDecisionViewModel["deadlineLabel"] = null;
  if (typeof decision.hasExplicitDeadline === "boolean") {
    if (!decision.hasExplicitDeadline) {
      deadlineLabel = "None";
    } else if (decision.deadlineUrgency === "URGENT") {
      deadlineLabel = "Urgent";
    } else {
      deadlineLabel = "Yes";
    }
  } else if (decision.deadlineUrgency === "URGENT") {
    deadlineLabel = "Urgent";
  } else if (decision.deadlineUrgency === "STANDARD") {
    deadlineLabel = "Yes";
  } else if (decision.deadlineUrgency === "NONE") {
    deadlineLabel = "None";
  }

  // Field visibility follows Email Review examples (rule-driven).
  const showJobConfidence = jobConfidencePct != null;
  const showRequiredThreshold = rule === "NO_CONFIDENT_JOB_MATCH";
  const showActionRequested =
    rule === "JOB_WITHOUT_ACTION_REQUEST" ||
    rule === "JOB_WITH_ACTION_NO_DEADLINE" ||
    rule === "JOB_WITH_ACTION_DEADLINE" ||
    rule === "JOB_WITH_ACTION_URGENT_DEADLINE";
  const showDeadline =
    rule === "JOB_WITH_ACTION_NO_DEADLINE" ||
    rule === "JOB_WITH_ACTION_DEADLINE" ||
    rule === "JOB_WITH_ACTION_URGENT_DEADLINE";

  return {
    displayLabel: priorityDisplayLabel(input.priority),
    reason,
    jobConfidencePct,
    jobThresholdPct: showRequiredThreshold ? jobThresholdPct : null,
    actionRequestedLabel: showActionRequested ? actionRequestedLabel : null,
    deadlineLabel: showDeadline ? deadlineLabel : null,
    showJobConfidence,
    showActionRequested,
    showDeadline,
  };
}
