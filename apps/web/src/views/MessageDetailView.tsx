import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { api, type ThreadMessage, type ThreadDetail, type AttachmentMeta, type JobLookup, type StoredAttachment } from '../api'
import { PriorityBadge } from '../components/Badges'
import { ComposeEditor, type ComposeSendPayload } from '../components/ComposeEditor'
import type { Breakpoint } from '../hooks/useBreakpoint'

interface Props {
  workspaceId: string
  connectionId: string
  messageId: string
  onBack: () => void
  breakpoint?: Breakpoint
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

function normalizeCid(value: string): string {
  return value.replace(/^cid:/i, '').replace(/^<|>$/g, '').trim().toLowerCase()
}

function rewriteCidImages(html: string, cidToUrl: Map<string, string>): string {
  if (cidToUrl.size === 0) return html
  return html.replace(
    /(?:src|SRC)\s*=\s*(["']?)cid:([^"'>\s]+)\1/gi,
    (match, quote: string, cid: string) => {
      const url = cidToUrl.get(normalizeCid(cid))
      if (!url) return match
      const q = quote || '"'
      return `src=${q}${url}${q}`
    }
  )
}

function EmailBody({
  bodyHtml,
  bodyText,
  workspaceId,
  connectionId,
  emailId,
  attachmentMetadata,
}: {
  bodyHtml: string | null
  bodyText: string | null
  workspaceId: string
  connectionId: string
  emailId: string
  attachmentMetadata?: AttachmentMeta[]
}) {
  const [showHtml, setShowHtml] = useState(!!bodyHtml)
  const [resolvedHtml, setResolvedHtml] = useState(bodyHtml)
  const hasHtml = !!bodyHtml

  useEffect(() => {
    setShowHtml(!!bodyHtml)
    setResolvedHtml(bodyHtml)
    if (!bodyHtml || !/cid:/i.test(bodyHtml)) return

    let cancelled = false
    const cidToUrl = new Map<string, string>()

    // Prefer stored attachments (n8n upload path) with contentId
    api.getEmailAttachments(workspaceId, emailId)
      .then(r => {
        for (const a of r.attachments) {
          if (!a.contentId || a.uploadStatus !== 'UPLOADED') continue
          if (!a.mimeType.startsWith('image/')) continue
          cidToUrl.set(
            normalizeCid(a.contentId),
            api.getStoredAttachmentDownloadUrl(workspaceId, a.id, true)
          )
        }
      })
      .catch(() => {})
      .finally(() => {
        // Fallback: provider metadata (native Outlook/Gmail sync)
        for (const a of attachmentMetadata ?? []) {
          if (!a.contentId || !a.attachmentId) continue
          const key = normalizeCid(a.contentId)
          if (cidToUrl.has(key)) continue
          if (a.mimeType && !a.mimeType.startsWith('image/') && !a.inline) continue
          cidToUrl.set(
            key,
            api.getAttachmentUrl(workspaceId, connectionId, emailId, a.attachmentId)
          )
        }
        if (!cancelled) setResolvedHtml(rewriteCidImages(bodyHtml, cidToUrl))
      })

    return () => { cancelled = true }
  }, [bodyHtml, workspaceId, connectionId, emailId, attachmentMetadata])

  if (!bodyHtml && !bodyText) {
    return <div style={{ color: '#aaa', fontSize: 13, padding: 16 }}>(empty body)</div>
  }

  const htmlToRender = resolvedHtml ?? bodyHtml

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
      {showHtml && htmlToRender ? (
        <div
          className="email-html-body"
          style={{
            fontSize: 14, lineHeight: 1.6, padding: '8px 0', overflow: 'auto', maxHeight: 600,
            wordBreak: 'break-word'
          }}
          ref={(el: HTMLDivElement | null) => {
            if (el) el.querySelectorAll('img').forEach(img => {
              const src = img.getAttribute('src') ?? ''
              if (src.startsWith('cid:')) {
                img.style.display = 'none'
                return
              }
              img.onerror = () => { img.style.display = 'none' }
              if (img.complete && img.naturalWidth === 0) {
                img.style.display = 'none'
              }
            })
          }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlToRender, { ADD_ATTR: ['target'] }) }}
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
            textDecoration: 'none', color: '#333', fontSize: 12, maxWidth: 240,
            minHeight: 44,
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

function MessageCard({ msg, expanded, onToggle, workspaceId, connectionId, isLast, onReply, onForward, onLoadBody, isPhone }: {
  msg: ThreadMessage
  expanded: boolean
  onToggle: () => void
  workspaceId: string
  connectionId: string
  isLast: boolean
  onReply: () => void
  onForward: () => void
  onLoadBody: () => void
  isPhone?: boolean
}) {
  const senderDisplay = msg.senderName ?? msg.senderEmail
  const toDisplay = msg.toAddresses.map(a => a.name ?? a.email).join(', ')

  if (!expanded) {
    return (
      <div
        onClick={onToggle}
        style={{
          padding: isPhone ? '12px' : '10px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center',
          borderBottom: '1px solid #f0f0f0', fontSize: 13, minHeight: 44,
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
          {!isPhone && <span style={{ color: '#999', marginLeft: 8 }}>{msg.snippet?.slice(0, 80) ?? ''}</span>}
          {isPhone && msg.snippet && (
            <div style={{ color: '#999', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.snippet.slice(0, 60)}</div>
          )}
        </div>
        <div style={{ color: '#aaa', fontSize: 11, flexShrink: 0 }}>{formatDate(msg.receivedAt ?? msg.sentAt)}</div>
        {msg.hasAttachments && <span style={{ fontSize: 14 }} title="Has attachments">{'\u{1F4CE}'}</span>}
      </div>
    )
  }

  return (
    <div style={{ padding: isPhone ? '12px' : '16px', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: isPhone ? 'wrap' : undefined }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', background: '#e3f2fd', color: '#1565c0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15, flexShrink: 0
        }}>
          {senderDisplay.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: isPhone ? 'wrap' : undefined, gap: isPhone ? 4 : 0 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{senderDisplay}</span>
              {msg.senderName && <span style={{ color: '#999', fontSize: 12, marginLeft: 6 }}>&lt;{msg.senderEmail}&gt;</span>}
              {msg.labelIds.includes('n8n-ingested') && (
                <span style={{ fontSize: 10, color: '#6a1b9a', background: '#f3e5f5', padding: '1px 6px', borderRadius: 3, marginLeft: 6, fontWeight: 500 }}>via n8n</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>{formatDate(msg.receivedAt ?? msg.sentAt)}</span>
              {!isLast && (
                <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#bbb', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Collapse">&#9660;</button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            to {toDisplay}
            {msg.ccAddresses.length > 0 && <span>, cc: {msg.ccAddresses.map(a => a.name ?? a.email).join(', ')}</span>}
          </div>
        </div>
      </div>

      <div style={{ paddingLeft: isPhone ? 0 : 48 }}>
        {msg.bodyTruncated && !msg.bodyText && !msg.bodyHtml ? (
          <div style={{ padding: '12px 0' }}>
            <button
              onClick={onLoadBody}
              style={{
                background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4,
                padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: '#555',
                minHeight: 44,
              }}
            >
              Show full message
            </button>
          </div>
        ) : (
          <EmailBody
            bodyHtml={msg.bodyHtml}
            bodyText={msg.bodyText}
            workspaceId={workspaceId}
            connectionId={connectionId}
            emailId={msg.id}
            attachmentMetadata={msg.attachmentMetadata}
          />
        )}

        <AttachmentBar
          attachments={msg.attachmentMetadata}
          workspaceId={workspaceId}
          connectionId={connectionId}
          messageId={msg.id}
        />

        {isLast && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-outline" onClick={onReply} style={isPhone ? { flex: 1, minHeight: 44 } : undefined}>Reply</button>
            <button className="btn btn-sm btn-outline" onClick={onForward} style={isPhone ? { flex: 1, minHeight: 44 } : undefined}>Forward</button>
          </div>
        )}
      </div>
    </div>
  )
}

function statusBadge(status: StoredAttachment['uploadStatus']) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    UPLOADED: { bg: '#e6f4ea', color: '#1b7a3d', label: 'Ready' },
    PENDING: { bg: '#fff8e1', color: '#f57f17', label: 'Uploading…' },
    FAILED: { bg: '#fce4ec', color: '#c62828', label: 'Failed' },
    REJECTED: { bg: '#fce4ec', color: '#c62828', label: 'Rejected' },
  }
  const s = styles[status] ?? styles.FAILED!
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
      background: s.bg, color: s.color
    }}>
      {s.label}
    </span>
  )
}

function isInlineImage(att: StoredAttachment): boolean {
  const mime = (att.mimeType ?? '').toLowerCase()
  return att.isInline && mime.startsWith('image/')
}

function StoredAttachmentsSection({
  workspaceId,
  emailIds,
  compact,
}: {
  workspaceId: string
  emailIds: string[]
  compact?: boolean
}) {
  const [attachments, setAttachments] = useState<StoredAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [showInlineImages, setShowInlineImages] = useState(false)

  const emailIdsKey = emailIds.join(',')

  useEffect(() => {
    if (emailIds.length === 0) {
      setAttachments([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      emailIds.map(id =>
        api.getEmailAttachments(workspaceId, id)
          .then(r => r.attachments)
          .catch(() => [] as StoredAttachment[])
      )
    )
      .then(results => {
        if (cancelled) return
        const byId = new Map<string, StoredAttachment>()
        for (const list of results) {
          for (const att of list) byId.set(att.id, att)
        }
        setAttachments([...byId.values()])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceId, emailIdsKey])

  if (loading) {
    return (
      <div style={{ marginTop: compact ? 8 : 0, fontSize: 12, color: '#999' }}>
        Loading attachments…
      </div>
    )
  }

  // Show all real files by default; keep pure inline images optional
  const downloadable = attachments.filter(a => !isInlineImage(a))
  const inlineImages = attachments.filter(isInlineImage)
  const visible = showInlineImages ? [...downloadable, ...inlineImages] : downloadable

  if (attachments.length === 0) return null
  if (visible.length === 0) {
    return (
      <div style={{ marginTop: compact ? 8 : 0, fontSize: 12, color: '#888' }}>
        <button
          onClick={() => setShowInlineImages(true)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#888', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Show {inlineImages.length} inline image{inlineImages.length !== 1 ? 's' : ''}
        </button>
      </div>
    )
  }

  return (
    <div style={{
      marginTop: compact ? 8 : 0,
      marginBottom: compact ? 0 : 12,
      padding: compact ? '8px 10px' : '10px 14px',
      background: '#fff',
      border: '1px solid #e5e5e5',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
          Attachments ({downloadable.length}{inlineImages.length > 0 ? ` · ${inlineImages.length} inline` : ''})
        </div>
        {inlineImages.length > 0 && (
          <button
            onClick={() => setShowInlineImages(v => !v)}
            style={{
              background: 'none', border: 'none', fontSize: 11, color: '#888',
              cursor: 'pointer', textDecoration: 'underline', padding: 0
            }}
          >
            {showInlineImages ? 'Hide inline images' : 'Show inline images'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: compact ? 160 : undefined, overflowY: compact ? 'auto' : undefined }}>
        {visible.map(att => (
          <div
            key={att.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
              border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa',
              fontSize: 13, flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(att.mimeType)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.filename}
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                {formatSize(att.sizeBytes)}
                {att.mimeType ? ` · ${att.mimeType.split('/').pop()}` : ''}
                {att.isInline && <span style={{ marginLeft: 6, color: '#999' }}>(inline)</span>}
              </div>
            </div>
            {statusBadge(att.uploadStatus)}
            {att.uploadStatus === 'UPLOADED' && (
              <a
                href={api.getStoredAttachmentDownloadUrl(workspaceId, att.id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12, color: '#1565c0', textDecoration: 'none', fontWeight: 500,
                  padding: '4px 10px', border: '1px solid #1565c0', borderRadius: 4,
                  flexShrink: 0, minHeight: 32, display: 'inline-flex', alignItems: 'center',
                }}
              >
                Download
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function jobSourceLabel(source: string | null | undefined, isManual: boolean | undefined): string {
  if (isManual || source === 'USER_ASSIGNED') return 'Manual'
  if (!source) return 'Unknown'
  if (source.startsWith('AI_')) return 'AI'
  if (source === 'FOLDER_ALIAS') return 'Folder Alias'
  if (source === 'JOB_NUMBER_MATCH') return 'Job Number'
  if (source === 'IMPORT') return 'Import'
  return source
}

export function MessageDetailView({ workspaceId, connectionId, messageId, onBack, breakpoint = 'desktop' }: Props) {
  const [threadData, setThreadData] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [composeMode, setComposeMode] = useState<'reply' | 'forward' | null>(null)
  const [composeDefaults, setComposeDefaults] = useState({ to: '', cc: '', subject: '' })
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [jobBusy, setJobBusy] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)

  const [reclassifyBusy, setReclassifyBusy] = useState(false)
  const [monitoredEmails, setMonitoredEmails] = useState<Set<string>>(new Set())

  const isPhone = breakpoint === 'phone'

  const loadThread = () => api.getMessageThread(workspaceId, connectionId, messageId)

  useEffect(() => {
    api.getConnections(workspaceId)
      .then(r => setMonitoredEmails(new Set(r.connections.map(c => c.email.toLowerCase()))))
      .catch(() => setMonitoredEmails(new Set()))
  }, [workspaceId])

  useEffect(() => {
    const t0 = performance.now()
    setLoading(true)
    setComposeMode(null)
    setSendResult(null)
    setJobError(null)

    loadThread()
      .then(td => {
        const tApi = performance.now()
        console.log(`[perf] thread API: ${(tApi - t0).toFixed(0)}ms, ${td.messages.length} messages`)
        setThreadData(td)
        api.markAsRead(workspaceId, connectionId, messageId).catch(() => {})
        const clickedMsg = td.messages.find(m => m.id === messageId)
        if (clickedMsg?.job?.id) setSelectedJobId(clickedMsg.job.id)
        else setSelectedJobId('')
        const lastMsg = td.messages[td.messages.length - 1]
        setExpandedIds(new Set(lastMsg ? [lastMsg.id] : []))
      })
      .catch(() => setThreadData(null))
      .finally(() => {
        const tRender = performance.now()
        console.log(`[perf] thread total to render: ${(tRender - t0).toFixed(0)}ms`)
        setLoading(false)
      })
  }, [workspaceId, connectionId, messageId])

  useEffect(() => {
    api.getJobsLookup(workspaceId, { showArchived: false })
      .then(r => setJobs(r.jobs))
      .catch(() => setJobs([]))
  }, [workspaceId])

  const clickedMessage = threadData?.messages.find(m => m.id === messageId) ?? threadData?.messages[threadData.messages.length - 1] ?? null

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading conversation...</p>
  if (!threadData || threadData.messages.length === 0) return <p>Message not found.</p>

  const messages = threadData.messages
  const lastMessage = messages[messages.length - 1]!
  const subject = threadData.thread.subject ?? lastMessage.subject ?? '(no subject)'
  const isBusinessMessage = clickedMessage?.mailboxCategory === 'BUSINESS'

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

  const handleAssignJob = async () => {
    if (!selectedJobId || !clickedMessage) return
    setJobBusy(true)
    setJobError(null)
    try {
      await api.assignEmailToJob(workspaceId, selectedJobId, { messageId: clickedMessage.id })
      const td = await loadThread()
      setThreadData(td)
      const updated = td.messages.find(m => m.id === messageId)
      if (updated?.job?.id) setSelectedJobId(updated.job.id)
    } catch (e) {
      setJobError(e instanceof Error ? e.message : 'Failed to assign job')
    } finally {
      setJobBusy(false)
    }
  }

  const handleRemoveJob = async () => {
    if (!clickedMessage?.job) return
    setJobBusy(true)
    setJobError(null)
    try {
      await api.removeEmailFromJob(workspaceId, clickedMessage.job!.id, clickedMessage.id)
      const td = await loadThread()
      setThreadData(td)
      setSelectedJobId('')
    } catch (e) {
      setJobError(e instanceof Error ? e.message : 'Failed to remove job')
    } finally {
      setJobBusy(false)
    }
  }

  const handleReclassify = async (newCategory: 'BUSINESS' | 'PERSONAL') => {
    if (!clickedMessage) return
    setReclassifyBusy(true)
    try {
      await api.reclassifyMessage(workspaceId, clickedMessage.id, { mailboxCategory: newCategory })
      const td = await loadThread()
      setThreadData(td)
    } catch { /* */ }
    finally { setReclassifyBusy(false) }
  }

  return (
    <div>
      {/* Sticky action bar — always visible while scrolling */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, marginBottom: 12,
        padding: '8px 0 10px', background: '#f5f5f6',
        borderBottom: '1px solid #e8e8e8',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <button
            onClick={onBack}
            title="Back to Inbox"
            aria-label="Back to Inbox"
            style={{
              flexShrink: 0, width: 32, height: 32, marginTop: 2,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff',
              color: '#374151', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1,
            }}
          >
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <h2 style={{
                  fontSize: isPhone ? 16 : 18, margin: 0, lineHeight: 1.3, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                }}>
                  {subject}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#999' }}>
                    {messages.length} message{messages.length !== 1 ? 's' : ''}
                  </span>
                  {clickedMessage?.previousCategory && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 10,
                      background: '#ede9fe', color: '#7c3aed'
                    }}>
                      Reclassified from {clickedMessage.previousCategory.toLowerCase()}
                    </span>
                  )}
                </div>
              </div>

              <div style={{
                display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                flexShrink: 0, justifyContent: 'flex-end',
              }}>
                {lastMessage.classification && !monitoredEmails.has(lastMessage.senderEmail.toLowerCase()) && (
                  <PriorityBadge priority={lastMessage.classification.priority} />
                )}
                {clickedMessage && clickedMessage.mailboxCategory === 'BUSINESS' && (
                  <button
                    onClick={() => handleReclassify('PERSONAL')}
                    disabled={reclassifyBusy}
                    style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 5,
                      border: '1px solid #7c3aed', background: '#ede9fe', color: '#7c3aed',
                      cursor: reclassifyBusy ? 'not-allowed' : 'pointer', fontWeight: 600,
                      opacity: reclassifyBusy ? 0.6 : 1, minHeight: 32,
                    }}
                  >
                    {reclassifyBusy ? 'Updating...' : 'Mark as Personal'}
                  </button>
                )}
                {clickedMessage && clickedMessage.mailboxCategory === 'PERSONAL' && (
                  <button
                    onClick={() => handleReclassify('BUSINESS')}
                    disabled={reclassifyBusy}
                    style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 5,
                      border: '1px solid #1565c0', background: '#e3f2fd', color: '#1565c0',
                      cursor: reclassifyBusy ? 'not-allowed' : 'pointer', fontWeight: 600,
                      opacity: reclassifyBusy ? 0.6 : 1, minHeight: 32,
                    }}
                  >
                    {reclassifyBusy ? 'Updating...' : 'Mark as Business'}
                  </button>
                )}
                {isBusinessMessage && clickedMessage && (
                  <>
                    {clickedMessage.job && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                        background: clickedMessage.jobAssignmentIsManual ? '#e3f2fd' : '#f3e5f5',
                        color: clickedMessage.jobAssignmentIsManual ? '#1565c0' : '#6a1b9a'
                      }}>
                        {jobSourceLabel(clickedMessage.jobAssignmentSource ?? null, clickedMessage.jobAssignmentIsManual ?? false)}
                      </span>
                    )}
                    <select
                      value={selectedJobId}
                      onChange={e => setSelectedJobId(e.target.value)}
                      disabled={jobBusy}
                      title="Assign job"
                      style={{
                        padding: '4px 8px', fontSize: 12, borderRadius: 5, border: '1px solid #ddd',
                        minWidth: isPhone ? 120 : 160, minHeight: 32,
                        background: '#fff', maxWidth: 220,
                      }}
                    >
                      <option value="">{clickedMessage.job ? 'Change job…' : 'Select a job…'}</option>
                      {jobs.map(j => (
                        <option key={j.id} value={j.id}>
                          {j.jobNumber ? `${j.jobNumber} — ${j.name}` : j.name}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={jobBusy || !selectedJobId || selectedJobId === clickedMessage.job?.id}
                      onClick={handleAssignJob}
                      style={{
                        fontSize: 12, padding: '4px 10px', borderRadius: 5, minHeight: 32,
                        border: '1px solid #d0d5dd', background: '#f9fafb', color: '#111',
                        cursor: jobBusy || !selectedJobId || selectedJobId === clickedMessage.job?.id ? 'not-allowed' : 'pointer',
                        opacity: jobBusy || !selectedJobId || selectedJobId === clickedMessage.job?.id ? 0.5 : 1,
                        fontWeight: 500,
                      }}
                    >
                      {clickedMessage.job ? 'Move' : 'Assign'}
                    </button>
                    {clickedMessage.job && (
                      <button
                        disabled={jobBusy}
                        onClick={handleRemoveJob}
                        style={{
                          fontSize: 12, padding: '4px 8px', borderRadius: 5, minHeight: 32,
                          border: 'none', background: 'none', color: '#888',
                          cursor: jobBusy ? 'not-allowed' : 'pointer', textDecoration: 'underline',
                        }}
                      >
                        Remove
                      </button>
                    )}
                    {jobError && <span style={{ fontSize: 12, color: '#c62828' }}>{jobError}</span>}
                  </>
                )}
              </div>
            </div>

            <StoredAttachmentsSection
              workspaceId={workspaceId}
              emailIds={messages.map(m => m.id)}
              compact
            />
          </div>
        </div>
      </div>

      {sendResult && (
        <div style={{
          padding: '8px 12px', marginBottom: 10, borderRadius: 4, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: sendResult.type === 'success' ? '#e6f4ea' : '#fce4ec',
          border: `1px solid ${sendResult.type === 'success' ? '#a8d5a2' : '#e8a09a'}`
        }}>
          <span>{sendResult.message}</span>
          <button onClick={() => setSendResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
        </div>
      )}

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
            isPhone={isPhone}
            onLoadBody={() => {
              api.getMessageDetail(workspaceId, connectionId, msg.id).then(r => {
                setThreadData(prev => {
                  if (!prev) return prev
                  return {
                    ...prev,
                    messages: prev.messages.map(m =>
                      m.id === msg.id ? { ...m, bodyText: r.data.message.bodyText, bodyHtml: r.data.message.bodyHtml, bodyTruncated: false } : m
                    )
                  }
                })
              }).catch(() => {})
            }}
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
