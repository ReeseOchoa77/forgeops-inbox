import {
  asString,
  loadWorkspaceState,
  patchUrlSearchParams,
  readUrlSearchParams,
  saveWorkspaceState,
} from './storage'

export const NAV_STATE_VERSION = 1
export const NAV_SURFACE = 'nav'

/** Pages that may be restored after refresh (excludes ephemeral detail shells). */
export const RESTORABLE_PAGES = [
  'dashboard',
  'inbox',
  'review',
  'email-analysis',
  'tasks',
  'calendar',
  'bidding',
  'jobs',
  'reference',
  'intelligence',
  'workspace',
  'settings',
  'admin',
  'worker-jobs',
] as const

export type RestorablePage = (typeof RESTORABLE_PAGES)[number]

export type NavPersistedState = {
  page: RestorablePage
  intelligenceId: string | null
}

export function isRestorablePage(value: string | null | undefined): value is RestorablePage {
  return !!value && (RESTORABLE_PAGES as readonly string[]).includes(value)
}

export function validateNavState(raw: unknown): NavPersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isRestorablePage(typeof o.page === 'string' ? o.page : null)) return null
  const intelligenceId =
    o.intelligenceId === null
      ? null
      : asString(o.intelligenceId, 120)
  if (o.intelligenceId != null && intelligenceId == null) return null
  return { page: o.page as RestorablePage, intelligenceId }
}

export function readNavFromUrl(): Partial<NavPersistedState> {
  const params = readUrlSearchParams()
  const view = params.get('view')
  const intel = params.get('intel')
  const out: Partial<NavPersistedState> = {}
  if (isRestorablePage(view)) out.page = view
  if (intel) out.intelligenceId = asString(intel, 120)
  else if (params.has('intel') && params.get('intel') === '') out.intelligenceId = null
  return out
}

export function writeNavToUrl(state: NavPersistedState, mode: 'replace' | 'push' = 'replace'): void {
  patchUrlSearchParams(
    {
      view: state.page,
      intel:
        state.page === 'intelligence' && state.intelligenceId
          ? state.intelligenceId
          : null,
    },
    mode
  )
}

export function loadNavState(input: {
  workspaceId: string
  userId: string
}): NavPersistedState | null {
  const fromUrl = readNavFromUrl()
  const stored = loadWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: NAV_SURFACE,
    version: NAV_STATE_VERSION,
    validate: validateNavState,
  })
  if (!fromUrl.page && !stored) return null
  return {
    page: fromUrl.page ?? stored?.page ?? 'inbox',
    intelligenceId:
      fromUrl.intelligenceId !== undefined
        ? fromUrl.intelligenceId
        : (stored?.intelligenceId ?? null),
  }
}

export function persistNavState(input: {
  workspaceId: string
  userId: string
  state: NavPersistedState
  syncUrl?: boolean
}): void {
  saveWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: NAV_SURFACE,
    version: NAV_STATE_VERSION,
    data: input.state,
  })
  if (input.syncUrl !== false) writeNavToUrl(input.state, 'replace')
}
