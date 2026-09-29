/**
 * Feature gates for paused AI automation.
 * Infrastructure stays in place; these flags stop automatic / accidental runs.
 *
 * Defaults are OFF (frozen). Set env to "true" or "1" to re-enable.
 */

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * When false (default), JobMatcher results are NOT written to EmailMessage.jobId
 * or Classification.jobId. Code paths that call persistJobMatchResult no-op.
 *
 * Unaffected (authoritative / manual):
 * - USER_ASSIGNED (Jobs API, bidding assign)
 * - VERIFIED_PROJECT_FOLDER (project-folder email analyze)
 *
 * JobMatcher library, candidates APIs, and evidence history remain available.
 */
export function isJobMatcherAutoAssignEnabled(): boolean {
  return envFlagEnabled("JOB_MATCHER_AUTO_ASSIGN_ENABLED");
}

/**
 * When false (default), the Analyze inline images enqueue endpoint refuses new runs.
 * Existing InlineImageRelevanceClassification rows and human corrections remain.
 * There is no automatic enqueue on inbound email; this only gates the manual action.
 */
export function isInlineImageAiAnalyzeEnabled(): boolean {
  return envFlagEnabled("INLINE_IMAGE_AI_ANALYZE_ENABLED");
}
