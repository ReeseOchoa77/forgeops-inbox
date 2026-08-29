import { describe, expect, it } from 'vitest'

/**
 * Contract expectations for Email Classification Review.
 * Keep in sync with ReviewQueueView product behavior (no Needs Review workflow).
 */
const CLASSIFICATION_REVIEW_CONTRACT = {
  defaultStatusFilter: 'ALL',
  historyFilters: ['ALL', 'CORRECTED', 'CONFIRMED'] as const,
  forbiddenProductLabels: ['Needs Review', 'NEEDS_REVIEW', 'needsReview'] as const,
  inspectorTitle: 'Classification Inspector',
  emailContentToggle: 'View Email Content',
  corrections: ['reclassifyMessage', 'confirmSenderEvidence', 'reviewClassification'] as const,
}

describe('Email Classification Review UI contract', () => {
  it('has no Needs Review tag, filter, or counter', () => {
    for (const label of CLASSIFICATION_REVIEW_CONTRACT.forbiddenProductLabels) {
      expect(CLASSIFICATION_REVIEW_CONTRACT.historyFilters.join(',')).not.toContain(label)
      expect(CLASSIFICATION_REVIEW_CONTRACT.defaultStatusFilter).not.toBe(label)
    }
  })

  it('defaults to all classifications and opens Classification Inspector', () => {
    expect(CLASSIFICATION_REVIEW_CONTRACT.defaultStatusFilter).toBe('ALL')
    expect(CLASSIFICATION_REVIEW_CONTRACT.inspectorTitle).toBe('Classification Inspector')
    expect(CLASSIFICATION_REVIEW_CONTRACT.emailContentToggle).toBe('View Email Content')
  })

  it('preserves manual corrections', () => {
    expect(CLASSIFICATION_REVIEW_CONTRACT.corrections).toEqual([
      'reclassifyMessage',
      'confirmSenderEvidence',
      'reviewClassification',
    ])
  })
})
