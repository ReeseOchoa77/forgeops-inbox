import { describe, expect, it } from 'vitest'
import {
  importProgressIndeterminate,
  importProgressLabel,
  importProgressPercent,
  isImportInProgress,
} from './mailbox-import-progress'

describe('mailbox import progress helpers', () => {
  it('treats PENDING and RUNNING as in progress', () => {
    expect(isImportInProgress('PENDING')).toBe(true)
    expect(isImportInProgress('RUNNING')).toBe(true)
    expect(isImportInProgress('COMPLETED')).toBe(false)
  })

  it('shows indeterminate while queued or still reading', () => {
    expect(
      importProgressIndeterminate({ status: 'PENDING', processedCount: 0 })
    ).toBe(true)
    expect(
      importProgressIndeterminate({ status: 'RUNNING', processedCount: 0 })
    ).toBe(true)
    expect(
      importProgressIndeterminate({ status: 'RUNNING', processedCount: 12 })
    ).toBe(false)
  })

  it('maps counts to a visible percent and completes at 100', () => {
    expect(
      importProgressPercent({
        status: 'RUNNING',
        processedCount: 0,
        requestedLimit: 50,
      })
    ).toBe(8)
    expect(
      importProgressPercent({
        status: 'RUNNING',
        processedCount: 25,
        requestedLimit: 50,
      })
    ).toBe(50)
    expect(
      importProgressPercent({
        status: 'COMPLETED',
        processedCount: 40,
        requestedLimit: 50,
      })
    ).toBe(100)
  })

  it('labels reading vs classifying phases', () => {
    expect(
      importProgressLabel({
        status: 'RUNNING',
        processedCount: 0,
        importedCount: 0,
        requestedLimit: 50,
        errorMessage: null,
      })
    ).toMatch(/Reading/)
    expect(
      importProgressLabel({
        status: 'RUNNING',
        processedCount: 10,
        importedCount: 8,
        requestedLimit: 50,
        errorMessage: null,
      })
    ).toMatch(/Importing & classifying/)
  })
})
