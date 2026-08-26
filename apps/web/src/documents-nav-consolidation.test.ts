import { describe, expect, it } from 'vitest'
import { isReferenceDataTab } from './views/ReferenceDataView'

/** Mirrors App.tsx NAV_ITEMS section assignment (nav IA only). */
const NAV_SECTIONS: Array<{ page: string; section?: string }> = [
  { page: 'dashboard' },
  { page: 'inbox' },
  { page: 'review' },
  { page: 'tasks' },
  { page: 'jobs' },
  { page: 'reference', section: 'Manage' },
  { page: 'outlook-folders', section: 'Manage' },
  { page: 'workspace' },
  { page: 'admin', section: 'System' },
]

describe('documents navigation consolidation', () => {
  it('Documents is a Reference Data tab, not a separate nav destination', () => {
    expect(NAV_SECTIONS.map((i) => i.page)).not.toContain('documents')
    expect(NAV_SECTIONS.map((i) => i.page)).toContain('reference')
  })

  it('documents is a valid Reference Data section for redirects and refresh', () => {
    expect(isReferenceDataTab('documents')).toBe(true)
    expect(isReferenceDataTab('customers')).toBe(true)
    expect(isReferenceDataTab('not-a-tab')).toBe(false)
  })
})

describe('job discovery navigation consolidation', () => {
  it('Job Discovery lives under Manage, not as a primary unsectioned item', () => {
    const jobDiscovery = NAV_SECTIONS.find((i) => i.page === 'outlook-folders')
    expect(jobDiscovery?.section).toBe('Manage')
    const managePages = NAV_SECTIONS.filter((i) => i.section === 'Manage').map((i) => i.page)
    expect(managePages).toEqual(['reference', 'outlook-folders'])
  })
})
