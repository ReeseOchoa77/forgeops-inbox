import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearRememberedAnalyzeRunsForTests,
  isAnalyzeRunInProgress,
  readRememberedAnalyzeRun,
  rememberAnalyzeRun,
} from './analyze-run-memory'

const progress = {
  status: 'RUNNING',
  currentFolderName: '2218 Koch',
  processed: 12,
  created: 4,
  existing: 8,
  assigned: 10,
  classifyQueued: 4,
  conflicts: 0,
  failed: 0,
  foldersDone: 1,
  foldersTotal: 6,
  errorMessage: null,
}

describe('email analysis progress memory', () => {
  beforeEach(() => clearRememberedAnalyzeRunsForTests())

  it('keeps an in-progress run for the mailbox after the view unmounts', () => {
    rememberAnalyzeRun('ws', 'conn', { runId: 'run-1', progress })
    expect(readRememberedAnalyzeRun('ws', 'conn')?.runId).toBe('run-1')
    expect(readRememberedAnalyzeRun('ws', 'other')).toBeNull()
  })

  it('treats pending and running as still active', () => {
    expect(isAnalyzeRunInProgress('PENDING')).toBe(true)
    expect(isAnalyzeRunInProgress('RUNNING')).toBe(true)
    expect(isAnalyzeRunInProgress('COMPLETED')).toBe(false)
    expect(isAnalyzeRunInProgress('FAILED')).toBe(false)
  })
})
