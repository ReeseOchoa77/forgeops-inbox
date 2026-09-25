/**
 * Preview capability for the web app.
 * Keep in sync with packages/shared/src/file-preview.ts.
 * List rows use this on metadata only — it never loads file bytes.
 */

export type PreviewKind = 'image' | 'pdf'

const IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

const MIME_TO_EXTENSIONS: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/jpg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'application/x-pdf': ['pdf'],
}

const IMPERFECT_MIME = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/x-download',
])

const UNSAFE_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'svgz', 'js', 'mjs', 'xml',
])

function fileExtension(filename: string | null | undefined): string {
  const base = (filename ?? '').split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

function normalizedMime(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function isUnsafeMime(mime: string): boolean {
  return (
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    mime === 'image/svg+xml' ||
    mime.startsWith('image/svg') ||
    mime === 'text/javascript' ||
    mime === 'application/javascript' ||
    mime === 'text/xml' ||
    mime === 'application/xml'
  )
}

export function previewKind(input: {
  filename?: string | null
  contentType?: string | null
}): PreviewKind | null {
  const mime = normalizedMime(input.contentType)
  const ext = fileExtension(input.filename)
  if (UNSAFE_EXTENSIONS.has(ext) || isUnsafeMime(mime)) return null

  const mimeExts = MIME_TO_EXTENSIONS[mime]
  if (mimeExts) {
    if (ext && !mimeExts.includes(ext)) return null
    return mime === 'application/pdf' || mime === 'application/x-pdf' ? 'pdf' : 'image'
  }

  if (!IMPERFECT_MIME.has(mime)) return null
  if (ext === 'pdf') return 'pdf'
  if (ext in IMAGE_EXTENSIONS) return 'image'
  return null
}

export function canPreviewFile(input: {
  filename?: string | null
  contentType?: string | null
}): boolean {
  return previewKind(input) !== null
}

export type PreviewFile = {
  id: string
  filename: string
  contentType: string
  sizeBytes: number | null
  kind: PreviewKind
  /** False when ForgeOps does not have the object yet. */
  available: boolean
  previewUrl: string
  downloadUrl: string
}

export function toPreviewFile(input: {
  id: string
  filename: string
  contentType: string
  sizeBytes: number | null
  available: boolean
  previewUrl: string
  downloadUrl: string
}): PreviewFile | null {
  const kind = previewKind({ filename: input.filename, contentType: input.contentType })
  if (!kind) return null
  return { ...input, kind }
}

export function previewFilesFrom<T extends { id: string }>(
  rows: T[],
  toFile: (row: T) => PreviewFile | null,
): PreviewFile[] {
  const files: PreviewFile[] = []
  for (const row of rows) {
    const file = toFile(row)
    if (file) files.push(file)
  }
  return files
}

export function previewIndexFor(files: PreviewFile[], id: string): number {
  const index = files.findIndex((file) => file.id === id)
  return index < 0 ? 0 : index
}

export function previewKeyAction(key: string, count: number): 'close' | 'previous' | 'next' | null {
  if (key === 'Escape') return 'close'
  if (count < 2) return null
  if (key === 'ArrowLeft') return 'previous'
  if (key === 'ArrowRight') return 'next'
  return null
}

export function stepPreviewIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (index + delta + count) % count
}

export function formatPreviewSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function previewTypeLabel(kind: PreviewKind): string {
  return kind === 'pdf' ? 'PDF' : 'Image'
}

/** Stored email attachment content URL, not the Graph provider proxy. */
export function storedAttachmentIdFromUrl(src: string): string | null {
  try {
    const path = new URL(src, 'https://forgeops.local').pathname
    const match = path.match(/\/workspaces\/[^/]+\/attachments\/([^/]+)\/download\/?$/)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

export const PREVIEW_NOT_STORED_MESSAGE =
  'Preview unavailable — attachment has not been downloaded to ForgeOps yet.'

export const PREVIEW_FAILED_MESSAGE = 'Unable to preview this file.'
