/**
 * Clear Inbox boundary for normal live ingestion.
 *
 * Compare the provider's historical received/sent instant to the connection's
 * current inboxClearedAt. Ingestion time, createdAt, and worker time are not inputs.
 * A missing provider timestamp fails closed when a watermark is set.
 * Explicit historical callers pass bypass: true.
 */
export function isBlockedByInboxClearedAt(input: {
  inboxClearedAt: Date | null;
  receivedAt: Date | null;
  sentAt: Date | null;
  bypass?: boolean;
}): boolean {
  if (input.bypass) return false;
  if (!input.inboxClearedAt) return false;
  const providerTimestamp = input.receivedAt ?? input.sentAt;
  if (!providerTimestamp || Number.isNaN(providerTimestamp.getTime())) return true;
  return providerTimestamp.getTime() <= input.inboxClearedAt.getTime();
}
