/**
 * Quote-first Bidding Folder Analysis UI helpers (labels / stage mapping).
 * Keep in sync with backend BidEmailAnalyzePhase values.
 */

export const QUOTE_FIRST_WORKFLOW_STEPS = [
  'Scan Quotes',
  'Find Bid Emails',
  'Build Candidates',
  'Review & Import',
] as const

/** Detailed running stages — labels match user-facing progress. */
export const BIDDING_PIPELINE_STAGES = [
  { phase: 'SCANNING_QUOTES', label: 'Scanning Quotes' },
  { phase: 'EXTRACTING_QUOTES', label: 'Analyzing Quotes' },
  { phase: 'GROUPING_QUOTES', label: 'Grouping Quote Revisions' },
  { phase: 'SEARCHING_BID_INVITES', label: 'Searching Bid Invites' },
  { phase: 'MATCHING_BID_INVITES', label: 'Matching Bid Emails' },
  { phase: 'SEARCHING_INBOX_FALLBACK', label: 'Searching Inbox for Missing Bids' },
  { phase: 'BUILDING_CANDIDATES', label: 'Building Bid Candidates' },
  { phase: 'MATCHING_EXISTING_JOBS', label: 'Checking Existing Jobs' },
  { phase: 'READY_FOR_REVIEW', label: 'Ready for Review' },
] as const

export type BiddingPipelinePhase =
  (typeof BIDDING_PIPELINE_STAGES)[number]['phase']

export function biddingPhaseUserLabel(
  phase: string | null | undefined
): string {
  if (!phase) return ''
  const hit = BIDDING_PIPELINE_STAGES.find((s) => s.phase === phase)
  if (hit) return hit.label
  // Legacy / intermediate backend phases
  switch (phase) {
    case 'BID_INVITES':
    case 'SCANNING_BID_INVITES':
      return 'Searching Bid Invites'
    case 'QUOTES':
      return 'Scanning Quotes'
    case 'EXTRACTING_BID_CANDIDATES':
    case 'ANALYZE_CANDIDATES':
      return 'Building Bid Candidates'
    case 'MATCHING_QUOTES':
      return 'Matching Bid Emails'
    case 'RESOLVE_FOLDERS':
      return 'Scanning Quotes'
    case 'DONE':
      return 'Ready for Review'
    default:
      return phase.replace(/_/g, ' ')
  }
}

export function normalizeBiddingPhaseForPipeline(
  currentPhase: string | null | undefined
): string | null {
  if (!currentPhase) return null
  if (
    currentPhase === 'BID_INVITES' ||
    currentPhase === 'SCANNING_BID_INVITES'
  ) {
    return 'SEARCHING_BID_INVITES'
  }
  if (currentPhase === 'QUOTES') return 'SCANNING_QUOTES'
  if (
    currentPhase === 'ANALYZE_CANDIDATES' ||
    currentPhase === 'EXTRACTING_BID_CANDIDATES'
  ) {
    return 'BUILDING_CANDIDATES'
  }
  if (currentPhase === 'MATCHING_QUOTES') return 'MATCHING_BID_INVITES'
  if (currentPhase === 'RESOLVE_FOLDERS') return 'SCANNING_QUOTES'
  if (currentPhase === 'DONE') return 'READY_FOR_REVIEW'
  return currentPhase
}

export function biddingPipelineStageState(
  currentPhase: string | null | undefined,
  stagePhase: string,
  runDone: boolean
): 'done' | 'active' | 'pending' {
  if (runDone || currentPhase === 'DONE' || currentPhase === 'READY_FOR_REVIEW') {
    return 'done'
  }
  const order = BIDDING_PIPELINE_STAGES.map((s) => s.phase)
  const normalized = normalizeBiddingPhaseForPipeline(currentPhase)
  const curIdx = normalized
    ? order.indexOf(normalized as (typeof order)[number])
    : -1
  const stageIdx = order.indexOf(stagePhase as (typeof order)[number])
  if (curIdx < 0) return 'pending'
  if (stageIdx < curIdx) return 'done'
  if (stageIdx === curIdx) return 'active'
  return 'pending'
}

/** Human labels for BidOriginalBidSource — never expose raw enums. */
export function originalBidSourceLabel(
  source: string | undefined | null
): string {
  switch (source) {
    case 'BID_INVITES_FOLDER':
      return 'Bid Invites'
    case 'INBOX_FALLBACK':
      return 'Inbox'
    case 'NONE':
      return 'Not Found'
    default:
      return source ? String(source) : '—'
  }
}

export function existingJobMatchLabel(status: string | undefined): string {
  switch (status) {
    case 'NONE':
      return 'No Existing Job'
    case 'POSSIBLE':
      return 'Possible Existing Job'
    case 'STRONG':
      return 'Possible Existing Job'
    case 'NEEDS_REVIEW':
      return 'Needs Review'
    case 'RESOLVED_SAME':
      return 'Matched to Existing Job'
    case 'RESOLVED_DIFFERENT':
      return 'Different Job'
    default:
      return status || '—'
  }
}

export function discoveryRoleLabel(role: string): string {
  switch (role) {
    case 'BID_INVITE':
      return 'Bid Invite'
    case 'QUOTE':
      return 'Quote'
    default:
      return role
  }
}

export function candidateEmailRoleLabel(role: string): string {
  switch (role) {
    case 'BID_INVITE':
      return 'Original Bid'
    case 'QUOTE':
      return 'Quote'
    case 'ADDENDUM':
      return 'Addendum'
    case 'SUPPORTING':
      return 'Supporting'
    default:
      return role
  }
}

export const CLEAR_ALL_CONFIRM_MESSAGE =
  'This clears the current Bidding Analysis results for this mailbox. Existing emails, attachments, Jobs, Customers, and imported Bids are not deleted.'

export const SCAN_QUOTES_HELPER =
  'Scan Quotes from this period, then search earlier Bid Invites and Inbox emails for the original bid request.'

export const BID_EMAIL_SEARCH_HELPER =
  'ForgeOps uses each Quote to locate the original Bid email. Bid Invites are searched first; Inbox is used as a fallback.'

export const EMPTY_ANALYSIS_MESSAGE =
  'Choose a Quote date range and scan Quotes to reconstruct historical bids.'
