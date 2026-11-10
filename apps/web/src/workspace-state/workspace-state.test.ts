import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearInboxState,
  clearWorkspaceState,
  DEFAULT_INBOX_STATE,
  DEFAULT_INTELLIGENCE_STATE,
  loadInboxState,
  loadIntelligenceState,
  loadJobsState,
  loadNavState,
  loadWorkspaceState,
  persistInboxState,
  persistIntelligenceState,
  persistJobsState,
  persistNavState,
  saveWorkspaceState,
  validateInboxState,
  validateIntelligenceState,
  validateJobsState,
  workspaceStateKey,
} from './index'

const WS_A = 'ws_a'
const WS_B = 'ws_b'
const USER_1 = 'user_1'
const USER_2 = 'user_2'

function installMemoryStorage() {
  const store = new Map<string, string>()
  const memory: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: memory,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: { href: 'http://localhost/', search: '', pathname: '/', hash: '' },
      history: {
        replaceState: (_s: unknown, _t: string, url?: string) => {
          if (!url) return
          const parsed = new URL(url, 'http://localhost')
          window.location.pathname = parsed.pathname
          window.location.search = parsed.search
          window.location.hash = parsed.hash
          window.location.href = parsed.toString()
        },
        pushState: (_s: unknown, _t: string, url?: string) => {
          window.history.replaceState(_s, _t, url)
        },
      },
    },
    configurable: true,
  })
}

beforeEach(() => {
  installMemoryStorage()
})

afterEach(() => {
  localStorage.clear()
})

describe('workspace-state storage', () => {
  it('persists and restores versioned envelope', () => {
    saveWorkspaceState({
      workspaceId: WS_A,
      userId: USER_1,
      surface: 'demo',
      version: 1,
      data: { ok: true },
    })
    const loaded = loadWorkspaceState({
      workspaceId: WS_A,
      userId: USER_1,
      surface: 'demo',
      version: 1,
      validate: (raw) =>
        raw && typeof raw === 'object' && (raw as { ok?: boolean }).ok === true
          ? (raw as { ok: true })
          : null,
    })
    expect(loaded).toEqual({ ok: true })
  })

  it('rejects schema version mismatch safely', () => {
    saveWorkspaceState({
      workspaceId: WS_A,
      userId: USER_1,
      surface: 'demo',
      version: 1,
      data: { ok: true },
    })
    const loaded = loadWorkspaceState({
      workspaceId: WS_A,
      userId: USER_1,
      surface: 'demo',
      version: 2,
      validate: () => ({ ok: true }),
    })
    expect(loaded).toBeNull()
  })

  it('scopes keys by workspace and user', () => {
    expect(
      workspaceStateKey({ workspaceId: WS_A, userId: USER_1, surface: 'inbox-filters' })
    ).not.toBe(
      workspaceStateKey({ workspaceId: WS_B, userId: USER_1, surface: 'inbox-filters' })
    )
    expect(
      workspaceStateKey({ workspaceId: WS_A, userId: USER_1, surface: 'inbox-filters' })
    ).not.toBe(
      workspaceStateKey({ workspaceId: WS_A, userId: USER_2, surface: 'inbox-filters' })
    )
  })

  it('does not leak workspace A filters into workspace B', () => {
    persistJobsState({
      workspaceId: WS_A,
      userId: USER_1,
      state: {
        search: 'Beltline',
        statusFilter: 'ACTIVE',
        customerFilter: 'job_abc',
        assignedUserFilter: '',
        hasOverdueTasks: false,
        showArchived: false,
        sortBy: 'createdAt',
        sortDir: 'desc',
      },
    })
    expect(loadJobsState({ workspaceId: WS_B, userId: USER_1 })).toBeNull()
  })

  it('clear removes persisted surface state', () => {
    persistInboxState({
      workspaceId: WS_A,
      userId: USER_1,
      state: { ...DEFAULT_INBOX_STATE, jobFilter: 'job_1' },
    })
    clearInboxState({ workspaceId: WS_A, userId: USER_1 })
    expect(loadInboxState({ workspaceId: WS_A, userId: USER_1 })).toBeNull()
  })
})

describe('inbox persistence', () => {
  it('restores category, jobs filter, subtype, priority, search, participants', () => {
    const state = {
      inboxTab: 'BIDS_ESTIMATING',
      readFilter: 'unread',
      pinnedOnly: true,
      priorityKeys: ['HIGH'],
      jobFilter: 'job_2417',
      businessTypeKey: 'BID_OPPORTUNITY',
      search: 'from:acme',
      dateRange: 'WEEK',
      participantEmails: ['a@example.com'],
    }
    persistInboxState({ workspaceId: WS_A, userId: USER_1, state })
    expect(loadInboxState({ workspaceId: WS_A, userId: USER_1 })).toEqual(state)
  })

  it('rejects hidden Unclassified tab / key', () => {
    expect(validateInboxState({ ...DEFAULT_INBOX_STATE, inboxTab: 'UNCLASSIFIED' })).toBeNull()
    expect(
      validateInboxState({ ...DEFAULT_INBOX_STATE, businessTypeKey: 'UNCLASSIFIED' })
    ).toBeNull()
  })

  it('rejects invalid persisted values', () => {
    expect(validateInboxState({ ...DEFAULT_INBOX_STATE, readFilter: 'bogus' })).toBeNull()
    expect(validateInboxState({ ...DEFAULT_INBOX_STATE, dateRange: 'YEAR' })).toBeNull()
  })
})

