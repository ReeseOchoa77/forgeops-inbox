import { describe, expect, it } from 'vitest'
import { canAccessPlatformOperatorNav } from './system-nav-access'
import { EmailAnalysisView } from './views/EmailAnalysisView'
import { BiddingFolderAnalysisView } from './views/BiddingFolderAnalysisView'

/**
 * Mirrors App.tsx NAV_ITEMS (browser-safe — no node:fs under web tsconfig).
 * Keep in sync with System section ordering in App.tsx.
 */
const SYSTEM_NAV = [
  { page: 'review', label: 'Email Classification', minRole: 'ADMIN', adminOnly: false },
  { page: 'email-analysis', label: 'Email Analysis', minRole: 'MEMBER', adminOnly: false },
  { page: 'worker-jobs', label: 'Worker Jobs', minRole: undefined, adminOnly: true },
  { page: 'admin', label: 'Platform Admin', minRole: undefined, adminOnly: true },
] as const

/** Mirrors WorkspaceView tabs after Email Analysis moved to Systems. */
const WORKSPACE_TABS = [
  { id: 'mailboxes', label: 'Monitored Mailboxes' },
  { id: 'team', label: 'Team Access' },
] as const

describe('Email Analysis Systems navigation', () => {
  it('places Email Analysis in Systems between Email Classification and Worker Jobs', () => {
    const pages = SYSTEM_NAV.map((i) => i.page)
    expect(pages).toEqual(['review', 'email-analysis', 'worker-jobs', 'admin'])
    expect(SYSTEM_NAV.filter((i) => i.page === 'email-analysis')).toHaveLength(1)
    expect(SYSTEM_NAV.find((i) => i.page === 'email-analysis')?.label).toBe('Email Analysis')
  })

  it('keeps Worker Jobs and Platform Admin as adminOnly; unauthorized users cannot see them', () => {
    const worker = SYSTEM_NAV.find((i) => i.page === 'worker-jobs')
    const admin = SYSTEM_NAV.find((i) => i.page === 'admin')
    expect(worker?.adminOnly).toBe(true)
    expect(admin?.adminOnly).toBe(true)
    expect(
      canAccessPlatformOperatorNav({
        isPlatformAdmin: true,
        role: 'ADMIN',
        workspaceRole: 'OWNER',
      })
    ).toBe(true)
    expect(
      canAccessPlatformOperatorNav({
        isPlatformAdmin: false,
        role: 'OWNER',
        workspaceRole: 'OWNER',
      })
    ).toBe(false)
    expect(
      canAccessPlatformOperatorNav({
        isPlatformAdmin: true,
        role: 'MEMBER',
        workspaceRole: 'VIEWER',
      })
    ).toBe(false)
  })

  it('Workspace keeps Monitored Mailboxes and Team Access; no Email Analysis tab', () => {
    expect(WORKSPACE_TABS.map((t) => t.id)).toEqual(['mailboxes', 'team'])
    expect(WORKSPACE_TABS.map((t) => t.label)).toEqual([
      'Monitored Mailboxes',
      'Team Access',
    ])
    expect(WORKSPACE_TABS.some((t) => t.label === 'Email Analysis')).toBe(false)
    expect(WORKSPACE_TABS.some((t) => t.id === 'folders')).toBe(false)
  })

  it('keeps Project vs Bidding modes under Email Analysis', () => {
    expect(typeof EmailAnalysisView).toBe('function')
    expect(typeof BiddingFolderAnalysisView).toBe('function')
  })

  it('Bidding Folder Analysis view is the dedicated staging surface', () => {
    expect(BiddingFolderAnalysisView.name).toBe('BiddingFolderAnalysisView')
  })
})
