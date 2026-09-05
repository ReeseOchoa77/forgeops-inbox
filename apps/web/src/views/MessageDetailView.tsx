import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { api, type ThreadMessage, type ThreadDetail, type AttachmentMeta, type JobLookup, type StoredAttachment, type ConnectionSummary } from '../api'
import { PriorityBadge } from '../components/Badges'
import {
  JobAssignPicker,
  formatJobPrimaryLabel,
  formatJobTooltip,
} from '../components/JobAssignPicker'
import { ComposeEditor, type ComposeSendPayload } from '../components/ComposeEditor'
import {
  AttachmentActionMenu,
  CopyAllAttachmentsButton,
} from '../components/AttachmentActionMenu'
import type { Breakpoint } from '../hooks/useBreakpoint'
import {
  getCachedThread,
  getInflightThread,
  setCachedThread,
} from '../message-thread-cache'

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
  const hasHtml = !!bodyHtml
  const htmlBodyRef = useRef<HTMLDivElement | null>(null)

  /** Build an initial CID map from provider metadata already on the thread payload. */
  const buildProviderCidMap = (): Map<string, string> => {
    const cidToUrl = new Map<string, string>()
    for (const a of attachmentMetadata ?? []) {
      if (!a.contentId || !a.attachmentId) continue
      const mime = (a.mimeType ?? '').toLowerCase()
      if (mime && !mime.startsWith('image/') && !a.inline) continue
      const url = api.getAttachmentUrl(workspaceId, connectionId, emailId, a.attachmentId)
      for (const key of cidMapKeys(a.contentId)) {
        if (!cidToUrl.has(key)) cidToUrl.set(key, url)
      }
    }
    return cidToUrl
  }

  // Paint immediately: rewrite with provider metadata (or neutralize) — never wait on attachments GET.
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(() => {
    if (!bodyHtml) return null
    if (!/cid:/i.test(bodyHtml)) return bodyHtml
    return rewriteCidImages(bodyHtml, buildProviderCidMap())
  })
  const [cidUpgrading, setCidUpgrading] = useState(!!(bodyHtml && /cid:/i.test(bodyHtml)))

  useEffect(() => {
    setShowHtml(!!bodyHtml)
    if (!bodyHtml) {
      setResolvedHtml(null)
      setCidUpgrading(false)
      return
    }
    if (!/cid:/i.test(bodyHtml)) {
      setResolvedHtml(bodyHtml)
      setCidUpgrading(false)
      return
    }

    let cancelled = false
    const providerMap = buildProviderCidMap()
    // First paint from thread metadata (no network).
    setResolvedHtml(rewriteCidImages(bodyHtml, providerMap))
    setCidUpgrading(true)

    // Upgrade to stored attachment URLs when available (non-blocking).
    api.getEmailAttachments(workspaceId, emailId)
      .then(r => {
        if (cancelled) return
        const cidToUrl = new Map(providerMap)
        for (const a of r.attachments) {
          const mime = (a.mimeType ?? '').toLowerCase()
          const isImage = mime.startsWith('image/')
          if (a.uploadStatus !== 'UPLOADED') continue
          if (!a.contentId) continue
          if (!isImage) continue
          const url = api.getStoredAttachmentDownloadUrl(workspaceId, a.id, true)
          for (const key of cidMapKeys(a.contentId)) {
            cidToUrl.set(key, url)
          }
        }
        setResolvedHtml(rewriteCidImages(bodyHtml, cidToUrl))
      })
      .catch(() => {
        // Keep provider/neutralized rewrite already painted
      })
      .finally(() => {
        if (!cancelled) setCidUpgrading(false)
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
      {showHtml && cidUpgrading && (
        <div style={{ fontSize: 11, color: '#bbb', padding: '0 0 4px' }}>Refreshing inline images…</div>
      )}
      {showHtml && htmlToRender ? (
        <div
          ref={htmlBodyRef}
          className="email-html-body"
          style={{
            fontSize: 14, lineHeight: 1.6, padding: '8px 0',
            wordBreak: 'break-word',
          }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlToRender, { ADD_ATTR: ['target'] }) }}
        />
      ) : (
        <div style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontSize: 13, lineHeight: 1.6, padding: '8px 0',
          maxWidth: 720,
        }}>
          {bodyText}
        </div>
      )}
    </div>
  )
}


