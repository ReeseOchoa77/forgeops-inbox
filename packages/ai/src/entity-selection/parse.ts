import {
  isPlainObject,
  requireFiniteProbability,
  requireNullableString,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import {
  emptyEntitySelectionResult,
  type EntitySelectionInput,
  type EntitySelectionResult,
} from "./prompt.js";

const REQUIRED = [
  "selectedCustomerId",
  "selectedVendorId",
  "selectedJobId",
  "entityMatchConfidence",
  "matchEvidence",
] as const;

function candidateIds(
  candidates: Array<{ id: string }> | undefined
): Set<string> {
  return new Set((candidates ?? []).map((c) => c.id));
}

/**
 * Strict entity-selection validation with anti-fabrication checks.
 */
export function parseEntitySelectionResult(
  raw: unknown,
  context: Pick<
    EntitySelectionInput,
    | "customerCandidates"
    | "vendorCandidates"
    | "jobCandidates"
    | "candidateLookupFailed"
  >
): EntitySelectionResult {
  if (context.candidateLookupFailed) {
    // Enforce hard rule regardless of model output.
    return emptyEntitySelectionResult();
  }

  const issues: string[] = [];
  if (!isPlainObject(raw)) {
    throw new StructuredOutputValidationError("entity selection", [
      "response must be a JSON object",
    ]);
  }

  for (const key of Object.keys(raw)) {
    if (!(REQUIRED as readonly string[]).includes(key)) {
      issues.push(`unexpected property "${key}"`);
    }
  }
  for (const key of REQUIRED) {
    if (!(key in raw)) issues.push(`missing required field "${key}"`);
  }

  const selectedCustomerId = requireNullableString(
    raw.selectedCustomerId,
    "selectedCustomerId",
    issues
  );
  const selectedVendorId = requireNullableString(
    raw.selectedVendorId,
    "selectedVendorId",
    issues
  );
  const selectedJobId = requireNullableString(
    raw.selectedJobId,
    "selectedJobId",
    issues
  );

  const entityMatchConfidence = requireFiniteProbability(
    raw.entityMatchConfidence,
    "entityMatchConfidence",
    issues
  );

  let matchEvidence: string[] | null = null;
  if (!Array.isArray(raw.matchEvidence)) {
    issues.push("matchEvidence must be an array");
  } else {
    const items: string[] = [];
    let ok = true;
    for (let i = 0; i < raw.matchEvidence.length; i++) {
      const item = raw.matchEvidence[i];
      if (typeof item !== "string") {
        issues.push(`matchEvidence[${i}] must be a string`);
        ok = false;
      } else {
        items.push(item);
      }
    }
    if (ok) matchEvidence = items;
  }

  const customerIds = candidateIds(context.customerCandidates);
  const vendorIds = candidateIds(context.vendorCandidates);
  const jobIds = candidateIds(context.jobCandidates);

  if (
    selectedCustomerId != null &&
    selectedCustomerId !== undefined &&
    !customerIds.has(selectedCustomerId)
  ) {
    issues.push(
      `selectedCustomerId "${selectedCustomerId}" is not present in customerCandidates`
    );
  }
  if (
    selectedVendorId != null &&
    selectedVendorId !== undefined &&
    !vendorIds.has(selectedVendorId)
  ) {
    issues.push(
      `selectedVendorId "${selectedVendorId}" is not present in vendorCandidates`
    );
  }
  if (
    selectedJobId != null &&
    selectedJobId !== undefined &&
    !jobIds.has(selectedJobId)
  ) {
    issues.push(
      `selectedJobId "${selectedJobId}" is not present in jobCandidates`
    );
  }

  const nothingSelected =
    selectedCustomerId == null &&
    selectedVendorId == null &&
    selectedJobId == null;

  if (
    nothingSelected &&
    entityMatchConfidence != null &&
    entityMatchConfidence !== 0 &&
    issues.length === 0
  ) {
    // Soft consistency: when nothing selected, confidence should be 0.
    // Enforce strictly to match n8n hard rules ("Use 0 when nothing is selected").
    issues.push(
      "entityMatchConfidence must be 0 when no entities are selected"
    );
  }

  if (
    issues.length > 0 ||
    selectedCustomerId === undefined ||
    selectedVendorId === undefined ||
    selectedJobId === undefined ||
    entityMatchConfidence == null ||
    matchEvidence == null
  ) {
    throw new StructuredOutputValidationError(
      "entity selection",
      issues.length > 0 ? issues : ["incomplete entity selection payload"]
    );
  }

  return {
    selectedCustomerId,
    selectedVendorId,
    selectedJobId,
    entityMatchConfidence,
    matchEvidence,
  };
}
