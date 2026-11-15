import { describe, expect, it } from 'vitest'
import {
  intelligenceSectionForId,
  isValidSubForSection,
  jobMatcherProductionPolicyLabel,
  JOB_MATCHER_SUBS,
  EMAIL_CLASSIFICATION_SUBS,
} from './intelligence-control-center'

describe('intelligence control center hierarchy', () => {
  it('maps registry ids to product sections', () => {
    expect(intelligenceSectionForId('email-classification')).toBe('email-classification')
    expect(intelligenceSectionForId('job-matcher')).toBe('job-matcher')
    expect(intelligenceSectionForId('knowledge-document-analysis')).toBe(
      'document-intelligence'
    )
    expect(intelligenceSectionForId('bid-scope-extraction')).toBe('workflow-intelligence')
    expect(intelligenceSectionForId('future-widget')).toBe('other')
  })

  it('validates subsection ids per section', () => {
    expect(isValidSubForSection('email-classification', 'discovery')).toBe(true)
    expect(isValidSubForSection('job-matcher', 'comparisons')).toBe(true)
    expect(isValidSubForSection('job-matcher', 'discovery')).toBe(false)
    expect(isValidSubForSection('overview', null)).toBe(true)
  })

  it('exposes expected Job Matcher and Email Classification subs', () => {
    expect(JOB_MATCHER_SUBS.map((s) => s.id)).toEqual([
      'overview',
      'policies',
      'evaluations',
      'comparisons',
      'history',
    ])
    expect(EMAIL_CLASSIFICATION_SUBS.map((s) => s.id)).toContain('discovery')
  })

  it('reports real production policy from shared registry', () => {
    expect(jobMatcherProductionPolicyLabel()).toBe('CONTEXT_AWARE_V2')
  })
})
