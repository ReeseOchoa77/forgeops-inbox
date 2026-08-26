import type { ApprovedAccessEntry, ConnectionSummary } from './api'

export type MemberMailboxState = 'connected' | 'authorization_required' | 'not_connected'

export function normalizeMailboxEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Find connections for a member email (case-insensitive). */
export function connectionsForMemberEmail(
  email: string,
  connections: ConnectionSummary[]
): ConnectionSummary[] {
  const normalized = normalizeMailboxEmail(email)
  return connections.filter((c) => normalizeMailboxEmail(c.email) === normalized)
}

export function deriveMemberMailboxState(
  email: string,
  connections: ConnectionSummary[]
): MemberMailboxState {
  const matches = connectionsForMemberEmail(email, connections)
  if (matches.length === 0) return 'not_connected'
  if (matches.some((c) => c.authorizationStatus === 'CONNECTED')) return 'connected'
  return 'authorization_required'
}

export function memberMailboxStateLabel(state: MemberMailboxState): string {
  if (state === 'connected') return 'Connected'
  if (state === 'authorization_required') return 'Authorization required'
  return 'Not connected'
}

/** Active Team Access entries eligible to connect a mailbox. */
export function eligibleTeamMembers(
  entries: ApprovedAccessEntry[]
): ApprovedAccessEntry[] {
  return entries.filter((e) => e.status === 'ACTIVE')
}

/**
 * Prefer an existing same-email connection for the chosen provider;
 * otherwise any connection for that email (for View / Reauthorize).
 */
export function findExistingMemberConnection(
  email: string,
  provider: 'outlook' | 'gmail',
  connections: ConnectionSummary[]
): ConnectionSummary | null {
  const matches = connectionsForMemberEmail(email, connections)
  if (matches.length === 0) return null
  const providerKey = provider === 'gmail' ? 'gmail' : 'outlook'
  return (
    matches.find((c) => c.provider.toLowerCase() === providerKey) ??
    matches[0] ??
    null
  )
}
