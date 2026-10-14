/**
 * Bid Candidate Quote presentation helpers.
 *
 * Two distinct concepts:
 * 1) Durable Quote evidence (With Quote / Without Quote filters) — quoteCount /
 *    BidCandidateEmail role=QUOTE / durable staging. Unchanged.
 * 2) Quoted visual state (green row + passive "Quoted" tag) — requires a
 *    canonical displayed PRICE (list API quoteAmount), not evidence alone.
 */

/** Finite number usable as a displayed quote price (not null/NaN/Infinity). */
export function isValidQuoteAmount(
  amount: number | null | undefined
): boolean {
  return typeof amount === 'number' && Number.isFinite(amount)
}

/**
 * Durable Quote evidence — same meaning as Phase 4 With Quote / Without Quote
 * (list API quoteCount + durableQuoteWhere). Does NOT drive green/Quoted UI.
 */
export function candidateHasDurableQuote(input: {
  /** From listBidCandidates — already durable-only. */
  quoteCount?: number
  /** Detail payload: durable staging rows and/or QUOTE email links. */
  quotes?: Array<{ isDurable?: boolean; matchStatus?: string }>
  emails?: Array<{ role?: string }>
}): boolean {
  if (typeof input.quoteCount === 'number') {
    return input.quoteCount > 0
  }
  const durableStaging = (input.quotes ?? []).some(
    (q) => q.isDurable === true && q.matchStatus !== 'REJECTED'
  )
  const quoteEmail = (input.emails ?? []).some((e) => e.role === 'QUOTE')
  return durableStaging || quoteEmail
}

/**
 * Canonical price for Quoted visual state.
 *
 * List authority: `quoteAmount` from listBidCandidates
 * (last finite extractedAmount among durable non-rejected stagings by createdAt).
 *
 * Detail: same rule from `quotes[]` (durable, non-rejected, last finite amount).
 *
 * NOT: lifecycle QUOTE, Quote email alone, or durable staging without amount.
 */
export function hasQuotedPrice(input: {
  /** List row: canonical displayed amount from listBidCandidates. */
  quoteAmount?: number | null
  /** Detail: quote rows with amount (and durability flags). */
  quotes?: Array<{
    amount?: number | null
    extractedAmount?: number | null
    isDurable?: boolean
    matchStatus?: string
  }>
}): boolean {
  if ('quoteAmount' in input && input.quoteAmount !== undefined) {
    return isValidQuoteAmount(input.quoteAmount)
  }
  const amounts = (input.quotes ?? [])
    .filter((q) => q.isDurable === true && q.matchStatus !== 'REJECTED')
    .map((q) => {
      const a = q.amount ?? q.extractedAmount ?? null
      return isValidQuoteAmount(a) ? a : null
    })
    .filter((n): n is number => n != null)
  return amounts.length > 0
}

/** Subtle success treatment for priced/quoted Candidate rows. */
export const quotedCandidateRowStyle: {
  background: string
  borderLeft: string
} = {
  background: '#f1f8f2',
  borderLeft: '3px solid #2e7d32',
}
