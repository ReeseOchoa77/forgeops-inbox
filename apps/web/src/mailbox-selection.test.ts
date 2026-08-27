import { describe, expect, it } from 'vitest'
import {
  ALL_MAILBOXES_CONNECTION_ID,
  isAllMailboxesConnectionId,
  pickDefaultInboxConnectionId,
} from './mailbox-selection'

const connections = [
  { id: 'c-other', email: 'other@co.com' },
  { id: 'c-me', email: 'me@co.com' },
  { id: 'c-third', email: 'third@co.com' },
]

describe('pickDefaultInboxConnectionId', () => {
  it('prefers pinned mailbox when still accessible', () => {
    expect(
      pickDefaultInboxConnectionId({
        connections,
        pinnedInboxConnectionId: 'c-third',
        signedInEmail: 'me@co.com',
      })
    ).toBe('c-third')
  })

  it('falls back to signed-in email match when pin missing', () => {
    expect(
      pickDefaultInboxConnectionId({
        connections,
        pinnedInboxConnectionId: null,
        signedInEmail: 'me@co.com',
      })
    ).toBe('c-me')
  })

  it('ignores stale pin and uses signed-in match', () => {
    expect(
      pickDefaultInboxConnectionId({
        connections,
        pinnedInboxConnectionId: 'deleted-id',
        signedInEmail: 'me@co.com',
      })
    ).toBe('c-me')
  })

  it('falls back to first connection', () => {
    expect(
      pickDefaultInboxConnectionId({
        connections,
        pinnedInboxConnectionId: null,
        signedInEmail: 'nobody@co.com',
      })
    ).toBe('c-other')
  })
})

describe('ALL_MAILBOXES_CONNECTION_ID', () => {
  it('identifies all-mailboxes sentinel', () => {
    expect(isAllMailboxesConnectionId(ALL_MAILBOXES_CONNECTION_ID)).toBe(true)
    expect(isAllMailboxesConnectionId('c-me')).toBe(false)
  })
})
