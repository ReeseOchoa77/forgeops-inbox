import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyJobInlineUpdateToSummary,
  buildJobInlineFieldUpdate,
  formatJobCalendarDate,
  isJobsInlineCell,
  jobInlineFieldChanged,
  jobInlineFieldDisplay,
  jobInlineFieldDraft,
  jobsInlineCellKey,
} from './jobs-inline-edit'
import type { JobSummary } from './api'

const here = import.meta.dirname
const jobsViewSrc = readFileSync(join(here, 'views/JobsView.tsx'), 'utf8')
const cellSrc = readFileSync(join(here, 'components/JobsInlineField.tsx'), 'utf8')
const apiSrc = readFileSync(join(here, 'api.ts'), 'utf8')

const sampleJob: JobSummary = {
  id: 'job-1',
  jobNumber: '1001',
  name: 'Nova Academy',
  status: 'ACTIVE',
  customerId: 'cust-1',
  customerName: 'Acme',
  description: null,
  startDate: '2026-11-05T00:00:00.000Z',
  targetCompletionDate: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  emailCount: 0,
  openTaskCount: 0,
  overdueTaskCount: 0,
  lastActivityAt: null,
  nextDueDate: null,
  assignedMembers: [],
}

describe('Jobs page Edit mode', () => {
  it('defaults Edit mode OFF and keeps read-only row navigation', () => {
    expect(jobsViewSrc).toContain('useState(false)')
    expect(jobsViewSrc).toContain('/** Page-level Edit mode. Default OFF')
    expect(jobsViewSrc).toContain('const handleRowActivate')
    expect(jobsViewSrc).toContain('if (editMode) return')
    expect(jobsViewSrc).toContain('onSelectJob(job.id, job)')
  })

  it('shows Edit / Done Editing toggle for authorized users only', () => {
    expect(jobsViewSrc).toContain("const canEdit = canCreate")
    expect(jobsViewSrc).toContain('data-testid="jobs-edit-mode-toggle"')
    expect(jobsViewSrc).toContain('aria-pressed={editMode}')
    expect(jobsViewSrc).toContain("'Done Editing'")
    expect(jobsViewSrc).toContain("{canEdit && (")
  })

  it('suppresses row navigation while Edit mode is ON', () => {
    expect(jobsViewSrc).toContain('cursor: editMode ? \'default\' : \'pointer\'')
    expect(jobsViewSrc).toContain('handleRowActivate(job)')
    expect(jobsViewSrc).toContain('Row navigation is paused')
  })

  it('enables inline editors without a modal', () => {
    expect(jobsViewSrc).toContain('JobsInlineFieldCell')
    expect(jobsViewSrc).toContain("renderInlineField(job, 'jobNumber'")
    expect(jobsViewSrc).toContain("renderInlineField(job, 'name'")
    expect(jobsViewSrc).toContain("renderInlineField(job, 'customerId'")
    expect(jobsViewSrc).toContain("renderInlineField(job, 'startDate'")
    expect(jobsViewSrc).not.toContain('JobCrmModal')
    expect(jobsViewSrc).not.toContain('title="Edit Job"')
    expect(jobsViewSrc).not.toContain('openQuickEdit')
  })

  it('saves per field through canonical updateJob and prevents duplicates', () => {
    expect(jobsViewSrc).toContain('persistInlineField')
    expect(jobsViewSrc).toContain('api.updateJob(workspaceId, jobId, built.body)')
    expect(jobsViewSrc).toContain('if (savingCellKey) return false')
    expect(jobsViewSrc).toContain('JOB_NUMBER_TAKEN')
    expect(apiSrc).toContain('updateJob:')
  })

  it('failed save keeps the active editor and shows an alert', () => {
    expect(jobsViewSrc).toContain('setFieldError')
    expect(cellSrc).toContain('role="alert"')
    expect(jobsViewSrc).toContain('cancelActiveCell')
    const failBlock = jobsViewSrc.slice(
      jobsViewSrc.indexOf('} catch (e) {', jobsViewSrc.indexOf('persistInlineField')),
      jobsViewSrc.indexOf('} finally {', jobsViewSrc.indexOf('persistInlineField'))
    )
    expect(failBlock).toContain('setFieldError')
    expect(failBlock).not.toContain('cancelActiveCell()')
  })

  it('Enter saves and Escape cancels for text fields', () => {
    expect(cellSrc).toContain("e.key === 'Enter'")
    expect(cellSrc).toContain('onSave()')
    expect(cellSrc).toContain("e.key === 'Escape'")
    expect(cellSrc).toContain('onCancel()')
  })

  it('turning Edit mode OFF saves the active field instead of discarding', () => {
    expect(jobsViewSrc).toContain('toggleEditMode')
    expect(jobsViewSrc).toContain('thenExitEditMode: true')
    expect(jobsViewSrc).toContain('saveActiveCell({ thenExitEditMode: true })')
  })

  it('customer select supports clear and avoids fuzzy matching', () => {
    expect(jobsViewSrc).toContain('— None —')
    expect(jobsViewSrc).toContain('getCustomers')
    expect(jobsViewSrc).not.toMatch(/fuzzy/i)
  })
})

