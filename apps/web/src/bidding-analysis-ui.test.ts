import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BIDDING_PIPELINE_STAGES,
  CLEAR_ALL_CONFIRM_MESSAGE,
  EMPTY_ANALYSIS_MESSAGE,
  QUOTE_FIRST_WORKFLOW_STEPS,
  SCAN_QUOTES_HELPER,
  biddingPhaseUserLabel,
  biddingPipelineStageState,
  existingJobMatchLabel,
  originalBidSourceLabel,
} from './bidding-analysis-ui'

const viewSrc = readFileSync(
  join(import.meta.dirname, 'views/BiddingFolderAnalysisView.tsx'),
  'utf8'
)

describe('quote-first Bidding Analysis UI helpers', () => {
  it('maps backend stages to user-facing labels', () => {
    expect(biddingPhaseUserLabel('SCANNING_QUOTES')).toBe('Scanning Quotes')
    expect(biddingPhaseUserLabel('EXTRACTING_QUOTES')).toBe('Analyzing Quotes')
    expect(biddingPhaseUserLabel('GROUPING_QUOTES')).toBe(
      'Grouping Quote Revisions'
    )
    expect(biddingPhaseUserLabel('SEARCHING_BID_INVITES')).toBe(
      'Searching Bid Invites'
    )
    expect(biddingPhaseUserLabel('MATCHING_BID_INVITES')).toBe(
      'Matching Bid Emails'
    )
    expect(biddingPhaseUserLabel('SEARCHING_INBOX_FALLBACK')).toBe(
      'Searching Inbox for Missing Bids'
    )
    expect(biddingPhaseUserLabel('BUILDING_CANDIDATES')).toBe(
      'Building Bid Candidates'
    )
    expect(biddingPhaseUserLabel('MATCHING_EXISTING_JOBS')).toBe(
      'Checking Existing Jobs'
    )
    expect(biddingPhaseUserLabel('READY_FOR_REVIEW')).toBe('Ready for Review')
  })

  it('marks pipeline stages done when ready for review', () => {
    expect(
      biddingPipelineStageState('READY_FOR_REVIEW', 'SCANNING_QUOTES', false)
    ).toBe('done')
    expect(
      biddingPipelineStageState('SEARCHING_INBOX_FALLBACK', 'SCANNING_QUOTES', false)
    ).toBe('done')
    expect(
      biddingPipelineStageState(
        'SEARCHING_INBOX_FALLBACK',
        'SEARCHING_INBOX_FALLBACK',
        false
      )
    ).toBe('active')
  })

  it('labels Bid email sources without internal enums', () => {
    expect(originalBidSourceLabel('BID_INVITES_FOLDER')).toBe('Bid Invites')
    expect(originalBidSourceLabel('INBOX_FALLBACK')).toBe('Inbox')
    expect(originalBidSourceLabel('NONE')).toBe('Not Found')
    expect(originalBidSourceLabel('INBOX_FALLBACK')).not.toContain('FALLBACK')
  })

  it('uses human existing-job labels', () => {
    expect(existingJobMatchLabel('NONE')).toBe('No Existing Job')
    expect(existingJobMatchLabel('POSSIBLE')).toBe('Possible Existing Job')
    expect(existingJobMatchLabel('RESOLVED_SAME')).toBe(
      'Matched to Existing Job'
    )
  })

  it('exposes compact workflow steps', () => {
    expect(QUOTE_FIRST_WORKFLOW_STEPS).toEqual([
      'Scan Quotes',
      'Find Bid Emails',
      'Build Candidates',
      'Review & Import',
    ])
    expect(BIDDING_PIPELINE_STAGES[0]?.phase).toBe('SCANNING_QUOTES')
  })
})

describe('BiddingFolderAnalysisView quote-first copy', () => {
  it('primary CTA is Scan Quotes and removes Scan Bids CTA', () => {
    expect(viewSrc).toContain("'Scan Quotes'")
    expect(viewSrc).toContain('Scanning Quotes…')
    expect(viewSrc).not.toMatch(/'Scan Bids'/)
    expect(viewSrc).not.toMatch(/Scanning Bids/)
    expect(viewSrc).toContain('startScanQuotes')
  })

  it('uses Quote Date Range terminology', () => {
    expect(viewSrc).toContain('Quote Date Range')
    expect(viewSrc).toContain('SCAN_QUOTES_HELPER')
    expect(viewSrc).toContain('EMPTY_ANALYSIS_MESSAGE')
    expect(viewSrc).toContain('BID_EMAIL_SEARCH_HELPER')
    expect(SCAN_QUOTES_HELPER).toMatch(/Scan Quotes from this period/i)
    expect(EMPTY_ANALYSIS_MESSAGE).toMatch(/scan Quotes/i)
  })

  it('shows Analysis Complete and Bid email source labels', () => {
    expect(viewSrc).toContain('Analysis Complete')
    expect(viewSrc).toContain('Ready for Review')
    expect(viewSrc).toContain('Original Bid Request')
    expect(viewSrc).toContain('Not Found')
    expect(viewSrc).toContain('originalBidSourceLabel')
  })

  it('keeps Clear All separate with safe confirmation', () => {
    expect(viewSrc).toContain('Clear All')
    expect(viewSrc).toContain('CLEAR_ALL_CONFIRM_MESSAGE')
    expect(CLEAR_ALL_CONFIRM_MESSAGE).toMatch(/imported Bids are not deleted/i)
    expect(CLEAR_ALL_CONFIRM_MESSAGE).not.toMatch(/Outlook emails or existing/i)
  })

  it('keeps detailed scope in Candidate detail, compact in table', () => {
    expect(viewSrc).toContain('Scope Requested')
    expect(viewSrc).toContain('Quote Scope')
    expect(viewSrc).toContain('scopeListPreview')
    expect(viewSrc).toContain('Bid Email')
  })
})
