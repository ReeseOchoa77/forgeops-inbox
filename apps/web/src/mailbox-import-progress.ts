import type { MailboxHistoricalImportStatus } from './api'

export function isImportInProgress(status: string): boolean {
  return status === 'PENDING' || status === 'RUNNING'
}

/** 0–100 fill for the mailbox card progress bar. */
export function importProgressPercent(imp: Pick<
  MailboxHistoricalImportStatus,
  'status' | 'processedCount' | 'requestedLimit'
>): number {
  if (imp.status === 'COMPLETED') return 100
  if (imp.status === 'FAILED' || imp.status === 'CANCELLED') {
    const total = Math.max(imp.requestedLimit, 1)
    return Math.min(100, Math.round((imp.processedCount / total) * 100))
  }
  if (imp.status === 'PENDING') return 0
  const total = Math.max(imp.requestedLimit, 1)
  const pct = Math.round((imp.processedCount / total) * 100)
  // Keep a visible minimum once running so the bar doesn't look stuck empty.
  if (imp.processedCount === 0) return 8
  return Math.min(99, Math.max(8, pct))
}

export function importProgressLabel(imp: Pick<
  MailboxHistoricalImportStatus,
  'status' | 'processedCount' | 'importedCount' | 'requestedLimit' | 'errorMessage'
>): string {
  if (imp.status === 'COMPLETED') return 'Import complete'
  if (imp.status === 'FAILED') return imp.errorMessage?.trim() || 'Import failed'
  if (imp.status === 'CANCELLED') return 'Import cancelled'
  if (imp.status === 'PENDING') return 'Import queued…'
  if (imp.processedCount === 0 && imp.importedCount === 0) {
    return 'Reading previous emails…'
  }
  if (imp.processedCount < imp.requestedLimit) {
    return `Importing & classifying… ${imp.processedCount} / ${imp.requestedLimit}`
  }
  return `Classifying… ${imp.processedCount} / ${imp.requestedLimit}`
}

export function importProgressIndeterminate(imp: Pick<
  MailboxHistoricalImportStatus,
  'status' | 'processedCount'
>): boolean {
  return imp.status === 'PENDING' || (imp.status === 'RUNNING' && imp.processedCount === 0)
}
