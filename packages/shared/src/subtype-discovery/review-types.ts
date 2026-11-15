/**
 * Subtype recommendation review / approval / taxonomy revision types.
 * Approval mutates workspace BusinessType + TaxonomyRevision only — never Classification rows.
 */

import type { SubtypeDiscoveryRecommendation } from "./types.js";

export type SubtypeRecommendationDecisionStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "MERGED"
  | "DEFERRED";

export type SubtypeRecommendationEditPayload = {
  suggestedSubtypeName: string;
  /** UPPER_SNAKE system key; validated server-side. */
  systemKey: string;
  recommendedParentType: "BUSINESS";
  definition: string;
  inclusionCriteria: string;
  exclusionCriteria: string;
};

export type SubtypeRecommendationDecisionDto = {
  id: string;
  discoveryRunId: string;
  recommendationId: string;
  status: SubtypeRecommendationDecisionStatus;
  editedPayload: SubtypeRecommendationEditPayload | null;
  mergeTargetKey: string | null;
  notes: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  taxonomyRevisionId: string | null;
};

export type TaxonomyRevisionChangeType =
  | "ADD_SUBTYPE"
  | "EDIT_SUBTYPE"
  | "MERGE_SUBTYPE"
  | "DEACTIVATE_SUBTYPE"
  | "ROLLBACK";

export type TaxonomyRevisionStatus = "ACTIVE" | "SUPERSEDED" | "ROLLED_BACK";

export type TaxonomyRevisionDto = {
  id: string;
  version: number;
  status: TaxonomyRevisionStatus;
  changeType: TaxonomyRevisionChangeType;
  payload: Record<string, unknown>;
  businessTypeId: string | null;
  systemKey: string | null;
  discoveryRunId: string | null;
  recommendationId: string | null;
  approvedByUserId: string;
  createdAt: string;
  rolledBackAt: string | null;
  rolledBackByUserId: string | null;
  rollbackOfRevisionId: string | null;
};

/** Effective recommendation after optional edits (for display / approve preview). */
export function effectiveRecommendation(
  rec: SubtypeDiscoveryRecommendation,
  edit: SubtypeRecommendationEditPayload | null | undefined
): SubtypeDiscoveryRecommendation & { systemKey?: string } {
  if (!edit) return rec;
  return {
    ...rec,
    suggestedSubtypeName: edit.suggestedSubtypeName,
    recommendedParentType: edit.recommendedParentType,
    definition: edit.definition,
    inclusionCriteria: edit.inclusionCriteria,
    exclusionCriteria: edit.exclusionCriteria,
    systemKey: edit.systemKey,
  };
}

/**
 * Derive a candidate system key from a display name.
 * Does not guarantee uniqueness — caller must validate against taxonomy.
 */
export function suggestSystemKeyFromName(name: string): string {
  const raw = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!raw) return "CUSTOM_SUBTYPE";
  if (/^[0-9]/.test(raw)) return `T_${raw}`.slice(0, 48);
  return raw.slice(0, 48);
}

export function isValidSystemKey(key: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,47}$/.test(key);
}

export const SUBTYPE_TAXONOMY_EVAL_METHODOLOGY = [
  "Experimental taxonomy comparison — not production classifier accuracy.",
  "Coverage and distributions are descriptive counts on the evaluation dataset.",
  "Precision / confusion are reported ONLY when independent ground-truth labels exist",
  "(ClassificationCorrection.correctedBusinessType human labels).",
  "Proposed assignments for NEW_SUBTYPE recommendations use discovery supporting email ids",
  "as a simulation of cluster membership — not a live model reclassification.",
  "Historical Classification rows are never rewritten by approval or this evaluation.",
].join(" ");
