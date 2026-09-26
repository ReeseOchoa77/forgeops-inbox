/** Logic version stored with every inline-image relevance row. */
export const INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION = "inline-image-relevance-v1";

/** Images at or below this size may be sent to the vision classifier. */
export const INLINE_IMAGE_VISION_MAX_BYTES = 1_500_000;

/** A vision result at or above this confidence may be copied by exact checksum. */
export const INLINE_IMAGE_MODEL_HASH_MIN_CONFIDENCE = 0.8;

export const INLINE_IMAGE_RELEVANCE_VALUES = ["RELEVANT", "NOISE", "UNCERTAIN"] as const;
export type InlineImageRelevance = (typeof INLINE_IMAGE_RELEVANCE_VALUES)[number];

export const INLINE_IMAGE_NOISE_REASONS = [
  "LOGO",
  "ICON",
  "SIGNATURE_GRAPHIC",
  "DECORATIVE",
  "TRACKING_PIXEL",
  "BADGE",
  "REPEATED_BRANDING",
  "OTHER_NOISE",
] as const;
export type InlineImageNoiseReason = (typeof INLINE_IMAGE_NOISE_REASONS)[number];

export const INLINE_IMAGE_RELEVANCE_METHODS = [
  "DETERMINISTIC",
  "VISION",
  "HUMAN",
  "HUMAN_CONFIRMED_HASH_MATCH",
  "MODEL_HASH_MATCH",
] as const;
export type InlineImageRelevanceMethod = (typeof INLINE_IMAGE_RELEVANCE_METHODS)[number];

/** Vision accepts these types. Other image/* types stay UNCERTAIN and are not sent. */
export const INLINE_IMAGE_VISION_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export const INLINE_IMAGE_PAGE_SIZE = 25;

export function normalizeImageMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isVisionSupportedImageMime(mimeType: string): boolean {
  const mime = normalizeImageMimeType(mimeType);
  return (INLINE_IMAGE_VISION_MIME_TYPES as readonly string[]).includes(mime);
}
