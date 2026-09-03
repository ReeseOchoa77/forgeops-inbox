import { describe, expect, it } from 'vitest'

/**
 * Contract for Workspace → Email Analysis (FoldersView).
 * Avoids filesystem reads so web `tsc -b` stays browser-clean.
 */
const EMAIL_ANALYSIS_CONTRACT = {
  workspaceTabLabel: 'Email Analysis',
  scanButtonLabel: 'Analyze Project Folders',
  analyzeEmailsLabel: 'Analyze Emails',
  analyzeSelectedLabel: 'Analyze Emails (selected)',
  analyzeAllVerifiedLabel: 'Analyze Emails (all verified)',
  verifiedOnlyEligible: true,
  autoScanOnWorkspaceMount: false,
  autoAnalyzeEmailsOnMount: false,
  usesJobAssignPicker: true,
  providerFilter: 'outlook (case-insensitive)',
  mailboxScopedFolders: true,
  hideFoldersWithoutMailbox: true,
  autoSelectSingleOutlookMailbox: true,
  listPathUsesConnectionId: '/discovered-folders?connectionId=',
  scanPath: '/project-folders/scan',
  analyzePath: '/project-folders/analyze-emails',
  /** Retired top-level nav page key — App redirects to Workspace → Email Analysis. */
  legacyJobDiscoveryPage: 'outlook-folders',
  retiredJobDiscoveryNavLabel: 'Job Discovery',
  canonicalFolderMatcher: 'matchFolderToExistingJobs',
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
  })

  it('requires mailbox-scoped folder loads and case-insensitive Outlook filter', () => {
    expect(EMAIL_ANALYSIS_CONTRACT.providerFilter).toContain('outlook')
    expect(EMAIL_ANALYSIS_CONTRACT.mailboxScopedFolders).toBe(true)
    expect(EMAIL_ANALYSIS_CONTRACT.hideFoldersWithoutMailbox).toBe(true)
    expect(EMAIL_ANALYSIS_CONTRACT.autoSelectSingleOutlookMailbox).toBe(true)
    expect(EMAIL_ANALYSIS_CONTRACT.listPathUsesConnectionId).toContain('connectionId')
    expect(EMAIL_ANALYSIS_CONTRACT.scanPath).toBe('/project-folders/scan')
    expect(EMAIL_ANALYSIS_CONTRACT.analyzePath).toBe('/project-folders/analyze-emails')
    expect(EMAIL_ANALYSIS_CONTRACT.analyzeSelectedLabel).toContain('selected')
    expect(EMAIL_ANALYSIS_CONTRACT.analyzeAllVerifiedLabel).toContain('all verified')
  })

  it('retires Job Discovery nav in favor of Email Analysis', () => {
    expect(EMAIL_ANALYSIS_CONTRACT.legacyJobDiscoveryPage).toBe('outlook-folders')
    expect(EMAIL_ANALYSIS_CONTRACT.retiredJobDiscoveryNavLabel).toBe('Job Discovery')
    expect(EMAIL_ANALYSIS_CONTRACT.workspaceTabLabel).not.toBe(
      EMAIL_ANALYSIS_CONTRACT.retiredJobDiscoveryNavLabel
    )
    expect(EMAIL_ANALYSIS_CONTRACT.canonicalFolderMatcher).toBe('matchFolderToExistingJobs')
  })
})
