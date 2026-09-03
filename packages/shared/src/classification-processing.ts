import { extractPrismaClientDiagnostic } from "./prisma-error-diagnostic.js";

/** Max automatic enqueue cycles (safety-net) before marking FAILED permanently. */
export const MAX_AUTO_CLASSIFICATION_ATTEMPTS = 3;

/** Bounded error string persisted on EmailMessage.classificationError. */
export const CLASSIFICATION_ERROR_MAX_LEN = 480;

export type ClassificationProcessingStatus =
  | "PENDING"
  | "PROCESSING"
  | "CLASSIFIED"
  | "FAILED";

export type RetryClassificationOutcome =
  | "queued"
  | "already_processing"
  | "already_classified"
  | "failed_to_enqueue";

/**
 * Bound a classificationError for DB persistence.
 * When given a raw Prisma invocation dump, prefers the useful field diagnostic
 * so the bounded string is not only the useless opening lines.
 * Stage-prefixed messages (e.g. TASK_PERSIST: ...) are left intact aside from length.
 */
export function truncateClassificationError(message: string): string {
  const looksLikeRawPrismaDump = /Invalid `prisma\.[^`]+` invocation/i.test(
    message
  );
  const source = looksLikeRawPrismaDump
    ? extractPrismaClientDiagnostic(message).compactMessage || message
    : message;
  const cleaned = source.replace(/\s+/g, " ").trim();
  if (cleaned.length <= CLASSIFICATION_ERROR_MAX_LEN) return cleaned;
  return `${cleaned.slice(0, CLASSIFICATION_ERROR_MAX_LEN - 1)}…`;
}

/** Whether the safety-net may auto-requeue this message. */
export function canAutoRequeueClassification(input: {
  classificationAttemptCount: number;
  classificationStatus: ClassificationProcessingStatus | null | undefined;
}): boolean {
  if (input.classificationStatus === "FAILED") return false;
  if (input.classificationStatus === "CLASSIFIED") return false;
  return input.classificationAttemptCount < MAX_AUTO_CLASSIFICATION_ATTEMPTS;
}
