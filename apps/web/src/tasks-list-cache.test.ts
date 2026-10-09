import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearTasksListCacheForTests,
  getCachedTasksList,
  invalidateTasksListCache,
  patchCachedTasksListPin,
  setCachedTasksList,
  sortTasksPinnedFirst,
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
      hasMore: false,
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
      hasMore: false,
    })
    setCachedTasksList('ws', 'conn-b', 1, {
      tasks: [],
      page: 1,
      totalCount: 0,
      totalPages: 0,
      hasMore: false,
    })
    invalidateTasksListCache('ws', 'conn-a')
    expect(getCachedTasksList('ws', 'conn-a')).toBeNull()
    expect(getCachedTasksList('ws', 'conn-b')).not.toBeNull()
  })

  it('sortTasksPinnedFirst moves pinned to top without changing relative unpinned order', () => {
    const sorted = sortTasksPinnedFirst([
      { task: { id: 'a', isPinned: false } } as never,
      { task: { id: 'b', isPinned: true } } as never,
      { task: { id: 'c', isPinned: false } } as never,
    ])
    expect(sorted.map((t) => t.task.id)).toEqual(['b', 'a', 'c'])
  })

  it('patchCachedTasksListPin updates pin across filter caches and removes from pinnedOnly', () => {
    setCachedTasksList(
      'ws',
      'conn',
      1,
      {
        tasks: [
          { task: { id: 't1', isPinned: false } } as never,
          { task: { id: 't2', isPinned: false } } as never,
        ],
        page: 1,
        totalCount: 2,
        totalPages: 1,
        hasMore: false,
      },
      { statusFilter: 'OPEN' }
    )
    setCachedTasksList(
      'ws',
      'conn',
      1,
      {
        tasks: [{ task: { id: 't1', isPinned: true } } as never],
        page: 1,
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
      },
      { statusFilter: 'OPEN', pinnedOnly: true }
    )

    patchCachedTasksListPin({
      workspaceId: 'ws',
      connectionId: 'conn',
      taskId: 't1',
      isPinned: true,
    })
    expect(
      getCachedTasksList('ws', 'conn', 1, { statusFilter: 'OPEN' })?.tasks[0]?.task
        .isPinned
    ).toBe(true)

    patchCachedTasksListPin({
      workspaceId: 'ws',
      connectionId: 'conn',
      taskId: 't1',
      isPinned: false,
    })
    expect(
      getCachedTasksList('ws', 'conn', 1, {
        statusFilter: 'OPEN',
        pinnedOnly: true,
      })?.tasks
    ).toEqual([])
  })

  it('separates cache entries by filter fingerprint', () => {
    setCachedTasksList(
      'ws',
      'conn',
      1,
      {
        tasks: [{ task: { id: 'overdue' } } as never],
        page: 1,
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
      },
      { due: 'OVERDUE' }
    )
    setCachedTasksList(
      'ws',
      'conn',
      1,
      {
        tasks: [{ task: { id: 'all' } } as never],
        page: 1,
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
      },
      {}
    )
    expect(
      getCachedTasksList('ws', 'conn', 1, { due: 'OVERDUE' })?.tasks[0]?.task.id
    ).toBe('overdue')
    expect(getCachedTasksList('ws', 'conn', 1, {})?.tasks[0]?.task.id).toBe('all')
  })
})
