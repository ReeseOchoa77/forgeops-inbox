import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  confidencePercent,
  methodLabel,
  noiseReasonLabel,
  NOISE_REASON_OPTIONS,
  relevanceHeadline,
  type InlineImageNoiseReason,
  type InlineImageRelevanceInfo,
} from '../inline-image-relevance'

const badgeBase: CSSProperties = {
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.2px',
  lineHeight: 1.3,
}

function badgeStyle(info: InlineImageRelevanceInfo | null | undefined): CSSProperties {
  if (!info) {
    return { ...badgeBase, background: '#f3f4f6', color: '#6b7280' }
  }
  if (info.relevance === 'NOISE') {
    return { ...badgeBase, background: '#fce8e8', color: '#b91c1c' }
  }
  if (info.relevance === 'UNCERTAIN') {
    return { ...badgeBase, background: '#f3f4f6', color: '#4b5563' }
  }
  return { ...badgeBase, background: '#eef2ff', color: '#4338ca' }
}

export function InlineImageRelevanceBadge({
  info,
  reviewMode,
}: {
  info: InlineImageRelevanceInfo | null | undefined
  reviewMode?: boolean
}) {
  if (!info && !reviewMode) return null
  if (info?.relevance === 'RELEVANT' && !reviewMode) return null
  return <span style={badgeStyle(info)}>{relevanceHeadline(info)}</span>
}

export function InlineImageRelevanceDetails({
  info,
}: {
  info: InlineImageRelevanceInfo | null | undefined
}) {
  if (!info) {
    return (
      <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700, color: '#374151' }}>Not analyzed</div>
        <div>Run Analyze inline images from Worker Jobs to classify this image.</div>
      </div>
    )
  }
  return (
    <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, color: '#111', marginBottom: 4 }}>
        {info.relevance === 'NOISE'
          ? 'Likely irrelevant'
          : info.relevance === 'UNCERTAIN'
            ? 'Unsure'
            : 'Relevant'}
      </div>
      {info.relevance === 'NOISE' && info.noiseReason ? (
        <div>Reason: {noiseReasonLabel(info.noiseReason)}</div>
      ) : null}
      <div>Confidence: {confidencePercent(info.confidence)}</div>
      <div>Method: {methodLabel(info.method)}</div>
      <div>Analyzer: {info.analyzerVersion}</div>
      {info.evidence ? <div>Evidence: {info.evidence}</div> : null}
      <div>Analyzed: {new Date(info.analyzedAt).toLocaleString()}</div>
      {info.correctedAt ? (
        <div>Corrected: {new Date(info.correctedAt).toLocaleString()}</div>
      ) : null}
      {info.priorRelevance ? (
        <div>
          Prior: {info.priorRelevance}
          {info.priorMethod ? ` · ${methodLabel(info.priorMethod)}` : ''}
        </div>
      ) : null}
    </div>
  )
}

type CorrectFn = (input: {
  relevance: 'RELEVANT' | 'NOISE'
  noiseReason?: InlineImageNoiseReason | null
}) => Promise<void>

export function InlineImageRelevanceActions({
  info,
  canCorrect,
  busy,
  onCorrect,
}: {
  info: InlineImageRelevanceInfo | null | undefined
  canCorrect: boolean
  busy: boolean
  onCorrect: CorrectFn
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickingReason, setPickingReason] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setMenuOpen(false)
        setPickingReason(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  if (!canCorrect) return null

  const markRelevant = () => {
    void onCorrect({ relevance: 'RELEVANT', noiseReason: null })
    setMenuOpen(false)
    setPickingReason(false)
  }

  const markIrrelevant = (reason: InlineImageNoiseReason) => {
    void onCorrect({ relevance: 'NOISE', noiseReason: reason })
    setMenuOpen(false)
    setPickingReason(false)
  }

  const openIrrelevantPicker = () => {
    setPickingReason(true)
    setMenuOpen(true)
  }

  const btn: CSSProperties = {
    background: '#fff',
    border: '1px solid #d0d5dd',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    cursor: busy ? 'not-allowed' : 'pointer',
    color: '#374151',
    fontFamily: 'inherit',
  }

  const relevance = info?.relevance

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {relevance === 'NOISE' && (
        <button type="button" disabled={busy} onClick={markRelevant} style={btn}>
          Mark relevant
        </button>
      )}
      {relevance === 'RELEVANT' && (
        <button type="button" disabled={busy} onClick={openIrrelevantPicker} style={btn}>
          Mark irrelevant
        </button>
      )}
      {(relevance === 'UNCERTAIN' || !info) && (
        <>
          <button type="button" disabled={busy} onClick={markRelevant} style={btn}>
            Relevant
          </button>
          <button type="button" disabled={busy} onClick={openIrrelevantPicker} style={btn}>
            Irrelevant
          </button>
        </>
      )}

      {menuOpen && pickingReason && (
        <div
          id={menuId}
          role="menu"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 180,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
            padding: 6,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', padding: '4px 8px' }}>
            Why irrelevant?
          </div>
          {NOISE_REASON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => markIrrelevant(opt.value)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '6px 8px',
                fontSize: 12,
                cursor: busy ? 'not-allowed' : 'pointer',
                borderRadius: 4,
                fontFamily: 'inherit',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#f8fafc'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'none'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
