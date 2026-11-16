import { describe, expect, it } from 'vitest'
import {
  canRunModelSelection,
  defaultModelSelection,
  modelSelectionFromLegacyEvalMode,
} from './components/JobMatcherModelSelectionPanel'

describe('Job Matcher model selection', () => {
  it('defaults to single production V2', () => {
    const s = defaultModelSelection()
    expect(s.mode).toBe('SINGLE')
    expect(s.selectedPolicyIds).toEqual(['CONTEXT_AWARE_V2'])
    expect(canRunModelSelection(s)).toBe(true)
  })

  it('requires at least two models for compare', () => {
    expect(
      canRunModelSelection({
        mode: 'COMPARE',
        selectedPolicyIds: ['CONTEXT_AWARE_V2'],
      })
    ).toBe(false)
    expect(
      canRunModelSelection({
        mode: 'COMPARE',
        selectedPolicyIds: ['CONTEXT_AWARE_V2', 'CONTEXT_AWARE_V2_2'],
      })
    ).toBe(true)
  })

  it('maps legacy COMPARE_ALL onto all evaluation-selectable policies', () => {
    const s = modelSelectionFromLegacyEvalMode('COMPARE_ALL')
    expect(s.mode).toBe('COMPARE')
    expect(s.selectedPolicyIds).toEqual([
      'CONTEXT_AWARE_V2',
      'CONTEXT_AWARE_V2_1',
      'CONTEXT_AWARE_V2_2',
      'CONTEXT_AWARE_V2_3',
      'CONTEXT_AWARE_V2_4',
    ])
  })
})
