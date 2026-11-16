/**
 * Helpers for switching among per-policy evaluation results without rematching.
 */
import { experimentRevisionForIdentityPolicy } from '@forgeops/shared/jobs/job-name-identity-policy'
import type {
  JobMatcherEvalPolicyResultBundle,
  JobMatcherEvalResult,
  JobMatcherIdentityPolicy,
} from './api'

export function policyLabelSuffix(policy: JobMatcherIdentityPolicy): string {
  if (policy === 'CONTEXT_AWARE_V2') return ' (production)'
  if (policy === 'CONTEXT_AWARE_V2_1') return ' (title-gap experiment)'
  if (policy === 'CONTEXT_AWARE_V2_2') return ' (unique-token experiment)'
  if (policy === 'CONTEXT_AWARE_V2_3')
    return ' (normalized subject identity experiment)'
  if (policy === 'CONTEXT_AWARE_V2_4')
    return ' (contextual word search experiment)'
  if (policy === 'CONTEXT_AWARE_V3')
    return ' (dynamic word importance experiment)'
  return ''
}

/**
 * Compact tab label for Results model selector (registry displayName prefix,
 * else strip CONTEXT_AWARE_). Dynamic — not limited to V2–V2.3.
 */
export function policyTabShortLabel(
  policy: JobMatcherIdentityPolicy,
  displayName?: string | null
): string {
  const fromRegistry = displayName?.split('—')[0]?.trim()
  if (fromRegistry) return fromRegistry
  return policy.replace(/^CONTEXT_AWARE_/, '').replace(/^BASELINE$/, 'Baseline')
}

/** Show Results model tabs only for multi-model evaluation payloads. */
export function shouldShowResultModelTabs(
  policies: readonly JobMatcherIdentityPolicy[]
): boolean {
  return policies.length >= 2
}

/** True when a scored policy bundle uses the current independent experiment revision. */
export function isCurrentExperimentRevision(
  bundle: Pick<JobMatcherEvalPolicyResultBundle, 'identityPolicy' | 'experimentRevision'>,
  currentRevision?: string
): boolean {
  const expected =
    experimentRevisionForIdentityPolicy(bundle.identityPolicy) ??
    currentRevision ??
    null
  if (expected == null) return true
  return bundle.experimentRevision === expected
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
