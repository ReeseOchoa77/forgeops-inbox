import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname
const detailSrc = readFileSync(
  join(here, 'components/BidCandidateDetail.tsx'),
  'utf8'
)
const apiSrc = readFileSync(join(here, 'api.ts'), 'utf8')
const viewSrc = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')

describe('Active Bid operational editing', () => {
  it('Edit / Save / Cancel and real PATCH persist', () => {
    expect(detailSrc).toContain('setEditing(true)')
    expect(detailSrc).toContain("Saving…")
    expect(detailSrc).toContain("'Save'")
    expect(detailSrc).toContain('cancelEdit')
    expect(detailSrc).toContain('patchOperationalBidCandidate')
    expect(detailSrc).toContain("setSaveOk(true)")
    expect(apiSrc).toContain('patchOperationalBidCandidate')
    expect(apiSrc).toContain('scopeDetail')
    expect(viewSrc).toContain('BidCandidateDetail')
  })

  it('15) save failure is an alert, not success', () => {
    expect(detailSrc).toContain("setSaveOk(false)")
    expect(detailSrc).toContain("setSaveError")
    expect(detailSrc).toContain('role="alert"')
    const failBlock = detailSrc.slice(
      detailSrc.indexOf('} catch (e) {'),
      detailSrc.indexOf('} finally {')
    )
    expect(failBlock).toContain('setSaveOk(false)')
    expect(failBlock).toContain('setSaveError')
    expect(failBlock).not.toContain('setSaveOk(true)')
    expect(failBlock).not.toContain('setEditing(false)')
  })

  it('customer select reuses getCustomers; no fuzzy matching', () => {
    expect(detailSrc).toContain('getCustomers')
    expect(detailSrc).toContain('No customer')
    expect(detailSrc).not.toMatch(/fuzzy/i)
  })

  it('lifecycle omits CONVERTED from the edit dropdown', () => {
    expect(detailSrc).toContain("EDITABLE_LIFECYCLES")
    expect(detailSrc).toContain("'OPEN'")
    expect(detailSrc).toContain("'QUOTED'")
    expect(detailSrc).toContain("'LOST'")
    expect(detailSrc).toContain("'ARCHIVED'")
    expect(detailSrc).toContain("Convert to Job only")
    expect(apiSrc).not.toMatch(
      /patchOperationalBidCandidate:[\s\S]*lifecycle\?: 'OPEN' \| 'QUOTED' \| 'CONVERTED'/
    )
  })

  it('emails can be linked and unlinked without deleting EmailMessage', () => {
    expect(detailSrc).toContain('assignEmailToBidCandidate')
    expect(detailSrc).toContain('unlinkEmailFromBidCandidate')
    expect(detailSrc).toContain('The email itself is')
    expect(detailSrc).toContain('not deleted.')
    expect(apiSrc).toContain('unlinkEmailFromBidCandidate')
    expect(apiSrc).toContain('method: \'DELETE\'')
  })

  it('Quote metadata uses existing extractedAmount / displayName / scope / notes', () => {
    expect(detailSrc).toContain('updateBidQuote')
    expect(detailSrc).toContain('extractedAmount')
    expect(detailSrc).toContain('displayName')
    expect(detailSrc).toContain('extractedScope')
    expect(detailSrc).toContain('extractedNotes')
    expect(detailSrc).not.toContain('quoteDate')
    expect(detailSrc).not.toContain('manualPrice')
  })

  it('12) documents are email attachments; no fake EmailMessage uploads', () => {
    expect(detailSrc).toContain('getEmailAttachments')
    expect(detailSrc).toContain('getStoredAttachmentDownloadUrl')
    expect(detailSrc).toContain('canonical attachments')
    expect(detailSrc).not.toContain('createEmailMessage')
    expect(detailSrc).not.toContain('BidCandidateDocument')
  })

  it('14) converted Candidate copy says Job remains canonical', () => {
    expect(detailSrc).toContain('Job remains canonical')
    expect(detailSrc).toContain('Candidate edits do not update the Job')
  })

  it('prevents duplicate Save submissions', () => {
    expect(detailSrc).toContain('if (saving) return')
    expect(detailSrc).toContain('disabled={saving}')
  })
})
