import { describe, expect, it } from 'vitest'
import { isReferenceDataTab } from './views/ReferenceDataView'

/** Mirrors App.tsx NAV_ITEMS section assignment (nav IA only). */
const NAV_SECTIONS: Array<{ page: string; section?: string; minRole?: string }> = [
  { page: 'dashboard' },
  { page: 'inbox' },
  { page: 'tasks' },
  { page: 'jobs' },
  { page: 'reference', section: 'Manage' },
  { page: 'workspace' },
  { page: 'review', section: 'System', minRole: 'ADMIN' },
  { page: 'admin', section: 'System' },
]

describe('documents navigation consolidation', () => {
  it('Documents is a Company Data tab, not a separate nav destination', () => {
    expect(NAV_SECTIONS.map((i) => i.page)).not.toContain('documents')
    expect(NAV_SECTIONS.map((i) => i.page)).toContain('reference')
  })

  it('documents is a valid Company Data section for redirects and refresh', () => {
    expect(isReferenceDataTab('documents')).toBe(true)
    expect(isReferenceDataTab('customers')).toBe(true)
    expect(isReferenceDataTab('not-a-tab')).toBe(false)
  })
})

describe('job discovery navigation consolidation', () => {
  it('retires top-level Job Discovery in favor of Workspace → Email Analysis', () => {
    expect(NAV_SECTIONS.map((i) => i.page)).not.toContain('outlook-folders')
    expect(NAV_SECTIONS.map((i) => i.page)).toContain('workspace')
    const managePages = NAV_SECTIONS.filter((i) => i.section === 'Manage').map((i) => i.page)
    expect(managePages).toEqual(['reference'])
  })
})

describe('email review navigation consolidation', () => {
  it('Email Review lives under System next to Platform Admin and keeps ADMIN minRole', () => {
    const review = NAV_SECTIONS.find((i) => i.page === 'review')
    expect(review?.section).toBe('System')
    expect(review?.minRole).toBe('ADMIN')
    const systemPages = NAV_SECTIONS.filter((i) => i.section === 'System').map((i) => i.page)
    expect(systemPages).toEqual(['review', 'admin'])
  })
})
