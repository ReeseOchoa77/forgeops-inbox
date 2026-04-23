import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { api, type ThreadMessage, type ThreadDetail, type AttachmentMeta } from '../api'
import { PriorityBadge } from '../components/Badges'
import { ComposeEditor, type ComposeSendPayload } from '../components/ComposeEditor'

interface Props {
  workspaceId: string
  connectionId: string
  messageId: string
  onBack: () => void
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string | null): string {
  if (!mimeType) return '\u{1F4CE}'
  if (mimeType.startsWith('image/')) return '\u{1F5BC}'
  if (mimeType.includes('pdf')) return '\u{1F4D1}'
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '\u{1F4E6}'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '\u{1F4CA}'
  if (mimeType.includes('document') || mimeType.includes('word')) return '\u{1F4DD}'
  return '\u{1F4CE}'
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function EmailBody({ bodyHtml, bodyText }: { bodyHtml: string | null; bodyText: string | null }) {
  const [showHtml, setShowHtml] = useState(!!bodyHtml)
  const hasHtml = !!bodyHtml

  if (!bodyHtml && !bodyText) {
    return <div style={{ color: '#aaa', fontSize: 13, padding: 16 }}>(empty body)</div>
  }

  return (
    <div>
      {hasHtml && bodyText && (
        <div style={{ marginBottom: 8, textAlign: 'right' }}>
          <button
            onClick={() => setShowHtml(v => !v)}
            style={{ background: 'none', border: 'none', fontSize: 11, color: '#888', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {showHtml ? 'Show plain text' : 'Show HTML'}
          </button>
        </div>
      )}
      {showHtml && bodyHtml ? (
        <div
          className="email-html-body"
          style={{
            fontSize: 14, lineHeight: 1.6, padding: '8px 0', overflow: 'auto', maxHeight: 600,
            wordBreak: 'break-word'
          }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bodyHtml, { ADD_ATTR: ['target'] }) }}
        />
      ) : (
        <div style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontSize: 13, lineHeight: 1.6, padding: '8px 0',
          maxHeight: 600, overflow: 'auto'
        }}>
          {bodyText}
        </div>
      )}
    </div>
  )
}

function AttachmentBar({ attachments, workspaceId, connectionId, messageId }: {
  attachments: AttachmentMeta[]
  workspaceId: string
  connectionId: string
  messageId: string
}) {
  const nonInline = attachments.filter(a => !a.inline && a.attachmentId)
  if (nonInline.length === 0) return null

  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 0',
      borderTop: '1px solid #f0f0f0', marginTop: 8
    }}>
      {nonInline.map((att, i) => (
        <a
          key={i}
          href={api.getAttachmentUrl(workspaceId, connectionId, messageId, att.attachmentId!)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            border: '1px solid #e5e5e5', borderRadius: 6, background: '#fafafa',
            textDecoration: 'none', color: '#333', fontSize: 12, maxWidth: 240
          }}
        >
          <span style={{ fontSize: 16 }}>{fileIcon(att.mimeType)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {att.filename ?? 'attachment'}
          </span>
          {att.size && <span style={{ color: '#999', fontSize: 11, flexShrink: 0 }}>{formatSize(att.size)}</span>}
        </a>
      ))}
    </div>
  )
}

