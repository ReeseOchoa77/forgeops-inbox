/**
 * Feature gates for paused AI automation.
 * Infrastructure stays in place; these flags stop automatic / accidental runs.
 *
 * Defaults are OFF (frozen). Set env to "true" or "1" to re-enable.
 * Missing / empty / "false" / "0" / any other value = disabled (safe default).
 */

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Email Agent V1 — automatic Email → Job assignment freeze.
 *
 * When false (default), JobMatcher / classifier / n8n / reclassify results are
 * NOT written to EmailMessage.jobId or Classification.jobId via
 * persistJobMatchResult. Candidate computation may still run for evidence.
 *
 * Authoritative paths (always allowed; not gated by this flag):
 * - USER_ASSIGNED — manual Assign Job / bidding assign / move
 * - VERIFIED_PROJECT_FOLDER — verified Outlook Project Folder analyze
 *
 * Escape hatch: set JOB_MATCHER_AUTO_ASSIGN_ENABLED=true|1 to re-enable
 * probabilistic persistence (AI_AUTO_ASSIGNED / AI_SUGGESTED / JOB_NUMBER_MATCH).
 * Production/default must remain OFF.
 *
 * JobMatcher library, candidates APIs, and historical match data remain available.
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
