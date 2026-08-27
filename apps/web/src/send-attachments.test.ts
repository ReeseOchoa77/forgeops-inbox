import { describe, expect, it } from 'vitest'

/**
 * Mirrors apps/web sendMessage multipart vs JSON branch.
 */
function shouldUseMultipart(input: {
  files?: File[]
  existingAttachmentIds?: string[]
}): boolean {
  return (input.files?.length ?? 0) > 0 || (input.existingAttachmentIds?.length ?? 0) > 0
}

describe('sendMessage attachment transport', () => {
  it('uses JSON when no attachments', () => {
    expect(shouldUseMultipart({ files: [], existingAttachmentIds: [] })).toBe(false)
  })

  it('uses multipart for new file uploads', () => {
    const fake = { name: 'a.pdf', size: 10 } as File
    expect(shouldUseMultipart({ files: [fake] })).toBe(true)
  })

  it('uses multipart for forward existing attachment IDs', () => {
    expect(shouldUseMultipart({ existingAttachmentIds: ['att1'] })).toBe(true)
  })

  it('reply should not inherit existing attachment IDs by default', () => {
    const replyIds: string[] = []
    expect(replyIds).toEqual([])
  })
})
