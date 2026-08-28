/**
 * Audit metadata hygiene: keep AuditEvent.metadata compact and free of secrets /
 * operational blobs that already live in canonical tables (e.g. InboxConnection.syncCursor).
 */

/** Soft warning threshold — emit a log when metadata JSON exceeds this. */
export const AUDIT_METADATA_WARN_BYTES = 8 * 1024;

/** Hard ceiling — refuse to persist larger payloads (replace with stub). */
export const AUDIT_METADATA_MAX_BYTES = 16 * 1024;

const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|refresh|access.?token|delta.?link|sync.?cursor|cursor|bodyHtml|bodyText|rawBody)/i;

export type SanitizeAuditMetadataResult = {
  metadata: Record<string, unknown>;
  byteLength: number;
  warned: boolean;
  truncated: boolean;
  strippedKeys: string[];
};

function utf8ByteLength(value: string): number {
  if (typeof Buffer !== "undefined") {
    return Buffer.byteLength(value, "utf8");
  }
  return new TextEncoder().encode(value).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively strip sensitive keys and unbounded arrays from audit metadata.
 * Arrays of primitives longer than `maxArrayLength` become `{ count }`.
 */
export function sanitizeAuditMetadata(
  input: Record<string, unknown> | null | undefined,
  options?: {
    maxArrayLength?: number;
    warnBytes?: number;
    maxBytes?: number;
    onWarn?: (info: {
      byteLength: number;
      truncated: boolean;
      strippedKeys: string[];
    }) => void;
  }
): SanitizeAuditMetadataResult {
  const maxArrayLength = options?.maxArrayLength ?? 20;
  const warnBytes = options?.warnBytes ?? AUDIT_METADATA_WARN_BYTES;
  const maxBytes = options?.maxBytes ?? AUDIT_METADATA_MAX_BYTES;
  const strippedKeys: string[] = [];

  const walk = (value: unknown, path: string): unknown => {
    if (value == null) return value;
    if (typeof value === "string") {
      // Cap accidental long strings (cursors, HTML, tokens).
      if (value.length > 512 || SENSITIVE_KEY_RE.test(path)) {
        if (SENSITIVE_KEY_RE.test(path) || value.length > 2048) {
          strippedKeys.push(path || "(string)");
          return `[omitted:${value.length}chars]`;
        }
      }
      return value;
    }
    if (typeof value !== "object") return value;

    if (Array.isArray(value)) {
      if (value.length > maxArrayLength) {
        strippedKeys.push(path || "(array)");
        return { count: value.length, omitted: true };
      }
      return value.map((item, i) => walk(item, `${path}[${i}]`));
    }

    if (!isPlainObject(value)) return String(value);

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_KEY_RE.test(key)) {
        strippedKeys.push(childPath);
        if (typeof child === "string") {
          out[`${key}Omitted`] = true;
          out[`${key}Length`] = child.length;
        } else if (Array.isArray(child)) {
          out[`${key}Count`] = child.length;
        } else {
          out[`${key}Omitted`] = true;
        }
        continue;
      }
      out[key] = walk(child, childPath);
    }
    return out;
  };

  let metadata = (walk(input ?? {}, "") as Record<string, unknown>) ?? {};
  let serialized = JSON.stringify(metadata);
  let byteLength = utf8ByteLength(serialized);
  let warned = byteLength > warnBytes;
  let truncated = false;

  if (byteLength > maxBytes) {
    truncated = true;
    warned = true;
    const summary: Record<string, unknown> = {
      _auditMetadataTruncated: true,
      _originalByteLength: byteLength,
      _strippedKeys: strippedKeys.slice(0, 50),
    };
    for (const [k, v] of Object.entries(input ?? {})) {
      if (SENSITIVE_KEY_RE.test(k)) continue;
      if (typeof v === "number" || typeof v === "boolean" || v == null) {
        summary[k] = v;
      } else if (typeof v === "string" && v.length <= 64) {
        summary[k] = v;
      } else if (Array.isArray(v)) {
        summary[`${k}Count`] = v.length;
      }
    }
    metadata = summary;
    serialized = JSON.stringify(metadata);
    byteLength = utf8ByteLength(serialized);
  }

  if (warned) {
    options?.onWarn?.({ byteLength, truncated, strippedKeys });
  }

  return { metadata, byteLength, warned, truncated, strippedKeys };
}

/**
 * Compact metadata for inbox_connection.sync_succeeded.
 * Never includes sync cursors, message ID arrays, or attachment payloads.
 */
export function buildInboxSyncSucceededAuditMetadata(input: {
  provider: string;
  jobId?: string;
  refreshTokenRotated: boolean;
  syncCursorAdvanced: boolean;
  threadsImported: number;
  messagesImported: number;
  duplicatesSkipped: number;
  createdCount: number;
  updatedCount: number;
  duplicateCount: number;
  attachmentIngestCandidateCount: number;
  skippedClearedCount?: number;
  skipped?: boolean;
  skipReason?: string;
}): Record<string, unknown> {
  return {
    provider: input.provider,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    refreshTokenRotated: input.refreshTokenRotated,
    syncCursorAdvanced: input.syncCursorAdvanced,
    threadsImported: input.threadsImported,
    messagesImported: input.messagesImported,
    duplicatesSkipped: input.duplicatesSkipped,
    createdCount: input.createdCount,
    updatedCount: input.updatedCount,
    duplicateCount: input.duplicateCount,
    attachmentIngestCandidateCount: input.attachmentIngestCandidateCount,
    ...(input.skippedClearedCount != null
      ? { skippedClearedCount: input.skippedClearedCount }
      : {}),
    ...(input.skipped ? { skipped: true, skipReason: input.skipReason ?? null } : {}),
  };
}
