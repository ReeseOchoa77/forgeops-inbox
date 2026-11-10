import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  intelligenceStatusLabel,
  intelligenceTypeLabel,
  instructionsTabLabel,
  mapIntelligenceCards,
  showInstructionsSection,
  showRulesSection,
} from './intelligence-display'
import { IntelligencePipelineView } from './components/IntelligencePipeline'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const here = dirname(fileURLToPath(import.meta.url))

describe('intelligence type/status badges', () => {
  it('renders AI_LLM, DETERMINISTIC, HYBRID labels', () => {
    expect(intelligenceTypeLabel('AI_LLM')).toBe('AI / LLM')
    expect(intelligenceTypeLabel('DETERMINISTIC')).toBe('Deterministic')
    expect(intelligenceTypeLabel('HYBRID')).toBe('Hybrid')
  })

  it('renders statuses with spaces', () => {
    expect(intelligenceStatusLabel('ACTIVE')).toBe('ACTIVE')
    expect(intelligenceStatusLabel('FEATURE_GATED')).toBe('FEATURE GATED')
    expect(intelligenceStatusLabel('EVALUATION_ONLY')).toBe('EVALUATION ONLY')
  })
})

describe('intelligence discovery rendering', () => {
  it('maps registered components generically without hard-coded ids', () => {
    const future = { id: 'future-widget', name: 'Future Widget' }
    const cards = mapIntelligenceCards([
      { id: 'job-matcher', name: 'Job Matcher' },
      future,
    ])
    expect(cards.map((c) => c.id)).toEqual(['job-matcher', 'future-widget'])
    expect(cards.find((c) => c.id === 'future-widget')?.name).toBe('Future Widget')
  })

  it('IntelligenceView maps API components via .map (no per-system render helpers)', () => {
    const src = readFileSync(join(here, 'views/IntelligenceView.tsx'), 'utf8')
    expect(src).toContain('components.map((c) =>')
    expect(src).not.toMatch(/renderJobMatcher\s*\(/)
    expect(src).not.toMatch(/renderEmailClassifier\s*\(/)
    expect(src).toMatch(/\.listIntelligence\s*\(/)
    expect(src).toContain('No intelligence systems are currently registered.')
  })

  it('App wires Intelligence under Manage with ADMIN minRole', () => {
    const src = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(src).toContain("page: 'intelligence'")
    expect(src).toContain("label: 'Intelligence'")
    expect(src).toContain("section: 'Manage'")
    expect(src).toMatch(/page: 'intelligence'[\s\S]*?minRole: 'ADMIN'/)
    expect(src).toContain('<IntelligenceView')
  })

  it('detail opens by stable registry id, not display name', () => {
    const src = readFileSync(join(here, 'views/IntelligenceView.tsx'), 'utf8')
    expect(src).toContain('onOpen(c.id)')
    expect(src).toMatch(/\.getIntelligence\s*\(\s*workspaceId,\s*intelligenceId\s*\)/)
    expect(src).toContain('Intelligence not found')
  })
})

describe('instructions vs rules sections', () => {
  it('deterministic shows Rules; AI shows Instructions; hybrid both', () => {
    expect(showRulesSection('DETERMINISTIC')).toBe(true)
    expect(showInstructionsSection('DETERMINISTIC')).toBe(false)
    expect(showInstructionsSection('AI_LLM')).toBe(true)
    expect(showRulesSection('AI_LLM')).toBe(false)
    expect(showInstructionsSection('HYBRID')).toBe(true)
    expect(showRulesSection('HYBRID')).toBe(true)
    expect(instructionsTabLabel('HYBRID')).toBe('Instructions & Rules')
    expect(instructionsTabLabel('AI_LLM')).toBe('Instructions')
    expect(instructionsTabLabel('DETERMINISTIC')).toBe('Rules')
  })

  it('unsupported evaluation does not hard-code a fake Run button path for all systems', () => {
    const src = readFileSync(join(here, 'views/IntelligenceView.tsx'), 'utf8')
    expect(src).toContain('Evaluation is not available for this intelligence.')
    expect(src).toContain("component.id !== 'job-matcher'")
    expect(src).toContain('JobMatcherEvaluationPanel')
    const panel = readFileSync(join(here, 'components/JobMatcherEvaluationPanel.tsx'), 'utf8')
    expect(panel).toContain('Run Evaluation')
  })
})

describe('generic pipeline renderer', () => {
  it('consumes generic metadata (Job Matcher-shaped pipeline from data, not hard-code)', () => {
    const html = renderToStaticMarkup(
      createElement(IntelligencePipelineView, {
        nodes: [
          { id: 'in', kind: 'INPUT', label: 'Email' },
          { id: 'm1', kind: 'MARKER', label: 'Project Identity' },
          { id: 'm2', kind: 'MARKER', label: 'Active Exact Contact' },
          { id: 'm3', kind: 'MARKER', label: 'Authoritative Thread' },
          { id: 'dec', kind: 'DECISION', label: 'Decision' },
        ],
        edges: [
          { from: 'in', to: 'm1' },
          { from: 'm1', to: 'm2' },
          { from: 'm2', to: 'm3' },
          { from: 'm3', to: 'dec' },
        ],
      })
    )
    expect(html).toContain('Project Identity')
    expect(html).toContain('Active Exact Contact')
    expect(html).toContain('Authoritative Thread')
    expect(html).toContain('MARKER')
    expect(html).toContain('DECISION')
  })

  it('pipeline component has no job-matcher hard-coding', () => {
    const src = readFileSync(join(here, 'components/IntelligencePipeline.tsx'), 'utf8')
    expect(src).not.toContain('job-matcher')
    expect(src).not.toContain('Project Identity')
  })
})

describe('api client intelligence contract', () => {
  it('exposes list/detail/eval/test paths', () => {
    const src = readFileSync(join(here, 'api.ts'), 'utf8')
    expect(src).toContain('/workspaces/${workspaceId}/intelligence')
    expect(src).toContain('/intelligence/${encodeURIComponent(intelligenceId)}')
    expect(src).toContain('/intelligence/job-matcher/evaluate')
    expect(src).toContain('/intelligence/job-matcher/eval-dataset-preview')
    expect(src).toContain('/intelligence/job-matcher/emails/')
    expect(src).toContain('/intelligence/job-matcher/test-one')
  })
})

describe('job matcher evaluation UX v2', () => {
  it('loads email bodies on demand via inspector endpoint, not embedded in eval DTO type', () => {
    const apiSrc = readFileSync(join(here, 'api.ts'), 'utf8')
    expect(apiSrc).toContain('getJobMatcherEvalEmail')
    expect(apiSrc).toContain('JobMatcherEvalRow')
    // Result rows are summaries — body fields live on email detail type only.
    const rowBlock = apiSrc.slice(
      apiSrc.indexOf('export interface JobMatcherEvalRow'),
      apiSrc.indexOf('export interface JobMatcherEvalResult')
    )
    expect(rowBlock).not.toContain('bodyHtml')
    expect(rowBlock).not.toContain('bodyText')
  })

  it('evaluation panel uses SafeEmailBody and side inspector', () => {
    const src = readFileSync(join(here, 'components/JobMatcherEvaluationPanel.tsx'), 'utf8')
    expect(src).toContain('SafeEmailBody')
    expect(src).toContain('eval-email-inspector')
    expect(src).toContain('job-matcher-eval-workspace')
    expect(src).toContain('PER_JOB')
    expect(src).toContain('Emails')
    expect(src).toContain('Jobs')
    expect(src).toContain('Marker progression')
    expect(src).toContain('height: \'100%\'')
    expect(src).toContain('Read-only evaluation')
    expect(src).toContain('Match Analysis')
    expect(src).toContain('Correct / Eval')
    expect(src).toContain('Dataset summary')
    expect(src).toContain('job-matcher-dataset-summary')
    expect(src).toContain('job-matcher-metric-cards')
    expect(src).toContain('No-match rate')
    expect(src).toContain('Ambiguity')
  })


  it('evaluation workspace fills height without max-width bottleneck', () => {
    const panel = readFileSync(join(here, 'components/JobMatcherEvaluationPanel.tsx'), 'utf8')
    expect(panel).not.toMatch(/maxWidth:\s*640/)
    expect(panel).not.toMatch(/maxWidth:\s*720/)
    expect(panel).not.toMatch(/maxWidth:\s*900/)
    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(app).toMatch(/page === 'intelligence'[\s\S]*?overflow: 'hidden'/)
  })

  it('SafeEmailBody uses DOMPurify sanitize', () => {
    const src = readFileSync(join(here, 'components/SafeEmailBody.tsx'), 'utf8')
    expect(src).toContain('DOMPurify.sanitize')
  })
})