function MessageCard({ msg, expanded, onToggle, workspaceId, connectionId, isLast, onReply, onForward }: {
  msg: ThreadMessage
  expanded: boolean
  onToggle: () => void
  workspaceId: string
  connectionId: string
  isLast: boolean
  onReply: () => void
  onForward: () => void
}) {
  const senderDisplay = msg.senderName ?? msg.senderEmail
  const toDisplay = msg.toAddresses.map(a => a.name ?? a.email).join(', ')

  if (!expanded) {
    return (
      <div
        onClick={onToggle}
        style={{
          padding: '10px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center',
          borderBottom: '1px solid #f0f0f0', fontSize: 13
        }}
        onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
        onMouseOut={e => (e.currentTarget.style.background = '')}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: '#e3f2fd', color: '#1565c0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flexShrink: 0
        }}>
          {senderDisplay.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 500 }}>{senderDisplay}</span>
          <span style={{ color: '#999', marginLeft: 8 }}>{msg.snippet?.slice(0, 80) ?? ''}</span>
        </div>
        <div style={{ color: '#aaa', fontSize: 11, flexShrink: 0 }}>{formatDate(msg.receivedAt ?? msg.sentAt)}</div>
        {msg.hasAttachments && <span style={{ fontSize: 14 }} title="Has attachments">{'\u{1F4CE}'}</span>}
      </div>
    )
  }

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', background: '#e3f2fd', color: '#1565c0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15, flexShrink: 0
        }}>
          {senderDisplay.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{senderDisplay}</span>
              {msg.senderName && <span style={{ color: '#999', fontSize: 12, marginLeft: 6 }}>&lt;{msg.senderEmail}&gt;</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>{formatDate(msg.receivedAt ?? msg.sentAt)}</span>
              {!isLast && (
                <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#bbb', padding: 0 }} title="Collapse">&#9660;</button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            to {toDisplay}
            {msg.ccAddresses.length > 0 && <span>, cc: {msg.ccAddresses.map(a => a.name ?? a.email).join(', ')}</span>}
          </div>
        </div>
      </div>

      <div style={{ paddingLeft: 48 }}>
        <EmailBody bodyHtml={msg.bodyHtml} bodyText={msg.bodyText} />

        <AttachmentBar
          attachments={msg.attachmentMetadata}
          workspaceId={workspaceId}
          connectionId={connectionId}
          messageId={msg.id}
        />

        {isLast && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-sm btn-outline" onClick={onReply}>Reply</button>
            <button className="btn btn-sm btn-outline" onClick={onForward}>Forward</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function MessageDetailView({ workspaceId, connectionId, messageId, onBack }: Props) {
  const [threadData, setThreadData] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [composeMode, setComposeMode] = useState<'reply' | 'forward' | null>(null)
  const [composeDefaults, setComposeDefaults] = useState({ to: '', cc: '', subject: '' })
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    setComposeMode(null)
    setSendResult(null)

    api.getMessageDetail(workspaceId, connectionId, messageId)
      .then(r => {
        const threadId = r.data.thread.id
        api.markAsRead(workspaceId, connectionId, messageId).catch(() => {})
        return api.getThreadMessages(workspaceId, connectionId, threadId)
      })
      .then(td => {
        setThreadData(td)
        const lastMsg = td.messages[td.messages.length - 1]
        setExpandedIds(new Set(lastMsg ? [lastMsg.id] : []))
      })
      .catch(() => setThreadData(null))
      .finally(() => setLoading(false))
  }, [workspaceId, connectionId, messageId])

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading conversation...</p>
  if (!threadData || threadData.messages.length === 0) return <p>Message not found.</p>

  const messages = threadData.messages
  const lastMessage = messages[messages.length - 1]!
  const subject = threadData.thread.subject ?? lastMessage.subject ?? '(no subject)'

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openReply = () => {
    setComposeMode('reply')
    setComposeDefaults({
      to: lastMessage.senderEmail,
      cc: '',
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`
    })
    setSendResult(null)
  }

  const openForward = () => {
    setComposeMode('forward')
    setComposeDefaults({
      to: '',
      cc: '',
      subject: subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`
    })
    setSendResult(null)
  }

  const handleComposeSend = async (payload: ComposeSendPayload) => {
    if (!composeMode) return
    setSending(true)
    setSendResult(null)

    try {
      await api.sendMessage(workspaceId, connectionId, {
        action: composeMode,
        originalMessageId: lastMessage.id,
        to: payload.to,
        cc: payload.cc,
        subject: payload.subject,
        body: payload.html,
        bodyFormat: 'html'
      })
      setSendResult({ type: 'success', message: composeMode === 'reply' ? 'Reply sent' : 'Message forwarded' })
      setComposeMode(null)
    } catch (e) {
      setSendResult({ type: 'error', message: e instanceof Error ? e.message : 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <button onClick={onBack} className="btn btn-sm btn-outline" style={{ marginBottom: 12 }}>
        &larr; Back to Inbox
      </button>

      {sendResult && (
        <div style={{
          padding: '8px 12px', marginBottom: 10, borderRadius: 4, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: sendResult.type === 'success' ? '#e6f4ea' : '#fce4ec',
          border: `1px solid ${sendResult.type === 'success' ? '#a8d5a2' : '#e8a09a'}`
        }}>
          <span>{sendResult.message}</span>
          <button onClick={() => setSendResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>&times;</button>
        </div>
      )}

      {/* Subject header */}
      <div style={{ padding: '12px 16px', marginBottom: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ fontSize: 20, margin: 0, lineHeight: 1.3, fontWeight: 600 }}>{subject}</h2>
          {lastMessage.classification && <PriorityBadge priority={lastMessage.classification.priority} />}
        </div>
        <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
          {messages.length} message{messages.length !== 1 ? 's' : ''} in this conversation
        </div>
      </div>

      {/* Thread messages */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
        {messages.map((msg, i) => (
          <MessageCard
            key={msg.id}
            msg={msg}
            expanded={expandedIds.has(msg.id)}
            onToggle={() => toggleExpand(msg.id)}
            workspaceId={workspaceId}
            connectionId={connectionId}
            isLast={i === messages.length - 1}
            onReply={openReply}
            onForward={openForward}
          />
        ))}
      </div>

      {/* Compose panel */}
      {composeMode && (
        <div className="card" style={{ marginTop: 12, borderLeft: '3px solid #5c7cfa' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px', fontWeight: 600 }}>
            {composeMode === 'reply' ? 'Reply' : 'Forward'}
          </h3>
          <ComposeEditor
            onSend={handleComposeSend}
            sending={sending}
            sendLabel={composeMode === 'reply' ? 'Send Reply' : 'Send Forward'}
            onCancel={() => setComposeMode(null)}
            initialTo={composeDefaults.to}
            initialCc={composeDefaults.cc}
            initialSubject={composeDefaults.subject}
          />
        </div>
      )}
    </div>
  )
}
