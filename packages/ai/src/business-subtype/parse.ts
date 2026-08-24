import {
  isPlainObject,
  requireFiniteProbability,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import {
  BUSINESS_SUBTYPE_KEYS,
  type BusinessSubtypeKey,
  type BusinessSubtypeResult,
} from "./prompt.js";

export function parseBusinessSubtypeResult(raw: unknown): BusinessSubtypeResult {
  const issues: string[] = [];
  if (!isPlainObject(raw)) {
    throw new StructuredOutputValidationError("business subtype", [
      "response must be a JSON object",
    ]);
  }

  for (const key of Object.keys(raw)) {
    if (key !== "businessType" && key !== "businessTypeConfidence") {
      issues.push(`unexpected property "${key}"`);
    }
  }

  let businessType: BusinessSubtypeKey | null = null;
  if (typeof raw.businessType !== "string") {
    issues.push("businessType must be a string");
  } else if (
    !(BUSINESS_SUBTYPE_KEYS as readonly string[]).includes(raw.businessType)
  ) {
    issues.push(
      `businessType must be one of the allowed enum values (got "${raw.businessType}")`
    );
  } else {
    businessType = raw.businessType as BusinessSubtypeKey;
  }

  const businessTypeConfidence = requireFiniteProbability(
    raw.businessTypeConfidence,
    "businessTypeConfidence",
    issues
  );

  if (issues.length > 0 || businessType == null || businessTypeConfidence == null) {
    throw new StructuredOutputValidationError(
      "business subtype",
      issues.length > 0 ? issues : ["incomplete business subtype payload"]
    );
  }

  return { businessType, businessTypeConfidence };
}
