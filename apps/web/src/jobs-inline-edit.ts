import { calendarDateToIso, isoToCalendarDate } from './job-settings-payload'
import type { JobSummary } from './api'

export type JobsInlineField = 'jobNumber' | 'name' | 'customerId' | 'startDate'

export type JobsInlineActiveCell = {
  jobId: string
  field: JobsInlineField
}

export function jobsInlineCellKey(cell: JobsInlineActiveCell): string {
  return `${cell.jobId}:${cell.field}`
}

export function isJobsInlineCell(
  active: JobsInlineActiveCell | null,
  jobId: string,
  field: JobsInlineField
): boolean {
  return Boolean(active && active.jobId === jobId && active.field === field)
}

/** Draft string for the active editor, sourced from persisted Job values. */
export function jobInlineFieldDraft(job: JobSummary, field: JobsInlineField): string {
  switch (field) {
    case 'jobNumber':
      return job.jobNumber ?? ''
    case 'name':
      return job.name
    case 'customerId':
      return job.customerId ?? ''
    case 'startDate':
      return isoToCalendarDate(job.startDate)
  }
}

export function jobInlineFieldDisplay(job: JobSummary, field: JobsInlineField): string {
  switch (field) {
    case 'jobNumber':
      return job.jobNumber?.trim() ? job.jobNumber : '—'
    case 'name':
      return job.name
    case 'customerId':
      return job.customerName?.trim() ? job.customerName : '—'
    case 'startDate':
      return job.startDate ? formatJobCalendarDate(job.startDate) : '—'
  }
}

/** Date-only Job timestamps are stored as UTC midnight — render in UTC. */
export function formatJobCalendarDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function jobInlineFieldChanged(
  job: JobSummary,
  field: JobsInlineField,
  draft: string
): boolean {
  return jobInlineFieldDraft(job, field) !== draft
}

export type JobInlineFieldUpdateBody =
  | { jobNumber: string }
  | { name: string }
  | { customerId: string | null }
  | { startDate: string | null }

/**
 * Partial PUT body for one Jobs-list field.
 * Server enforces Job-number uniqueness for current Jobs.
 */
export function buildJobInlineFieldUpdate(
  field: JobsInlineField,
  draft: string
): { ok: true; body: JobInlineFieldUpdateBody } | { ok: false; error: string } {
  switch (field) {
    case 'jobNumber': {
      const jobNumber = draft.trim()
      if (!jobNumber) return { ok: false, error: 'Job number is required.' }
      return { ok: true, body: { jobNumber } }
    }
    case 'name': {
      const name = draft.trim()
      if (!name) return { ok: false, error: 'Job name is required.' }
      return { ok: true, body: { name } }
    }
    case 'customerId':
      return {
        ok: true,
        body: { customerId: draft.trim() ? draft.trim() : null },
      }
    case 'startDate':
      return { ok: true, body: { startDate: calendarDateToIso(draft) } }
  }
}

/** Apply a successful update response onto a list-row summary. */
export function applyJobInlineUpdateToSummary(
  job: JobSummary,
  field: JobsInlineField,
  updated: {
    jobNumber?: string | null
    name?: string
    customerId?: string | null
    customerName?: string | null
    startDate?: string | null
  }
): JobSummary {
  switch (field) {
    case 'jobNumber':
      return { ...job, jobNumber: updated.jobNumber ?? null }
    case 'name':
      return { ...job, name: updated.name ?? job.name }
    case 'customerId':
      return {
        ...job,
        customerId: updated.customerId ?? null,
        customerName: updated.customerName ?? null,
      }
    case 'startDate':
      return { ...job, startDate: updated.startDate ?? null }
  }
}
