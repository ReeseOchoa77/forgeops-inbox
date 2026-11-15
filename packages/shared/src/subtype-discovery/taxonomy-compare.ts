/**
 * Compare discovered cluster patterns against the existing BUSINESS_SUBTYPE taxonomy.
 * Does not invent confidence percentages — uses documented cohesion + label overlap.
 */

import {
  BUSINESS_SUBTYPE_KEYS,
  BUSINESS_SUBTYPE_LABELS,
  type BusinessSubtypeKey,
} from "../business-subtypes.js";
import type { SubtypeDiscoveryRecommendationKind } from "./types.js";

export function taxonomyLabelList(): Array<{ key: string; label: string }> {
  return BUSINESS_SUBTYPE_KEYS.map((key) => ({
    key,
    label: BUSINESS_SUBTYPE_LABELS[key],
  }));
}

export function classifyClusterAgainstTaxonomy(input: {
  suggestedName: string | null;
  similarExistingKeys: string[];
  /** Share of labeled members with the dominant existing subtype (0–1). */
  dominantExistingShare: number;
  clusterSize: number;
  analyzedCount: number;
  /** Mean internal cosine similarity. */
  clusterCohesion: number;
  llmKind?: SubtypeDiscoveryRecommendationKind | null;
}): {
  kind: SubtypeDiscoveryRecommendationKind;
  similarExistingSubtypes: string[];
  rationalePrefix: string;
} {
  const similar = input.similarExistingKeys.filter((k) =>
    (BUSINESS_SUBTYPE_KEYS as readonly string[]).includes(k)
  );
  const labels = similar.map(
    (k) => BUSINESS_SUBTYPE_LABELS[k as BusinessSubtypeKey] ?? k
  );

  // Prefer LLM kind when provided and coherent; otherwise derive.
  if (input.llmKind && input.llmKind !== "NEW_SUBTYPE") {
    return {
      kind: input.llmKind,
      similarExistingSubtypes: labels,
      rationalePrefix: kindRationale(input.llmKind, labels),
    };
  }

  if (input.clusterCohesion < 0.72 || input.clusterSize < 3) {
    return {
      kind: "UNCLEAR",
      similarExistingSubtypes: labels,
      rationalePrefix:
        "Cluster cohesion or size is too weak for a taxonomy change recommendation.",
    };
  }

  // Large share already under one subtype → likely existing match or refinement
  if (similar.length > 0 && input.dominantExistingShare >= 0.7) {
    return {
      kind: "EXISTING_MATCH",
      similarExistingSubtypes: labels,
      rationalePrefix: `Most labeled emails already use ${labels[0] ?? similar[0]}.`,
    };
  }

  if (similar.length >= 2 && input.dominantExistingShare < 0.55) {
    return {
      kind: "MERGE_CANDIDATE",
      similarExistingSubtypes: labels,
      rationalePrefix: `Emails span overlapping subtypes (${labels.join(", ")}).`,
    };
  }

  if (similar.length === 1 && input.dominantExistingShare >= 0.4) {
    return {
      kind: "REFINEMENT",
      similarExistingSubtypes: labels,
      rationalePrefix: `Pattern may refine ${labels[0]}.`,
    };
  }

  // Size alone does not justify a new subtype — require cohesion + low overlap
  const share = input.analyzedCount > 0 ? input.clusterSize / input.analyzedCount : 0;
  if (share < 0.01 && input.clusterSize < 8) {
    return {
      kind: "UNCLEAR",
      similarExistingSubtypes: labels,
      rationalePrefix:
        "Cluster is small relative to the analyzed set; not enough evidence for a new subtype.",
    };
  }

  return {
    kind: input.llmKind === "NEW_SUBTYPE" ? "NEW_SUBTYPE" : "NEW_SUBTYPE",
    similarExistingSubtypes: labels,
    rationalePrefix:
      similar.length === 0
        ? "No strong overlap with existing subtype keys."
        : `Partial overlap with ${labels.join(", ")}; LLM suggested a distinct label.`,
  };
}

function kindRationale(
  kind: SubtypeDiscoveryRecommendationKind,
  labels: string[]
): string {
  switch (kind) {
    case "EXISTING_MATCH":
      return `Already covered by existing subtype(s): ${labels.join(", ") || "—"}.`;
    case "REFINEMENT":
      return `Possible refinement of ${labels.join(", ") || "an existing subtype"}.`;
    case "MERGE_CANDIDATE":
      return `Possible merge across ${labels.join(", ") || "overlapping subtypes"}.`;
    case "UNCLEAR":
      return "Cluster intent is unclear; no taxonomy change recommended.";
    case "NEW_SUBTYPE":
    default:
      return "Candidate for a new subtype pending human review.";
  }
}
