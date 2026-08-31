import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearJobsListCacheForTests,
  getCachedJobsList,
  invalidateJobsListCache,
  jobsListCacheKey,
  setCachedJobsList,
} from './jobs-list-cache'

describe('jobs list cache', () => {
  beforeEach(() => {
    clearJobsListCacheForTests()
  })

  it('returns null when empty', () => {
    expect(getCachedJobsList(jobsListCacheKey('ws', { page: 1 }))).toBeNull()
  })

  it('stores and returns page within TTL', () => {
    const key = jobsListCacheKey('ws', { page: 1, status: 'ACTIVE' })
    setCachedJobsList(key, {
      jobs: [{ id: 'j1' } as never],
      page: 1,
      totalCount: 1,
      hasMore: false,
    })
    const hit = getCachedJobsList(key)
    expect(hit?.jobs).toHaveLength(1)
    expect(hit?.totalCount).toBe(1)
  })

  it('invalidateJobsListCache clears workspace keys only', () => {
    const a = jobsListCacheKey('ws-a', { page: 1 })
    const b = jobsListCacheKey('ws-b', { page: 1 })
    setCachedJobsList(a, { jobs: [], page: 1, totalCount: 0, hasMore: false })
    setCachedJobsList(b, { jobs: [], page: 1, totalCount: 0, hasMore: false })
    invalidateJobsListCache('ws-a')
    expect(getCachedJobsList(a)).toBeNull()
    expect(getCachedJobsList(b)).not.toBeNull()
  })
})
