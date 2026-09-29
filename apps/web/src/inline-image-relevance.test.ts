import { describe, expect, it } from 'vitest'
import {
  confidencePercent,
  imageCardBackground,
  imageCardBorder,
  INLINE_IMAGE_REVIEW_UI_CONTRACT,
  methodLabel,
  noiseReasonLabel,
  relevanceHeadline,
  type InlineImageRelevanceInfo,
} from './inline-image-relevance'

const noise: InlineImageRelevanceInfo = {
  emailAttachmentId: 'a1',
  relevance: 'NOISE',
  noiseReason: 'LOGO',
  confidence: 0.97,
  method: 'VISION',
  analyzerVersion: 'inline-image-relevance-v1',
  evidence: 'company logo',
  analyzedAt: '2026-09-29T12:00:00.000Z',
  correctedAt: null,
  priorRelevance: null,
  priorMethod: null,
}

const relevant: InlineImageRelevanceInfo = {
  ...noise,
  relevance: 'RELEVANT',
  noiseReason: null,
  method: 'HUMAN',
}

const uncertain: InlineImageRelevanceInfo = {
  ...noise,
  relevance: 'UNCERTAIN',
  noiseReason: null,
}

describe('inline image relevance display', () => {
  it('keeps NOISE visible with muted-red treatment and reason badge', () => {
    expect(relevanceHeadline(noise)).toBe('Likely irrelevant · Logo')
    expect(imageCardBorder(noise)).toContain('#f5b5b5')
    expect(imageCardBackground(noise)).toBe('#fffafa')
  })

  it('keeps RELEVANT normal without heavy chrome', () => {
    expect(relevanceHeadline(relevant)).toBe('Relevant')
    expect(imageCardBorder(relevant)).toBe('1px solid #e5e7eb')
    expect(imageCardBackground(relevant)).toBe('#fff')
  })

  it('gives UNCERTAIN a distinct neutral treatment', () => {
    expect(relevanceHeadline(uncertain)).toBe('Unsure')
    expect(imageCardBorder(uncertain)).toContain('#d1d5db')
    expect(imageCardBorder(uncertain)).not.toContain('#f5b5b5')
  })

  it('renders NOT_ANALYZED without implying relevance', () => {
    expect(relevanceHeadline(null)).toBe('Not analyzed')
    expect(imageCardBorder(null)).toBe('1px solid #e5e7eb')
  })

  it('formats confidence and method for details panel', () => {
    expect(confidencePercent(0.97)).toBe('97%')
    expect(methodLabel('VISION')).toBe('Vision')
    expect(methodLabel('HUMAN_CONFIRMED_HASH_MATCH')).toBe('Human (hash match)')
    expect(noiseReasonLabel('SIGNATURE_GRAPHIC')).toBe('Signature graphic')
  })
})

describe('job documents review surface contract', () => {
  it('marks noise visually without hide/delete/grayscale paths', () => {
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.doesNotHideNoise).toBe(true)
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.doesNotGrayscaleNoise).toBe(true)
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.doesNotDeleteImages).toBe(true)
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.noiseBadgePrefix).toBe('Likely irrelevant')
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.uncertainBadge).toBe('Unsure')
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.notAnalyzedLabel).toBe('Not analyzed')
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.defaultImageRelevanceFilter).toBe('ALL')
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.viewFilterNote).toContain('View filter only')
  })

  it('does not mark email read from image review helpers', () => {
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.doesNotMarkEmailRead).toBe(true)
  })

  it('does not call AI from web relevance helpers', () => {
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.doesNotCallAiFromUi).toBe(true)
  })

  it('defers email-reader CID annotation', () => {
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.emailReaderDeferred).toBe(true)
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.surfaces).toEqual(['Job Documents'])
  })

  it('exposes human correction labels', () => {
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.markRelevant).toBe('Mark relevant')
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.markIrrelevant).toBe('Mark irrelevant')
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.reasonMenuTitle).toBe('Why irrelevant?')
    expect(INLINE_IMAGE_REVIEW_UI_CONTRACT.reviewModeLabel).toBe('Review images')
  })
})
