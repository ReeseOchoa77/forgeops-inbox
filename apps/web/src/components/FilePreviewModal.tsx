import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  formatPreviewSize,
  PREVIEW_FAILED_MESSAGE,
  PREVIEW_NOT_STORED_MESSAGE,
  previewKeyAction,
  previewTypeLabel,
  stepPreviewIndex,
  type PreviewFile,
} from '../file-preview'

type Props = {
  files: PreviewFile[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

export function FilePreviewModal({ files, index, onIndexChange, onClose }: Props) {
  const file = files[index] ?? null
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  useEffect(() => {
    setPhase(file?.available ? 'loading' : 'ready')
    setAttempt(0)
    setFit(true)
    setZoom(1)
    setRotation(0)
    setNatural(null)
  }, [file?.id, file?.available])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = previewKeyAction(event.key, files.length)
      if (!action) return
      event.preventDefault()
      if (action === 'close') onClose()
      else if (action === 'previous') onIndexChange(stepPreviewIndex(index, -1, files.length))
      else onIndexChange(stepPreviewIndex(index, 1, files.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [files.length, index, onClose, onIndexChange])

  if (!file) return null

  const sizeLabel = formatPreviewSize(file.sizeBytes)
  const meta = [file.filename, previewTypeLabel(file.kind), sizeLabel].filter(Boolean).join(' · ')
  const zoomLabel = fit ? 'Fit' : `${Math.round(zoom * 100)}%`

  const openInNewTab = () => {
    if (!file.available) return
    window.open(file.previewUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(15, 23, 42, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={file.filename}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(94vw, 1280px)',
          height: 'min(92vh, 960px)',
          background: '#0f172a',
          color: '#f8fafc',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
      >
        <header style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: '#111827',
          borderBottom: '1px solid #1f2937',
          flexShrink: 0,
        }}>
          <span aria-hidden style={{ fontSize: 16 }}>{file.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.filename}
          </div>
          {file.available && (
            <button type="button" onClick={openInNewTab} style={headerButton}>
              Open in new tab
            </button>
          )}
          {file.available && (
            <a href={file.downloadUrl} style={{ ...headerButton, textDecoration: 'none' }}>
              Download
            </a>
          )}
          <button type="button" onClick={onClose} aria-label="Close preview" style={headerButton}>
            ✕
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#0b1220' }}>
          {!file.available && (
            <Status
              message={PREVIEW_NOT_STORED_MESSAGE}
            />
          )}
          {file.available && phase === 'error' && (
            <Status
              message={PREVIEW_FAILED_MESSAGE}
              actions={
                <>
                  <button type="button" onClick={() => { setPhase('loading'); setAttempt((n) => n + 1) }} style={headerButton}>
                    Retry
                  </button>
                  <a href={file.downloadUrl} style={{ ...headerButton, textDecoration: 'none' }}>Download</a>
                </>
              }
            />
          )}
          {file.available && phase === 'loading' && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#cbd5e1', fontSize: 14, pointerEvents: 'none',
            }}>
              Opening {file.filename}…
            </div>
          )}
          {file.available && phase !== 'error' && file.kind === 'pdf' && (
            <iframe
              key={`${file.id}-${attempt}`}
              title={file.filename}
              src={file.previewUrl}
              onLoad={() => setPhase('ready')}
              style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
            />
          )}
          {file.available && phase !== 'error' && file.kind === 'image' && (
            <div
              ref={stageRef}
              onWheel={(event) => {
                event.preventDefault()
                const next = Math.min(6, Math.max(0.25, zoom * (event.deltaY < 0 ? 1.12 : 0.9)))
                setFit(false)
                setZoom(next)
              }}
              onPointerDown={(event) => {
                if (fit) return
                const stage = stageRef.current
                if (!stage) return
                dragRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  left: stage.scrollLeft,
                  top: stage.scrollTop,
                }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current
                const stage = stageRef.current
                if (!drag || !stage) return
                stage.scrollLeft = drag.left - (event.clientX - drag.x)
                stage.scrollTop = drag.top - (event.clientY - drag.y)
              }}
              onPointerUp={() => { dragRef.current = null }}
              style={{
                width: '100%',
                height: '100%',
                overflow: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: fit ? 'default' : 'grab',
              }}
            >
              <img
                key={`${file.id}-${attempt}`}
                src={file.previewUrl}
                alt={file.filename}
                onLoad={(event) => {
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                  setPhase('ready')
                }}
                onError={() => setPhase('error')}
                draggable={false}
                style={{
                  maxWidth: fit ? '100%' : 'none',
                  maxHeight: fit ? '100%' : 'none',
                  width: !fit && natural ? natural.width * zoom : 'auto',
                  height: !fit && natural ? natural.height * zoom : 'auto',
                  objectFit: 'contain',
                  transform: rotation ? `rotate(${rotation}deg)` : undefined,
                  userSelect: 'none',
                }}
              />
            </div>
          )}
        </div>

        <footer style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: '#111827',
          borderTop: '1px solid #1f2937',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}>
          {files.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                aria-label="Previous file"
                onClick={() => onIndexChange(stepPreviewIndex(index, -1, files.length))}
                style={headerButton}
              >
                ←
              </button>
              <span style={{ fontSize: 12, color: '#cbd5e1', minWidth: 52, textAlign: 'center' }}>
                {index + 1} of {files.length}
              </span>
              <button
                type="button"
                aria-label="Next file"
                onClick={() => onIndexChange(stepPreviewIndex(index, 1, files.length))}
                style={headerButton}
              >
                →
              </button>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta}
          </div>
          {file.kind === 'image' && file.available && phase !== 'error' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" onClick={() => { setFit(true); setZoom(1) }} style={headerButton}>Fit</button>
              <button type="button" onClick={() => { setFit(false); setZoom(1) }} style={headerButton}>100%</button>
              <button type="button" aria-label="Zoom out" onClick={() => { setFit(false); setZoom((z) => Math.max(0.25, z / 1.25)) }} style={headerButton}>−</button>
              <span style={{ fontSize: 11, color: '#cbd5e1', minWidth: 40, textAlign: 'center' }}>{zoomLabel}</span>
              <button type="button" aria-label="Zoom in" onClick={() => { setFit(false); setZoom((z) => Math.min(6, z * 1.25)) }} style={headerButton}>+</button>
              <button type="button" aria-label="Rotate" onClick={() => setRotation((deg) => (deg + 90) % 360)} style={headerButton}>Rotate</button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}

function Status({ message, actions }: { message: string; actions?: ReactNode }) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 24,
      textAlign: 'center',
      color: '#e2e8f0',
      fontSize: 14,
    }}>
      <div>{message}</div>
      {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  )
}

const headerButton: CSSProperties = {
  background: 'transparent',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1.2,
}
