/**
 * Extract full comparable n8n classification result from persisted records.
 * Read-only — does not recompute decisions.
 *
 * Persistence map (verified against n8n-ingest):
 * - businessType → Classification.businessTypeKey (+ rawAiPayload.businessType)
 * - businessTypeConfidence → Classification.businessTypeConfidence
 * - selectedCustomerId → Classification.customerId (n8n selectedCustomerId)
 * - selectedVendorId → Classification.vendorId
 * - selectedJobId → rawAiPayload.selectedJobId ONLY
 *     (Classification.jobId / EmailMessage.jobId are ForgeOps JobMatcher, not n8n)
 * - entityMatchConfidence / matchEvidence → Classification columns
 * - tasks → Task rows (title, description/summary, dueAt, assigneeGuess, confidence)
 *     fallback: rawAiPayload.tasks
 * - priority → Classification.priority (NORMAL stored as MEDIUM)
 * - priorityDecision → classificationEvidence.priorityDecision
 */

import {
  extractHistoricalN8nComparableSignals,
  type HistoricalClassificationSnapshot,
  type HistoricalN8nComparableSignals,
} from "./historical-n8n-signals.js";
import {
  mapStoredPriorityToN8n,
  type PriorityDecisionPayload,
} from "./priority-decision.js";

export interface HistoricalN8nTask {
  title: string;
  description: string | null;
  dueDate: string | null;
  recommendedOwner: string | null;
  confidence: number | null;
}

export interface HistoricalN8nFullResult extends HistoricalN8nComparableSignals {
  businessType: string | null;
  businessTypeConfidence: number | null;
  selectedCustomerId: string | null;
  selectedVendorId: string | null;
  /** n8n hint only — never Classification.jobId (JobMatcher). */
  selectedJobId: string | null;
  entityMatchConfidence: number | null;
  matchEvidence: string[] | null;
  tasks: HistoricalN8nTask[] | null;
  /** n8n priority vocabulary: LOW | NORMAL | HIGH | URGENT */
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT" | null;
  priorityDecision: PriorityDecisionPayload | null;
}

export interface HistoricalTaskSnapshot {
  title: string;
  description?: string | null;
  summary?: string | null;
  dueAt?: Date | string | null;
  assigneeGuess?: string | null;
  confidence?: { toString(): string } | number | null;
}

export interface HistoricalFullClassificationSnapshot
  extends HistoricalClassificationSnapshot {
  businessTypeKey?: string | null | undefined;
  businessTypeConfidence?: { toString(): string } | number | null | undefined;
  customerId?: string | null | undefined;
  vendorId?: string | null | undefined;
  /** ForgeOps JobMatcher job — NOT used for n8n selectedJobId parity. */
  jobId?: string | null | undefined;
  entityMatchConfidence?: { toString(): string } | number | null | undefined;
  matchEvidence?: unknown;
  priority?: string | null | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFiniteProbability(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  if (value != null && typeof value === "object" && "toString" in value) {
    const n = Number((value as { toString(): string }).toString());
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value;
}

function dueDateToIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return value.trim();
  }
  return null;
}

function tasksFromRows(rows: HistoricalTaskSnapshot[]): HistoricalN8nTask[] {
  return rows.map((t) => ({
    title: t.title,
    description: t.description ?? t.summary ?? null,
    dueDate: dueDateToIso(t.dueAt ?? null),
    recommendedOwner: t.assigneeGuess ?? null,
    confidence: asFiniteProbability(t.confidence ?? null),
  }));
}

function tasksFromRaw(raw: Record<string, unknown> | null): HistoricalN8nTask[] | null {
  if (!raw || !Array.isArray(raw.tasks)) return null;
  const out: HistoricalN8nTask[] = [];
  for (const item of raw.tasks) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (typeof t.title !== "string" || !t.title.trim()) continue;
    out.push({
      title: t.title,
      description: typeof t.description === "string" ? t.description : null,
      dueDate: dueDateToIso(t.dueDate ?? null),
      recommendedOwner:
        typeof t.recommendedOwner === "string" ? t.recommendedOwner : null,
      confidence: asFiniteProbability(t.confidence),
    });
  }
  return out;
}

