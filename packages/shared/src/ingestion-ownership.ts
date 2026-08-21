/**
 * Ingestion ownership: N8N vs NATIVE.
 *
 * N8N mailboxes: n8n owns message ingest + BUSINESS/PERSONAL classification.
 * ForgeOps OAuth is for attachments/send/token refresh only — not mailbox sync.
 *
 * NATIVE mailboxes: ForgeOps owns Graph sync + native analysis.
 */

export type IngestionSource = "NATIVE" | "N8N";

export const NATIVE_INBOX_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function scheduledInboxSyncJobId(connectionId: string): string {
  return `scheduled-sync:${connectionId}`;
}

/** Repeatable BullMQ inbox-sync only for ACTIVE NATIVE connections. */
export function shouldScheduleNativeInboxSync(connection: {
  status: string;
  ingestionSource: string;
}): boolean {
  return (
    connection.status === "ACTIVE" && connection.ingestionSource === "NATIVE"
  );
}

/** Hard guard: never import/analyze via native sync for N8N-owned connections. */
export function shouldRunNativeInboxSync(connection: {
  ingestionSource: string;
}): boolean {
  return connection.ingestionSource === "NATIVE";
}

/** Detect n8n-owned Classification rows (modelName e.g. "n8n-openai"). */
export function isN8nOwnedClassification(
  classification: { modelName?: string | null } | null | undefined
): boolean {
  const name = classification?.modelName?.trim().toLowerCase();
  if (!name) return false;
  return name.startsWith("n8n");
}

/**
 * Native analyzer must not overwrite:
 * - n8n-owned classifications
 * - manually reviewed classifications (APPROVED/REJECTED)
 */
export function shouldSkipNativeClassificationOverwrite(
  classification: {
    modelName?: string | null;
    reviewStatus?: string | null;
  } | null | undefined
): boolean {
  if (!classification) return false;
  if (isN8nOwnedClassification(classification)) return true;
  const status = classification.reviewStatus;
  return status === "APPROVED" || status === "REJECTED";
}

export type ClassificationWriteSource = "N8N" | "NATIVE_ANALYSIS" | "MANUAL";

/** Safe structured log payload for category ownership debugging (no bodies/tokens). */
export function buildClassificationWriteLog(input: {
  workspaceId: string;
  inboxConnectionId?: string | null;
  emailMessageId: string;
  source: ClassificationWriteSource;
  previousCategory: string | null | undefined;
  newCategory: string | null | undefined;
  modelName?: string | null;
}): Record<string, unknown> {
  return {
    event: "email-classification-write",
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId ?? null,
    emailMessageId: input.emailMessageId,
    source: input.source,
    previousCategory: input.previousCategory ?? null,
    newCategory: input.newCategory ?? null,
    modelName: input.modelName ?? null,
  };
}
