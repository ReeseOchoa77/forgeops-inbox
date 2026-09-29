/** Display helpers for inline-image relevance (Job Documents review). No AI calls. */

export type ImageRelevanceValue = 'RELEVANT' | 'NOISE' | 'UNCERTAIN'

export type ImageRelevanceFilter = 'ALL' | 'RELEVANT' | 'NOISE' | 'UNCERTAIN' | 'NOT_ANALYZED'

export type InlineImageNoiseReason =
  | 'LOGO'
  | 'ICON'
  | 'SIGNATURE_GRAPHIC'
  | 'DECORATIVE'
  | 'TRACKING_PIXEL'
  | 'BADGE'
  | 'REPEATED_BRANDING'
  | 'OTHER_NOISE'

export type InlineImageRelevanceInfo = {
  emailAttachmentId: string
  relevance: ImageRelevanceValue
  noiseReason: InlineImageNoiseReason | null
  confidence: number
  method: string
  analyzerVersion: string
  evidence: string
  analyzedAt: string
  correctedAt: string | null
  priorRelevance: ImageRelevanceValue | null
  priorMethod: string | null
}

/** Static contract for tests — avoids node:fs under the web tsconfig. */
export const INLINE_IMAGE_REVIEW_UI_CONTRACT = {
  surfaces: ['Job Documents'],
  reviewModeLabel: 'Review images',
  viewFilterNote: 'View filter only — nothing is deleted or hidden from storage',
  noiseBadgePrefix: 'Likely irrelevant',
  uncertainBadge: 'Unsure',
  notAnalyzedLabel: 'Not analyzed',
  markRelevant: 'Mark relevant',
  markIrrelevant: 'Mark irrelevant',
  reasonMenuTitle: 'Why irrelevant?',
  doesNotHideNoise: true,
  doesNotGrayscaleNoise: true,
  doesNotDeleteImages: true,
  doesNotMarkEmailRead: true,
  doesNotCallAiFromUi: true,
  emailReaderDeferred: true,
  defaultImageRelevanceFilter: 'ALL' as ImageRelevanceFilter,
}

export const NOISE_REASON_OPTIONS: Array<{ value: InlineImageNoiseReason; label: string }> = [
  { value: 'LOGO', label: 'Logo' },
  { value: 'ICON', label: 'Icon' },
  { value: 'SIGNATURE_GRAPHIC', label: 'Signature graphic' },
  { value: 'DECORATIVE', label: 'Decorative' },
  { value: 'TRACKING_PIXEL', label: 'Tracking image' },
  { value: 'BADGE', label: 'Badge' },
  { value: 'REPEATED_BRANDING', label: 'Repeated branding' },
  { value: 'OTHER_NOISE', label: 'Other' },
]

export function noiseReasonLabel(reason: InlineImageNoiseReason | null | undefined): string {
  if (!reason) return ''
  return NOISE_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason
}

export function relevanceHeadline(info: InlineImageRelevanceInfo | null | undefined): string {
  if (!info) return 'Not analyzed'
  if (info.relevance === 'NOISE') {
    const reason = noiseReasonLabel(info.noiseReason)
    return reason ? `Likely irrelevant · ${reason}` : 'Likely irrelevant'
  }
  if (info.relevance === 'UNCERTAIN') return 'Unsure'
  return 'Relevant'
}

export function methodLabel(method: string): string {
  switch (method) {
    case 'DETERMINISTIC':
      return 'Deterministic'
    case 'VISION':
      return 'Vision'
    case 'HUMAN':
      return 'Human'
    case 'HUMAN_CONFIRMED_HASH_MATCH':
      return 'Human (hash match)'
    case 'MODEL_HASH_MATCH':
      return 'Vision (hash match)'
    default:
      return method
  }
}

export function confidencePercent(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`
}

/** Card chrome for Job Documents — never hides or replaces the image. */
export function imageCardBorder(info: InlineImageRelevanceInfo | null | undefined): string {
  if (!info) return '1px solid #e5e7eb'
  if (info.relevance === 'NOISE') return '2px solid #f5b5b5'
  if (info.relevance === 'UNCERTAIN') return '2px solid #d1d5db'
  return '1px solid #e5e7eb'
}

export function imageCardBackground(info: InlineImageRelevanceInfo | null | undefined): string {
  if (info?.relevance === 'NOISE') return '#fffafa'
  if (info?.relevance === 'UNCERTAIN') return '#fafafa'
  return '#fff'
}
