import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname

describe('Phase 6 — Convert to Job UI', () => {
  it('BiddingView has Convert to Job review dialog', () => {
    const src = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(src).toContain('Convert to Job')
    expect(src).toContain('ConvertToJobDialog')
    expect(src).toContain('previewConvertBidCandidateToJob')
    expect(src).toContain('convertBidCandidateToJob')
    expect(src).toContain('Confirm Convert to Job')
    expect(src).toContain('does not create a Job')
    expect(src).toMatch(/lifecycle === ['"]OPEN['"]/)
    expect(src).toMatch(/lifecycle === ['"]QUOTED['"]/)
    expect(src).toContain('Converted to Job')
  })

  it('api client hits convert-to-job endpoint', () => {
    const src = readFileSync(join(here, 'api.ts'), 'utf8')
    expect(src).toContain('/convert-to-job')
    expect(src).toContain('convertBidCandidateToJob')
    expect(src).toContain('previewConvertBidCandidateToJob')
  })

  it('Email Analysis no longer bulk-imports Jobs', () => {
    const src = readFileSync(
      join(here, 'views/BiddingFolderAnalysisView.tsx'),
      'utf8'
    )
    expect(src).toContain('Convert to Job')
    expect(src).not.toContain('Import Selected Bids')
  })
})
