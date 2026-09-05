import { useEffect, useRef, useState } from 'react'
import { api, type StoredAttachment } from '../api'
import {
  appendCopiedAttachments,
  copyAttachmentToClipboard,
} from '../attachment-clipboard'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type Props = {
  workspaceId: string
  attachment: Pick<
    StoredAttachment,
    'id' | 'filename' | 'mimeType' | 'sizeBytes' | 'uploadStatus'
  > & { sourceEmailMessageId?: string }
  sourceEmailMessageId: string
  /** When true, Copy appends instead of replacing the clipboard. */
  appendOnCopy?: boolean
  onCopied?: (filename: string) => void
}

/**
 * Outlook-like chevron menu: Copy (internal clipboard) + Download.
 * Primary download remains available via the Download menu item (and existing ↓ links elsewhere).
 */
export function AttachmentActionMenu({
  workspaceId,
  attachment,
  sourceEmailMessageId,
  appendOnCopy = false,
  onCopied,
}: Props) {
  const [open, setOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canCopy = attachment.uploadStatus === 'UPLOADED'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleCopy = () => {
    if (!canCopy) return
    const ref = {
      attachmentId: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sourceEmailMessageId,
      workspaceId,
    }
    if (appendOnCopy) appendCopiedAttachments([ref])
    else copyAttachmentToClipboard(ref)
    setOpen(false)
    setFlash(`Copied ${attachment.filename}`)
    onCopied?.(attachment.filename)
    window.setTimeout(() => setFlash(null), 2200)
  }

  const downloadUrl = api.getStoredAttachmentDownloadUrl(workspaceId, attachment.id)

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-label="Attachment actions"
        aria-expanded={open}
        aria-haspopup="menu"
        title="More actions"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        style={{
          background: open ? '#eef2ff' : 'none',
          border: open ? '1px solid #c7d2fe' : '1px solid transparent',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
          color: '#555',
          padding: '2px 6px',
          lineHeight: 1,
          minHeight: 28,
          minWidth: 28,
        }}
      >
        ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            zIndex: 50,
            minWidth: 140,
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 6,
            boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
            padding: 4,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!canCopy}
            title={
              canCopy
                ? 'Copy attachment to paste into Compose / Reply / Forward'
                : 'Attachment is not available in storage yet'
            }
            onClick={handleCopy}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 10px',
              border: 'none',
              background: 'none',
              borderRadius: 4,
              fontSize: 12,
              cursor: canCopy ? 'pointer' : 'not-allowed',
              color: canCopy ? '#222' : '#aaa',
            }}
          >
            Copy
          </button>
          {canCopy ? (
            <a
              role="menuitem"
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              style={{
                display: 'block',
                padding: '7px 10px',
                borderRadius: 4,
                fontSize: 12,
                color: '#1565c0',
                textDecoration: 'none',
              }}
            >
              Download
            </a>
          ) : (
            <div
              style={{ padding: '7px 10px', fontSize: 12, color: '#aaa' }}
              title="Unavailable"
            >
              Download
            </div>
          )}
        </div>
      )}
      {flash && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            zIndex: 60,
            whiteSpace: 'nowrap',
            padding: '4px 8px',
            fontSize: 11,
            background: '#1a1a2e',
            color: '#fff',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {flash}
        </div>
      )}
    </div>
  )
}

export function CopyAllAttachmentsButton({
  workspaceId,
  sourceEmailMessageId,
  attachments,
  onCopied,
}: {
  workspaceId: string
  sourceEmailMessageId: string
  attachments: Array<
    Pick<StoredAttachment, 'id' | 'filename' | 'mimeType' | 'sizeBytes' | 'uploadStatus'>
  >
  onCopied?: (count: number) => void
}) {
  const uploaded = attachments.filter((a) => a.uploadStatus === 'UPLOADED')
  if (uploaded.length < 2) return null
  return (
    <button
      type="button"
      onClick={() => {
        appendCopiedAttachments(
          uploaded.map((a) => ({
            attachmentId: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            sourceEmailMessageId,
            workspaceId,
          }))
        )
        onCopied?.(uploaded.length)
      }}
      style={{
        background: 'none',
        border: 'none',
        color: '#1565c0',
        fontSize: 11,
        cursor: 'pointer',
        padding: '4px 0',
        fontFamily: 'inherit',
      }}
    >
      Copy all attachments ({uploaded.length})
    </button>
  )
}

export { formatSize as formatAttachmentMenuSize }
