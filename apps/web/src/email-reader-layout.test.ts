import { describe, expect, it } from 'vitest'

/**
 * Desktop email reader layout contracts (MessageDetailView).
 * Keep in sync with the two-column reader redesign.
 */
const EMAIL_READER_CONTRACT = {
  desktopMainShare: 0.74,
  desktopSidebarShare: 0.26,
  selectedMessagePrimary: true,
  threadInSidebar: true,
  attachmentsInSidebar: true,
  attachmentsDefaultScope: 'selected-message',
  threadWideAttachmentsOnDemand: true,
  noAccordionBodies: true,
  sidebarSelectionDoesNotMarkRead: true,
  markReadOnlyOnOpen: true,
  hideThreadNavWhenSingleMessage: true,
  hideSidebarWhenSingleMessageNoAttachments: true,
  sidebarCollapseLocalStorageKey: 'forgeops_email_reader_sidebar_collapsed',
  narrowUsesThreadAttachmentsButtons: true,
}

describe('email reader layout contract', () => {
  it('prioritizes selected message with compact sidebar context', () => {
    expect(EMAIL_READER_CONTRACT.selectedMessagePrimary).toBe(true)
    expect(EMAIL_READER_CONTRACT.threadInSidebar).toBe(true)
    expect(EMAIL_READER_CONTRACT.attachmentsInSidebar).toBe(true)
    expect(EMAIL_READER_CONTRACT.noAccordionBodies).toBe(true)
    expect(EMAIL_READER_CONTRACT.desktopMainShare).toBeGreaterThan(0.7)
    expect(EMAIL_READER_CONTRACT.desktopSidebarShare).toBeLessThan(0.3)
  })

  it('keeps mark-read on intentional open only', () => {
    expect(EMAIL_READER_CONTRACT.markReadOnlyOnOpen).toBe(true)
    expect(EMAIL_READER_CONTRACT.sidebarSelectionDoesNotMarkRead).toBe(true)
  })

  it('scopes attachments to selected message by default', () => {
    expect(EMAIL_READER_CONTRACT.attachmentsDefaultScope).toBe('selected-message')
    expect(EMAIL_READER_CONTRACT.threadWideAttachmentsOnDemand).toBe(true)
  })

  it('collapses useless chrome for single-message threads', () => {
    expect(EMAIL_READER_CONTRACT.hideThreadNavWhenSingleMessage).toBe(true)
    expect(EMAIL_READER_CONTRACT.hideSidebarWhenSingleMessageNoAttachments).toBe(true)
    expect(EMAIL_READER_CONTRACT.sidebarCollapseLocalStorageKey).toContain('sidebar')
    expect(EMAIL_READER_CONTRACT.narrowUsesThreadAttachmentsButtons).toBe(true)
  })
})
