import {
  isPlainObject,
  requireFiniteProbability,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { SUBTYPE_CLASSIFIER_VERSION } from "./evidence-packet.js";
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

  const allowed = new Set([
    "businessType",
    "businessTypeConfidence",
    "competingType",
    "evidence",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
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

  let competingType: BusinessSubtypeKey | null = null;
  if (raw.competingType === null) {
    competingType = null;
  } else if (typeof raw.competingType !== "string") {
    issues.push("competingType must be an allowed subtype or null");
  } else if (!(BUSINESS_SUBTYPE_KEYS as readonly string[]).includes(raw.competingType)) {
    issues.push(`competingType is not an allowed subtype (got "${raw.competingType}")`);
  } else if (raw.competingType === businessType) {
    issues.push("competingType must differ from businessType");
  } else {
    competingType = raw.competingType as BusinessSubtypeKey;
  }

  const evidence: string[] = [];
  if (!Array.isArray(raw.evidence) || raw.evidence.length < 1 || raw.evidence.length > 4) {
    issues.push("evidence must be 1 to 4 short strings");
  } else {
    for (const item of raw.evidence) {
      if (typeof item !== "string" || item.trim().length === 0 || item.length > 240) {
        issues.push("each evidence marker must be a non-empty string up to 240 characters");
        break;
      }
      evidence.push(item.trim());
    }
  }

  if (
    issues.length > 0 ||
    businessType == null ||
    businessTypeConfidence == null ||
    evidence.length === 0
  ) {
    throw new StructuredOutputValidationError(
      "business subtype",
      issues.length > 0 ? issues : ["incomplete business subtype payload"]
    );
  }

  return {
    businessType,
    businessTypeConfidence,
    competingType,
    evidence,
    classifierVersion: SUBTYPE_CLASSIFIER_VERSION,
  };
}
