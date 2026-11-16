import {
  asString,
  asStringArray,
  clearWorkspaceState,
  loadWorkspaceState,
  patchUrlSearchParams,
  readUrlSearchParams,
  saveWorkspaceState,
} from './storage'
import {
  defaultSubForSection,
  isValidSubForSection,
  type IntelligenceControlSection,
  type IntelligenceControlSub,
} from '../intelligence-control-center'

export const INTEL_STATE_VERSION = 1
export const INTEL_SURFACE = 'intelligence'

export type IntelligenceEvalMode =
  | 'CURRENT'
  | 'COMPARE_V1'
  | 'COMPARE_V2'
  | 'COMPARE_V2_1'
  | 'COMPARE_V2_2'
  | 'COMPARE_ALL'

export type IntelligenceModelSelectionMode = 'SINGLE' | 'COMPARE'

export type { IntelligenceControlSection, IntelligenceControlSub }

export type IntelligencePersistedState = {
  tab: 'overview' | 'pipeline' | 'instructions' | 'evaluation' | 'test'
  /** Control Center primary section (Overview / Email / Job Matcher / …). */
  controlSection: IntelligenceControlSection
  /** Section subsection (e.g. evaluations); null on Overview. */
  controlSub: IntelligenceControlSub | null
  /** Job Matcher evaluation draft / UI prefs — config only, never result bodies. */
  evalConfig: {
    jobsMode: 'ALL' | 'SPECIFIC' | 'SELECTED'
    jobIds: string[]
    sampling: 'TOTAL' | 'PER_JOB' | 'ALL_ELIGIBLE'
    count: number
    lifecycle: 'ALL' | 'CURRENT' | 'ARCHIVED'
    /**
     * Legacy dropdown mode — kept for older session restores.
     * Prefer modelSelectionMode + selectedPolicyIds.
     */
    evaluationMode: IntelligenceEvalMode
    modelSelectionMode?: IntelligenceModelSelectionMode
    selectedPolicyIds?: string[]
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
  /** Job Matcher Results pane collapsed (emails/jobs/diagnostics + inspector). */
  resultsCollapsed?: boolean
}

const TABS = new Set(['overview', 'pipeline', 'instructions', 'evaluation', 'test'])
const CONTROL_SECTIONS = new Set([
  'overview',
  'email-classification',
  'job-matcher',
  'document-intelligence',
  'workflow-intelligence',
])
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
  'COMPARE_V2_2',
  'COMPARE_ALL',
])

function parseControlSection(raw: unknown): IntelligenceControlSection {
  if (typeof raw === 'string' && CONTROL_SECTIONS.has(raw)) {
    return raw as IntelligenceControlSection
  }
  return 'overview'
}

function parseControlSub(
  section: IntelligenceControlSection,
  raw: unknown
): IntelligenceControlSub | null {
  if (section === 'overview') return null
  if (typeof raw === 'string' && isValidSubForSection(section, raw)) {
    return raw as IntelligenceControlSub
  }
  return defaultSubForSection(section)
}

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
  const modelSelectionMode =
    ec.modelSelectionMode === 'SINGLE' || ec.modelSelectionMode === 'COMPARE'
      ? ec.modelSelectionMode
      : undefined
  const selectedPolicyIds = Array.isArray(ec.selectedPolicyIds)
    ? (ec.selectedPolicyIds as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64)
        .slice(0, 8)
    : undefined
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
  const controlSection = parseControlSection(o.controlSection)
  const controlSub = parseControlSub(controlSection, o.controlSub)
  const resultsCollapsed =
    typeof o.resultsCollapsed === 'boolean' ? o.resultsCollapsed : undefined
  return {
    tab: o.tab as IntelligencePersistedState['tab'],
    controlSection,
    controlSub,
    evalConfig: {
      jobsMode: ec.jobsMode as IntelligencePersistedState['evalConfig']['jobsMode'],
      jobIds,
      sampling: ec.sampling as IntelligencePersistedState['evalConfig']['sampling'],
      count: ec.count,
      lifecycle: ec.lifecycle as IntelligencePersistedState['evalConfig']['lifecycle'],
      evaluationMode,
      ...(modelSelectionMode ? { modelSelectionMode } : {}),
      ...(selectedPolicyIds && selectedPolicyIds.length > 0
        ? { selectedPolicyIds }
        : {}),
    },
    outcomeFilter: o.outcomeFilter as IntelligencePersistedState['outcomeFilter'],
    transitionFilter,
    resultsView: o.resultsView,
    selectedEmailMessageId,
    inspectorTab: o.inspectorTab,
    ...(resultsCollapsed !== undefined ? { resultsCollapsed } : {}),
  }
}

export const DEFAULT_INTELLIGENCE_STATE: IntelligencePersistedState = {
  tab: 'overview',
  controlSection: 'overview',
  controlSub: null,
  evalConfig: {
    jobsMode: 'ALL',
    jobIds: [],
    sampling: 'TOTAL',
    count: 100,
    lifecycle: 'ALL',
    evaluationMode: 'CURRENT',
    modelSelectionMode: 'SINGLE',
    selectedPolicyIds: ['CONTEXT_AWARE_V2'],
  },
  outcomeFilter: 'ALL',
  transitionFilter: null,
  resultsView: 'emails',
  selectedEmailMessageId: null,
  inspectorTab: 'email',
  resultsCollapsed: true,
}

export function readIntelligenceTabFromUrl(): IntelligencePersistedState['tab'] | null {
  const tab = readUrlSearchParams().get('intelTab')
  if (tab && TABS.has(tab)) return tab as IntelligencePersistedState['tab']
  return null
}

export function readIntelligenceControlFromUrl(): {
  controlSection?: IntelligenceControlSection
  controlSub?: IntelligenceControlSub | null
} {
  const params = readUrlSearchParams()
  const sectionRaw = params.get('intelSection')
  if (!sectionRaw || !CONTROL_SECTIONS.has(sectionRaw)) return {}
  const controlSection = sectionRaw as IntelligenceControlSection
  const subRaw = params.get('intelSub')
  if (controlSection === 'overview') {
    return { controlSection, controlSub: null }
  }
  if (subRaw && isValidSubForSection(controlSection, subRaw)) {
    return { controlSection, controlSub: subRaw as IntelligenceControlSub }
  }
  return { controlSection, controlSub: defaultSubForSection(controlSection) }
}

export function writeIntelligenceTabToUrl(
  tab: IntelligencePersistedState['tab']
): void {
  patchUrlSearchParams({ intelTab: tab }, 'replace')
}

export function writeIntelligenceControlToUrl(input: {
  controlSection: IntelligenceControlSection
  controlSub: IntelligenceControlSub | null
}): void {
  patchUrlSearchParams(
    {
      intelSection: input.controlSection,
      intelSub: input.controlSub ?? '',
    },
    'replace'
  )
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
  const urlControl = readIntelligenceControlFromUrl()
  if (!stored && !urlTab && !urlControl.controlSection) return null
  return {
    ...(stored ?? DEFAULT_INTELLIGENCE_STATE),
    ...(urlTab ? { tab: urlTab } : {}),
    ...(urlControl.controlSection
      ? {
          controlSection: urlControl.controlSection,
          controlSub:
            urlControl.controlSub !== undefined
              ? urlControl.controlSub
              : defaultSubForSection(urlControl.controlSection),
        }
      : {}),
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
  if (input.syncUrl !== false) {
    writeIntelligenceTabToUrl(input.state.tab)
    writeIntelligenceControlToUrl({
      controlSection: input.state.controlSection,
      controlSub: input.state.controlSub,
    })
  }
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
