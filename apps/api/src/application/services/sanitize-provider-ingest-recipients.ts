import { normalizeEmail } from "@forgeops/shared";
import { z } from "zod";

const emailFormat = z.string().email();

export type SanitizeProviderIngestRecipientsResult = {
  /** Canonical recipients for EmailMessage persistence (normalized, deduped). */
  recipients: string[];
  /** Malformed values dropped from the canonical list (truncated for diagnostics). */
  dropped: Array<{ rawPreview: string; normalizedPreview: string }>;
};

/**
 * Sanitize provider/n8n-ingested recipient lists.
 * Valid addresses are normalized (trim + lowercase) and deduped.
 * Malformed addresses are dropped — they must not fail the whole ingest.
 *
 * Do NOT use for outbound Send/Reply/Forward or mailbox connect (keep strict .email()).
 */
export function sanitizeProviderIngestRecipients(
  raw: readonly unknown[],
  options?: {
    field?: "to" | "cc";
    log?: (event: string, data: Record<string, unknown>) => void;
  }
): SanitizeProviderIngestRecipientsResult {
  const recipients: string[] = [];
  const dropped: Array<{ rawPreview: string; normalizedPreview: string }> = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "string") {
      const preview = String(entry).slice(0, 200);
      dropped.push({ rawPreview: preview, normalizedPreview: "" });
      options?.log?.("n8n-ingest-recipient-dropped", {
        field: options.field ?? null,
        reason: "non_string",
        recipientPreview: preview,
      });
      continue;
    }

    const rawPreview = entry.trim().slice(0, 200);
    if (!entry.trim()) {
      continue;
    }

    const normalized = normalizeEmail(entry);
    if (!emailFormat.safeParse(normalized).success) {
      dropped.push({
        rawPreview,
        normalizedPreview: normalized.slice(0, 200),
      });
      options?.log?.("n8n-ingest-recipient-dropped", {
        field: options.field ?? null,
        reason: "invalid_email",
        recipientPreview: normalized.slice(0, 200),
      });
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    recipients.push(normalized);
  }

  return { recipients, dropped };
}

/** Zod field for inbound provider recipient arrays (tolerant). */
export function providerIngestRecipientListSchema(
  field: "to" | "cc",
  maxRecipients: number
) {
  return z
    .array(z.string().max(320))
    .max(maxRecipients)
    .transform((raw) =>
      sanitizeProviderIngestRecipients(raw, {
        field,
        log: (event, data) => console.info(event, data),
      }).recipients
    );
}
