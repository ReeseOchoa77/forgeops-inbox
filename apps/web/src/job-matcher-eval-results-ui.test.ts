/**
 * Job Matcher evaluation Results UI helpers (collapse + delta wiring).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultDeltaBaseline,
  formatMetricDelta,
} from './job-matcher-eval-metric-deltas'

const panelSrc = readFileSync(
  join(__dirname, 'components/JobMatcherEvaluationPanel.tsx'),
  'utf8'
)

describe('Job Matcher evaluation Results UI', () => {
  it('9. Results section has collapse toggle with aria-expanded', () => {
    expect(panelSrc).toContain('job-matcher-results-collapse-toggle')
    expect(panelSrc).toContain('aria-expanded={!resultsCollapsed}')
    expect(panelSrc).toContain('Evaluation Results')
  })

  it('10. collapse hides results body without clearing result state', () => {
    expect(panelSrc).toContain('{!resultsCollapsed ? (')
    expect(panelSrc).toContain('job-matcher-results-split')
    // State setters for filters/model remain outside the collapsed body.
    expect(panelSrc).toContain('setOutcomeFilter')
    expect(panelSrc).toContain('selectResultTab')
  })

  it('chrome expands when Results collapsed; capped when expanded', () => {
    expect(panelSrc).toContain("flex: resultsCollapsed ? '1 1 auto' : '0 1 auto'")
    expect(panelSrc).toContain(
      "maxHeight: resultsCollapsed ? undefined : '42%'"
    )
    expect(panelSrc).toContain(
      "flex: resultsCollapsed ? '0 0 auto' : '1 1 0'"
    )
  })

  it('defaults collapsed after new evaluation finishes', () => {
    expect(panelSrc).toContain('setResultsCollapsed(true)')
  })

  it('wires delta baseline selector into multi-policy comparison', () => {
    expect(panelSrc).toContain('job-matcher-delta-baseline-select')
    expect(panelSrc).toContain('adjustedMetricsByPolicy')
    expect(panelSrc).toContain('job-matcher-deltas-not-comparable')
  })

  it('13. single-model path still renders metric cards', () => {
    expect(panelSrc).toContain('job-matcher-metric-cards')
    expect(defaultDeltaBaseline(['CONTEXT_AWARE_V2'])).toBe('CONTEXT_AWARE_V2')
    expect(formatMetricDelta(0, 'count', true)).toBe('Baseline')
  })
})