/**
 * Map stored Prisma priority back to n8n vocabulary for comparison.
 */
function toN8nPriority(
  stored: string | null | undefined
): "LOW" | "NORMAL" | "HIGH" | "URGENT" | null {
  return mapStoredPriorityToN8n(stored);
}

export function extractHistoricalN8nFullResult(input: {
  classification: HistoricalFullClassificationSnapshot | null | undefined;
  messageMailboxCategory?: string | null | undefined;
  tasks?: HistoricalTaskSnapshot[] | null | undefined;
}): HistoricalN8nFullResult {
  const base = extractHistoricalN8nComparableSignals({
    classification: input.classification,
    messageMailboxCategory: input.messageMailboxCategory,
  });

  const classification = input.classification ?? null;
  const raw = asRecord(classification?.rawAiPayload);
  const evidence = asRecord(classification?.classificationEvidence);
  const fieldSources = { ...base.fieldSources };
  const unavailableFields = [...base.unavailableFields];

  // --- subtype ---
  let businessType: string | null =
    asNullableString(classification?.businessTypeKey) ??
    asNullableString(raw?.businessType);
  if (businessType) {
    fieldSources.businessType = classification?.businessTypeKey
      ? "Classification.businessTypeKey"
      : "rawAiPayload.businessType";
  } else {
    fieldSources.businessType = null;
    unavailableFields.push("businessType");
  }

  let businessTypeConfidence =
    asFiniteProbability(classification?.businessTypeConfidence ?? null) ??
    asFiniteProbability(raw?.businessTypeConfidence);
  if (businessTypeConfidence != null) {
    fieldSources.businessTypeConfidence = classification?.businessTypeConfidence != null
      ? "Classification.businessTypeConfidence"
      : "rawAiPayload.businessTypeConfidence";
  } else {
    fieldSources.businessTypeConfidence = null;
    unavailableFields.push("businessTypeConfidence");
  }

  // --- entities ---
  let selectedCustomerId =
    asNullableString(classification?.customerId) ??
    asNullableString(raw?.selectedCustomerId);
  // Distinguish explicit null in raw vs missing: if column is null and raw has null, still "available" as null for BUSINESS?
  // Treat present column (including null) as available when classification exists and mailbox is BUSINESS.
  // Simpler: if classification row exists, customerId column is authoritative (may be null).
  if (classification) {
    selectedCustomerId = asNullableString(classification.customerId);
    // If column null, still allow raw fallback for older rows
    if (selectedCustomerId == null && raw && "selectedCustomerId" in raw) {
      selectedCustomerId = asNullableString(raw.selectedCustomerId);
      fieldSources.selectedCustomerId = "rawAiPayload.selectedCustomerId";
    } else {
      fieldSources.selectedCustomerId = "Classification.customerId";
    }
  } else {
    fieldSources.selectedCustomerId = null;
    unavailableFields.push("selectedCustomerId");
    selectedCustomerId = null;
  }

  let selectedVendorId: string | null = null;
  if (classification) {
    selectedVendorId = asNullableString(classification.vendorId);
    if (selectedVendorId == null && raw && "selectedVendorId" in raw) {
      selectedVendorId = asNullableString(raw.selectedVendorId);
      fieldSources.selectedVendorId = "rawAiPayload.selectedVendorId";
    } else {
      fieldSources.selectedVendorId = "Classification.vendorId";
    }
  } else {
    fieldSources.selectedVendorId = null;
    unavailableFields.push("selectedVendorId");
  }

  // selectedJobId: NEVER Classification.jobId
  let selectedJobId: string | null = null;
  if (raw && "selectedJobId" in raw) {
    selectedJobId = asNullableString(raw.selectedJobId);
    fieldSources.selectedJobId = "rawAiPayload.selectedJobId";
  } else {
    fieldSources.selectedJobId = null;
    unavailableFields.push("selectedJobId");
  }

  let entityMatchConfidence =
    asFiniteProbability(classification?.entityMatchConfidence ?? null) ??
    asFiniteProbability(raw?.entityMatchConfidence);
  if (entityMatchConfidence != null) {
    fieldSources.entityMatchConfidence =
      classification?.entityMatchConfidence != null
        ? "Classification.entityMatchConfidence"
        : "rawAiPayload.entityMatchConfidence";
  } else {
    fieldSources.entityMatchConfidence = null;
    unavailableFields.push("entityMatchConfidence");
  }

  let matchEvidence: string[] | null = null;
  const fromColumn = classification?.matchEvidence;
  if (Array.isArray(fromColumn)) {
    matchEvidence = fromColumn.filter((x): x is string => typeof x === "string");
    fieldSources.matchEvidence = "Classification.matchEvidence";
  } else if (raw && Array.isArray(raw.matchEvidence)) {
    matchEvidence = raw.matchEvidence.filter((x): x is string => typeof x === "string");
    fieldSources.matchEvidence = "rawAiPayload.matchEvidence";
  } else {
    fieldSources.matchEvidence = null;
    unavailableFields.push("matchEvidence");
  }

  // --- tasks ---
  let tasks: HistoricalN8nTask[] | null = null;
  if (input.tasks && input.tasks.length > 0) {
    tasks = tasksFromRows(input.tasks);
    fieldSources.tasks = "Task[]";
  } else {
    const fromRaw = tasksFromRaw(raw);
    if (fromRaw && fromRaw.length > 0) {
      tasks = fromRaw;
      fieldSources.tasks = "rawAiPayload.tasks";
    } else if (input.tasks && input.tasks.length === 0) {
      // Explicit empty task list from DB is available
      tasks = [];
      fieldSources.tasks = "Task[]";
    } else if (raw && Array.isArray(raw.tasks) && raw.tasks.length === 0) {
      tasks = [];
      fieldSources.tasks = "rawAiPayload.tasks";
    } else {
      fieldSources.tasks = null;
      unavailableFields.push("tasks");
    }
  }

  // --- priority ---
  let priority = toN8nPriority(classification?.priority ?? null);
  if (!priority && raw && typeof raw.priority === "string") {
    priority = toN8nPriority(
      raw.priority === "NORMAL" ? "NORMAL" : String(raw.priority)
    );
    // raw already uses n8n vocab
    if (
      raw.priority === "LOW" ||
      raw.priority === "NORMAL" ||
      raw.priority === "HIGH" ||
      raw.priority === "URGENT"
    ) {
      priority = raw.priority;
      fieldSources.priority = "rawAiPayload.priority";
    }
  } else if (priority) {
    fieldSources.priority = "Classification.priority";
  } else {
    fieldSources.priority = null;
    unavailableFields.push("priority");
  }

  let priorityDecision: PriorityDecisionPayload | null = null;
  const fromEvidence = asRecord(evidence?.priorityDecision);
  const fromRawPd = asRecord(raw?.priorityDecision);
  if (fromEvidence) {
    priorityDecision = fromEvidence as PriorityDecisionPayload;
    fieldSources.priorityDecision = "classificationEvidence.priorityDecision";
  } else if (fromRawPd) {
    priorityDecision = fromRawPd as PriorityDecisionPayload;
    fieldSources.priorityDecision = "rawAiPayload.priorityDecision";
  } else {
    fieldSources.priorityDecision = null;
    unavailableFields.push("priorityDecision");
  }

  // Dedupe unavailable while keeping order
  const seen = new Set<string>();
  const uniqUnavailable = unavailableFields.filter((f) => {
    if (seen.has(f)) return false;
    seen.add(f);
    return true;
  });

  return {
    ...base,
    fieldSources,
    unavailableFields: uniqUnavailable,
    businessType,
    businessTypeConfidence,
    selectedCustomerId,
    selectedVendorId,
    selectedJobId,
    entityMatchConfidence,
    matchEvidence,
    tasks,
    priority,
    priorityDecision,
  };
}
