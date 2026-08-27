import { describe, expect, it } from 'vitest'

/**
 * Documents attachment download URL construction used by MessageDetailView.
 * List downloads must use ForgeOps EmailAttachment.id on the stored route.
 * Provider route is CID fallback only and must encode Graph attachment IDs
 * (they can contain `/`, which otherwise yields Fastify "Route not found").
 */
const API_BASE = '/api/v1'

function getStoredAttachmentDownloadUrl(
  workspaceId: string,
  attachmentId: string,
  inline = false
) {
  return `${API_BASE}/workspaces/${workspaceId}/attachments/${attachmentId}/download${inline ? '?inline=true' : ''}`
}

function getAttachmentUrl(
  workspaceId: string,
  connectionId: string,
  messageId: string,
  attachmentId: string
) {
  return (
    `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}` +
    `/inbox-connections/${encodeURIComponent(connectionId)}` +
    `/messages/${encodeURIComponent(messageId)}` +
    `/attachments/${encodeURIComponent(attachmentId)}/download`
  )
}

describe('attachment download contract', () => {
  it('list download uses ForgeOps EmailAttachment.id on canonical stored route', () => {
    const forgeOpsAttachmentId = 'cmattachment001'
    const url = getStoredAttachmentDownloadUrl('ws1', forgeOpsAttachmentId)
    expect(url).toBe(
      '/api/v1/workspaces/ws1/attachments/cmattachment001/download'
    )
    expect(url).not.toContain('/inbox-connections/')
    expect(url).not.toContain('/messages/')
  })

  it('inline CID stored rewrite uses same ForgeOps id with inline=true', () => {
    const url = getStoredAttachmentDownloadUrl('ws1', 'cmattInline', true)
    expect(url).toBe(
      '/api/v1/workspaces/ws1/attachments/cmattInline/download?inline=true'
    )
  })

  it('provider CID fallback encodes Graph attachment ids with slashes', () => {
    const graphId = 'AAMkAGI2/TG93+ThU3=='
    const url = getAttachmentUrl('ws1', 'conn1', 'msg1', graphId)
    expect(url).toContain(`/attachments/${encodeURIComponent(graphId)}/download`)
    expect(url).not.toContain('/attachments/AAMkAGI2/TG93')
    // Path has a single attachmentId segment after encode
    const path = url.replace(API_BASE, '')
    const match = path.match(
      /\/attachments\/([^/]+)\/download$/
    )
    expect(match?.[1]).toBe(encodeURIComponent(graphId))
  })

  it('does not use Graph attachment id as stored download path segment', () => {
    const graphId = 'AAMkProviderAttachment'
    const stored = getStoredAttachmentDownloadUrl('ws1', 'cmforgeopsid')
    expect(stored).not.toContain(graphId)
  })
})
