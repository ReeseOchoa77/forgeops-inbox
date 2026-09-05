import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendCopiedAttachments,
  clearAttachmentClipboard,
  copyAttachmentToClipboard,
  disarmAttachmentClipboardPaste,
  getCopiedAttachments,
  isAttachmentClipboardPasteArmed,
} from './attachment-clipboard'

describe('attachment clipboard', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      clear: () => store.clear(),
    })
    clearAttachmentClipboard()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const ref = (id: string, name = 'file.pdf') => ({
    attachmentId: id,
    filename: name,
    mimeType: 'application/pdf',
    sizeBytes: 1200,
    sourceEmailMessageId: 'msg-1',
    workspaceId: 'ws-1',
  })

  it('stores a single copied attachment reference (no binary)', () => {
    copyAttachmentToClipboard(ref('a1', 'quote.pdf'))
    expect(getCopiedAttachments('ws-1')).toEqual([
      expect.objectContaining({ attachmentId: 'a1', filename: 'quote.pdf' }),
    ])
    expect(isAttachmentClipboardPasteArmed()).toBe(true)
  })

  it('appendCopiedAttachments supports multi-copy with dedupe', () => {
    copyAttachmentToClipboard(ref('a1'))
    appendCopiedAttachments([ref('a2', 'b.xlsx'), ref('a1', 'quote.pdf')])
    const items = getCopiedAttachments('ws-1')
    expect(items.map((i) => i.attachmentId).sort()).toEqual(['a1', 'a2'])
  })

  it('filters by workspaceId', () => {
    copyAttachmentToClipboard(ref('a1'))
    expect(getCopiedAttachments('ws-other')).toEqual([])
    expect(getCopiedAttachments('ws-1')).toHaveLength(1)
  })

  it('disarm clears pasteArmed but keeps items for button paste', () => {
    copyAttachmentToClipboard(ref('a1'))
    disarmAttachmentClipboardPaste()
    expect(isAttachmentClipboardPasteArmed()).toBe(false)
    expect(getCopiedAttachments('ws-1')).toHaveLength(1)
  })

  it('clear removes everything', () => {
    copyAttachmentToClipboard(ref('a1'))
    clearAttachmentClipboard()
    expect(getCopiedAttachments()).toEqual([])
    expect(isAttachmentClipboardPasteArmed()).toBe(false)
  })
})
