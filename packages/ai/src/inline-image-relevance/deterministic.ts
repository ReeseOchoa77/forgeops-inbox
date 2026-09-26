import {
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
  normalizeImageMimeType,
  type InlineImageNoiseReason,
  type InlineImageRelevance,
  type InlineImageRelevanceMethod,
} from "./constants.js";

export type InlineImageDecision = {
  relevance: InlineImageRelevance;
  noiseReason: InlineImageNoiseReason | null;
  confidence: number;
  method: InlineImageRelevanceMethod;
  analyzerVersion: string;
  evidence: string;
  sourceAttachmentId: string | null;
};

const EVIDENCE_MAX = 160;

export function clampEvidence(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= EVIDENCE_MAX) return trimmed;
  return trimmed.slice(0, EVIDENCE_MAX);
}

/**
 * Extremely strong metadata only.
 * Returns null when the image should continue to hash reuse or vision.
 * Filename is intentionally unused.
 */
export function deterministicInlineImageDecision(input: {
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  messageCount: number;
  threadCount: number;
}): InlineImageDecision | null {
  const mime = normalizeImageMimeType(input.mimeType);
  const width = input.width;
  const height = input.height;
  const bothKnown = width != null && height != null && width > 0 && height > 0;

  if (bothKnown && width <= 2 && height <= 2) {
    return noise("TRACKING_PIXEL", 0.97, "image is 2 pixels or smaller");
  }

  if (mime === "image/gif" && input.sizeBytes > 0 && input.sizeBytes <= 40) {
    return noise("TRACKING_PIXEL", 0.9, "tiny gif consistent with a tracking pixel");
  }

  const maxDim = bothKnown ? Math.max(width, height) : null;
  const repeated =
    bothKnown &&
    maxDim != null &&
    maxDim <= 48 &&
    input.messageCount >= 10 &&
    input.threadCount >= 4 &&
    input.sizeBytes > 0 &&
    input.sizeBytes <= 50_000;

  if (repeated) {
    return noise(
      "REPEATED_BRANDING",
      0.82,
      "identical small image recurs across many threads in this workspace"
    );
  }

  return null;
}

function noise(
  noiseReason: InlineImageNoiseReason,
  confidence: number,
  evidence: string
): InlineImageDecision {
  return {
    relevance: "NOISE",
    noiseReason,
    confidence,
    method: "DETERMINISTIC",
    analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
    evidence: clampEvidence(evidence),
    sourceAttachmentId: null,
  };
}

export function unsupportedImageDecision(): InlineImageDecision {
  return {
    relevance: "UNCERTAIN",
    noiseReason: null,
    confidence: 0,
    method: "DETERMINISTIC",
    analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
    evidence: "image format is not classified in this version",
    sourceAttachmentId: null,
  };
}

export function oversizeImageDecision(): InlineImageDecision {
  return {
    relevance: "UNCERTAIN",
    noiseReason: null,
    confidence: 0,
    method: "DETERMINISTIC",
    analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
    evidence: "image exceeds the vision size cap",
    sourceAttachmentId: null,
  };
}

export function failedImageDecision(evidence: string): InlineImageDecision {
  return {
    relevance: "UNCERTAIN",
    noiseReason: null,
    confidence: 0,
    method: "DETERMINISTIC",
    analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
    evidence: clampEvidence(evidence),
    sourceAttachmentId: null,
  };
}
