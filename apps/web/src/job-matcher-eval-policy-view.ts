/**
 * Helpers for switching among per-policy evaluation results without rematching.
 */
import type {
  JobMatcherEvalPolicyResultBundle,
  JobMatcherEvalResult,
  JobMatcherIdentityPolicy,
} from './api'

export function policyLabelSuffix(policy: JobMatcherIdentityPolicy): string {
  if (policy === 'CONTEXT_AWARE_V2') return ' (production)'
  if (policy === 'CONTEXT_AWARE_V2_1') return ' (shadow)'
  if (policy === 'CONTEXT_AWARE_V2_2') return ' (experimental)'
  return ''
}

/** Policies available in this completed run (from policyResults, else legacy single). */
export function availableEvalPolicies(
  result: JobMatcherEvalResult
): JobMatcherIdentityPolicy[] {
  if (result.policyResults && result.policyResults.length > 0) {
    return result.policyResults.map((b) => b.identityPolicy)
  }
  const fallback =
    result.displayIdentityPolicy ?? result.identityPolicy ?? null
  return fallback ? [fallback] : []
}

export type SelectedPolicyView = {
  identityPolicy: JobMatcherIdentityPolicy
  metrics: JobMatcherEvalResult['metrics']
  rows: JobMatcherEvalResult['rows']
  jobBreakdown: JobMatcherEvalResult['jobBreakdown']
  diagnostics: JobMatcherEvalResult['diagnostics']
  wrongMatches: JobMatcherEvalResult['wrongMatches']
  available: true
} | {
  identityPolicy: JobMatcherIdentityPolicy
  available: false
}

/**
 * Resolve metrics + rows for the selected matcher.
 * Never invents zeros for a missing policy — returns available: false.
 */
export function selectPolicyView(
  result: JobMatcherEvalResult,
  selectedPolicy: JobMatcherIdentityPolicy | null
): SelectedPolicyView {
  const preferred =
    selectedPolicy ??
    result.displayIdentityPolicy ??
    result.identityPolicy ??
    null

  if (!preferred) {
    return {
      identityPolicy: 'CONTEXT_AWARE_V2',
      available: false,
    }
  }

  const fromBundles = result.policyResults?.find(
    (b) => b.identityPolicy === preferred
  )
  if (fromBundles) {
    return {
      identityPolicy: preferred,
      metrics: fromBundles.metrics,
      rows: fromBundles.rows,
      jobBreakdown: fromBundles.jobBreakdown,
      diagnostics: fromBundles.diagnostics,
      wrongMatches: fromBundles.wrongMatches,
      available: true,
    }
  }

  // Legacy single-policy responses (pre-policyResults): only the display rows.
  const legacyPolicy =
    result.displayIdentityPolicy ?? result.identityPolicy ?? null
  if (
    legacyPolicy === preferred &&
    (result.displayMetrics ?? result.metrics) &&
    result.rows
  ) {
    return {
      identityPolicy: preferred,
      metrics: result.displayMetrics ?? result.metrics,
      rows: result.rows,
      jobBreakdown: result.jobBreakdown,
      diagnostics: result.diagnostics,
      wrongMatches: result.wrongMatches,
      available: true,
    }
  }

  return { identityPolicy: preferred, available: false }
}

export function defaultSelectedPolicy(
  result: JobMatcherEvalResult
): JobMatcherIdentityPolicy {
  const available = availableEvalPolicies(result)
  const display =
    result.displayIdentityPolicy ?? result.identityPolicy ?? null
  if (display && available.includes(display)) return display
  return available[0] ?? 'CONTEXT_AWARE_V2'
}

/** Type guard for tests / callers. */
export function isPolicyResultBundle(
  value: unknown
): value is JobMatcherEvalPolicyResultBundle {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.identityPolicy === 'string' &&
    Array.isArray(o.rows) &&
    o.metrics != null &&
    typeof o.metrics === 'object'
  )
}
