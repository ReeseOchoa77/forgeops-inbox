import {
  asString,
  asStringArray,
  clearWorkspaceState,
  loadWorkspaceState,
  patchUrlSearchParams,
  readUrlSearchParams,
  saveWorkspaceState,
} from './storage'

export const INTEL_STATE_VERSION = 1
export const INTEL_SURFACE = 'intelligence'

export type IntelligenceEvalMode =
  | 'CURRENT'
  | 'COMPARE_V1'
  | 'COMPARE_V2'
  | 'COMPARE_V2_1'
  | 'COMPARE_ALL'

export type IntelligencePersistedState = {
  tab: 'overview' | 'pipeline' | 'instructions' | 'evaluation' | 'test'
  /** Job Matcher evaluation draft / UI prefs — config only, never result bodies. */
  evalConfig: {
    jobsMode: 'ALL' | 'SPECIFIC' | 'SELECTED'
    jobIds: string[]
    sampling: 'TOTAL' | 'PER_JOB' | 'ALL_ELIGIBLE'
    count: number
    lifecycle: 'ALL' | 'CURRENT' | 'ARCHIVED'
    /** CURRENT = baseline only; COMPARE_V1 = paired shadow comparison. */
    evaluationMode: IntelligenceEvalMode
  }
  outcomeFilter:
    | 'ALL'
    | 'CORRECT_MATCH'
    | 'WRONG_MATCH'
    | 'AMBIGUOUS'
    | 'CONFLICT'
    | 'NO_MATCH'
  /** Transition filter when comparison results are present. */
  transitionFilter: string | null
  resultsView: 'emails' | 'jobs'
  selectedEmailMessageId: string | null
  inspectorTab: 'email' | 'match'
}

const TABS = new Set(['overview', 'pipeline', 'instructions', 'evaluation', 'test'])
const JOBS_MODES = new Set(['ALL', 'SPECIFIC', 'SELECTED'])
const SAMPLING = new Set(['TOTAL', 'PER_JOB', 'ALL_ELIGIBLE'])
const LIFECYCLE = new Set(['ALL', 'CURRENT', 'ARCHIVED'])
const OUTCOMES = new Set([
  'ALL',
  'CORRECT_MATCH',
  'WRONG_MATCH',
  'AMBIGUOUS',
  'CONFLICT',
  'NO_MATCH',
])
const EVAL_MODES = new Set([
  'CURRENT',
  'COMPARE_V1',
  'COMPARE_V2',
  'COMPARE_V2_1',
  'COMPARE_ALL',
])

export function validateIntelligenceState(raw: unknown): IntelligencePersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.tab !== 'string' || !TABS.has(o.tab)) return null
  if (!o.evalConfig || typeof o.evalConfig !== 'object') return null
  const ec = o.evalConfig as Record<string, unknown>
  if (typeof ec.jobsMode !== 'string' || !JOBS_MODES.has(ec.jobsMode)) return null
  const jobIds = asStringArray(ec.jobIds, 200, 80)
  if (!jobIds) return null
  if (typeof ec.sampling !== 'string' || !SAMPLING.has(ec.sampling)) return null
  if (typeof ec.count !== 'number' || !Number.isInteger(ec.count) || ec.count < 1 || ec.count > 1000) {
    return null
  }
  if (typeof ec.lifecycle !== 'string' || !LIFECYCLE.has(ec.lifecycle)) return null
  const evaluationMode =
    typeof ec.evaluationMode === 'string' && EVAL_MODES.has(ec.evaluationMode)
      ? (ec.evaluationMode as IntelligencePersistedState['evalConfig']['evaluationMode'])
      : 'CURRENT'
  if (typeof o.outcomeFilter !== 'string' || !OUTCOMES.has(o.outcomeFilter)) return null
  if (o.resultsView !== 'emails' && o.resultsView !== 'jobs') return null
  const selectedEmailMessageId =
    o.selectedEmailMessageId === null
      ? null
      : asString(o.selectedEmailMessageId, 80)
  if (o.selectedEmailMessageId != null && selectedEmailMessageId == null) return null
  if (o.inspectorTab !== 'email' && o.inspectorTab !== 'match') return null
  const transitionFilter =
    o.transitionFilter === null || o.transitionFilter === undefined
      ? null
      : asString(o.transitionFilter, 64)
  if (o.transitionFilter != null && transitionFilter == null) return null
  return {
    tab: o.tab as IntelligencePersistedState['tab'],
    evalConfig: {
      jobsMode: ec.jobsMode as IntelligencePersistedState['evalConfig']['jobsMode'],
      jobIds,
      sampling: ec.sampling as IntelligencePersistedState['evalConfig']['sampling'],
      count: ec.count,
      lifecycle: ec.lifecycle as IntelligencePersistedState['evalConfig']['lifecycle'],
      evaluationMode,
    },
    outcomeFilter: o.outcomeFilter as IntelligencePersistedState['outcomeFilter'],
    transitionFilter,
    resultsView: o.resultsView,
    selectedEmailMessageId,
    inspectorTab: o.inspectorTab,
  }
}

export const DEFAULT_INTELLIGENCE_STATE: IntelligencePersistedState = {
  tab: 'overview',
  evalConfig: {
    jobsMode: 'ALL',
    jobIds: [],
    sampling: 'TOTAL',
    count: 100,
    lifecycle: 'ALL',
    evaluationMode: 'CURRENT',
  },
  outcomeFilter: 'ALL',
  transitionFilter: null,
  resultsView: 'emails',
  selectedEmailMessageId: null,
  inspectorTab: 'email',
}

export function readIntelligenceTabFromUrl(): IntelligencePersistedState['tab'] | null {
  const tab = readUrlSearchParams().get('intelTab')
  if (tab && TABS.has(tab)) return tab as IntelligencePersistedState['tab']
  return null
}

export function writeIntelligenceTabToUrl(
  tab: IntelligencePersistedState['tab']
): void {
  patchUrlSearchParams({ intelTab: tab }, 'replace')
}

export function loadIntelligenceState(input: {
  workspaceId: string
  userId: string
}): IntelligencePersistedState | null {
  const stored = loadWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: INTEL_SURFACE,
    version: INTEL_STATE_VERSION,
    validate: validateIntelligenceState,
  })
  const urlTab = readIntelligenceTabFromUrl()
  if (!stored && !urlTab) return null
  return {
    ...(stored ?? DEFAULT_INTELLIGENCE_STATE),
    ...(urlTab ? { tab: urlTab } : {}),
  }
}

export function persistIntelligenceState(input: {
  workspaceId: string
  userId: string
  state: IntelligencePersistedState
  syncUrl?: boolean
}): void {
  // Never persist evaluation result payloads / bodies — config + UI ids only.
  saveWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: INTEL_SURFACE,
    version: INTEL_STATE_VERSION,
    data: input.state,
  })
  if (input.syncUrl !== false) writeIntelligenceTabToUrl(input.state.tab)
}

export function clearIntelligenceState(input: {
  workspaceId: string
  userId: string
}): void {
  clearWorkspaceState({
    workspaceId: input.workspaceId,
    userId: input.userId,
    surface: INTEL_SURFACE,
  })
}