describe('jobs-inline-edit helpers', () => {
  it('builds partial PUT bodies and rejects empty required fields', () => {
    expect(buildJobInlineFieldUpdate('jobNumber', ' 1004 ')).toEqual({
      ok: true,
      body: { jobNumber: '1004' },
    })
    expect(buildJobInlineFieldUpdate('jobNumber', '  ')).toEqual({
      ok: false,
      error: 'Job number is required.',
    })
    expect(buildJobInlineFieldUpdate('name', 'Site A')).toEqual({
      ok: true,
      body: { name: 'Site A' },
    })
    expect(buildJobInlineFieldUpdate('customerId', '')).toEqual({
      ok: true,
      body: { customerId: null },
    })
    expect(buildJobInlineFieldUpdate('startDate', '2026-11-05')).toEqual({
      ok: true,
      body: { startDate: '2026-11-05T00:00:00.000Z' },
    })
    expect(buildJobInlineFieldUpdate('startDate', '')).toEqual({
      ok: true,
      body: { startDate: null },
    })
  })

  it('does not shift calendar dates across timezones', () => {
    expect(formatJobCalendarDate('2026-11-05T00:00:00.000Z')).toContain('2026')
    expect(formatJobCalendarDate('2026-11-05T00:00:00.000Z')).toMatch(/Nov/)
    expect(formatJobCalendarDate('2026-11-05T00:00:00.000Z')).toMatch(/5/)
    expect(jobInlineFieldDraft(sampleJob, 'startDate')).toBe('2026-11-05')
    expect(jobInlineFieldDisplay(sampleJob, 'startDate')).toBe(
      formatJobCalendarDate('2026-11-05T00:00:00.000Z')
    )
  })

  it('tracks active cell identity and draft changes', () => {
    expect(jobsInlineCellKey({ jobId: 'job-1', field: 'name' })).toBe('job-1:name')
    expect(isJobsInlineCell({ jobId: 'job-1', field: 'name' }, 'job-1', 'name')).toBe(true)
    expect(isJobsInlineCell({ jobId: 'job-1', field: 'name' }, 'job-1', 'jobNumber')).toBe(false)
    expect(jobInlineFieldChanged(sampleJob, 'name', 'Nova Academy')).toBe(false)
    expect(jobInlineFieldChanged(sampleJob, 'name', 'Other')).toBe(true)
    expect(jobInlineFieldDisplay({ ...sampleJob, customerName: null }, 'customerId')).toBe('—')
  })

  it('applies server updates onto list summaries', () => {
    expect(
      applyJobInlineUpdateToSummary(sampleJob, 'customerId', {
        customerId: null,
        customerName: null,
      }).customerId
    ).toBeNull()
    expect(
      applyJobInlineUpdateToSummary(sampleJob, 'jobNumber', { jobNumber: '1004' }).jobNumber
    ).toBe('1004')
  })
})
