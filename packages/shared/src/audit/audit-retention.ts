/**
 * AuditEvent retention policy.
 *
 * Operational / high-frequency events are eligible for timed cleanup.
 * Durable security/compliance events are retained indefinitely (manual review only).
 *
 * Cleanup is NEVER automatic on deploy — use the explicit cleanup script.
 */

export const AUDIT_OPERATIONAL_RETENTION_DAYS = 30;

/** High-frequency operational actions eligible for retention cleanup. */
export const AUDIT_OPERATIONAL_ACTIONS = [
  "inbox_connection.sync_started",
  "inbox_connection.sync_succeeded",
  // Keep sync_failed durable — security/ops signal of auth/config failures.
  "inbox_connection.analysis_started",
  "inbox_connection.analysis_succeeded",
  "workspace.inbox_connections_viewed",
  "inbox_connection.messages_viewed",
  "inbox_connection.tasks_viewed",
  "inbox_connection.review_queue_viewed",
] as const;

export type AuditOperationalAction = (typeof AUDIT_OPERATIONAL_ACTIONS)[number];

const OPERATIONAL_SET = new Set<string>(AUDIT_OPERATIONAL_ACTIONS);

export function isOperationalAuditAction(action: string): boolean {
  return OPERATIONAL_SET.has(action);
}

export function auditRetentionDaysForAction(action: string): number | null {
  if (isOperationalAuditAction(action)) {
    return AUDIT_OPERATIONAL_RETENTION_DAYS;
  }
  return null; // durable — no automatic retention
}

export function operationalAuditCutoffDate(
  now: Date = new Date(),
  retentionDays: number = AUDIT_OPERATIONAL_RETENTION_DAYS
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
