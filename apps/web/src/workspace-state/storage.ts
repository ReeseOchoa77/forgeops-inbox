/**
 * Scoped, versioned browser persistence for ForgeOps workspace UI state.
 * Never store secrets, tokens, or email bodies here.
 */

export type WorkspaceStateEnvelope<T> = {
  v: number
  workspaceId: string
  userId: string
  updatedAt: number
  data: T
}

export function workspaceStateKey(input: {
  workspaceId: string
  userId: string
  surface: string
}): string {
  return `forgeops:ws:${input.workspaceId}:u:${input.userId}:${input.surface}`
}

export function loadWorkspaceState<T>(input: {
  workspaceId: string
  userId: string
  surface: string
  version: number
  validate: (raw: unknown) => T | null
}): T | null {
  if (!input.workspaceId || !input.userId) return null
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(
      workspaceStateKey({
        workspaceId: input.workspaceId,
        userId: input.userId,
        surface: input.surface,
      })
    )
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceStateEnvelope<unknown>>
    if (parsed.v !== input.version) return null
    if (parsed.workspaceId !== input.workspaceId) return null
    if (parsed.userId !== input.userId) return null
    if (parsed.data === undefined) return null
    return input.validate(parsed.data)
  } catch {
    return null
  }
}

export function saveWorkspaceState<T>(input: {
  workspaceId: string
  userId: string
  surface: string
  version: number
  data: T
}): void {
  if (!input.workspaceId || !input.userId) return
  if (typeof localStorage === 'undefined') return
  try {
    const envelope: WorkspaceStateEnvelope<T> = {
      v: input.version,
      workspaceId: input.workspaceId,
      userId: input.userId,
      updatedAt: Date.now(),
      data: input.data,
    }
    localStorage.setItem(
      workspaceStateKey({
        workspaceId: input.workspaceId,
        userId: input.userId,
        surface: input.surface,
      }),
      JSON.stringify(envelope)
    )
  } catch {
    /* quota / private mode */
  }
}

export function clearWorkspaceState(input: {
  workspaceId: string
  userId: string
  surface: string
}): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(
      workspaceStateKey({
        workspaceId: input.workspaceId,
        userId: input.userId,
        surface: input.surface,
      })
    )
  } catch {
    /* ignore */
  }
}

/** Read URL query params (browser only). */
export function readUrlSearchParams(
  search = typeof window !== 'undefined' ? window.location.search : ''
): URLSearchParams {
  return new URLSearchParams(search)
}

/**
 * Patch URL query params. Null values remove keys.
 * Uses replaceState by default to avoid polluting history on filter typing.
 */
export function patchUrlSearchParams(
  patch: Record<string, string | null | undefined>,
  mode: 'replace' | 'push' = 'replace'
): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  const next = `${url.pathname}${url.search}${url.hash}`
  if (mode === 'push') window.history.pushState({}, '', next)
  else window.history.replaceState({}, '', next)
}

export function asString(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t || t.length > max) return null
  return t
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

export function asStringArray(value: unknown, maxItems = 50, maxLen = 120): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (!t || t.length > maxLen) continue
    out.push(t)
    if (out.length >= maxItems) break
  }
  return out
}
