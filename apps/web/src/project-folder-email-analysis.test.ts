import { describe, expect, it } from 'vitest'

/**
 * Contract for Workspace → Email Analysis (FoldersView).
 * Avoids filesystem reads so web `tsc -b` stays browser-clean.
 */
const EMAIL_ANALYSIS_CONTRACT = {
  workspaceTabLabel: 'Email Analysis',
  scanButtonLabel: 'Analyze Project Folders',
  analyzeEmailsLabel: 'Analyze Emails',
  verifiedOnlyEligible: true,
  autoScanOnWorkspaceMount: false,
  autoAnalyzeEmailsOnMount: false,
  usesJobAssignPicker: true,
  matchStatuses: ['UNMATCHED', 'SUGGESTED', 'VERIFIED'] as const,
}

describe('Workspace Email Analysis UX contracts', () => {
  it('documents on-demand scan/analyze and verified-only eligibility', () => {
    expect(EMAIL_ANALYSIS_CONTRACT.workspaceTabLabel).toBe('Email Analysis')
    expect(EMAIL_ANALYSIS_CONTRACT.scanButtonLabel).toBe('Analyze Project Folders')
    expect(EMAIL_ANALYSIS_CONTRACT.analyzeEmailsLabel).toBe('Analyze Emails')
    expect(EMAIL_ANALYSIS_CONTRACT.autoScanOnWorkspaceMount).toBe(false)
    expect(EMAIL_ANALYSIS_CONTRACT.autoAnalyzeEmailsOnMount).toBe(false)
    expect(EMAIL_ANALYSIS_CONTRACT.verifiedOnlyEligible).toBe(true)
    expect(EMAIL_ANALYSIS_CONTRACT.usesJobAssignPicker).toBe(true)
    expect(EMAIL_ANALYSIS_CONTRACT.matchStatuses).toContain('VERIFIED')
    expect(EMAIL_ANALYSIS_CONTRACT.matchStatuses).not.toContain('DISCOVERED')
  })
})
