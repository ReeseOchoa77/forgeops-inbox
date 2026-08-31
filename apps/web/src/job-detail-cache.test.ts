import { describe, expect, it, beforeEach } from 'vitest'
import type { JobSummary } from './api'
import {
  clearJobDetailCacheForTests,
  getCachedJobDetail,
  jobDetailShellFromSummary,
  setCachedJobDetail,
} from './job-detail-cache'

const summary = {
  id: 'job-1',
  jobNumber: '100',
  name: 'Demo Job',
  status: 'ACTIVE',
  customerId: null,
  customerName: null,
  description: null,
  startDate: null,
  targetCompletionDate: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  emailCount: 3,
  openTaskCount: 1,
  overdueTaskCount: 0,
  lastActivityAt: null,
  nextDueDate: null,
  assignedMembers: [
    { userId: 'u1', name: 'Ada', email: 'ada@example.com', role: 'MEMBER' },
  ],
} satisfies JobSummary

describe('job detail cache', () => {
  beforeEach(() => {
    clearJobDetailCacheForTests()
  })

  it('shell from summary paints without network fields', () => {
    const shell = jobDetailShellFromSummary(summary)
    expect(shell.id).toBe('job-1')
    expect(shell.name).toBe('Demo Job')
    expect(shell.members).toHaveLength(1)
    expect(shell.aliases).toEqual([])
    expect(shell.attachmentCount).toBe(0)
  })

  it('stores and returns detail within TTL', () => {
    const shell = jobDetailShellFromSummary(summary)
    setCachedJobDetail('ws', 'job-1', { ...shell, notes: 'hi' })
    const hit = getCachedJobDetail('ws', 'job-1')
    expect(hit?.job.notes).toBe('hi')
  })
})
