/**
 * Job Intelligence email eligibility — based on existing assignment provenance.
 * Does NOT invent calibrated numeric confidence thresholds.
 * Does NOT change Job Matcher production assignment behavior.
 */

export type JobIntelligenceEligibilityTier =
  | "AUTHORITATIVE"
  | "HIGH_CONFIDENCE_AI"
  | "REVIEW_ONLY"
  | "EXCLUDED";

export type JobIntelligenceEligibilityInput = {
  jobId: string | null | undefined;
  jobAssignmentSource: string | null | undefined;
  jobAssignmentIsManual: boolean | null | undefined;
};

const AUTHORITATIVE_SOURCES = new Set([
  "USER_ASSIGNED",
  "VERIFIED_PROJECT_FOLDER",
  "FOLDER_ALIAS",
]);

/**
 * Classify whether an EmailMessage may feed automatic Job Intelligence aggregation.
 *
 * - Manual / human / verified-folder → AUTHORITATIVE (always aggregated)
 * - AI_AUTO_ASSIGNED with jobId → HIGH_CONFIDENCE_AI (aggregated; not treated as human truth)
 * - AI_SUGGESTED / JOB_NUMBER_MATCH / IMPORT without manual → REVIEW_ONLY (excluded from auto aggregation)
 * - No jobId → EXCLUDED
 */
export function classifyJobIntelligenceEligibility(
  input: JobIntelligenceEligibilityInput
): JobIntelligenceEligibilityTier {
  if (!input.jobId) return "EXCLUDED";

  if (input.jobAssignmentIsManual === true) return "AUTHORITATIVE";

  const source = input.jobAssignmentSource ?? null;
  if (source && AUTHORITATIVE_SOURCES.has(source)) return "AUTHORITATIVE";

  if (source === "AI_AUTO_ASSIGNED") return "HIGH_CONFIDENCE_AI";

  // Suggestions, import noise, job-number-only matches stay out of automatic facts.
  if (
    source === "AI_SUGGESTED" ||
    source === "JOB_NUMBER_MATCH" ||
    source === "IMPORT" ||
    source == null
  ) {
    return "REVIEW_ONLY";
  }

  return "REVIEW_ONLY";
}

export function isEligibleForAutomaticAggregation(
  tier: JobIntelligenceEligibilityTier
): boolean {
  return tier === "AUTHORITATIVE" || tier === "HIGH_CONFIDENCE_AI";
}

export function eligibilitySkipReason(
  tier: JobIntelligenceEligibilityTier
): string | null {
  if (tier === "EXCLUDED") return "no_job_assignment";
  if (tier === "REVIEW_ONLY") return "assignment_not_authoritative";
  return null;
}
