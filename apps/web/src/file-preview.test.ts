import { describe, expect, it } from 'vitest'
import {
  canPreviewFile,
  previewFilesFrom,
  previewIndexFor,
  stepPreviewIndex,
  previewKeyAction,
  storedAttachmentIdFromUrl,
  toPreviewFile,
} from './file-preview'

describe('preview capability', () => {
  it('previews pdf and raster images', () => {
    expect(canPreviewFile({ filename: 'drawing-set.pdf', contentType: 'application/pdf' })).toBe(true)
    expect(canPreviewFile({ filename: 'site.jpg', contentType: 'image/jpeg' })).toBe(true)
    expect(canPreviewFile({ filename: 'photo.png', contentType: 'image/png' })).toBe(true)
    expect(canPreviewFile({ filename: 'anim.gif', contentType: 'image/gif' })).toBe(true)
    expect(canPreviewFile({ filename: 'shot.webp', contentType: 'image/webp' })).toBe(true)
  })

  it('rejects unsupported files and suspicious MIME/extension pairs', () => {
    expect(canPreviewFile({ filename: 'plan.dwg', contentType: 'application/octet-stream' })).toBe(false)
    expect(canPreviewFile({ filename: 'pack.zip', contentType: 'application/zip' })).toBe(false)
    expect(canPreviewFile({ filename: 'sheet.xlsx', contentType: 'application/vnd.ms-excel' })).toBe(false)
    expect(canPreviewFile({ filename: 'page.html', contentType: 'image/png' })).toBe(false)
    expect(canPreviewFile({ filename: 'photo.png', contentType: 'text/html' })).toBe(false)
    expect(canPreviewFile({ filename: 'icon.svg', contentType: 'image/svg+xml' })).toBe(false)
  })
})

describe('preview descriptors', () => {
  it('builds a URL descriptor and does not embed file bytes', () => {
    const file = toPreviewFile({
      id: 'att1',
      filename: 'drawing-set.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4800000,
      available: true,
      previewUrl: '/api/v1/workspaces/ws/attachments/att1/download?inline=true',
      downloadUrl: '/api/v1/workspaces/ws/attachments/att1/download',
    })
    expect(file?.kind).toBe('pdf')
    expect(file?.previewUrl).toContain('inline=true')
    expect(file?.downloadUrl).not.toContain('inline=true')
    expect(JSON.stringify(file)).not.toMatch(/^data:|base64/)
  })

  it('skips unsupported files when collecting a preview list', () => {
    const files = previewFilesFrom(
      [
        { id: 'pdf', filename: 'a.pdf', contentType: 'application/pdf' },
        { id: 'zip', filename: 'a.zip', contentType: 'application/zip' },
        { id: 'img', filename: 'a.png', contentType: 'image/png' },
      ],
      (row) => toPreviewFile({
        ...row,
        sizeBytes: 10,
        available: true,
        previewUrl: `/preview/${row.id}`,
        downloadUrl: `/download/${row.id}`,
      }),
    )
    expect(files.map((file) => file.id)).toEqual(['pdf', 'img'])
    expect(previewIndexFor(files, 'img')).toBe(1)
    expect(stepPreviewIndex(1, 1, files.length)).toBe(0)
    expect(stepPreviewIndex(0, -1, files.length)).toBe(1)
    expect(previewKeyAction('Escape', 2)).toBe('close')
    expect(previewKeyAction('ArrowLeft', 2)).toBe('previous')
    expect(previewKeyAction('ArrowRight', 2)).toBe('next')
    expect(previewKeyAction('ArrowRight', 1)).toBeNull()
  })

  it('reads only the stored attachment id from a content URL', () => {
    expect(storedAttachmentIdFromUrl(
      'https://api.example/api/v1/workspaces/ws/attachments/att_1/download?inline=true',
    )).toBe('att_1')
    expect(storedAttachmentIdFromUrl(
      'https://api.example/api/v1/workspaces/ws/inbox-connections/c/messages/m/attachments/graph/download',
    )).toBeNull()
  })
})
