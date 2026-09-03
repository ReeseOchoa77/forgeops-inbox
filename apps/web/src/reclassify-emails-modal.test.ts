import { describe, expect, it } from 'vitest'

/**
 * UI contracts for Workspace → Monitored Mailboxes → Reclassify Emails.
 * Keep in sync with ReclassifyEmailsModal + MonitoredMailboxesPanel.
 */
const RECLASSIFY_UI_CONTRACT = {
  entryLabel: 'Reclassify Emails',
  previewBeforeEnqueue: true,
  confirmLabel: 'Confirm reclassify',
  requiresConfirmTrue: true,
  unclassifiedLabel: 'Unclassified (no Classification row)',
  neverProcessedLabel: 'Never processed (NULL)',
  cancelLabel: 'Cancel reclassification',
  defaultTaskMode: 'REMOVE_ONLY',
  regenerateTaskMode: 'REGENERATE',
  taskSectionLabel: 'TASKS',
}

describe('Reclassify Emails UI contract', () => {
  it('opens from Monitored Mailboxes as a dedicated console', () => {
    expect(RECLASSIFY_UI_CONTRACT.entryLabel).toBe('Reclassify Emails')
    expect(RECLASSIFY_UI_CONTRACT.previewBeforeEnqueue).toBe(true)
  })

  it('requires explicit confirm and distinguishes Unclassified from NULL status', () => {
    expect(RECLASSIFY_UI_CONTRACT.confirmLabel).toBe('Confirm reclassify')
    expect(RECLASSIFY_UI_CONTRACT.requiresConfirmTrue).toBe(true)
    expect(RECLASSIFY_UI_CONTRACT.unclassifiedLabel).not.toBe(
      RECLASSIFY_UI_CONTRACT.neverProcessedLabel
    )
  })

  it('exposes cancel during active run', () => {
    expect(RECLASSIFY_UI_CONTRACT.cancelLabel).toBe('Cancel reclassification')
  })

  it('defaults to REMOVE_ONLY task mode with explicit regenerate option', () => {
    expect(RECLASSIFY_UI_CONTRACT.defaultTaskMode).toBe('REMOVE_ONLY')
    expect(RECLASSIFY_UI_CONTRACT.regenerateTaskMode).toBe('REGENERATE')
    expect(RECLASSIFY_UI_CONTRACT.taskSectionLabel).toBe('TASKS')
  })
})
