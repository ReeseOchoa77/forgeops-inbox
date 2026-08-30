/**
 * Ingestion ownership: N8N vs NATIVE (+ reserved SHADOW).
 *
 * Authentication (OAuth tokens) is separate from:
 * - nativeListeningEnabled (automatic new-mail listener / reconciliation)
 * - ingestionSource (who owns production classification writes)
 *
 * N8N mailboxes: n8n owns message ingest + BUSINESS/PERSONAL classification.
 * ForgeOps OAuth is for attachments/send/token refresh — not automatic sync.
 *
 * NATIVE mailboxes with listening ON: ForgeOps owns Graph sync + native analysis.
 * SHADOW: reserved; native classification must not overwrite production yet.
 */

export type IngestionSource = "NATIVE" | "N8N" | "SHADOW";

export const NATIVE_INBOX_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Hard cap for a single "By count" historical import request. */
export const HISTORICAL_IMPORT_MAX_LIMIT = 250;

export const HISTORICAL_IMPORT_LIMIT_PRESETS = [25, 50, 100, 250] as const;

/**
 * Internal Graph/Gmail page size for historical import batches.
 * Since-date mode pages until exhausted; By-count still respects requestedLimit.
 */
export const HISTORICAL_IMPORT_PAGE_SIZE = 50;

/**
 * requestedLimit=0 on MailboxHistoricalImport means Since-date with no total cap.
 * By-count uses 1…HISTORICAL_IMPORT_MAX_LIMIT.
 */
export const HISTORICAL_IMPORT_UNLIMITED = 0;

export function isUnlimitedHistoricalImport(requestedLimit: number): boolean {
  return requestedLimit === HISTORICAL_IMPORT_UNLIMITED;
}

/**
 * Parse a YYYY-MM-DD or ISO date string into a UTC Date (start of that calendar day
 * when only a date is provided). Used for historical import "since date" mode.
 */
export function parseHistoricalImportSinceDate(value: string): Date {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new Error(`Invalid sinceDate: ${value}`);
    }
    return parsed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid sinceDate: ${value}`);
  }
  return parsed;
}

export function scheduledInboxSyncJobId(connectionId: string): string {
  return `scheduled-sync-${connectionId}`;
}

export function historicalImportJobId(importId: string): string {
  return `historical-import-${importId}`;
}

/**
 * Parse connection id from a scheduled-sync BullMQ job id.
 * Accepts the current hyphen form and the legacy colon form for cleanup.
 */
export function connectionIdFromScheduledSyncJobId(
  jobId: string
): string | null {
  if (jobId.startsWith("scheduled-sync-")) {
    return jobId.slice("scheduled-sync-".length) || null;
  }
  if (jobId.startsWith("scheduled-sync:")) {
    return jobId.slice("scheduled-sync:".length) || null;
  }
  return null;
}

type ListenerGate = {
  status: string;
  ingestionSource: string;
  nativeListeningEnabled?: boolean | null;
};

function listeningEnabled(connection: {
  nativeListeningEnabled?: boolean | null;
}): boolean {
  return connection.nativeListeningEnabled === true;
}

/**
 * Repeatable BullMQ inbox-sync only when:
 * ACTIVE + NATIVE processing + explicit listener ON.
 */
export function shouldScheduleNativeInboxSync(connection: ListenerGate): boolean {
  return (
    connection.status === "ACTIVE" &&
    connection.ingestionSource === "NATIVE" &&
    listeningEnabled(connection)
  );
}

/**
 * Hard guard for automatic native sync/import (webhook + scheduled + push).
 * Manual historical import uses a separate path and does not call this.
 */
export function shouldRunNativeInboxSync(connection: {
  ingestionSource: string;
  nativeListeningEnabled?: boolean | null;
}): boolean {
  return (
    connection.ingestionSource === "NATIVE" && listeningEnabled(connection)
  );
}

/** Push/webhook subscription registration — same gate as scheduled sync. */
export function shouldRegisterNativePush(connection: ListenerGate): boolean {
  return shouldScheduleNativeInboxSync(connection);
}

/**
 * Whether newly imported messages may be analyzed by the native classifier
 * for production Classification rows. SHADOW is reserved / not enabled.
 * Listening is NOT required — historical import may classify while listener is OFF.
 */
export function shouldEnqueueNativeClassification(connection: {
  ingestionSource: string;
}): boolean {
  return connection.ingestionSource === "NATIVE";
}

/** Alias for production message-scoped classifier gate (same as enqueue rule). */
export function shouldRunProductionNativeClassification(connection: {
  ingestionSource: string;
}): boolean {
  return shouldEnqueueNativeClassification(connection);
}

export const NATIVE_PIPELINE_MODEL_NAME = "native-openai-pipeline";
export const NATIVE_PIPELINE_MODEL_VERSION = "v1";

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
