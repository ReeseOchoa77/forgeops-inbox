import { describe, expect, it } from 'vitest'
import {
  canAccessPlatformOperatorNav,
  isWorkspaceOwnerMembership,
} from './system-nav-access'

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
})
