/**
 * Sidebar / page access for platform-operator System items (Worker Jobs, Platform Admin).
 *
 * Matches API OWNER checks that accept either Membership.role or Membership.workspaceRole
 * (see jobs.route canPermanentlyDeleteJob). Does not grant access to ordinary users.
 */
export function isWorkspaceOwnerMembership(input: {
  role?: string | null
  workspaceRole?: string | null
}): boolean {
  return input.role === 'OWNER' || input.workspaceRole === 'OWNER'
}

export function canAccessPlatformOperatorNav(input: {
  isPlatformAdmin: boolean
  role?: string | null
  workspaceRole?: string | null
}): boolean {
  return input.isPlatformAdmin && isWorkspaceOwnerMembership(input)
}
