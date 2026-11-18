export const JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION =
  "job-intel-extract-v1" as const;
export const JOB_INTELLIGENCE_SCHEMA_VERSION = "job-intel-schema-v1" as const;
export const JOB_INTELLIGENCE_SUMMARY_MODEL_VERSION =
  "job-intel-summary-v1" as const;

/** Emails processed per worker tick / batch. */
export const JOB_INTELLIGENCE_EMAIL_BATCH_SIZE = 8;

/** Max characters of current-message body sent to the extractor. */
export const JOB_INTELLIGENCE_MAX_BODY_CHARS = 12_000;

/** Max characters of attachment extracted text per email. */
export const JOB_INTELLIGENCE_MAX_ATTACHMENT_CHARS = 6_000;

/** Max events accepted from a single email extraction. */
export const JOB_INTELLIGENCE_MAX_EVENTS_PER_EMAIL = 20;

/** Debounce window hint for incremental enqueue (ms). */
export const JOB_INTELLIGENCE_INCREMENTAL_DEBOUNCE_MS = 15_000;
