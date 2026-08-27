import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef, useState } from 'react'
import { RecipientField } from './RecipientField'

export interface SendableMailboxOption {
  id: string
  email: string
  displayName: string | null
  provider: string
}

export interface ComposeSendPayload {
  inboxConnectionId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  html: string
  files: File[]
  existingAttachmentIds: string[]
}

export interface ComposeExistingAttachment {
  id: string
  filename: string
  sizeBytes: number
  mimeType?: string
}

interface Props {
  workspaceId: string
  sendableMailboxes: SendableMailboxOption[]
  mailboxesLoading?: boolean
  onSend: (payload: ComposeSendPayload) => void | Promise<void>
  sending?: boolean
  sendError?: string | null
  sendLabel?: string
  onCancel?: () => void
  initialTo?: string[]
  initialCc?: string[]
  initialBcc?: string[]
  initialSubject?: string
  showRecipients?: boolean
  /** When true, hide From (reply uses current connection outside this editor). */
  hideFrom?: boolean
  fixedConnectionId?: string
  /** Forward: original non-inline attachments (included by default). */
  existingAttachments?: ComposeExistingAttachment[]
  /** Max bytes per new file (client-side gate). Default 3MB (Outlook Graph simple limit). */
  maxAttachmentBytes?: number
}

const btnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 8px',
  border: active ? '1px solid #999' : '1px solid #ddd',
  borderRadius: 3,
  background: active ? '#eee' : '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  lineHeight: 1,
  color: '#333'
})

const BLOCKED_EXT = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.msi', '.com', '.vbs', '.js', '.ps1', '.sh', '.pif', '.ws', '.wsf',
])

const DEFAULT_MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024

