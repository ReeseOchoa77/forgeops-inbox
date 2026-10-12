import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canAccessPlatformOperatorNav,
  isWorkspaceOwnerMembership,
} from './system-nav-access'

const here = import.meta.dirname

describe('system nav access — platform operator items', () => {
  it('treats Membership.role OWNER or workspaceRole OWNER as workspace owner', () => {
    expect(isWorkspaceOwnerMembership({ role: 'OWNER', workspaceRole: 'VIEWER' })).toBe(true)
    expect(isWorkspaceOwnerMembership({ role: 'ADMIN', workspaceRole: 'OWNER' })).toBe(true)
    expect(isWorkspaceOwnerMembership({ role: 'ADMIN', workspaceRole: 'EDITOR' })).toBe(false)
    expect(isWorkspaceOwnerMembership({ role: 'MEMBER', workspaceRole: 'VIEWER' })).toBe(false)
  })

  it('shows Worker Jobs / Platform Admin only for platform admin + workspace owner', () => {
    expect(
      canAccessPlatformOperatorNav({
        isPlatformAdmin: true,
        role: 'ADMIN',
        workspaceRole: 'OWNER',
      })
    ).toBe(true)
    expect(
      canAccessPlatformOperatorNav({
        isPlatformAdmin: true,
        role: 'OWNER',
        workspaceRole: 'VIEWER',
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
        role: 'ADMIN',
        workspaceRole: 'EDITOR',
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

  it('App wires Worker Jobs and Platform Admin through canAccessPlatformOperatorNav', () => {
    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(app).toContain("from './system-nav-access'")
    expect(app).toContain('canAccessPlatformOperatorNav')
    expect(app).toContain('canSeePlatformOperatorNav')
    expect(app).toContain("page: 'worker-jobs'")
    expect(app).toContain("page: 'admin'")
    expect(app).toContain('adminOnly: true')
    expect(app).toContain('<WorkerJobsView')
    expect(app).toContain('<PlatformAdminView')
    // Must not use the brittle role-only OWNER gate for operator pages.
    expect(app).not.toMatch(
      /page === 'admin' && isPlatformAdmin && currentRole === 'OWNER'/
    )
    expect(app).not.toMatch(
      /page === 'worker-jobs' && isPlatformAdmin && currentRole === 'OWNER'/
    )
    expect(app).toContain("page === 'admin' && canSeePlatformOperatorNav")
    expect(app).toContain("page === 'worker-jobs' && canSeePlatformOperatorNav")
  })
})
