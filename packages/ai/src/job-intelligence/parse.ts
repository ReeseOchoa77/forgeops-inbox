import {
  emptyExtractionResult,
  parseJobIntelligenceExtraction,
  type JobIntelligenceExtractionResult,
} from "@forgeops/shared";
import {
  isPlainObject,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";

export function parseJobIntelligenceExtractionResponse(
  value: unknown,
  opts: {
    allowedEmailIds: Set<string>;
    allowedAttachmentIds: Set<string>;
  }
): JobIntelligenceExtractionResult {
  if (!isPlainObject(value)) {
    throw new StructuredOutputValidationError("jobIntelligence", [
      "response must be a JSON object",
    ]);
  }
  const result = parseJobIntelligenceExtraction(value, opts);
  if (result.events.length === 0 && result.issues.length > 0 && result.rejectedCount > 0) {
    // Soft-fail: return empty rather than throw when all events rejected —
    // caller still records issues for progress.
  }
  return result;
}

export { emptyExtractionResult };
