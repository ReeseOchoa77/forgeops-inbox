/**
 * ForgeOps internal attachment clipboard (Outlook-like Copy → Compose paste).
 * Stores lightweight EmailAttachment references only — never binary data.
 */

export type CopiedAttachmentRef = {
  attachmentId: string
  filename: string
  mimeType: string
  sizeBytes: number
  sourceEmailMessageId: string
  workspaceId: string
}

type ClipboardState = {
  items: CopiedAttachmentRef[]
  /** When true, the next Cmd/Ctrl+V in a composer will attach these items. */
  pasteArmed: boolean
  updatedAt: number
}

const STORAGE_KEY = 'forgeops.attachmentClipboard.v1'

type Listener = () => void
const listeners = new Set<Listener>()

function emptyState(): ClipboardState {
  return { items: [], pasteArmed: false, updatedAt: 0 }
}

function readState(): ClipboardState {
  if (typeof sessionStorage === 'undefined') return emptyState()
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as ClipboardState
    if (!parsed || !Array.isArray(parsed.items)) return emptyState()
    return {
      items: parsed.items.filter(
        (i) =>
          i &&
          typeof i.attachmentId === 'string' &&
          typeof i.filename === 'string' &&
          typeof i.workspaceId === 'string'
      ),
      pasteArmed: Boolean(parsed.pasteArmed),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return emptyState()
  }
}

function writeState(next: ClipboardState) {
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore quota */
    }
  }
  for (const l of listeners) l()
}

export function subscribeAttachmentClipboard(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAttachmentClipboard(): ClipboardState {
  return readState()
}

export function getCopiedAttachments(workspaceId?: string): CopiedAttachmentRef[] {
  const items = readState().items
  if (!workspaceId) return items
  return items.filter((i) => i.workspaceId === workspaceId)
}

/** Replace clipboard with one attachment (MVP single-copy; multi via appendCopiedAttachments). */
export function copyAttachmentToClipboard(ref: CopiedAttachmentRef): void {
  writeState({
    items: [ref],
    pasteArmed: true,
    updatedAt: Date.now(),
  })
}

/** Append one or more attachments (dedupe by attachmentId). */
export function appendCopiedAttachments(refs: CopiedAttachmentRef[]): void {
  if (refs.length === 0) return
  const prev = readState()
  const byId = new Map(prev.items.map((i) => [i.attachmentId, i]))
  for (const ref of refs) byId.set(ref.attachmentId, ref)
  writeState({
    items: [...byId.values()],
    pasteArmed: true,
    updatedAt: Date.now(),
  })
}

export function clearAttachmentClipboard(): void {
  writeState(emptyState())
}

/** After a keyboard paste into the composer, disarm so ordinary text pastes don't re-attach. */
export function disarmAttachmentClipboardPaste(): void {
  const prev = readState()
  if (!prev.pasteArmed) return
  writeState({ ...prev, pasteArmed: false })
}

export function isAttachmentClipboardPasteArmed(): boolean {
  return readState().pasteArmed
}
