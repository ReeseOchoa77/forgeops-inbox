import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('Clear All Emails — Include Bid Candidates UI', () => {
  it('S) checkbox defaults unchecked; confirmation warns Quotes/Jobs', () => {
    const panel = readFileSync(
      join(here, 'components/MonitoredMailboxesPanel.tsx'),
      'utf8'
    )
    expect(panel).toContain('data-testid="clear-include-bid-candidates"')
    expect(panel).toContain('Include Bid Candidates')
    expect(panel).toContain('useState(false)')
    expect(panel).toContain('candidates with Quotes')
    expect(panel).toContain('Existing Jobs will not be deleted')
    expect(panel).toContain('Clear emails and Bid Candidates')
  })

  it('API sends includeBidCandidates only when true', () => {
    const api = readFileSync(join(here, 'api.ts'), 'utf8')
    expect(api).toContain('includeBidCandidates: options?.includeBidCandidates === true')
  })

  it('O) Clear Analysis path is separate (unchanged preserve wording)', () => {
    // Ensure we did not wire includeBidCandidates into Bidding Analysis clear.
    const analysis = readFileSync(
      join(here, 'views/BiddingFolderAnalysisView.tsx'),
      'utf8'
    )
    expect(analysis).not.toContain('includeBidCandidates')
  })
})
