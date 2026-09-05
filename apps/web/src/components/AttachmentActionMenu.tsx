import { useState, type MouseEvent } from 'react'
import { type StoredAttachment } from '../api'
import {
  appendCopiedAttachments,
  copyAttachmentToClipboard,
} from '../attachment-clipboard'

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

/** Direct Copy control — places attachment ref on the ForgeOps internal clipboard. */
export function AttachmentActionMenu({
  workspaceId,
  attachment,
  sourceEmailMessageId,
  appendOnCopy = false,
  onCopied,
}: Props) {
  const [flash, setFlash] = useState<string | null>(null)
  const canCopy = attachment.uploadStatus === 'UPLOADED'

  const handleCopy = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
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
    setFlash(`Copied ${attachment.filename}`)
    onCopied?.(attachment.filename)
    window.setTimeout(() => setFlash(null), 2200)
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        disabled={!canCopy}
        aria-label="Copy attachment"
        title={
          canCopy
            ? 'Copy attachment to paste into Compose / Reply / Forward'
            : 'Attachment is not available in storage yet'
        }
        onClick={handleCopy}
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: canCopy ? '#1565c0' : '#bbb',
          background: canCopy ? '#fff' : 'transparent',
          border: canCopy ? '1px solid #90caf9' : '1px solid transparent',
          borderRadius: 4,
          cursor: canCopy ? 'pointer' : 'not-allowed',
          padding: '3px 8px',
          lineHeight: 1.2,
          minHeight: 28,
        }}
      >
        Copy
      </button>
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
