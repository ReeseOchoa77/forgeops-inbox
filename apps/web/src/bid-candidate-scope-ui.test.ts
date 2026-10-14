import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isScopeReviewPlaceholder,
  parseDetailedScope,
} from '@forgeops/shared/bidding/scope-detail'

const here = dirname(fileURLToPath(import.meta.url))

describe('Bid Candidate scope UI', () => {
  it('presents structured scope (not raw JSON primary)', () => {
    const src = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(src).toContain('CandidateScopePanel')
    expect(src).toContain('Needs review')
    expect(src).toContain('Work identified')
    expect(src).not.toMatch(/JSON\.stringify\(detail\.scopeDetail/)
  })

  it('incomplete work-only detail parses as not complete', () => {
    const d = parseDetailedScope({
      work: [
        { kind: 'WORK', name: 'Furnish/supply', source: 'EMAIL_BODY' },
        { kind: 'WORK', name: 'Installation', source: 'EMAIL_BODY' },
      ],
      items: [],
      summary: 'Scope needs review',
      exclusions: [],
      tradeCategory: null,
      qualifications: [],
      detailedComplete: true,
      extractionMethod: 'DETERMINISTIC',
    })
    expect(d?.detailedComplete).toBe(false)
    expect(d?.summary).toBeNull()
    expect(isScopeReviewPlaceholder('Scope needs review')).toBe(true)
  })
})
