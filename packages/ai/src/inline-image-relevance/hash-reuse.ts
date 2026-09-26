import {
  INLINE_IMAGE_MODEL_HASH_MIN_CONFIDENCE,
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
} from "./constants.js";
import type { InlineImageDecision } from "./deterministic.js";

export type HashReuseSource = {
  workspaceId: string;
  emailAttachmentId: string;
  relevance: InlineImageDecision["relevance"];
  noiseReason: InlineImageDecision["noiseReason"];
  confidence: number;
  method: "HUMAN" | "VISION";
  evidence: string;
};

/**
 * Exact checksum reuse inside one workspace.
 * UNCERTAIN results are never copied. Model results need high confidence.
 * The returned evidence does not include sender, job, filename, or email text.
 */
export function hashReuseDecision(input: {
  workspaceId: string;
  human: HashReuseSource | null;
  model: HashReuseSource | null;
}): InlineImageDecision | null {
  const human = usable(input.workspaceId, input.human);
  if (human && (human.relevance === "RELEVANT" || human.relevance === "NOISE")) {
    return {
      relevance: human.relevance,
      noiseReason: human.relevance === "NOISE" ? human.noiseReason : null,
      confidence: human.confidence,
      method: "HUMAN_CONFIRMED_HASH_MATCH",
      analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
      evidence: "exact checksum match of a human-confirmed image in this workspace",
      sourceAttachmentId: human.emailAttachmentId,
    };
  }

  const model = usable(input.workspaceId, input.model);
  if (
    model &&
    (model.relevance === "RELEVANT" || model.relevance === "NOISE") &&
    model.confidence >= INLINE_IMAGE_MODEL_HASH_MIN_CONFIDENCE
  ) {
    return {
      relevance: model.relevance,
      noiseReason: model.relevance === "NOISE" ? model.noiseReason : null,
      confidence: model.confidence,
      method: "MODEL_HASH_MATCH",
      analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
      evidence: "exact checksum match of a vision classification in this workspace",
      sourceAttachmentId: model.emailAttachmentId,
    };
  }

  return null;
}

function usable(workspaceId: string, source: HashReuseSource | null): HashReuseSource | null {
  if (!source) return null;
  if (source.workspaceId !== workspaceId) return null;
  if (source.relevance === "UNCERTAIN") return null;
  if (source.relevance === "NOISE" && source.noiseReason == null) return null;
  return source;
}