describe('jobs persistence', () => {
  it('restores list filters', () => {
    const state = {
      search: '2417',
      statusFilter: 'ACTIVE',
      customerFilter: 'cust_1',
      assignedUserFilter: 'user_9',
      hasOverdueTasks: true,
      showArchived: true,
      sortBy: 'name',
      sortDir: 'asc' as const,
    }
    persistJobsState({ workspaceId: WS_A, userId: USER_1, state })
    expect(loadJobsState({ workspaceId: WS_A, userId: USER_1 })).toEqual(state)
  })

  it('rejects invalid sortDir', () => {
    expect(
      validateJobsState({
        search: '',
        statusFilter: 'ALL',
        customerFilter: '',
        assignedUserFilter: '',
        hasOverdueTasks: false,
        showArchived: false,
        sortBy: 'createdAt',
        sortDir: 'sideways',
      })
    ).toBeNull()
  })
})

describe('URL precedence for nav / intelligence', () => {
  it('explicit URL view overrides persisted page', () => {
    persistNavState({
      workspaceId: WS_A,
      userId: USER_1,
      state: { page: 'jobs', intelligenceId: null },
      syncUrl: false,
    })
    window.history.replaceState({}, '', '/?view=inbox')
    const restored = loadNavState({ workspaceId: WS_A, userId: USER_1 })
    expect(restored?.page).toBe('inbox')
  })

  it('explicit intelTab overrides persisted intelligence tab', () => {
    persistIntelligenceState({
      workspaceId: WS_A,
      userId: USER_1,
      state: { ...DEFAULT_INTELLIGENCE_STATE, tab: 'overview' },
      syncUrl: false,
    })
    window.history.replaceState({}, '', '/?intelTab=evaluation')
    const restored = loadIntelligenceState({ workspaceId: WS_A, userId: USER_1 })
    expect(restored?.tab).toBe('evaluation')
  })

  it('restores Job Matcher evaluation configuration', () => {
    const state = {
      ...DEFAULT_INTELLIGENCE_STATE,
      tab: 'evaluation' as const,
      evalConfig: {
        jobsMode: 'SPECIFIC' as const,
        jobIds: ['job_beltline'],
        sampling: 'TOTAL' as const,
        count: 50,
        lifecycle: 'CURRENT' as const,
      },
      outcomeFilter: 'WRONG_MATCH' as const,
      resultsView: 'jobs' as const,
      selectedEmailMessageId: 'msg_1',
      inspectorTab: 'match' as const,
    }
    persistIntelligenceState({
      workspaceId: WS_A,
      userId: USER_1,
      state,
      syncUrl: false,
    })
    expect(loadIntelligenceState({ workspaceId: WS_A, userId: USER_1 })).toMatchObject(state)
  })

  it('rejects invalid intelligence payload', () => {
    expect(
      validateIntelligenceState({
        ...DEFAULT_INTELLIGENCE_STATE,
        evalConfig: { ...DEFAULT_INTELLIGENCE_STATE.evalConfig, count: 99999 },
      })
    ).toBeNull()
  })
})

describe('security — persistence payload', () => {
  it('intelligence validator does not accept arbitrary body fields as required state', () => {
    const raw = {
      ...DEFAULT_INTELLIGENCE_STATE,
      emailBody: '<p>secret</p>',
      accessToken: 'tok_xxx',
    }
    const validated = validateIntelligenceState(raw)
    expect(validated).not.toBeNull()
    expect(validated).not.toHaveProperty('emailBody')
    expect(validated).not.toHaveProperty('accessToken')
  })

  it('clearWorkspaceState only removes the named surface', () => {
    persistInboxState({
      workspaceId: WS_A,
      userId: USER_1,
      state: DEFAULT_INBOX_STATE,
    })
    persistJobsState({
      workspaceId: WS_A,
      userId: USER_1,
      state: {
        search: 'x',
        statusFilter: 'ALL',
        customerFilter: '',
        assignedUserFilter: '',
        hasOverdueTasks: false,
        showArchived: false,
        sortBy: 'createdAt',
        sortDir: 'desc',
      },
    })
    clearWorkspaceState({ workspaceId: WS_A, userId: USER_1, surface: 'inbox-filters' })
    expect(loadInboxState({ workspaceId: WS_A, userId: USER_1 })).toBeNull()
    expect(loadJobsState({ workspaceId: WS_A, userId: USER_1 })?.search).toBe('x')
  })
})

describe('running evaluation durability (architecture contract)', () => {
  it('does not treat a localStorage busy flag as an authoritative run', () => {
    // Contract: no surface persists running=true / fabricated progress.
    // Configuration may restore; server run identity would be required for resume.
    localStorage.setItem(
      workspaceStateKey({ workspaceId: WS_A, userId: USER_1, surface: 'intelligence' }),
      JSON.stringify({
        v: 1,
        workspaceId: WS_A,
        userId: USER_1,
        updatedAt: Date.now(),
        data: {
          ...DEFAULT_INTELLIGENCE_STATE,
          running: true,
          processed: 1420,
          total: 2474,
        },
      })
    )
    const restored = loadIntelligenceState({ workspaceId: WS_A, userId: USER_1 })
    expect(restored).not.toBeNull()
    expect(restored).not.toHaveProperty('running')
    expect(restored).not.toHaveProperty('processed')
  })
})
