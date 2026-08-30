import { describe, expect, it } from 'vitest'
import {
  importProgressIndeterminate,
  importProgressLabel,
  importProgressPercent,
  isImportInProgress,
  isUnlimitedImport,
} from './mailbox-import-progress'

describe('mailbox import progress helpers', () => {
  it('treats PENDING and RUNNING as in progress', () => {
    expect(isImportInProgress('PENDING')).toBe(true)
    expect(isImportInProgress('RUNNING')).toBe(true)
    expect(isImportInProgress('COMPLETED')).toBe(false)
  })

  it('treats since-date / limit 0 as unlimited', () => {
    expect(isUnlimitedImport({ requestedLimit: 0, sinceDate: null })).toBe(true)
    expect(
      isUnlimitedImport({ requestedLimit: 50, sinceDate: '2026-01-01T00:00:00.000Z' })
    ).toBe(true)
    expect(isUnlimitedImport({ requestedLimit: 50, sinceDate: null })).toBe(false)
  })

  it('shows indeterminate while queued or still reading (by count)', () => {
    expect(
      importProgressIndeterminate({
        status: 'PENDING',
        processedCount: 0,
        requestedLimit: 50,
        sinceDate: null,
      })
    ).toBe(true)
    expect(
      importProgressIndeterminate({
        status: 'RUNNING',
        processedCount: 0,
        requestedLimit: 50,
        sinceDate: null,
      })
    ).toBe(true)
    expect(
      importProgressIndeterminate({
        status: 'RUNNING',
        processedCount: 12,
        requestedLimit: 50,
        sinceDate: null,
      })
    ).toBe(false)
  })

  it('keeps since-date progress indeterminate while running (no known total)', () => {
    expect(
      importProgressIndeterminate({
        status: 'RUNNING',
        processedCount: 500,
        requestedLimit: 0,
        sinceDate: '2026-01-01T00:00:00.000Z',
      })
    ).toBe(true)
  })

  it('maps counts to a visible percent and completes at 100', () => {
    expect(
      importProgressPercent({
        status: 'RUNNING',
        processedCount: 0,
        requestedLimit: 50,
        sinceDate: null,
      })
    ).toBe(8)
    expect(
      importProgressPercent({
        status: 'RUNNING',
        processedCount: 25,
        requestedLimit: 50,
        sinceDate: null,
      })
    ).toBe(50)
    expect(
      importProgressPercent({
        status: 'COMPLETED',
        processedCount: 40,
        requestedLimit: 50,
        sinceDate: null,
      })
    ).toBe(100)
  })

  it('labels reading vs classifying phases for by-count', () => {
    expect(
      importProgressLabel({
        status: 'RUNNING',
        processedCount: 0,
        importedCount: 0,
        duplicateCount: 0,
        requestedLimit: 50,
        sinceDate: null,
        errorMessage: null,
      })
    ).toMatch(/Reading/)
    expect(
      importProgressLabel({
        status: 'RUNNING',
        processedCount: 10,
        importedCount: 8,
        duplicateCount: 2,
        requestedLimit: 50,
        sinceDate: null,
        errorMessage: null,
      })
    ).toMatch(/Importing & classifying/)
  })

  it('labels since-date with processed/imported/duplicates (no /250)', () => {
    const label = importProgressLabel({
      status: 'RUNNING',
      processedCount: 500,
      importedCount: 462,
      duplicateCount: 38,
      requestedLimit: 0,
      sinceDate: '2026-01-01T00:00:00.000Z',
      errorMessage: null,
    })
    expect(label).toMatch(/processed 500/)
    expect(label).toMatch(/imported 462/)
    expect(label).toMatch(/duplicates 38/)
    expect(label).not.toMatch(/\/\s*250/)
  })
})
