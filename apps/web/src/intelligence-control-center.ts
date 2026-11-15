/**
 * Intelligence Control Center navigation hierarchy.
 * Maps registry components into product sections without inventing metrics.
 */

import {
  getProductionJobMatchIdentityPolicy,
  JOB_MATCH_POLICY_REGISTRY,
} from '@forgeops/shared'

export type IntelligenceControlSection =
  | 'overview'
  | 'email-classification'
  | 'job-matcher'
  | 'document-intelligence'
  | 'workflow-intelligence'

export type EmailClassificationSub =
  | 'overview'
  | 'type'
  | 'subtype'
  | 'taxonomy'
  | 'evaluations'
  | 'discovery'

export type JobMatcherSub =
  | 'overview'
  | 'policies'
  | 'evaluations'
  | 'comparisons'
  | 'history'

export type DocumentIntelligenceSub = 'overview' | 'systems'
export type WorkflowIntelligenceSub = 'overview' | 'systems'

export type IntelligenceControlSub =
  | EmailClassificationSub
  | JobMatcherSub
  | DocumentIntelligenceSub
  | WorkflowIntelligenceSub

export const INTELLIGENCE_CONTROL_SECTIONS: ReadonlyArray<{
  id: IntelligenceControlSection
  label: string
}> = [
  { id: 'overview', label: 'Overview' },
  { id: 'email-classification', label: 'Email Classification' },
  { id: 'job-matcher', label: 'Job Matcher' },
  { id: 'document-intelligence', label: 'Document Intelligence' },
  { id: 'workflow-intelligence', label: 'Workflow Intelligence' },
]

export const EMAIL_CLASSIFICATION_SUBS: ReadonlyArray<{
  id: EmailClassificationSub
  label: string
}> = [
  { id: 'overview', label: 'Overview' },
  { id: 'type', label: 'Type Classification' },
  { id: 'subtype', label: 'Subtype Classification' },
  { id: 'taxonomy', label: 'Subtype Taxonomy' },
  { id: 'evaluations', label: 'Evaluations' },
  { id: 'discovery', label: 'Subtype Discovery' },
]

export const JOB_MATCHER_SUBS: ReadonlyArray<{
  id: JobMatcherSub
  label: string
}> = [
  { id: 'overview', label: 'Overview' },
  { id: 'policies', label: 'Matcher Policies' },
  { id: 'evaluations', label: 'Historical Evaluations' },
  { id: 'comparisons', label: 'Policy Comparisons' },
  { id: 'history', label: 'Evaluation History' },
]

export const DOCUMENT_INTELLIGENCE_SUBS: ReadonlyArray<{
  id: DocumentIntelligenceSub
  label: string
}> = [
  { id: 'overview', label: 'Overview' },
  { id: 'systems', label: 'Systems' },
]

export const WORKFLOW_INTELLIGENCE_SUBS: ReadonlyArray<{
  id: WorkflowIntelligenceSub
  label: string
}> = [
  { id: 'overview', label: 'Overview' },
  { id: 'systems', label: 'Systems' },
]

/** Registry ids belonging to each control-center category. */
export const INTELLIGENCE_SECTION_IDS: Record<
  Exclude<IntelligenceControlSection, 'overview'>,
  readonly string[]
> = {
  'email-classification': ['email-classification', 'subtype-discovery'],
  'job-matcher': ['job-matcher'],
  'document-intelligence': [
    'knowledge-document-analysis',
    'inline-image-relevance',
    'reference-import-extraction',
  ],
  'workflow-intelligence': [
    'bid-scope-extraction',
    'quote-bid-matching',
    'existing-job-adjudication',
    'bidding-intake-suggestions',
  ],
}

export function intelligenceSectionForId(
  id: string
): Exclude<IntelligenceControlSection, 'overview'> | 'other' {
  for (const [section, ids] of Object.entries(INTELLIGENCE_SECTION_IDS) as Array<
    [Exclude<IntelligenceControlSection, 'overview'>, readonly string[]]
  >) {
    if (ids.includes(id)) return section
  }
  return 'other'
}

export function defaultSubForSection(
  section: IntelligenceControlSection
): IntelligenceControlSub | null {
  if (section === 'overview') return null
  return 'overview'
}

export function isValidSubForSection(
  section: IntelligenceControlSection,
  sub: string | null | undefined
): boolean {
  if (section === 'overview') return sub == null || sub === ''
  if (!sub) return false
  const list =
    section === 'email-classification'
      ? EMAIL_CLASSIFICATION_SUBS
      : section === 'job-matcher'
        ? JOB_MATCHER_SUBS
        : section === 'document-intelligence'
          ? DOCUMENT_INTELLIGENCE_SUBS
          : WORKFLOW_INTELLIGENCE_SUBS
  return list.some((s) => s.id === sub)
}

export function sectionLabel(section: IntelligenceControlSection): string {
  return INTELLIGENCE_CONTROL_SECTIONS.find((s) => s.id === section)?.label ?? section
}

/** Real production policy label from the shared registry — never invent metrics. */
export function jobMatcherProductionPolicyLabel(): string {
  const id = getProductionJobMatchIdentityPolicy()
  const entry = JOB_MATCH_POLICY_REGISTRY.find((e) => e.id === id)
  return entry?.label ?? id
}

export function jobMatcherPolicyRows(): ReadonlyArray<{
  id: string
  label: string
  productionDefault: boolean
  experimental: boolean
}> {
  return JOB_MATCH_POLICY_REGISTRY.map((e) => ({
    id: e.id,
    label: e.label,
    productionDefault: e.productionDefault,
    experimental: e.label === 'CONTEXT_AWARE_V2_2' || e.label === 'CONTEXT_AWARE_V2_1',
  }))
}
