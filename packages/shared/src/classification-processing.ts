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

export function truncateClassificationError(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
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