const ACCEPT_TYPES =
  '.pdf,.docx,.xlsx,.xls,.csv,.txt,.zip,.png,.jpg,.jpeg,.gif,.webp,.pptx,.rtf,.json,.xml,' +
  'application/pdf,text/csv,text/plain,application/zip,image/*'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function getExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function ComposeEditor({
  workspaceId,
  sendableMailboxes,
  mailboxesLoading,
  onSend,
  sending,
  sendError,
  sendLabel,
  onCancel,
  initialTo,
  initialCc,
  initialBcc,
  initialSubject,
  showRecipients = true,
  hideFrom = false,
  fixedConnectionId,
  existingAttachments = [],
  maxAttachmentBytes = DEFAULT_MAX_ATTACHMENT_BYTES,
}: Props) {
  const [fromId, setFromId] = useState('')
  const [to, setTo] = useState<string[]>(initialTo ?? [])
  const [cc, setCc] = useState<string[]>(initialCc ?? [])
  const [bcc, setBcc] = useState<string[]>(initialBcc ?? [])
  const [showBcc, setShowBcc] = useState((initialBcc?.length ?? 0) > 0)
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [includedExistingIds, setIncludedExistingIds] = useState<Set<string>>(
    () => new Set(existingAttachments.map((a) => a.id))
  )
  const [localError, setLocalError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingLock = useRef(false)

  useEffect(() => {
    setIncludedExistingIds(new Set(existingAttachments.map((a) => a.id)))
  }, [existingAttachments])

  useEffect(() => {
    if (fixedConnectionId) {
      setFromId(fixedConnectionId)
      return
    }
    if (sendableMailboxes.length === 1) {
      setFromId(sendableMailboxes[0]!.id)
    } else if (sendableMailboxes.length > 1) {
      setFromId((prev) =>
        sendableMailboxes.some((m) => m.id === prev) ? prev : sendableMailboxes[0]!.id
      )
    } else {
      setFromId('')
    }
  }, [sendableMailboxes, fixedConnectionId])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      Placeholder.configure({ placeholder: 'Write your message...' })
    ],
    content: '',
    editorProps: {
      attributes: {
        style: 'min-height: 160px; outline: none; padding: 12px; font-size: 14px; line-height: 1.6;'
      }
    }
  })

  const noMailbox = !mailboxesLoading && sendableMailboxes.length === 0 && !hideFrom
  const selectedMailbox = sendableMailboxes.find((m) => m.id === fromId) ?? null
  const canSend =
    !sending &&
    !mailboxesLoading &&
    !noMailbox &&
    Boolean(fromId || hideFrom) &&
    (!showRecipients || to.length > 0) &&
    subject.trim().length > 0

  const handleSend = async () => {
    if (!editor || sendingLock.current || !canSend) return
    const connectionId = hideFrom ? fixedConnectionId : fromId
    if (!connectionId) {
      setLocalError('Select a From mailbox before sending.')
      return
    }
    if (showRecipients && to.length === 0) {
      setLocalError('Add at least one recipient.')
      return
    }
    if (!subject.trim()) {
      setLocalError('Subject is required.')
      return
    }
    sendingLock.current = true
    setLocalError('')
    try {
      await onSend({
        inboxConnectionId: connectionId,
        to,
        cc,
        bcc,
        subject: subject.trim(),
        html: editor.getHTML(),
        files,
        existingAttachmentIds: [...includedExistingIds],
      })
    } finally {
      sendingLock.current = false
    }
  }

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list)
    const next: File[] = []
    for (const file of incoming) {
      const ext = getExt(file.name)
      if (BLOCKED_EXT.has(ext)) {
        setLocalError(`File type ${ext} is not allowed`)
        continue
      }
      if (file.size > maxAttachmentBytes) {
        setLocalError(
          `"${file.name}" exceeds the ${formatBytes(maxAttachmentBytes)} attachment limit`
        )
        continue
      }
      next.push(file)
    }
    if (next.length) {
      setFiles((prev) => [...prev, ...next])
      if (!BLOCKED_EXT.has(getExt(next[0]!.name))) setLocalError('')
    }
  }

  const addLink = () => {
    if (!editor) return
    const url = prompt('Enter URL:')
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  if (!editor) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
      {!hideFrom && (
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>From</label>
          {mailboxesLoading ? (
            <div style={{ fontSize: 13, color: '#999' }}>Loading authorized mailboxes…</div>
          ) : noMailbox ? (
            <div style={{
              padding: '10px 12px', borderRadius: 6, background: '#fff8e1', border: '1px solid #ffe082',
              color: '#6d4c00', fontSize: 13, lineHeight: 1.45,
            }}>
              Connect and authorize a monitored mailbox to send from ForgeOps.
              The selected From mailbox must be OAuth-connected with send permission (e.g. Mail.Send).
            </div>
          ) : sendableMailboxes.length === 1 ? (
            <div style={{
              padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6,
              background: '#fafafa', fontSize: 13, color: '#333',
            }}>
              {selectedMailbox?.displayName
                ? `${selectedMailbox.displayName} <${selectedMailbox.email}>`
                : selectedMailbox?.email}
            </div>
          ) : (
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
            >
              {sendableMailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName ? `${m.displayName} <${m.email}>` : m.email}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {showRecipients && (
        <>
          <RecipientField
            label="To"
            workspaceId={workspaceId}
            emails={to}
            onChange={setTo}
            disabled={noMailbox || sending}
          />
          <RecipientField
            label="Cc"
            workspaceId={workspaceId}
            emails={cc}
            onChange={setCc}
            disabled={noMailbox || sending}
            placeholder="optional"
          />
          {showBcc ? (
            <RecipientField
              label="Bcc"
              workspaceId={workspaceId}
              emails={bcc}
              onChange={setBcc}
              disabled={noMailbox || sending}
              placeholder="optional"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowBcc(true)}
              style={{
                alignSelf: 'flex-start', background: 'none', border: 'none',
                color: '#5c6bc0', cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 8,
              }}
            >
              Add Bcc
            </button>
          )}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Subject</label>
            <input
              type="text"
              value={subject}
              disabled={noMailbox || sending}
              onChange={(e) => setSubject(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 2, padding: '6px 0', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
        <button type="button" style={btnStyle(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><b>B</b></button>
        <button type="button" style={btnStyle(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><i>I</i></button>
        <button type="button" style={btnStyle(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></button>
        <div style={{ width: 1, background: '#ddd', margin: '0 4px' }} />
        <button type="button" style={btnStyle(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">&#8226; List</button>
        <button type="button" style={btnStyle(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</button>
        <button type="button" style={btnStyle(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">&ldquo; Quote</button>
        <div style={{ width: 1, background: '#ddd', margin: '0 4px' }} />
        <button type="button" style={btnStyle(editor.isActive('link'))} onClick={addLink} title="Insert link">{'\u{1F517}'} Link</button>
        <button type="button" style={btnStyle(false)} onClick={() => fileInputRef.current?.click()} title="Attach file" disabled={noMailbox || sending}>{'📎'} Attach</button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_TYPES}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <div
        style={{ border: '1px solid #ddd', borderRadius: '0 0 6px 6px', background: '#fff', marginBottom: 8 }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {existingAttachments.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>
            Original attachments
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {existingAttachments.map((att) => {
              const included = includedExistingIds.has(att.id)
              return (
                <div
                  key={att.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                    border: `1px solid ${included ? '#c5cae9' : '#e5e5e5'}`,
                    borderRadius: 4,
                    background: included ? '#eef2ff' : '#fafafa',
                    fontSize: 12,
                    opacity: included ? 1 : 0.55,
                  }}
                >
                  📎 {att.filename}
                  <span style={{ color: '#999' }}>({formatBytes(att.sizeBytes)})</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIncludedExistingIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(att.id)) next.delete(att.id)
                        else next.add(att.id)
                        return next
                      })
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#5c6bc0', padding: 0 }}
                  >
                    {included ? 'Remove' : 'Include'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
              border: '1px solid #e5e5e5', borderRadius: 4, background: '#fafafa', fontSize: 12
            }}>
              📎 {f.name}
              <span style={{ color: '#999' }}>({formatBytes(f.size)})</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={sending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999', padding: 0 }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {(localError || sendError) && (
        <div style={{
          marginBottom: 8, padding: '8px 10px', borderRadius: 6,
          background: '#ffebee', color: '#b71c1c', fontSize: 13,
        }}>
          {localError || sendError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 4 }}>
        <button
          className="btn btn-primary"
          onClick={() => void handleSend()}
          disabled={!canSend}
          style={{ minHeight: 44 }}
        >
          {sending ? 'Sending...' : sendLabel ?? 'Send'}
        </button>
        {onCancel && (
          <button className="btn btn-outline" onClick={onCancel} disabled={sending} style={{ minHeight: 44 }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
