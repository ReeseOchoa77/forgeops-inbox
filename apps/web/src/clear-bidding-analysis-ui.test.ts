import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const viewSrc = readFileSync(
  join(import.meta.dirname, 'views/BiddingFolderAnalysisView.tsx'),
  'utf8'
)

describe('BiddingFolderAnalysis Clear All UI', () => {
  it('confirms before calling clear API', () => {
    expect(viewSrc).toContain('window.confirm')
    expect(viewSrc).toContain('api.clearBidAnalysis')
  })

  it('does not clear local lists before backend success', () => {
    const fnStart = viewSrc.indexOf('const handleClearAll')
    const fn = viewSrc.slice(fnStart, fnStart + 2200)
    const awaitIdx = fn.indexOf('await api.clearBidAnalysis')
    const setCandidatesIdx = fn.indexOf('setCandidates')
    // Candidates are refreshed via loadCandidates after await, not wiped first.
    expect(awaitIdx).toBeGreaterThan(0)
    expect(fn.indexOf('setProgress(null)')).toBeGreaterThan(awaitIdx)
    expect(fn).toContain('loadCandidates(connId)')
    expect(fn).toContain('loadQuotes(connId)')
    expect(fn).toContain('loadCounts(connId)')
    expect(viewSrc).toContain('connectionId: id')
    // Failure path must not wipe lists
    expect(fn).toContain("setError(e instanceof Error ? e.message : 'Clear All failed')")
    expect(setCandidatesIdx).toBe(-1)
  })

  it('cancels run polling and closes detail/edit state after success', () => {
    const fnStart = viewSrc.indexOf('const handleClearAll')
    const fn = viewSrc.slice(fnStart, fnStart + 2200)
    expect(fn).toContain('pollGenRef.current += 1')
    expect(fn).toContain('setSelectedCandidateId(null)')
    expect(fn).toContain('setDetail(null)')
    expect(fn).toContain('setEditingQuoteId(null)')
    expect(fn).toContain('setRunId(null)')
    expect(fn).toContain('setProgress(null)')
  })
})
