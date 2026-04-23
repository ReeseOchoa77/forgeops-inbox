import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { useState, useRef } from 'react'

export interface ComposeSendPayload {
  to: string[]
  cc: string[]
  subject: string
  html: string
  files: File[]
}

interface Props {
  onSend: (payload: ComposeSendPayload) => void
  sending?: boolean
  sendLabel?: string
  onCancel?: () => void
  initialTo?: string
  initialCc?: string
  initialSubject?: string
  showRecipients?: boolean
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

export function ComposeEditor({ onSend, sending, sendLabel, onCancel, initialTo, initialCc, initialSubject, showRecipients = true }: Props) {
  const [to, setTo] = useState(initialTo ?? '')
  const [cc, setCc] = useState(initialCc ?? '')
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        style: 'min-height: 120px; outline: none; padding: 12px; font-size: 14px; line-height: 1.6;'
      }
    }
  })

  const handleSend = () => {
    if (!editor) return
    onSend({
      to: to.split(',').map(e => e.trim()).filter(Boolean),
      cc: cc.split(',').map(e => e.trim()).filter(Boolean),
      subject,
      html: editor.getHTML(),
      files
    })
  }

  const addLink = () => {
    if (!editor) return
    const url = prompt('Enter URL:')
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)])
    }
    e.target.value = ''
  }

  if (!editor) return null

  return (
    <div>
      {showRecipients && (
        <>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>To</label>
            <input type="text" value={to} onChange={e => setTo(e.target.value)}
              placeholder="recipient@example.com"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>CC</label>
            <input type="text" value={cc} onChange={e => setCc(e.target.value)}
              placeholder="cc@example.com"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>Subject</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
            />
          </div>
        </>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 2, padding: '6px 0', borderBottom: '1px solid #eee', marginBottom: 0, flexWrap: 'wrap' }}>
        <button type="button" style={btnStyle(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><b>B</b></button>
        <button type="button" style={btnStyle(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><i>I</i></button>
        <button type="button" style={btnStyle(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></button>
        <div style={{ width: 1, background: '#ddd', margin: '0 4px' }} />
        <button type="button" style={btnStyle(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">&#8226; List</button>
        <button type="button" style={btnStyle(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</button>
        <button type="button" style={btnStyle(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">&ldquo; Quote</button>
        <div style={{ width: 1, background: '#ddd', margin: '0 4px' }} />
        <button type="button" style={btnStyle(editor.isActive('link'))} onClick={addLink} title="Insert link">{'\u{1F517}'} Link</button>
        <button type="button" style={btnStyle(false)} onClick={() => fileInputRef.current?.click()} title="Attach file">{'\u{1F4CE}'} Attach</button>
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
      </div>

      {/* Editor */}
      <div style={{ border: '1px solid #ddd', borderRadius: '0 0 6px 6px', background: '#fff', marginBottom: 8 }}>
        <EditorContent editor={editor} />
      </div>

      {/* Attached files */}
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
              border: '1px solid #e5e5e5', borderRadius: 4, background: '#fafafa', fontSize: 12
            }}>
              {'\u{1F4CE}'} {f.name} <span style={{ color: '#999' }}>({(f.size / 1024).toFixed(0)} KB)</span>
              <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999', padding: 0 }}>&times;</button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={handleSend} disabled={sending || (showRecipients && !to.trim())}>
          {sending ? 'Sending...' : sendLabel ?? 'Send'}
        </button>
        {onCancel && <button className="btn btn-outline" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}

export function useComposeFields(initial?: { to?: string; cc?: string; subject?: string }) {
  const [to] = useState(initial?.to ?? '')
  const [cc] = useState(initial?.cc ?? '')
  const [subject] = useState(initial?.subject ?? '')
  return { to, cc, subject }
}
