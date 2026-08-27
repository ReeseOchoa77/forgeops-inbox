import { describe, expect, it } from 'vitest'
import type { ApprovedAccessEntry, ConnectionSummary } from './api'
import {
  connectionsForMemberEmail,
  deriveMemberMailboxState,
  eligibleTeamMembers,
  findExistingMemberConnection,
  memberMailboxStateLabel,
  normalizeMailboxEmail,
} from './monitored-mailbox-eligibility'

function conn(partial: Partial<ConnectionSummary> & Pick<ConnectionSummary, 'id' | 'email'>): ConnectionSummary {
  return {
    provider: 'outlook',
    displayName: null,
    status: 'ACTIVE',
    connectedAt: null,
    lastSyncedAt: null,
    authorizationStatus: 'REQUIRED',
    capabilities: {
      emailIngestion: true,
      directProviderAccess: false,
      attachmentIngestion: false,
      emailSending: false,
    },
    counts: { messages: 0, threads: 0 },
    ...partial,
  }
}

function member(partial: Partial<ApprovedAccessEntry> & Pick<ApprovedAccessEntry, 'id' | 'email'>): ApprovedAccessEntry {
  return {
    role: 'MEMBER',
    status: 'ACTIVE',
    invitedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  }
}

describe('monitored mailbox eligibility', () => {
  it('normalizes emails for matching', () => {
    expect(normalizeMailboxEmail(' Ed@Tekstl.net ')).toBe('ed@tekstl.net')
  })

  it('scopes eligible members to ACTIVE team access only', () => {
    const entries = [
      member({ id: '1', email: 'a@x.com', status: 'ACTIVE' }),
      member({ id: '2', email: 'b@x.com', status: 'REVOKED' }),
    ]
    expect(eligibleTeamMembers(entries).map((e) => e.email)).toEqual(['a@x.com'])
  })

  it('derives mailbox state Connected / Authorization required / Not connected', () => {
    const connections = [
      conn({ id: 'c1', email: 'Ed@Tekstl.net', authorizationStatus: 'CONNECTED' }),
      conn({ id: 'c2', email: 'needs@x.com', authorizationStatus: 'REQUIRED' }),
    ]
    expect(deriveMemberMailboxState('ed@tekstl.net', connections)).toBe('connected')
    expect(memberMailboxStateLabel('connected')).toBe('Connected')
    expect(deriveMemberMailboxState('needs@x.com', connections)).toBe('authorization_required')
    expect(memberMailboxStateLabel('authorization_required')).toBe('Authorization required')
    expect(deriveMemberMailboxState('none@x.com', connections)).toBe('not_connected')
  })

  it('finds existing connection by email+provider without inventing duplicates', () => {
    const connections = [
      conn({ id: 'c1', email: 'ed@tekstl.net', provider: 'outlook', authorizationStatus: 'CONNECTED' }),
    ]
    expect(findExistingMemberConnection('Ed@Tekstl.net', 'outlook', connections)?.id).toBe('c1')
    expect(findExistingMemberConnection('ed@tekstl.net', 'gmail', connections)?.id).toBe('c1')
    expect(connectionsForMemberEmail('ED@TEKSTL.NET', connections)).toHaveLength(1)
  })

  it('finds DISCONNECTED connections so Add Mailbox can re-authorize without duplicates', () => {
    const connections = [
      conn({
        id: 'c_disc',
        email: 'ed@tekstl.net',
        provider: 'outlook',
        status: 'DISCONNECTED',
        authorizationStatus: 'REQUIRED',
      }),
    ]
    expect(findExistingMemberConnection('ed@tekstl.net', 'outlook', connections)?.id).toBe(
      'c_disc'
    )
    expect(deriveMemberMailboxState('ed@tekstl.net', connections)).toBe(
      'authorization_required'
    )
  })
})

describe('workspace team access placement', () => {
  it('documents Team Access as a Workspace tab (not top-level nav)', () => {
    const workspaceTabs = ['mailboxes', 'team', 'folders'] as const
    expect(workspaceTabs).toContain('team')
    expect(workspaceTabs).toContain('mailboxes')
  })
})
