import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  candidateHasDurableQuote,
  quotedCandidateRowStyle,
} from './bid-candidate-quoted'

const here = dirname(fileURLToPath(import.meta.url))

describe('Bid Candidate Quoted visual status', () => {
  it('A) zero durable Quotes → not quoted', () => {
    expect(candidateHasDurableQuote({ quoteCount: 0 })).toBe(false)
    expect(
      candidateHasDurableQuote({
        quotes: [{ isDurable: false, matchStatus: 'UNMATCHED' }],
        emails: [{ role: 'BID_INVITE' }],
      })
    ).toBe(false)
  })

  it('B) durable Quote → quoted', () => {
    expect(candidateHasDurableQuote({ quoteCount: 1 })).toBe(true)
    expect(
      candidateHasDurableQuote({
        quotes: [{ isDurable: true, matchStatus: 'MATCHED' }],
      })
    ).toBe(true)
    expect(
      candidateHasDurableQuote({
        emails: [{ role: 'QUOTE' }],
      })
    ).toBe(true)
  })

  it('C) subtle success/green treatment tokens', () => {
    expect(quotedCandidateRowStyle.background).toMatch(/#f1f8f2|#e8f5e9/i)
    expect(quotedCandidateRowStyle.borderLeft).toContain('#2e7d32')
  })

  it('D) multiple Quote revisions → one quoted status; count preserved', () => {
    expect(candidateHasDurableQuote({ quoteCount: 3 })).toBe(true)
    const view = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(view).toContain('row.quoteCount')
    expect(view).toContain('QuotedBadge')
    expect(view).toContain('candidateHasDurableQuote')
  })

  it('E/F/G) quoted independent of lifecycle (QUOTED / CONVERTED / LOST)', () => {
    // Helper only cares about durable evidence — lifecycle is separate.
    expect(candidateHasDurableQuote({ quoteCount: 2 })).toBe(true)
    expect(
      candidateHasDurableQuote({
        quotes: [{ isDurable: true, matchStatus: 'MATCHED' }],
        emails: [{ role: 'QUOTE' }],
      })
    ).toBe(true)
  })

  it('H) With Quote / Without Quote filter options unchanged in UI', () => {
    const view = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(view).toContain('With Quote')
    expect(view).toContain('Without Quote')
    expect(view).toContain("quote: quoteFilter")
  })

  it('I) Phase 4 Quote email filter predicate untouched in inbox-read', () => {
    const inbox = readFileSync(
      join(here, '../../api/src/interfaces/http/routes/inbox-read.route.ts'),
      'utf8'
    )
    const quoteBlock = inbox.slice(
      inbox.indexOf('businessTypeKey === "ESTIMATE_QUOTE"'),
      inbox.indexOf('} else {', inbox.indexOf('businessTypeKey === "ESTIMATE_QUOTE"'))
    )
    expect(quoteBlock).toContain('businessTypeKey: "ESTIMATE_QUOTE"')
    expect(quoteBlock).toContain('role: "QUOTE"')
  })

  it('J) Bid Candidate Inbox source-filter remains independent', () => {
    const inbox = readFileSync(
      join(here, '../../api/src/interfaces/http/routes/inbox-read.route.ts'),
      'utf8'
    )
    const bidBlock = inbox.slice(
      inbox.indexOf('businessTypeKey === "BID_OPPORTUNITY"'),
      inbox.indexOf('businessTypeKey === "ESTIMATE_QUOTE"')
    )
    expect(bidBlock).toContain('discoveredInBidInvitesFolder: true')
    expect(bidBlock).not.toContain('role: "BID_INVITE"')
  })

  it('QuotedBadge uses existing success badge tokens', () => {
    const badges = readFileSync(join(here, 'components/Badges.tsx'), 'utf8')
    expect(badges).toContain('QuotedBadge')
    expect(badges).toContain("background: '#e8f5e9'")
    expect(badges).toContain("color: '#2e7d32'")
    expect(badges).toContain('Quoted')
  })
})
