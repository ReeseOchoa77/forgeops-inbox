/** Server page size for Bid Invites / Quotes discovery (matches API default). */
export const BID_FOLDER_DISCOVERY_PAGE_SIZE = 50

export type BidFolderDiscoveryListRole = 'BID_INVITE' | 'QUOTE'
export type BidFolderDiscoverySort = 'newest' | 'oldest'

export function bidFolderDiscoveryHasMore(input: {
  page: number
  pageSize: number
  total: number
}): boolean {
  if (input.total <= 0) return false
  return input.page * input.pageSize < input.total
}

/** Stable query identity for role/search/sort isolation. */
export function bidFolderDiscoveryQueryKey(input: {
  workspaceId: string
  connectionId: string
  role: BidFolderDiscoveryListRole
  sort: BidFolderDiscoverySort
  search: string
}): string {
  return [
    input.workspaceId,
    input.connectionId,
    input.role,
    input.sort,
    input.search.trim().toLowerCase(),
  ].join('|')
}

/** Append next page; dedupe by discoveryId (never use array index as key). */
export function appendBidFolderDiscoveryItems<T extends { discoveryId: string }>(
  prev: T[],
  next: T[]
): T[] {
  if (next.length === 0) return prev
  const seen = new Set(prev.map((r) => r.discoveryId))
  const appended: T[] = []
  for (const row of next) {
    if (seen.has(row.discoveryId)) continue
    seen.add(row.discoveryId)
    appended.push(row)
  }
  if (appended.length === 0) return prev
  return [...prev, ...appended]
}

/**
 * Analyze Discovered Emails must use canonical discovery totals / backend dataset —
 * never the count of rows currently mounted in the infinite-scroll UI.
 */
export function analyzeDiscoveryUsesCanonicalDataset(input: {
  loadedItemCount: number
  discoveryTotalCount: number
  analyzeUsesUiLoadedRowsOnly: boolean
}): boolean {
  if (input.analyzeUsesUiLoadedRowsOnly) return false
  if (input.discoveryTotalCount <= 0) return true
  // UI may have loaded a subset; that must not constrain analyze.
  return input.loadedItemCount <= input.discoveryTotalCount
}
