import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUSINESS_SUBTYPE_FILTER_OPTIONS, BUSINESS_SUBTYPE_LABELS } from '@forgeops/shared/business-subtypes'
import { businessTypeLabels } from './components/Badges'
import { SearchableFilterSelect } from './components/SearchableFilterSelect'
import { TaskListRow, TaskProvenanceLine } from './components/TaskListRow'
import { tasksListFilterFingerprint } from './tasks-list-cache'
import { TasksView } from './views/TasksView'

const here = dirname(fileURLToPath(import.meta.url))

describe('Tasks filter UX contracts', () => {
  it('fingerprint changes when filters change (cache isolation)', () => {
    const a = tasksListFilterFingerprint({ statusFilter: 'OPEN' })
    const b = tasksListFilterFingerprint({ statusFilter: 'COMPLETED' })
    const c = tasksListFilterFingerprint({
      statusFilter: 'OPEN',
      businessTypeKey: 'RFI_CLARIFICATION',
    })
    const d = tasksListFilterFingerprint({ view: 'MY' })
    const e = tasksListFilterFingerprint({ view: 'REQUESTS' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(d).not.toBe(e)
  })

  it('exports TasksView and TaskListRow components', () => {
    expect(typeof TasksView).toBe('function')
    expect(typeof TaskListRow).toBe('function')
    expect(typeof TaskProvenanceLine).toBe('function')
    expect(typeof SearchableFilterSelect).toBe('function')
  })

  it('Badges reuse shared BUSINESS_SUBTYPE_LABELS', () => {
    expect(businessTypeLabels.BID_OPPORTUNITY).toBe(
      BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY
    )
    expect(businessTypeLabels.RFI_CLARIFICATION).toBe(
      BUSINESS_SUBTYPE_LABELS.RFI_CLARIFICATION
    )
    expect(BUSINESS_SUBTYPE_FILTER_OPTIONS.length).toBeGreaterThan(10)
  })

  it('Tasks toolbar: prominent search, searchable Job/Subtype, no Incoming/Sent', () => {
    const src = readFileSync(join(here, 'views/TasksView.tsx'), 'utf8')
    expect(src).toContain('tasks-main-search')
    expect(src).toContain('Search tasks...')
    expect(src).toContain('tasks-filter-toolbar')
    expect(src).toContain('SearchableFilterSelect')
    expect(src).toContain('tasks-job-filter')
    expect(src).toContain('tasks-subtype-filter')
    expect(src).toContain('tasks-clear-filters')
    expect(src).toContain('tasks-requests-toggle')
    expect(src).not.toContain('aria-label="Email direction"')
    expect(src).not.toContain('<option value="INCOMING">Incoming</option>')
    expect(src).not.toContain('<option value="SENT">Sent</option>')
    expect(src).not.toMatch(/setDirection\s*\(/)
  })
})
