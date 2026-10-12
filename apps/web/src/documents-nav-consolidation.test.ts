import { describe, expect, it } from 'vitest'
import { isReferenceDataTab } from './views/ReferenceDataView'

/** Mirrors App.tsx NAV_ITEMS section assignment (nav IA only). */
const NAV_SECTIONS: Array<{ page: string; section?: string; minRole?: string }> = [
  { page: 'inbox' },
  { page: 'tasks' },
  { page: 'jobs' },
  { page: 'dashboard', section: 'Manage' },
  { page: 'reference', section: 'Manage' },
  { page: 'workspace' },
  { page: 'review', section: 'System', minRole: 'ADMIN' },
  { page: 'email-analysis', section: 'System', minRole: 'MEMBER' },
  { page: 'worker-jobs', section: 'System' },
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
  it('retires top-level Job Discovery; Email Analysis lives under Systems', () => {
    expect(NAV_SECTIONS.map((i) => i.page)).not.toContain('outlook-folders')
    expect(NAV_SECTIONS.map((i) => i.page)).toContain('email-analysis')
    const managePages = NAV_SECTIONS.filter((i) => i.section === 'Manage').map((i) => i.page)
    expect(managePages).toEqual(['dashboard', 'reference'])
  })
})

describe('email review navigation consolidation', () => {
  it('Email Classification, Email Analysis, Worker Jobs order under System', () => {
    const review = NAV_SECTIONS.find((i) => i.page === 'review')
    expect(review?.section).toBe('System')
    expect(review?.minRole).toBe('ADMIN')
    const systemPages = NAV_SECTIONS.filter((i) => i.section === 'System').map((i) => i.page)
    expect(systemPages).toEqual(['review', 'email-analysis', 'worker-jobs', 'admin'])
    const ea = NAV_SECTIONS.find((i) => i.page === 'email-analysis')
    expect(ea?.minRole).toBe('MEMBER')
    const reviewIdx = systemPages.indexOf('review')
    const eaIdx = systemPages.indexOf('email-analysis')
    const wjIdx = systemPages.indexOf('worker-jobs')
    expect(eaIdx).toBe(reviewIdx + 1)
    expect(wjIdx).toBe(eaIdx + 1)
  })
})
