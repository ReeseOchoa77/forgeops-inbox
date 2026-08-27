/** Sentinel for All Mailboxes aggregate Inbox view (not a real connection id). */
export const ALL_MAILBOXES_CONNECTION_ID = '__all__'

export function isAllMailboxesConnectionId(id: string): boolean {
  return id === ALL_MAILBOXES_CONNECTION_ID
}

/**
 * Default mailbox when opening Inbox:
 * 1. User-pinned mailbox (if still accessible)
 * 2. Monitored mailbox matching signed-in user email
 * 3. First accessible connection
 */
export function pickDefaultInboxConnectionId(input: {
  connections: Array<{ id: string; email: string }>
  pinnedInboxConnectionId: string | null | undefined
  signedInEmail: string | null | undefined
}): string {
  const { connections, pinnedInboxConnectionId, signedInEmail } = input
  if (connections.length === 0) return ''

  if (
    pinnedInboxConnectionId &&
    connections.some((c) => c.id === pinnedInboxConnectionId)
  ) {
    return pinnedInboxConnectionId
  }

  const email = signedInEmail?.trim().toLowerCase() ?? ''
  if (email) {
    const match = connections.find((c) => c.email.toLowerCase() === email)
    if (match) return match.id
  }

  return connections[0]!.id
}
