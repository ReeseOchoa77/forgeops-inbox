/**
 * Durable Quote evidence for Bid Candidate UI — same meaning as Phase 4
 * With Quote / Without Quote (list API quoteCount + durableQuoteWhere).
 *
 * List rows: use quoteCount from listBidCandidates (durable staging and/or
 * BidCandidateEmail role=QUOTE). Do not invent a parallel rule.
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

/** Subtle success treatment for quoted Candidate rows (existing green tokens). */
export const quotedCandidateRowStyle: {
  background: string
  borderLeft: string
} = {
  background: '#f1f8f2',
  borderLeft: '3px solid #2e7d32',
}
