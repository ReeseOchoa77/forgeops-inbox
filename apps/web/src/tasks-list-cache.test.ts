import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearTasksListCacheForTests,
  getCachedTasksList,
  invalidateTasksListCache,
  setCachedTasksList,
} from './tasks-list-cache'

describe('tasks list cache', () => {
  beforeEach(() => {
    clearTasksListCacheForTests()
  })

  it('returns null when empty', () => {
    expect(getCachedTasksList('ws', 'conn')).toBeNull()
  })

  it('stores and returns first page within TTL', () => {
    setCachedTasksList('ws', 'conn', 1, {
      tasks: [{ task: { id: 't1' } } as never],
      page: 1,
      totalCount: 1,
      totalPages: 1,
    })
    const hit = getCachedTasksList('ws', 'conn', 1)
    expect(hit?.tasks).toHaveLength(1)
    expect(hit?.totalCount).toBe(1)
  })

  it('invalidateTasksListCache clears connection keys', () => {
    setCachedTasksList('ws', 'conn-a', 1, {
      tasks: [],
      page: 1,
      totalCount: 0,
      totalPages: 0,
    })
    setCachedTasksList('ws', 'conn-b', 1, {
      tasks: [],
      page: 1,
      totalCount: 0,
      totalPages: 0,
    })
    invalidateTasksListCache('ws', 'conn-a')
    expect(getCachedTasksList('ws', 'conn-a')).toBeNull()
    expect(getCachedTasksList('ws', 'conn-b')).not.toBeNull()
  })

  it('separates cache entries by dateRange', () => {
    setCachedTasksList('ws', 'conn', 1, {
      tasks: [{ task: { id: 'today' } } as never],
      page: 1,
      totalCount: 1,
      totalPages: 1,
    }, 'TODAY')
    setCachedTasksList('ws', 'conn', 1, {
      tasks: [{ task: { id: 'all' } } as never],
      page: 1,
      totalCount: 1,
      totalPages: 1,
    }, '')
    expect(getCachedTasksList('ws', 'conn', 1, 'TODAY')?.tasks[0]?.task.id).toBe('today')
    expect(getCachedTasksList('ws', 'conn', 1, '')?.tasks[0]?.task.id).toBe('all')
  })
})
