import { StructuredOutputValidationError } from "../openai/responses-json.js";
import {
  INLINE_IMAGE_NOISE_REASONS,
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
  INLINE_IMAGE_RELEVANCE_VALUES,
  type InlineImageNoiseReason,
  type InlineImageRelevance,
} from "./constants.js";
import { clampEvidence, type InlineImageDecision } from "./deterministic.js";

const ALLOWED_KEYS = new Set(["relevance", "noiseReason", "confidence", "evidence"]);

function isRelevance(value: unknown): value is InlineImageRelevance {
  return (
    typeof value === "string" &&
    (INLINE_IMAGE_RELEVANCE_VALUES as readonly string[]).includes(value)
  );
}

function isNoiseReason(value: unknown): value is InlineImageNoiseReason {
  return (
    typeof value === "string" &&
    (INLINE_IMAGE_NOISE_REASONS as readonly string[]).includes(value)
  );
}

/** Strict structured output. Unknown keys and unknown enums fail. */
export function parseInlineImageRelevanceOutput(value: unknown): InlineImageDecision {
  const issues: string[] = [];
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new StructuredOutputValidationError("inline image relevance", ["output must be an object"]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) issues.push(`unknown key ${key}`);
  }
  if (!isRelevance(record.relevance)) issues.push("relevance is invalid");
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence)) {
    issues.push("confidence must be a number");
  } else if (record.confidence < 0 || record.confidence > 1) {
    issues.push("confidence must be between 0 and 1");
  }
  if (typeof record.evidence !== "string" || record.evidence.trim().length === 0) {
    issues.push("evidence must be a short string");
  }

  const relevance = isRelevance(record.relevance) ? record.relevance : null;
  if (relevance === "NOISE") {
    if (!isNoiseReason(record.noiseReason)) issues.push("noiseReason is invalid");
  } else if (record.noiseReason !== null) {
    issues.push("noiseReason must be null unless relevance is NOISE");
  }

  if (issues.length > 0 || !relevance || typeof record.confidence !== "number") {
    throw new StructuredOutputValidationError(
      "inline image relevance",
      issues.length > 0 ? issues : ["invalid output"]
    );
  }
  if (typeof record.evidence !== "string") {
    throw new StructuredOutputValidationError("inline image relevance", [
      "evidence must be a short string",
    ]);
  }

  const noiseReason = relevance === "NOISE" && isNoiseReason(record.noiseReason)
    ? record.noiseReason
    : null;

  return {
    relevance,
    noiseReason,
    confidence: record.confidence,
    method: "VISION",
    analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
    evidence: clampEvidence(record.evidence),
    sourceAttachmentId: null,
  };
}
