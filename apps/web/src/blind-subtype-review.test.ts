import { describe, expect, it } from 'vitest'

import { BLIND_REVIEW_CONTRACT } from './components/BlindSubtypeReview'

describe('blind subtype validation UI', () => {
  it('asks for an explicit purpose and reveals the stored subtype only after submit', () => {
    expect(BLIND_REVIEW_CONTRACT.prompt).toBe('What is the primary business purpose of this email?')
    expect(BLIND_REVIEW_CONTRACT.ambiguousLabel).toBe('Ambiguous / insufficient information')
    expect(BLIND_REVIEW_CONTRACT.revealsStoredSubtypeOnlyAfterSubmit).toBe(true)
    expect(BLIND_REVIEW_CONTRACT.nextKey).toBe('N')
  })
})
