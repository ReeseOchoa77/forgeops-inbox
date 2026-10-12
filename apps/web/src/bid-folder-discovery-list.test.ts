import { describe, expect, it } from 'vitest'
import {
  appendBidFolderDiscoveryItems,
  analyzeDiscoveryUsesCanonicalDataset,
  BID_FOLDER_DISCOVERY_PAGE_SIZE,
  bidFolderDiscoveryHasMore,
  bidFolderDiscoveryQueryKey,
} from './bid-folder-discovery-list'

describe('bid folder discovery infinite list helpers', () => {
  it('defaults page size to 50 (bounded server pages)', () => {
    expect(BID_FOLDER_DISCOVERY_PAGE_SIZE).toBe(50)
  })

  it('initial page has more when total exceeds page size', () => {
    expect(
      bidFolderDiscoveryHasMore({ page: 1, pageSize: 50, total: 127 })
    ).toBe(true)
    expect(
      bidFolderDiscoveryHasMore({ page: 1, pageSize: 50, total: 50 })
    ).toBe(false)
    expect(
      bidFolderDiscoveryHasMore({ page: 1, pageSize: 50, total: 0 })
    ).toBe(false)
  })

  it('stops after final page', () => {
    expect(
      bidFolderDiscoveryHasMore({ page: 2, pageSize: 50, total: 127 })
    ).toBe(true)
    expect(
      bidFolderDiscoveryHasMore({ page: 3, pageSize: 50, total: 127 })
    ).toBe(false)
  })

  it('appends next page rather than replacing', () => {
    const page1 = [
      { discoveryId: 'd1' },
      { discoveryId: 'd2' },
    ]
    const page2 = [
      { discoveryId: 'd3' },
      { discoveryId: 'd4' },
    ]
    expect(appendBidFolderDiscoveryItems(page1, page2)).toEqual([
      { discoveryId: 'd1' },
      { discoveryId: 'd2' },
      { discoveryId: 'd3' },
      { discoveryId: 'd4' },
    ])
  })

  it('dedupes overlapping page boundaries by discoveryId', () => {
    const prev = [{ discoveryId: 'd1' }, { discoveryId: 'd2' }]
    const next = [{ discoveryId: 'd2' }, { discoveryId: 'd3' }]
    expect(appendBidFolderDiscoveryItems(prev, next)).toEqual([
      { discoveryId: 'd1' },
      { discoveryId: 'd2' },
      { discoveryId: 'd3' },
    ])
  })

  it('isolates Bid Invite vs Quote query keys', () => {
    const invites = bidFolderDiscoveryQueryKey({
      workspaceId: 'ws',
      connectionId: 'c1',
      role: 'BID_INVITE',
      sort: 'newest',
      search: '',
    })
    const quotes = bidFolderDiscoveryQueryKey({
      workspaceId: 'ws',
      connectionId: 'c1',
      role: 'QUOTE',
      sort: 'newest',
      search: '',
    })
    expect(invites).not.toBe(quotes)
  })

  it('search and sort change the query key (reset identity)', () => {
    const base = {
      workspaceId: 'ws',
      connectionId: 'c1',
      role: 'BID_INVITE' as const,
      sort: 'newest' as const,
      search: '',
    }
    expect(bidFolderDiscoveryQueryKey({ ...base, search: 'Falcon' })).not.toBe(
      bidFolderDiscoveryQueryKey(base)
    )
    expect(bidFolderDiscoveryQueryKey({ ...base, sort: 'oldest' })).not.toBe(
      bidFolderDiscoveryQueryKey(base)
    )
    expect(bidFolderDiscoveryQueryKey({ ...base, sort: 'newest' })).toBe(
      bidFolderDiscoveryQueryKey(base)
    )
  })

  it('newest is the default sort identity when callers pass newest', () => {
    expect(
      bidFolderDiscoveryQueryKey({
        workspaceId: 'ws',
        connectionId: 'c',
        role: 'BID_INVITE',
        sort: 'newest',
        search: '',
      })
    ).toContain('newest')
  })

  it('Analyze uses canonical discovery totals, not only loaded UI rows', () => {
    expect(
      analyzeDiscoveryUsesCanonicalDataset({
        loadedItemCount: 50,
        discoveryTotalCount: 127,
        analyzeUsesUiLoadedRowsOnly: false,
      })
    ).toBe(true)
    expect(
      analyzeDiscoveryUsesCanonicalDataset({
        loadedItemCount: 50,
        discoveryTotalCount: 127,
        analyzeUsesUiLoadedRowsOnly: true,
      })
    ).toBe(false)
  })
})
