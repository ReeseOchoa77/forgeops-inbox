import { describe, expect, it } from 'vitest'
import { BUSINESS_SUBTYPE_FILTER_OPTIONS, BUSINESS_SUBTYPE_LABELS } from '@forgeops/shared/business-subtypes'
import { businessTypeLabels } from './components/Badges'
import { TaskListRow, TaskProvenanceLine } from './components/TaskListRow'
import { tasksListFilterFingerprint } from './tasks-list-cache'
import { TasksView } from './views/TasksView'

describe('Tasks filter UX contracts', () => {
  it('fingerprint changes when filters change (cache isolation)', () => {
    const a = tasksListFilterFingerprint({ statusFilter: 'OPEN' })
    const b = tasksListFilterFingerprint({ statusFilter: 'COMPLETED' })
    const c = tasksListFilterFingerprint({
      statusFilter: 'OPEN',
      businessTypeKey: 'RFI_CLARIFICATION',
    })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('exports TasksView and TaskListRow components', () => {
    expect(typeof TasksView).toBe('function')
    expect(typeof TaskListRow).toBe('function')
    expect(typeof TaskProvenanceLine).toBe('function')
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
})
