import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  calendarDateToIso,
  isoToCalendarDate,
  jobQuickEditUpdateBody,
} from './job-settings-payload'

const here = import.meta.dirname
const jobsViewSrc = readFileSync(join(here, 'views/JobsView.tsx'), 'utf8')
const payloadSrc = readFileSync(join(here, 'job-settings-payload.ts'), 'utf8')
const apiSrc = readFileSync(join(here, 'api.ts'), 'utf8')

describe('Jobs list quick edit', () => {
  it('shows Edit for editable roles and opens Edit Job modal without navigating', () => {
    expect(jobsViewSrc).toContain("const canEdit = canCreate")
    expect(jobsViewSrc).toContain('data-testid={`job-quick-edit-${job.id}`}')
    expect(jobsViewSrc).toContain('title="Edit Job"')
    expect(jobsViewSrc).toContain('openQuickEdit(job)')
    expect(jobsViewSrc).toContain('e.stopPropagation()')
    expect(jobsViewSrc).toContain('onSelectJob(job.id, job)')
    // Edit click must not call onSelectJob.
    const editBtn = jobsViewSrc.slice(
      jobsViewSrc.indexOf('const editButton = '),
      jobsViewSrc.indexOf('const renderPhoneFilters')
    )
    expect(editBtn).toContain('stopPropagation')
    expect(editBtn).toContain('openQuickEdit')
    expect(editBtn).not.toContain('onSelectJob')
  })

  it('modal loads current Job values into the form', () => {
    expect(jobsViewSrc).toContain('jobToQuickEditForm(job)')
    expect(jobsViewSrc).toContain('isoToCalendarDate(job.startDate)')
    expect(jobsViewSrc).toContain('job.customerId ?? ')
    expect(jobsViewSrc).toContain('job.jobNumber ?? ')
  })

  it('edits job number, name, status, customerId, and startDate via updateJob', () => {
    expect(jobsViewSrc).toContain('jobQuickEditUpdateBody(editForm)')
    expect(jobsViewSrc).toContain('api.updateJob(workspaceId, editingJob.id')
    expect(payloadSrc).toContain('customerId: input.customerId.trim() ? input.customerId.trim() : null')
    expect(apiSrc).toContain('updateJob:')
    expect(apiSrc).toContain('customerId?: string | null')
  })

  it('customer uses canonical FK select with clear option; no fuzzy matching', () => {
    expect(jobsViewSrc).toContain('getCustomers')
    expect(jobsViewSrc).toContain('— None —')
    expect(jobsViewSrc).toContain('editForm.customerId')
    expect(jobsViewSrc).not.toMatch(/fuzzy/i)
  })

  it('failed save keeps modal open and shows an alert', () => {
    expect(jobsViewSrc).toContain("setEditError")
    expect(jobsViewSrc).toContain('role="alert"')
    const failBlock = jobsViewSrc.slice(
      jobsViewSrc.indexOf('} catch (e) {', jobsViewSrc.indexOf('handleSaveQuickEdit')),
      jobsViewSrc.indexOf('} finally {', jobsViewSrc.indexOf('handleSaveQuickEdit'))
    )
    expect(failBlock).toContain('setEditError')
    expect(failBlock).not.toContain('setEditingJob(null)')
    expect(failBlock).toContain("JOB_NUMBER_TAKEN")
  })

  it('successful save closes modal, invalidates list cache, and refreshes', () => {
    const saveFn = jobsViewSrc.slice(
      jobsViewSrc.indexOf('const handleSaveQuickEdit'),
      jobsViewSrc.indexOf('const editButton')
    )
    expect(saveFn).toContain('setEditingJob(null)')
    expect(saveFn).toContain('invalidateJobsListCache(workspaceId)')
    expect(saveFn).toContain("loadJobs({ page: 1, append: false })")
    expect(saveFn).toContain('if (!editingJob || !editForm || savingEdit) return')
  })

  it('uses JobCrmModal Escape / outside-click close and disables close while saving', () => {
    expect(jobsViewSrc).toContain('JobCrmModal')
    expect(jobsViewSrc).toContain('closeQuickEdit')
    expect(jobsViewSrc).toContain('if (savingEdit) return')
    expect(jobsViewSrc).toContain("Saving…")
    expect(jobsViewSrc).toContain('Save Changes')
  })

  it('does not invent a second Job update architecture', () => {
    const saveFn = jobsViewSrc.slice(
      jobsViewSrc.indexOf('const handleSaveQuickEdit'),
      jobsViewSrc.indexOf('const editButton')
    )
    expect(saveFn).toContain('api.updateJob')
    expect(saveFn).not.toContain('createJob')
    expect(jobsViewSrc).not.toMatch(/patchJobQuick|quickUpdateJob/)
  })
})

describe('jobQuickEditUpdateBody / date helpers', () => {
  it('converts calendar start dates to UTC midnight ISO and clears empty dates', () => {
    expect(calendarDateToIso('2026-09-24')).toBe('2026-09-24T00:00:00.000Z')
    expect(calendarDateToIso('')).toBeNull()
    expect(isoToCalendarDate('2026-09-24T00:00:00.000Z')).toBe('2026-09-24')
    expect(isoToCalendarDate(null)).toBe('')
  })

  it('does not shift calendar dates through local Date parsing', () => {
    // Regression: new Date('YYYY-MM-DD') is local midnight and can shift the day in UTC.
    expect(calendarDateToIso('2026-01-15')).toBe('2026-01-15T00:00:00.000Z')
    expect(isoToCalendarDate('2026-01-15T00:00:00.000Z')).toBe('2026-01-15')
  })

  it('builds the canonical PUT body including clearable customer', () => {
    expect(jobQuickEditUpdateBody({
      name: '  Nova Academy  ',
      jobNumber: ' 1004 ',
      status: 'ACTIVE',
      customerId: 'cust-1',
      startDate: '2026-03-01',
    })).toEqual({
      name: 'Nova Academy',
      jobNumber: '1004',
      status: 'ACTIVE',
      customerId: 'cust-1',
      startDate: '2026-03-01T00:00:00.000Z',
    })

    expect(jobQuickEditUpdateBody({
      name: 'Nova Academy',
      jobNumber: '1004',
      status: 'ON_HOLD',
      customerId: '',
      startDate: '',
    })).toEqual({
      name: 'Nova Academy',
      jobNumber: '1004',
      status: 'ON_HOLD',
      customerId: null,
      startDate: null,
    })
  })
})
