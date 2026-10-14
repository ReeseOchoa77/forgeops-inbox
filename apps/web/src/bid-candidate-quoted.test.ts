import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  candidateHasDurableQuote,
  hasQuotedPrice,
  isValidQuoteAmount,
  quotedCandidateRowStyle,
} from './bid-candidate-quoted'

const here = dirname(fileURLToPath(import.meta.url))

describe('Bid Candidate Quoted visual status (requires price)', () => {
  it('A) no Quote, no price → not quoted visual', () => {
    expect(hasQuotedPrice({ quoteAmount: null })).toBe(false)
    expect(hasQuotedPrice({ quotes: [] })).toBe(false)
  })

  it('B/C/D) durable Quote / email / PDF evidence without amount → NOT quoted visual', () => {
    expect(hasQuotedPrice({ quoteAmount: null })).toBe(false)
    expect(
      hasQuotedPrice({
        quotes: [
          { amount: null, isDurable: true, matchStatus: 'MATCHED' },
          { extractedAmount: null, isDurable: true, matchStatus: 'MATCHED' },
        ],
      })
    ).toBe(false)
    // Evidence helper still true for filters — visual helper false.
    expect(candidateHasDurableQuote({ quoteCount: 1 })).toBe(true)
    expect(hasQuotedPrice({ quoteAmount: null })).toBe(false)
  })

  it('E) lifecycle QUOTED alone does not set hasQuotedPrice', () => {
    expect(hasQuotedPrice({ quoteAmount: null })).toBe(false)
    const view = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(view).toContain('hasQuotedPrice')
    expect(view).not.toMatch(/hasQuotedPrice\(\{[^}]*lifecycle/)
  })

  it('F/G) valid canonical / manual price → quoted visual', () => {
    expect(isValidQuoteAmount(185000)).toBe(true)
    expect(hasQuotedPrice({ quoteAmount: 185000 })).toBe(true)
    expect(
      hasQuotedPrice({
        quotes: [
          { amount: 185000, isDurable: true, matchStatus: 'MATCHED' },
        ],
      })
    ).toBe(true)
  })

  it('H) multiple revisions with last finite amount → quoted', () => {
    expect(
      hasQuotedPrice({
        quotes: [
          { amount: 180000, isDurable: true, matchStatus: 'MATCHED' },
          { amount: null, isDurable: true, matchStatus: 'MATCHED' },
          { amount: 192500, isDurable: true, matchStatus: 'MATCHED' },
        ],
      })
    ).toBe(true)
    // List uses precomputed quoteAmount (last finite) — same agreement.
    expect(hasQuotedPrice({ quoteAmount: 192500 })).toBe(true)
  })

  it('I) multiple revisions but no finite amount → not quoted', () => {
    expect(
      hasQuotedPrice({
        quotes: [
          { amount: null, isDurable: true, matchStatus: 'MATCHED' },
          { amount: null, isDurable: true, matchStatus: 'MATCHED' },
        ],
      })
    ).toBe(false)
    expect(hasQuotedPrice({ quoteAmount: null })).toBe(false)
  })

  it('rejects NaN / Infinity as prices', () => {
    expect(isValidQuoteAmount(Number.NaN)).toBe(false)
    expect(isValidQuoteAmount(Number.POSITIVE_INFINITY)).toBe(false)
    expect(hasQuotedPrice({ quoteAmount: Number.NaN })).toBe(false)
  })

  it('C) subtle success/green treatment tokens', () => {
    expect(quotedCandidateRowStyle.background).toMatch(/#f1f8f2|#e8f5e9/i)
    expect(quotedCandidateRowStyle.borderLeft).toContain('#2e7d32')
  })

  it('J) With Quote / Without Quote filter options unchanged in UI', () => {
    const view = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(view).toContain('With Quote')
    expect(view).toContain('Without Quote')
    expect(view).toContain("quote: quoteFilter")
    // Visual uses price; filter still uses quote API param / quoteCount evidence.
    expect(view).toContain('hasQuotedPrice({ quoteAmount: row.quoteAmount })')
    expect(candidateHasDurableQuote({ quoteCount: 1 })).toBe(true)
  })

  it('K) QuotedBadge is passive status tag (not a button)', () => {
    const badges = readFileSync(join(here, 'components/Badges.tsx'), 'utf8')
    expect(badges).toContain('QuotedBadge')
    expect(badges).toContain('role="status"')
    expect(badges).toContain('pointerEvents: \'none\'')
    expect(badges).toContain('cursor: \'default\'')
    expect(badges).not.toMatch(/function QuotedBadge[\s\S]*<button/)
  })

  it('L) list + detail use hasQuotedPrice', () => {
    const view = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
    expect(view).toContain('hasQuotedPrice({ quoteAmount: row.quoteAmount })')
    expect(view).toContain('hasQuotedPrice({ quotes: detail.quotes })')
    expect(view).not.toContain('candidateHasDurableQuote')
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
})
