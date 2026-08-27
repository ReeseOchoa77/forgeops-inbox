import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { api, type ThreadMessage, type ThreadDetail, type AttachmentMeta, type JobLookup, type StoredAttachment, type ConnectionSummary } from '../api'
import { PriorityBadge } from '../components/Badges'
import { ComposeEditor, type ComposeSendPayload } from '../components/ComposeEditor'
import type { Breakpoint } from '../hooks/useBreakpoint'

interface Props {
  workspaceId: string
  connectionId: string
  messageId: string
  onBack: () => void
  breakpoint?: Breakpoint
  /** App-level connections — avoids a duplicate GET /inbox-connections on every open. */
  connections?: ConnectionSummary[]
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

function normalizeCid(value: string | null | undefined): string {
  return value
    ?.replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .trim()
    .toLowerCase() ?? ''
}

/** Index keys for a Content-ID: full normalized value + Outlook local-part before @. */
function cidMapKeys(value: string | null | undefined): string[] {
  const primary = normalizeCid(value)
  if (!primary) return []
  const keys = [primary]
  const at = primary.indexOf('@')
  if (at > 0) keys.push(primary.slice(0, at))
  return keys
}

function rewriteCidImages(
  html: string,
  cidToUrl: Map<string, string>
): string {
  const resolveUrl = (rawCid: string): string | undefined => {
    for (const key of cidMapKeys(rawCid)) {
      const url = cidToUrl.get(key)
      if (url) return url
    }
    return undefined
  }

  // src="cid:...", src='cid:...', src=cid:...
  // Also tolerate quoted-printable leftovers: src=3D"cid:..."
  let out = html.replace(
    /\bsrc\s*=\s*(?:3D)?(["']?)cid:([^"'>\s]+)\1/gi,
    (_match, quote: string, cid: string) => {
      const url = resolveUrl(cid)
      if (!url) {
        // Neutralize unmatched cid: so the browser never requests cid: scheme
        const q = quote || '"'
        return `src=${q}${q}`
      }
      const q = quote || '"'
      return `src=${q}${url}${q}`
    }
  )

  // CSS url(cid:...)
  out = out.replace(
    /url\(\s*(['"]?)cid:([^)'"\s]+)\1\s*\)/gi,
    (_match, quote: string, cid: string) => {
      const url = resolveUrl(cid)
      if (!url) return `url(${quote || "'"}${quote || "'"})`
      const q = quote || "'"
      return `url(${q}${url}${q})`
    }
  )

  return out
}

function isInlineImage(att: StoredAttachment): boolean {
  const mime = (att.mimeType ?? '').toLowerCase()
  return att.isInline && mime.startsWith('image/')
}

/** True when src points at our attachment download endpoints (stored or provider). */
function isAppAttachmentUrl(src: string): boolean {
  try {
    const path = new URL(src, window.location.origin).pathname
    return /\/attachments\/[^/]+\/download\/?$/.test(path)
      || /\/messages\/[^/]+\/attachments\/[^/]+\/download\/?$/.test(path)
  } catch {
    return false
  }
}

/** Drop ?inline=true so the API serves Content-Disposition: attachment. */
function toForceDownloadUrl(src: string): string {
  try {
    const u = new URL(src, window.location.origin)
    u.searchParams.delete('inline')
    return u.toString()
  } catch {
    return src.replace(/([?&])inline=true(&)?/g, (_m, p1: string, p2: string) => (p2 ? p1 : '')).replace(/\?$/, '')
  }
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
  // Never paint raw cid: HTML — wait until rewrite finishes (or confirm none needed)
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(
    bodyHtml && /cid:/i.test(bodyHtml) ? null : bodyHtml
  )
  const [cidResolving, setCidResolving] = useState(!!(bodyHtml && /cid:/i.test(bodyHtml)))
  const htmlBodyRef = useRef<HTMLDivElement | null>(null)
  const hasHtml = !!bodyHtml

  useEffect(() => {
    setShowHtml(!!bodyHtml)
    if (!bodyHtml) {
      setResolvedHtml(null)
      setCidResolving(false)
      return
    }
    if (!/cid:/i.test(bodyHtml)) {
      setResolvedHtml(bodyHtml)
      setCidResolving(false)
      return
    }

    let cancelled = false
    setResolvedHtml(null)
    setCidResolving(true)

    // Await attachments for THIS emailId before any HTML with cid: is painted
    api.getEmailAttachments(workspaceId, emailId)
      .then(r => {
        if (cancelled) return

        const cidToUrl = new Map<string, string>()

        for (const a of r.attachments) {
          const mime = (a.mimeType ?? '').toLowerCase()
          const isImage = mime.startsWith('image/')

          if (a.uploadStatus !== 'UPLOADED') continue
          if (!a.contentId) continue
          if (!isImage) continue

          const url = api.getStoredAttachmentDownloadUrl(workspaceId, a.id, true)
          for (const key of cidMapKeys(a.contentId)) {
            if (!cidToUrl.has(key)) cidToUrl.set(key, url)
          }
        }

        // Fallback: provider metadata (native Outlook/Gmail sync) when stored rows lack contentId
        for (const a of attachmentMetadata ?? []) {
          if (!a.contentId || !a.attachmentId) continue
          const mime = (a.mimeType ?? '').toLowerCase()
          if (mime && !mime.startsWith('image/') && !a.inline) continue
          const url = api.getAttachmentUrl(workspaceId, connectionId, emailId, a.attachmentId)
          for (const key of cidMapKeys(a.contentId)) {
            if (!cidToUrl.has(key)) cidToUrl.set(key, url)
          }
        }

        setResolvedHtml(rewriteCidImages(bodyHtml, cidToUrl))
      })
      .catch((err) => {
        console.error('[ForgeOps] Failed to load attachments for CID rewrite', {
          emailId,
          error: err instanceof Error ? err.message : 'unknown',
        })
        // Never paint unre-written cid: HTML on failure — neutralize cid: sources
        if (!cancelled) {
          setResolvedHtml(rewriteCidImages(bodyHtml, new Map()))
        }
      })
      .finally(() => {
        if (!cancelled) setCidResolving(false)
      })

    return () => { cancelled = true }
  }, [bodyHtml, workspaceId, connectionId, emailId, attachmentMetadata])

  // Click inline attachment images to download (same endpoints as the Attachments list)
  useEffect(() => {
    const el = htmlBodyRef.current
    if (!el || !resolvedHtml || !showHtml) return

    el.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') ?? ''
      if (src.startsWith('cid:')) {
        img.style.display = 'none'
        return
      }
      if (!isAppAttachmentUrl(src)) return
      img.style.cursor = 'pointer'
      if (!img.title) img.title = 'Click to download'
      img.setAttribute('role', 'button')
      img.setAttribute('tabindex', '0')
      img.setAttribute('aria-label', 'Download image')
    })

    const downloadFromImg = (img: HTMLImageElement) => {
      const src = img.currentSrc || img.getAttribute('src') || ''
      if (!isAppAttachmentUrl(src)) return
      const a = document.createElement('a')
      a.href = toForceDownloadUrl(src)
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof HTMLImageElement)) return
      if (!isAppAttachmentUrl(target.currentSrc || target.getAttribute('src') || '')) return
      e.preventDefault()
      e.stopPropagation()
      downloadFromImg(target)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const target = e.target
      if (!(target instanceof HTMLImageElement)) return
      if (!isAppAttachmentUrl(target.currentSrc || target.getAttribute('src') || '')) return
      e.preventDefault()
      e.stopPropagation()
      downloadFromImg(target)
    }

    el.addEventListener('click', onClick)
    el.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('click', onClick)
      el.removeEventListener('keydown', onKeyDown)
    }
  }, [resolvedHtml, showHtml])

  if (!bodyHtml && !bodyText) {
    return <div style={{ color: '#aaa', fontSize: 13, padding: 16 }}>(empty body)</div>
  }

  const htmlToRender = resolvedHtml

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
      {showHtml && cidResolving && (
        <div style={{ fontSize: 12, color: '#999', padding: '8px 0' }}>Resolving inline images…</div>
      )}
      {showHtml && htmlToRender ? (
        <div
          ref={htmlBodyRef}
          className="email-html-body"
          style={{
            fontSize: 14, lineHeight: 1.6, padding: '8px 0', overflow: 'auto', maxHeight: 600,
            wordBreak: 'break-word'
          }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlToRender, { ADD_ATTR: ['target'] }) }}
        />
      ) : !cidResolving ? (
        <div style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontSize: 13, lineHeight: 1.6, padding: '8px 0',
          maxHeight: 600, overflow: 'auto'
        }}>
          {bodyText}
        </div>
      ) : null}
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

  const replyActions = isLast ? (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap',
      padding: expanded ? undefined : (isPhone ? '0 12px 12px' : '0 16px 12px'),
      marginTop: expanded ? 12 : 0,
      borderBottom: expanded ? undefined : '1px solid #f0f0f0',
    }}>
      <button className="btn btn-sm btn-outline" onClick={onReply} style={isPhone ? { flex: 1, minHeight: 44 } : undefined}>Reply</button>
      <button className="btn btn-sm btn-outline" onClick={onForward} style={isPhone ? { flex: 1, minHeight: 44 } : undefined}>Forward</button>
    </div>
  ) : null

  if (!expanded) {
    return (
      <div>
        <div
          onClick={onToggle}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
          title="Expand message"
          style={{
            padding: isPhone ? '12px' : '10px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center',
            borderBottom: isLast ? 'none' : '1px solid #f0f0f0', fontSize: 13, minHeight: 44,
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
          <span style={{ fontSize: 12, color: '#bbb', flexShrink: 0 }} aria-hidden>&#9656;</span>
        </div>
        {replyActions}
      </div>
    )
  }

  return (
    <div style={{ padding: isPhone ? '12px' : '16px', borderBottom: '1px solid #f0f0f0' }}>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        title="Collapse message"
        style={{
          display: 'flex', gap: 12, marginBottom: 12, flexWrap: isPhone ? 'wrap' : undefined,
          cursor: 'pointer', borderRadius: 6, marginLeft: -4, marginRight: -4, padding: '4px',
        }}
        onMouseOver={e => (e.currentTarget.style.background = '#f8f9fb')}
        onMouseOut={e => (e.currentTarget.style.background = '')}
      >
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
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onToggle() }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999',
                  padding: 0, minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                title="Collapse"
                aria-label="Collapse message"
              >
                &#9650;
              </button>
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

        {replyActions}
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
  const [error, setError] = useState(false)

  const emailIdsKey = emailIds.join(',')

  useEffect(() => {
    if (emailIds.length === 0) {
      setAttachments([])
      setLoading(false)
      setError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    Promise.all(
      emailIds.map(id =>
        api.getEmailAttachments(workspaceId, id)
          .then(r => ({ ok: true as const, attachments: r.attachments }))
          .catch(() => ({ ok: false as const, attachments: [] as StoredAttachment[] }))
      )
    )
      .then(results => {
        if (cancelled) return
        const byId = new Map<string, StoredAttachment>()
        let anyOk = false
        let anyFail = false
        for (const result of results) {
          if (result.ok) anyOk = true
          else anyFail = true
          for (const att of result.attachments) byId.set(att.id, att)
        }
        setAttachments([...byId.values()])
        setError(anyFail && !anyOk)
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

  if (error && attachments.length === 0) {
    return (
      <div style={{ marginTop: compact ? 8 : 0, fontSize: 12, color: '#c62828' }}>
        Failed to load attachments
      </div>
    )
  }

  // Downloadable files only — inline images render in the email body via cid: rewrite
  const downloadable = attachments.filter(a => !isInlineImage(a))
  if (downloadable.length === 0) return null

  return (
    <div style={{
      marginTop: compact ? 8 : 0,
      marginBottom: compact ? 0 : 12,
      padding: compact ? '8px 10px' : '10px 14px',
      background: '#fff',
      border: '1px solid #e5e5e5',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
        Attachments ({downloadable.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: compact ? 160 : undefined, overflowY: compact ? 'auto' : undefined }}>
        {downloadable.map(att => (
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

export function MessageDetailView({ workspaceId, connectionId, messageId, onBack, breakpoint = 'desktop', connections }: Props) {
  const [threadData, setThreadData] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [composeMode, setComposeMode] = useState<'reply' | 'forward' | null>(null)
  const [composeDefaults, setComposeDefaults] = useState({ to: '', cc: '', subject: '' })
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState('')
  const [jobBusy, setJobBusy] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)

  const [reclassifyBusy, setReclassifyBusy] = useState(false)
  /** Prevents duplicate ForgeOps Email Debug logs across React rerenders for the same open. */
  const emailDebugLoggedForId = useRef<string | null>(null)

  const isPhone = breakpoint === 'phone'

  const connectionEmailsKey = (connections ?? []).map(c => c.email.toLowerCase()).sort().join('|')
  const monitoredEmails = useMemo(
    () => new Set(connectionEmailsKey ? connectionEmailsKey.split('|') : []),
    [connectionEmailsKey]
  )
  const monitoredEmailsReady = connections !== undefined

  const loadThread = () => api.getMessageThread(workspaceId, connectionId, messageId)

  const ensureJobsLoaded = () => {
    if (jobsLoaded || jobsLoading) return
    setJobsLoading(true)
    api.getJobsLookup(workspaceId, { showArchived: false })
      .then(r => setJobs(r.jobs))
      .catch(() => setJobs([]))
      .finally(() => {
        setJobsLoaded(true)
        setJobsLoading(false)
      })
  }

  useEffect(() => {
    setLoading(true)
    setComposeMode(null)
    setSendResult(null)
    setJobError(null)
    setJobs([])
    setJobsLoaded(false)
    emailDebugLoggedForId.current = null

    loadThread()
      .then(td => {
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
        setLoading(false)
      })
  }, [workspaceId, connectionId, messageId])

  // TEMP V1 DEBUG:
  // Remove or gate behind development/debug flag after pilot stabilization.
  // Logs the complete thread/message payload already loaded for MessageDetailView (no extra API call).
  // Does not log OAuth tokens, session cookies, or credentials.
  useEffect(() => {
    if (loading || !monitoredEmailsReady || !threadData || threadData.messages.length === 0) return
    if (emailDebugLoggedForId.current === messageId) return

    const message =
      threadData.messages.find(m => m.id === messageId) ??
      threadData.messages[threadData.messages.length - 1]
    if (!message) return

    emailDebugLoggedForId.current = messageId

    const mailboxCategory = message.mailboxCategory ?? null
    const isSent = monitoredEmails.has(message.senderEmail.toLowerCase())
    // Inbox chrome treats Sent as its own view; persisted category may still be BUSINESS/PERSONAL.
    const emailKind = isSent ? 'SENT' : (mailboxCategory ?? 'UNKNOWN')
    const classification = message.classification
    const businessTypeKey = classification?.businessTypeKey ?? null
    const businessSubtype =
      mailboxCategory === 'BUSINESS'
        ? {
            businessTypeKey,
            businessTypeLabel: businessTypeKey
              ? businessTypeKey.replace(/_/g, ' ')
              : null,
            emailType: classification?.emailType ?? null,
          }
        : null

    const groupTitle = businessSubtype?.businessTypeKey
      ? `[ForgeOps Email Debug] ${message.id} · ${emailKind} · ${businessSubtype.businessTypeKey}`
      : `[ForgeOps Email Debug] ${message.id} · ${emailKind}`

    console.groupCollapsed(groupTitle)
    console.log({
      emailId: message.id,
      threadId: threadData.thread.id,
      openedMessageId: messageId,
      emailKind,
      mailboxCategory,
      isSent,
      businessSubtype,
      message,
      thread: threadData.thread,
      threadMessages: threadData.messages,
      classification,
      job: message.job,
      attachments: message.attachmentMetadata,
      taskCandidate: message.taskCandidate,
    })
    console.groupEnd()
  }, [loading, monitoredEmailsReady, monitoredEmails, threadData, messageId])

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
      await api.sendMessage(workspaceId, payload.inboxConnectionId || connectionId, {
        action: composeMode,
        originalMessageId: lastMessage.id,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
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
            title="Back"
            aria-label="Back"
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
                {clickedMessage?.mailboxCategory === 'BUSINESS' && lastMessage.classification?.priority && (
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
                      onFocus={ensureJobsLoaded}
                      onMouseDown={ensureJobsLoaded}
                      disabled={jobBusy}
                      title="Assign job"
                      style={{
                        padding: '4px 8px', fontSize: 12, borderRadius: 5, border: '1px solid #ddd',
                        minWidth: isPhone ? 120 : 160, minHeight: 32,
                        background: '#fff', maxWidth: 220,
                      }}
                    >
                      <option value="">{clickedMessage.job ? 'Change job…' : 'Select a job…'}</option>
                      {jobsLoading && jobs.length === 0 && (
                        <option value="" disabled>Loading jobs…</option>
                      )}
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
            workspaceId={workspaceId}
            sendableMailboxes={[]}
            hideFrom
            fixedConnectionId={connectionId}
            onSend={handleComposeSend}
            sending={sending}
            sendError={sendResult?.type === 'error' ? sendResult.message : null}
            sendLabel={composeMode === 'reply' ? 'Send Reply' : 'Send Forward'}
            onCancel={() => setComposeMode(null)}
            initialTo={composeDefaults.to ? composeDefaults.to.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : []}
            initialCc={composeDefaults.cc ? composeDefaults.cc.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : []}
            initialSubject={composeDefaults.subject}
          />
        </div>
      )}
    </div>
  )
}
