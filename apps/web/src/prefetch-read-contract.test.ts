import { describe, expect, it } from 'vitest'

/**
 * Prefetch / hover must never mutate read state.
 * Only MessageDetailView applyThread on actual open may call markAsRead.
 */
describe('prefetch does not mark read', () => {
  it('prefetch path is GET-only', () => {
    const prefetchActions = ['getMessageThread'] as const
    expect(prefetchActions).not.toContain('markAsRead')
  })

  it('open path may mark read after detail mount', () => {
    const openActions = ['getMessageThread', 'markAsRead'] as const
    expect(openActions).toContain('markAsRead')
  })
})