const SIDEBAR_COLLAPSED_KEY = 'forgeops_email_reader_sidebar_collapsed'

function formatCompactWhen(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameYear = d.getFullYear() === now.getFullYear()
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' as const }),
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
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

function jobSourceLabel(source: string | null | undefined, isManual: boolean | undefined): string {
  if (isManual || source === 'USER_ASSIGNED') return 'Manual'
  if (!source) return 'Unknown'
  if (source.startsWith('AI_')) return 'AI'
  if (source === 'FOLDER_ALIAS') return 'Folder Alias'
  if (source === 'JOB_NUMBER_MATCH') return 'Job Number'
  if (source === 'IMPORT') return 'Import'
  return source
}

/** Compact thread navigator row — metadata/snippet only; never loads body. */
function ThreadMessageRow({
  msg,
  selected,
  onSelect,
  isSent,
}: {
  msg: ThreadMessage
  selected: boolean
  onSelect: () => void
  isSent?: boolean
}) {
  const senderDisplay = msg.senderName ?? msg.senderEmail
  const when = formatCompactWhen(msg.receivedAt ?? msg.sentAt)
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        borderBottom: '1px solid #f0f0f0',
        background: selected ? '#eef3ff' : 'transparent',
        borderLeft: selected ? '3px solid #1565c0' : '3px solid transparent',
        padding: '8px 10px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
        <span style={{ fontWeight: selected ? 700 : 600, fontSize: 12, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {senderDisplay}
        </span>
        <span style={{ fontSize: 10, color: '#999', flexShrink: 0 }}>{when}</span>
      </div>
      <div style={{
        fontSize: 11, color: '#777', marginTop: 2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {msg.snippet?.slice(0, 100) || '(no preview)'}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center' }}>
        {msg.hasAttachments && (
          <span style={{ fontSize: 11 }} title="Has attachments">
            {'\u{1F4CE}'}
          </span>
        )}
        {isSent && (
          <span style={{ fontSize: 9, fontWeight: 600, color: '#666', background: '#eee', padding: '0 5px', borderRadius: 3 }}>
            Sent
          </span>
        )}
      </div>
    </button>
  )
}

function SelectedMessagePane({
  msg,
  workspaceId,
  connectionId,
  onReply,
  onForward,
  onLoadBody,
  bodyLoading,
  isPhone,
}: {
  msg: ThreadMessage
  workspaceId: string
  connectionId: string
  onReply: () => void
  onForward: () => void
  onLoadBody: () => void
  bodyLoading?: boolean
  isPhone?: boolean
}) {
  const [showAllRecipients, setShowAllRecipients] = useState(false)
  const senderDisplay = msg.senderName ?? msg.senderEmail
  const toList = msg.toAddresses.map(a => a.name ?? a.email)
  const ccList = msg.ccAddresses.map(a => a.name ?? a.email)
  const toPreview = toList.slice(0, 3).join(', ') + (toList.length > 3 ? ` +${toList.length - 3}` : '')
  const needsBody = Boolean(msg.bodyTruncated && !msg.bodyText && !msg.bodyHtml)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: isPhone ? '12px 12px 8px' : '14px 18px 10px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', background: '#e3f2fd', color: '#1565c0',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15, flexShrink: 0
          }}>
            {senderDisplay.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{senderDisplay}</div>
                {msg.senderName && (
                  <div style={{ fontSize: 12, color: '#888' }}>&lt;{msg.senderEmail}&gt;</div>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>
                {formatDate(msg.receivedAt ?? msg.sentAt)}
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              to {showAllRecipients ? toList.join(', ') : toPreview}
              {showAllRecipients && ccList.length > 0 && (
                <span>; cc {ccList.join(', ')}</span>
              )}
              {(toList.length > 3 || ccList.length > 0) && (
                <button
                  type="button"
                  onClick={() => setShowAllRecipients(v => !v)}
                  style={{ background: 'none', border: 'none', color: '#1565c0', fontSize: 11, cursor: 'pointer', marginLeft: 6, padding: 0 }}
                >
                  {showAllRecipients ? 'Less' : 'Details'}
                </button>
              )}
            </div>
            {msg.labelIds.includes('n8n-ingested') && (
              <span style={{ fontSize: 10, color: '#6a1b9a', background: '#f3e5f5', padding: '1px 6px', borderRadius: 3, marginTop: 4, display: 'inline-block', fontWeight: 500 }}>via n8n</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: isPhone ? '8px 12px 12px' : '10px 18px 16px' }}>
        {needsBody ? (
          <div style={{ padding: '16px 0' }}>
            {bodyLoading ? (
              <span style={{ fontSize: 13, color: '#888' }}>Loading message…</span>
            ) : (
              <button
                type="button"
                onClick={onLoadBody}
                style={{
                  background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4,
                  padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: '#555', minHeight: 36,
                }}
              >
                Show full message
              </button>
            )}
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
      </div>

      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0,
        padding: isPhone ? '10px 12px' : '10px 18px',
        borderTop: '1px solid #f0f0f0', background: '#fafafa',
      }}>
        <button className="btn btn-sm btn-outline" onClick={onReply} style={isPhone ? { flex: 1, minHeight: 40 } : undefined}>Reply</button>
        <button className="btn btn-sm btn-outline" onClick={onForward} style={isPhone ? { flex: 1, minHeight: 40 } : undefined}>Forward</button>
      </div>
    </div>
  )
}

/** Attachments for one email (selected message). Does not mark read. */
function SelectedAttachmentsPanel({
  workspaceId,
  emailId,
  threadOtherIds,
  compact,
}: {
  workspaceId: string
  emailId: string
  /** Other thread message ids that have attachments — loaded only on demand. */
  threadOtherIds: string[]
  compact?: boolean
}) {
  const [attachments, setAttachments] = useState<StoredAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [threadExtra, setThreadExtra] = useState<Array<StoredAttachment & { sourceEmailMessageId: string }> | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const flashCopy = (msg: string) => {
    setCopyNotice(msg)
    window.setTimeout(() => setCopyNotice(null), 2200)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setShowAll(false)
    setThreadExtra(null)
    api.getEmailAttachments(workspaceId, emailId)
      .then(r => {
        if (cancelled) return
        setAttachments(r.attachments)
      })
      .catch(() => {
        if (!cancelled) {
          setAttachments([])
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceId, emailId])

  const loadThreadExtras = () => {
    if (threadExtra || threadOtherIds.length === 0) return
    setThreadLoading(true)
    Promise.all(
      threadOtherIds.map(id =>
        api.getEmailAttachments(workspaceId, id)
          .then(r => r.attachments.map(a => ({ ...a, sourceEmailMessageId: id })))
          .catch(() => [] as Array<StoredAttachment & { sourceEmailMessageId: string }>)
      )
    )
      .then(lists => {
        const byId = new Map<string, StoredAttachment & { sourceEmailMessageId: string }>()
        for (const list of lists) for (const a of list) byId.set(a.id, a)
        setThreadExtra([...byId.values()])
      })
      .finally(() => setThreadLoading(false))
  }

  if (loading) {
    return <div style={{ fontSize: 11, color: '#999', padding: '6px 0' }}>Loading attachments…</div>
  }
  if (error && attachments.length === 0) {
    return <div style={{ fontSize: 11, color: '#c62828', padding: '6px 0' }}>Failed to load attachments</div>
  }

  const downloadable = attachments.filter(a => !isInlineImage(a))
  const visible = showAll ? downloadable : downloadable.slice(0, 5)
  const threadDownloadable = (threadExtra ?? []).filter(a => !isInlineImage(a))

  if (downloadable.length === 0 && threadOtherIds.length === 0) return null

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Selected message{downloadable.length ? ` · ${downloadable.length}` : ''}</span>
        {downloadable.length > 0 && (
          <CopyAllAttachmentsButton
            workspaceId={workspaceId}
            sourceEmailMessageId={emailId}
            attachments={downloadable}
            onCopied={(n) => flashCopy(`Copied ${n} attachments`)}
          />
        )}
        {copyNotice && (
          <span style={{ fontWeight: 500, color: '#1565c0' }}>{copyNotice}</span>
        )}
      </div>
      {downloadable.length === 0 ? (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>No downloadable attachments</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: compact ? 180 : 260, overflowY: 'auto' }}>
          {visible.map(att => (
            <div
              key={att.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                border: '1px solid #f0f0f0', borderRadius: 5, background: '#fafafa', fontSize: 12,
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{fileIcon(att.mimeType)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.filename}
                </div>
                <div style={{ fontSize: 10, color: '#888' }}>{formatSize(att.sizeBytes)}</div>
              </div>
              {statusBadge(att.uploadStatus)}
              {att.uploadStatus === 'UPLOADED' && (
                <a
                  href={api.getStoredAttachmentDownloadUrl(workspaceId, att.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Download"
                  style={{
                    fontSize: 14, color: '#1565c0', textDecoration: 'none', flexShrink: 0,
                    padding: '2px 6px', lineHeight: 1,
                  }}
                >
                  ↓
                </a>
              )}
              <AttachmentActionMenu
                workspaceId={workspaceId}
                attachment={att}
                sourceEmailMessageId={emailId}
                onCopied={(name) => flashCopy(`Copied ${name}`)}
              />
            </div>
          ))}
        </div>
      )}
      {downloadable.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          style={{ background: 'none', border: 'none', color: '#1565c0', fontSize: 11, cursor: 'pointer', padding: '6px 0 0', fontFamily: 'inherit' }}
        >
          {showAll ? 'Show fewer' : `Show all (${downloadable.length})`}
        </button>
      )}

      {threadOtherIds.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #eee' }}>
          {!threadExtra ? (
            <button
              type="button"
              onClick={loadThreadExtras}
              disabled={threadLoading}
              style={{ background: 'none', border: 'none', color: '#1565c0', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              {threadLoading ? 'Loading…' : `Also in thread (${threadOtherIds.length} msg)`}
            </button>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                Other messages · {threadDownloadable.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 140, overflowY: 'auto' }}>
                {threadDownloadable.map(att => (
                  <div
                    key={att.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                      border: '1px solid #f0f0f0', borderRadius: 5, background: '#fafafa', fontSize: 12,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{fileIcon(att.mimeType)}</span>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {att.filename}
                    </div>
                    {att.uploadStatus === 'UPLOADED' && (
                      <a
                        href={api.getStoredAttachmentDownloadUrl(workspaceId, att.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 14, color: '#1565c0', textDecoration: 'none' }}
                      >
                        ↓
                      </a>
                    )}
                    <AttachmentActionMenu
                      workspaceId={workspaceId}
                      attachment={att}
                      sourceEmailMessageId={att.sourceEmailMessageId}
                      onCopied={(name) => flashCopy(`Copied ${name}`)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function MessageDetailView({ workspaceId, connectionId, messageId, onBack, breakpoint = 'desktop', connections }: Props) {
  const [threadData, setThreadData] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  /** Message shown in the main reader — independent of inbox open id (mark-read). */
  const [readingMessageId, setReadingMessageId] = useState<string>('')
  const [bodyLoadingId, setBodyLoadingId] = useState<string | null>(null)

  const [composeMode, setComposeMode] = useState<'reply' | 'forward' | null>(null)
  const [composeDefaults, setComposeDefaults] = useState({ to: '', cc: '', subject: '' })
  const [forwardAttachments, setForwardAttachments] = useState<Array<{
    id: string
    filename: string
    sizeBytes: number
    mimeType?: string
  }>>([])
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [selectedJobId, setSelectedJobId] = useState('')
  const [jobBusy, setJobBusy] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)
  const [jobPickerOpen, setJobPickerOpen] = useState(false)

  const [reclassifyBusy, setReclassifyBusy] = useState(false)
  const emailDebugLoggedForId = useRef<string | null>(null)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true' } catch { return false }
  })
  const [mobilePanel, setMobilePanel] = useState<'none' | 'thread' | 'attachments'>('none')

  const isPhone = breakpoint === 'phone'
  const isDesktop = breakpoint === 'desktop'

  const connectionEmailsKey = (connections ?? []).map(c => c.email.toLowerCase()).sort().join('|')
  const monitoredEmails = useMemo(
    () => new Set(connectionEmailsKey ? connectionEmailsKey.split('|') : []),
    [connectionEmailsKey]
  )
  const monitoredEmailsReady = connections !== undefined

  const loadThread = () => api.getMessageThread(workspaceId, connectionId, messageId)

  const persistSidebarCollapsed = (next: boolean) => {
    setSidebarCollapsed(next)
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)) } catch { /* */ }
  }

  useEffect(() => {
    const markName = `email-open-${messageId}`
    performance.mark(`${markName}-click`)

    setComposeMode(null)
    setSendResult(null)
    setJobError(null)
    setJobPickerOpen(false)
    setMobilePanel('none')
    emailDebugLoggedForId.current = null

    const applyThread = (td: ThreadDetail, fromCache: boolean) => {
      setThreadData(td)
      setCachedThread(workspaceId, connectionId, messageId, td)
      // Mark-read ONLY for the intentionally opened inbox message — never for sidebar selection.
      api.markAsRead(workspaceId, connectionId, messageId).catch(() => {})
      const clickedMsg = td.messages.find(m => m.id === messageId)
      if (clickedMsg?.job?.id) setSelectedJobId(clickedMsg.job.id)
      else setSelectedJobId('')
      const lastMsg = td.messages[td.messages.length - 1]
      setReadingMessageId(lastMsg?.id ?? messageId)
      setLoading(false)
      performance.mark(`${markName}-paint`)
      try {
        performance.measure('clickToDetailPaintMs', `${markName}-click`, `${markName}-paint`)
        const entries = performance.getEntriesByName('clickToDetailPaintMs')
        const last = entries[entries.length - 1]
        if (last) {
          console.info('clickToDetailPaintMs', {
            ms: Math.round(last.duration),
            messageId,
            fromCache,
          })
        }
        performance.clearMarks(`${markName}-click`)
        performance.clearMarks(`${markName}-paint`)
        performance.clearMeasures('clickToDetailPaintMs')
      } catch {
        /* ignore timing errors */
      }
    }

    const cached = getCachedThread(workspaceId, connectionId, messageId)
    if (cached) {
      applyThread(cached, true)
      return
    }

    setLoading(true)
    setThreadData(null)

    const inflight = getInflightThread(workspaceId, connectionId, messageId)
    const request = inflight ?? loadThread()
    request
      .then(td => applyThread(td, Boolean(inflight)))
      .catch(() => {
        setThreadData(null)
        setLoading(false)
      })
  }, [workspaceId, connectionId, messageId])

  // Lazy-load body for selected reader message without blocking selection / without mark-read.
  useEffect(() => {
    if (!threadData || !readingMessageId) return
    const msg = threadData.messages.find(m => m.id === readingMessageId)
    if (!msg) return
    if (!(msg.bodyTruncated && !msg.bodyText && !msg.bodyHtml)) return

    let cancelled = false
    setBodyLoadingId(msg.id)
    api.getMessageDetail(workspaceId, connectionId, msg.id)
      .then(r => {
        if (cancelled) return
        setThreadData(prev => {
          if (!prev) return prev
          const next = {
            ...prev,
            messages: prev.messages.map(m =>
              m.id === msg.id
                ? { ...m, bodyText: r.data.message.bodyText, bodyHtml: r.data.message.bodyHtml, bodyTruncated: false }
                : m
            ),
          }
          setCachedThread(workspaceId, connectionId, messageId, next)
          return next
        })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBodyLoadingId(null)
      })
    return () => { cancelled = true }
  }, [threadData, readingMessageId, workspaceId, connectionId, messageId])

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

  if (loading && !threadData) {
    return (
      <div style={{ padding: isPhone ? 8 : 0 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', fontSize: 13, color: '#5c7cfa',
            cursor: 'pointer', padding: '4px 0', marginBottom: 12, minHeight: 44,
          }}
        >
          ← Back
        </button>
        <div style={{
          background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
          padding: '16px 18px', marginBottom: 12,
        }}>
          <div style={{ height: 14, width: '40%', background: '#f0f0f0', borderRadius: 4, marginBottom: 10 }} />
          <div style={{ height: 20, width: '70%', background: '#eee', borderRadius: 4, marginBottom: 14 }} />
          <div style={{ height: 12, width: '55%', background: '#f3f3f3', borderRadius: 4 }} />
        </div>
        <div style={{
          background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
          padding: 16, minHeight: 180,
        }}>
          <div style={{ height: 12, width: '92%', background: '#f5f5f5', borderRadius: 4, marginBottom: 10 }} />
          <div style={{ height: 12, width: '88%', background: '#f5f5f5', borderRadius: 4, marginBottom: 10 }} />
          <div style={{ height: 12, width: '75%', background: '#f5f5f5', borderRadius: 4 }} />
          <p style={{ color: '#aaa', fontSize: 12, marginTop: 16 }}>Loading conversation…</p>
        </div>
      </div>
    )
  }
  if (!threadData || threadData.messages.length === 0) return <p>Message not found.</p>

  const messages = threadData.messages
  const lastMessage = messages[messages.length - 1]!
  const subject = threadData.thread.subject ?? lastMessage.subject ?? '(no subject)'
  const isBusinessMessage = clickedMessage?.mailboxCategory === 'BUSINESS'
  const readingMessage = messages.find(m => m.id === readingMessageId) ?? lastMessage

  const attachmentMsgIds = messages.filter(m => m.hasAttachments).map(m => m.id)
  const otherAttachmentIds = attachmentMsgIds.filter(id => id !== readingMessage.id)
  const anyAttachments = attachmentMsgIds.length > 0
  const showThreadNav = messages.length > 1
  const showSidebarContent = showThreadNav || anyAttachments
  const useTwoColumn = isDesktop && showSidebarContent && !sidebarCollapsed

  const selectReadingMessage = (id: string) => {
    setReadingMessageId(id)
    setMobilePanel('none')
    // Intentionally does NOT call markAsRead — sidebar selection must not mutate read state.
  }

  const openReply = () => {
    setComposeMode('reply')
    setForwardAttachments([])
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
    setForwardAttachments([])
    const ids = messages.filter(m => m.hasAttachments).map(m => m.id)
    if (ids.length === 0) return
    Promise.all(ids.map(id => api.getEmailAttachments(workspaceId, id).catch(() => ({ attachments: [] as StoredAttachment[] }))))
      .then(results => {
        const byId = new Map<string, StoredAttachment>()
        for (const r of results) {
          for (const a of r.attachments) {
            if (!isInlineImage(a) && a.uploadStatus === 'UPLOADED') byId.set(a.id, a)
          }
        }
        setForwardAttachments(
          [...byId.values()].map(a => ({
            id: a.id,
            filename: a.filename,
            sizeBytes: a.sizeBytes,
            mimeType: a.mimeType,
          }))
        )
      })
      .catch(() => setForwardAttachments([]))
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
        bodyFormat: 'html',
        files: payload.files,
        existingAttachmentIds:
          payload.existingAttachmentIds ?? [],
      })
      setSendResult({ type: 'success', message: composeMode === 'reply' ? 'Reply sent' : 'Message forwarded' })
      setComposeMode(null)
      setForwardAttachments([])
    } catch (e) {
      setSendResult({ type: 'error', message: e instanceof Error ? e.message : 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  const handleAssignJob = async (job: JobLookup) => {
    if (!clickedMessage) return
    setJobBusy(true)
    setJobError(null)
    try {
      await api.assignEmailToJob(workspaceId, job.id, { messageId: clickedMessage.id })
      const td = await loadThread()
      setThreadData(td)
      setSelectedJobId(job.id)
      setJobPickerOpen(false)
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
      setJobPickerOpen(false)
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

  const threadList = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: showThreadNav ? 1 : undefined }}>
      <div style={{
        padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#555',
        borderBottom: '1px solid #eee', flexShrink: 0, letterSpacing: 0.2,
      }}>
        THREAD · {messages.length}
      </div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {[...messages].reverse().map(msg => (
          <ThreadMessageRow
            key={msg.id}
            msg={msg}
            selected={msg.id === readingMessage.id}
            onSelect={() => selectReadingMessage(msg.id)}
            isSent={monitoredEmails.has(msg.senderEmail.toLowerCase())}
          />
        ))}
      </div>
    </div>
  )

  const attachmentsBlock = anyAttachments ? (
    <div style={{
      borderTop: showThreadNav ? '1px solid #e8e8e8' : undefined,
      padding: '8px 10px 10px',
      flexShrink: 0,
      maxHeight: showThreadNav ? '38%' : undefined,
      overflow: 'auto',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, letterSpacing: 0.2 }}>
        ATTACHMENTS
      </div>
      <SelectedAttachmentsPanel
        workspaceId={workspaceId}
        emailId={readingMessage.id}
        threadOtherIds={otherAttachmentIds}
        compact
      />
    </div>
  ) : null

  const sidebar = (
    <aside style={{
      width: useTwoColumn ? '26%' : '100%',
      minWidth: useTwoColumn ? 240 : undefined,
      maxWidth: useTwoColumn ? 340 : undefined,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      border: '1px solid #e5e5e5',
      borderRadius: 8,
      overflow: 'hidden',
      minHeight: 0,
      maxHeight: useTwoColumn ? '100%' : undefined,
    }}>
      {showThreadNav && threadList}
      {attachmentsBlock}
    </aside>
  )

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: isDesktop ? 'calc(100vh - 64px)' : undefined,
      minHeight: 0,
      maxHeight: isDesktop ? 'calc(100vh - 64px)' : undefined,
    }}>
      {/* Sticky thread header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, marginBottom: 10, flexShrink: 0,
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
                  fontSize: isPhone ? 16 : 17, margin: 0, lineHeight: 1.3, fontWeight: 600,
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
                {isDesktop && showSidebarContent && (
                  <button
                    type="button"
                    onClick={() => persistSidebarCollapsed(!sidebarCollapsed)}
                    title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                    style={{
                      fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid #ddd',
                      background: '#fff', cursor: 'pointer', color: '#555', minHeight: 32,
                    }}
                  >
                    {sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                  </button>
                )}
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
                      }} title={formatJobTooltip(clickedMessage.job)}>
                        {formatJobPrimaryLabel(clickedMessage.job, 36)}
                        {clickedMessage.job.jobNumber ? ` · #${clickedMessage.job.jobNumber}` : ''}
                      </span>
                    )}
                    {clickedMessage.job && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                        background: clickedMessage.jobAssignmentIsManual ? '#e3f2fd' : '#f3e5f5',
                        color: clickedMessage.jobAssignmentIsManual ? '#1565c0' : '#6a1b9a'
                      }}>
                        {jobSourceLabel(clickedMessage.jobAssignmentSource ?? null, clickedMessage.jobAssignmentIsManual ?? false)}
                      </span>
                    )}
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        disabled={jobBusy}
                        onClick={() => setJobPickerOpen(v => !v)}
                        style={{
                          padding: '4px 10px', fontSize: 12, borderRadius: 5, border: '1px solid #ddd',
                          minHeight: 32, background: '#fff', cursor: jobBusy ? 'not-allowed' : 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        {clickedMessage.job ? 'Change job…' : 'Assign job…'}
                      </button>
                      {jobPickerOpen && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4 }}>
                          <JobAssignPicker
                            workspaceId={workspaceId}
                            selectedJobId={clickedMessage.job?.id ?? selectedJobId}
                            disabled={jobBusy}
                            variant="dropdown"
                            onSelect={(job) => void handleAssignJob(job)}
                            onRemove={
                              clickedMessage.job
                                ? () => void handleRemoveJob()
                                : undefined
                            }
                            removeLabel="Remove job"
                            onClose={() => setJobPickerOpen(false)}
                          />
                        </div>
                      )}
                    </div>
                    {jobError && <span style={{ fontSize: 12, color: '#c62828' }}>{jobError}</span>}
                  </>
                )}
              </div>
            </div>

            {!isDesktop && showSidebarContent && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {showThreadNav && (
                  <button
                    type="button"
                    onClick={() => setMobilePanel(p => p === 'thread' ? 'none' : 'thread')}
                    style={{
                      fontSize: 12, padding: '5px 10px', borderRadius: 6,
                      border: mobilePanel === 'thread' ? '1px solid #1565c0' : '1px solid #ddd',
                      background: mobilePanel === 'thread' ? '#e3f2fd' : '#fff',
                      color: mobilePanel === 'thread' ? '#1565c0' : '#444',
                      fontWeight: 600, cursor: 'pointer', minHeight: 36,
                    }}
                  >
                    Thread ({messages.length})
                  </button>
                )}
                {anyAttachments && (
                  <button
                    type="button"
                    onClick={() => setMobilePanel(p => p === 'attachments' ? 'none' : 'attachments')}
                    style={{
                      fontSize: 12, padding: '5px 10px', borderRadius: 6,
                      border: mobilePanel === 'attachments' ? '1px solid #1565c0' : '1px solid #ddd',
                      background: mobilePanel === 'attachments' ? '#e3f2fd' : '#fff',
                      color: mobilePanel === 'attachments' ? '#1565c0' : '#444',
                      fontWeight: 600, cursor: 'pointer', minHeight: 36,
                    }}
                  >
                    Attachments{attachmentMsgIds.length ? ` (${attachmentMsgIds.length})` : ''}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {sendResult && (
        <div style={{
          padding: '8px 12px', marginBottom: 10, borderRadius: 4, fontSize: 13, flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: sendResult.type === 'success' ? '#e6f4ea' : '#fce4ec',
          border: `1px solid ${sendResult.type === 'success' ? '#a8d5a2' : '#e8a09a'}`
        }}>
          <span>{sendResult.message}</span>
          <button onClick={() => setSendResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
        </div>
      )}

      {!isDesktop && mobilePanel === 'thread' && showThreadNav && (
        <div style={{ marginBottom: 10, maxHeight: 280, overflow: 'hidden', flexShrink: 0 }}>
          {sidebar}
        </div>
      )}
      {!isDesktop && mobilePanel === 'attachments' && anyAttachments && (
        <div style={{
          marginBottom: 10, padding: 10, background: '#fff', border: '1px solid #e5e5e5',
          borderRadius: 8, flexShrink: 0, maxHeight: 280, overflow: 'auto',
        }}>
          <SelectedAttachmentsPanel
            workspaceId={workspaceId}
            emailId={readingMessage.id}
            threadOtherIds={otherAttachmentIds}
            compact
          />
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: 10,
        flex: 1,
        minHeight: 0,
        alignItems: 'stretch',
      }}>
        <div style={{
          flex: 1,
          minWidth: 0,
          minHeight: isDesktop ? 0 : 320,
          background: '#fff',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <SelectedMessagePane
            msg={readingMessage}
            workspaceId={workspaceId}
            connectionId={connectionId}
            onReply={openReply}
            onForward={openForward}
            bodyLoading={bodyLoadingId === readingMessage.id}
            isPhone={isPhone}
            onLoadBody={() => {
              setBodyLoadingId(readingMessage.id)
              api.getMessageDetail(workspaceId, connectionId, readingMessage.id).then(r => {
                setThreadData(prev => {
                  if (!prev) return prev
                  const next = {
                    ...prev,
                    messages: prev.messages.map(m =>
                      m.id === readingMessage.id
                        ? { ...m, bodyText: r.data.message.bodyText, bodyHtml: r.data.message.bodyHtml, bodyTruncated: false }
                        : m
                    ),
                  }
                  setCachedThread(workspaceId, connectionId, messageId, next)
                  return next
                })
              }).catch(() => {}).finally(() => setBodyLoadingId(null))
            }}
          />
        </div>

        {useTwoColumn && sidebar}
      </div>

      {composeMode && (
        <div className="card" style={{ marginTop: 12, borderLeft: '3px solid #5c7cfa', flexShrink: 0 }}>
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
            onCancel={() => { setComposeMode(null); setForwardAttachments([]) }}
            initialTo={composeDefaults.to ? composeDefaults.to.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : []}
            initialCc={composeDefaults.cc ? composeDefaults.cc.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : []}
            initialSubject={composeDefaults.subject}
            existingAttachments={composeMode === 'forward' ? forwardAttachments : []}
          />
        </div>
      )}
    </div>
  )
}
