import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  api,
  type JobMilestone,
  type JobMilestoneStatus,
  type JobMilestoneType,
  type JobScheduleSummary,
  type JobWorkPackage,
} from '../api'
import { formatOverviewDate } from '../job-overview-format'
import {
  JobTabLoadError,
  JobTabLoading,
  jobTabShouldShowLoadError,
} from '../job-tab-async-state'
import { useLatestRef } from '../use-latest-ref'
import {
  JobConfirmDialog,
  JobCrmField,
  JobCrmModal,
  JobCrmPrimaryButton,
  JobCrmSecondaryButton,
  jobCrmInputStyle,
} from '../components/JobCrmModal'

const TYPE_OPTIONS: Array<{ value: JobMilestoneType; label: string }> = [
  { value: 'GENERAL', label: 'General' },
  { value: 'SHOP_DRAWINGS', label: 'Shop drawings' },
  { value: 'SUBMITTAL', label: 'Submittal' },
  { value: 'APPROVAL', label: 'Approval' },
  { value: 'FIELD_MEASURE', label: 'Field measure' },
  { value: 'MATERIAL_REQUIRED', label: 'Material required' },
  { value: 'MATERIAL_ORDERED', label: 'Material ordered' },
  { value: 'MATERIAL_EXPECTED', label: 'Material expected' },
  { value: 'FABRICATION_START', label: 'Fabrication start' },
  { value: 'FABRICATION_COMPLETE', label: 'Fabrication complete' },
  { value: 'READY_TO_SHIP', label: 'Ready to ship' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'INSTALLATION_START', label: 'Installation start' },
  { value: 'INSTALLATION_COMPLETE', label: 'Installation complete' },
  { value: 'PROJECT_COMPLETE', label: 'Project complete' },
]

type StatusFilter = 'ALL' | 'OPEN' | 'OVERDUE' | 'COMPLETE'

type Props = {
  workspaceId: string
  jobId: string
  canEdit: boolean
  isPhone: boolean
  onSummaryChange?: (summary: JobScheduleSummary) => void
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildSummary(milestones: JobMilestone[]): JobScheduleSummary {
  const open = milestones.filter((m) => m.status === 'OPEN')
  const overdue = open
    .filter((m) => m.overdue && m.plannedDate)
    .map((m) => ({
      id: m.id,
      name: m.name,
      typeLabel: m.typeLabel,
      plannedDate: m.plannedDate!,
      workPackageName: m.workPackageName,
      daysOverdue: m.daysOverdue ?? 0,
    }))
  const upcoming = open
    .filter((m) => m.plannedDate && !m.overdue)
    .map((m) => ({
      id: m.id,
      name: m.name,
      typeLabel: m.typeLabel,
      plannedDate: m.plannedDate!,
      workPackageName: m.workPackageName,
    }))
  return {
    upcoming: upcoming.slice(0, 5),
    overdue: overdue.slice(0, 5),
    upcomingCount: upcoming.length,
    overdueCount: overdue.length,
    undatedOpenCount: open.filter((m) => !m.plannedDate).length,
  }
}

export function JobScheduleView({
  workspaceId,
  jobId,
  canEdit,
  isPhone,
  onSummaryChange,
}: Props) {
  const [milestones, setMilestones] = useState<JobMilestone[]>([])
  const [packages, setPackages] = useState<JobWorkPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [packageFilter, setPackageFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [draftType, setDraftType] = useState<JobMilestoneType>('GENERAL')
  const [draftName, setDraftName] = useState('')
  const [draftDate, setDraftDate] = useState('')
  const [draftPackageId, setDraftPackageId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [completeTarget, setCompleteTarget] = useState<JobMilestone | null>(null)
  const [completeDate, setCompleteDate] = useState(todayYmd())
  const [confirmAction, setConfirmAction] = useState<
    { type: 'cancel' | 'delete'; milestone: JobMilestone } | null
  >(null)

  const onSummaryChangeRef = useLatestRef(onSummaryChange)

  const apply = useCallback((list: JobMilestone[]) => {
    setMilestones(list)
    onSummaryChangeRef.current?.(buildSummary(list))
  }, [onSummaryChangeRef])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ms, scope] = await Promise.all([
        api.getJobMilestones(workspaceId, jobId),
        api.getJobScope(workspaceId, jobId),
      ])
      apply(ms.milestones)
      setPackages(scope.packages)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId, apply])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    return milestones.filter((m) => {
      if (packageFilter === '__job__') {
        if (m.workPackageId) return false
      } else if (packageFilter && m.workPackageId !== packageFilter) {
        return false
      }
      if (statusFilter === 'OPEN') return m.status === 'OPEN' && !m.overdue
      if (statusFilter === 'OVERDUE') return m.overdue
      if (statusFilter === 'COMPLETE') return m.status === 'COMPLETE'
      return true
    })
  }, [milestones, statusFilter, packageFilter])

  const upcoming = filtered.filter((m) => m.status === 'OPEN' && !m.overdue)
  const overdue = filtered.filter((m) => m.overdue)
  const undated = filtered.filter((m) => m.status === 'OPEN' && !m.plannedDate)
  const completed = filtered.filter((m) => m.status === 'COMPLETE')
  const cancelled = filtered.filter((m) => m.status === 'CANCELLED')

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.createJobMilestone(workspaceId, jobId, {
        type: draftType,
        name: draftName.trim() || null,
        plannedDate: draftDate || null,
        workPackageId: draftPackageId || null,
      })
      apply(res.milestones)
      setAdding(false)
      setDraftName('')
      setDraftDate('')
      setDraftPackageId('')
      setDraftType('GENERAL')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create milestone')
    } finally {
      setBusy(false)
    }
  }

  const openComplete = (m: JobMilestone) => {
    setCompleteDate(todayYmd())
    setCompleteTarget(m)
  }

  const submitComplete = async () => {
    if (!completeTarget) return
    const actual = completeDate.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(actual)) {
      setError('Actual date must be YYYY-MM-DD')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.updateJobMilestone(workspaceId, jobId, completeTarget.id, {
        status: 'COMPLETE',
        actualDate: actual,
      })
      apply(res.milestones)
      setCompleteTarget(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete milestone')
    } finally {
      setBusy(false)
    }
  }

  const reopen = async (m: JobMilestone) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.updateJobMilestone(workspaceId, jobId, m.id, { status: 'OPEN' })
      apply(res.milestones)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reopen milestone')
    } finally {
      setBusy(false)
    }
  }

  const runConfirmAction = async () => {
    if (!confirmAction) return
    const { type, milestone: m } = confirmAction
    setBusy(true)
    setError(null)
    try {
      const res =
        type === 'cancel'
          ? await api.updateJobMilestone(workspaceId, jobId, m.id, { status: 'CANCELLED' })
          : await api.deleteJobMilestone(workspaceId, jobId, m.id)
      apply(res.milestones)
      setConfirmAction(null)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : type === 'cancel'
            ? 'Failed to cancel milestone'
            : 'Failed to delete milestone'
      )
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (m: JobMilestone, patch: {
    name?: string
    plannedDate?: string | null
    workPackageId?: string | null
    type?: JobMilestoneType
  }) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.updateJobMilestone(workspaceId, jobId, m.id, patch)
      apply(res.milestones)
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update milestone')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <JobTabLoading label="Loading schedule…" />
  }

  if (jobTabShouldShowLoadError(loading, error, milestones.length > 0)) {
    return <JobTabLoadError message={error!} onRetry={() => void load()} />
  }

  const chip = (key: StatusFilter, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setStatusFilter(key)}
      style={{
        fontSize: 11,
        fontWeight: statusFilter === key ? 700 : 500,
        padding: '4px 10px',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        background: statusFilter === key ? '#1a1a2e' : '#fff',
        color: statusFilter === key ? '#fff' : '#374151',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {chip('ALL', 'All')}
        {chip('OPEN', 'Open')}
        {chip('OVERDUE', 'Overdue')}
        {chip('COMPLETE', 'Complete')}
        <select
          value={packageFilter}
          onChange={(e) => setPackageFilter(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d0d5dd' }}
        >
          <option value="">All packages</option>
          <option value="__job__">Job-level only</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding((v) => !v)}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: '1px solid #1a1a2e', background: '#1a1a2e', color: '#fff', cursor: 'pointer',
            }}
          >
            {adding ? 'Cancel' : '+ Milestone'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: '#fce4ec', color: '#c62828', fontSize: 13 }}>
          {error}
        </div>
      )}

      {adding && (
        <div style={{ marginBottom: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as JobMilestoneType)}
              style={{ padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12 }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Name (optional for typed milestones)"
              style={{ flex: 1, minWidth: 140, padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
            />
            <input
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12 }}
            />
            <select
              value={draftPackageId}
              onChange={(e) => setDraftPackageId(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12 }}
            >
              <option value="">Job-level</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              style={{
                padding: '7px 14px', borderRadius: 6, border: 'none', background: '#1565c0', color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {milestones.length === 0 && (
        <div style={{ padding: 28, textAlign: 'center', color: '#888', fontSize: 13, border: '1px dashed #e5e7eb', borderRadius: 8 }}>
          No milestones yet. Add shop drawings, field measure, fabrication, delivery, and install dates here.
        </div>
      )}

      {overdue.length > 0 && (
        <Section title="Overdue" accent="#b91c1c">
          {overdue.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              canEdit={canEdit}
              busy={busy}
              isPhone={isPhone}
              editing={editingId === m.id}
              packages={packages}
              onEdit={() => setEditingId(m.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(patch) => void saveEdit(m, patch)}
              onComplete={() => openComplete(m)}
              onReopen={() => void reopen(m)}
              onCancel={() => setConfirmAction({ type: 'cancel', milestone: m })}
              onDelete={() => setConfirmAction({ type: 'delete', milestone: m })}
            />
          ))}
        </Section>
      )}

      {(statusFilter === 'ALL' || statusFilter === 'OPEN') && (
        <>
          <Section title="Upcoming">
            {upcoming.filter((m) => m.plannedDate).length === 0 ? (
              <div style={{ fontSize: 12, color: '#9ca3af', padding: '4px 0 8px' }}>No upcoming dated milestones</div>
            ) : (
              upcoming.filter((m) => m.plannedDate).map((m) => (
                <MilestoneRow
                  key={m.id}
                  milestone={m}
                  canEdit={canEdit}
                  busy={busy}
                  isPhone={isPhone}
                  editing={editingId === m.id}
                  packages={packages}
                  onEdit={() => setEditingId(m.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(patch) => void saveEdit(m, patch)}
                  onComplete={() => openComplete(m)}
                  onReopen={() => void reopen(m)}
                  onCancel={() => setConfirmAction({ type: 'cancel', milestone: m })}
                  onDelete={() => setConfirmAction({ type: 'delete', milestone: m })}
                />
              ))
            )}
          </Section>
          {undated.length > 0 && (
            <Section title="Date not set">
              {undated.map((m) => (
                <MilestoneRow
                  key={m.id}
                  milestone={m}
                  canEdit={canEdit}
                  busy={busy}
                  isPhone={isPhone}
                  editing={editingId === m.id}
                  packages={packages}
                  onEdit={() => setEditingId(m.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(patch) => void saveEdit(m, patch)}
                  onComplete={() => openComplete(m)}
                  onReopen={() => void reopen(m)}
                  onCancel={() => setConfirmAction({ type: 'cancel', milestone: m })}
                  onDelete={() => setConfirmAction({ type: 'delete', milestone: m })}
                />
              ))}
            </Section>
          )}
        </>
      )}

      {(statusFilter === 'ALL' || statusFilter === 'COMPLETE') && completed.length > 0 && (
        <Section title="Completed">
          {completed.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              canEdit={canEdit}
              busy={busy}
              isPhone={isPhone}
              editing={editingId === m.id}
              packages={packages}
              onEdit={() => setEditingId(m.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(patch) => void saveEdit(m, patch)}
              onComplete={() => openComplete(m)}
              onReopen={() => void reopen(m)}
              onCancel={() => setConfirmAction({ type: 'cancel', milestone: m })}
              onDelete={() => setConfirmAction({ type: 'delete', milestone: m })}
            />
          ))}
        </Section>
      )}

      {statusFilter === 'ALL' && cancelled.length > 0 && (
        <Section title="Cancelled">
          {cancelled.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              canEdit={canEdit}
              busy={busy}
              isPhone={isPhone}
              editing={editingId === m.id}
              packages={packages}
              onEdit={() => setEditingId(m.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(patch) => void saveEdit(m, patch)}
              onComplete={() => openComplete(m)}
              onReopen={() => void reopen(m)}
              onCancel={() => setConfirmAction({ type: 'cancel', milestone: m })}
              onDelete={() => setConfirmAction({ type: 'delete', milestone: m })}
            />
          ))}
        </Section>
      )}

      <JobCrmModal
        title="Complete milestone"
        open={completeTarget != null}
        onClose={() => setCompleteTarget(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setCompleteTarget(null)} disabled={busy}>
              Cancel
            </JobCrmSecondaryButton>
            <JobCrmPrimaryButton onClick={() => void submitComplete()} disabled={busy}>
              Complete
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="Actual completion date" required hint="YYYY-MM-DD">
          <input
            type="date"
            style={jobCrmInputStyle}
            value={completeDate}
            onChange={(e) => setCompleteDate(e.target.value)}
          />
        </JobCrmField>
      </JobCrmModal>

      <JobConfirmDialog
        open={confirmAction != null}
        title={confirmAction?.type === 'delete' ? 'Delete milestone' : 'Cancel milestone'}
        message={
          confirmAction
            ? confirmAction.type === 'delete'
              ? `Delete “${confirmAction.milestone.name}”?`
              : `Cancel “${confirmAction.milestone.name}”?`
            : ''
        }
        confirmLabel={confirmAction?.type === 'delete' ? 'Delete' : 'Cancel milestone'}
        danger={confirmAction?.type === 'delete'}
        busy={busy}
        onConfirm={() => void runConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}

function Section({
  title,
  children,
  accent,
}: {
  title: string
  children: ReactNode
  accent?: string
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: accent ?? '#6b7280',
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 12px' }}>
        {children}
      </div>
    </div>
  )
}

function MilestoneRow({
  milestone: m,
  canEdit,
  busy,
  isPhone,
  editing,
  packages,
  onEdit,
  onCancelEdit,
  onSave,
  onComplete,
  onReopen,
  onCancel,
  onDelete,
}: {
  milestone: JobMilestone
  canEdit: boolean
  busy: boolean
  isPhone: boolean
  editing: boolean
  packages: JobWorkPackage[]
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (patch: {
    name?: string
    plannedDate?: string | null
    workPackageId?: string | null
    type?: JobMilestoneType
  }) => void
  onComplete: () => void
  onReopen: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(m.name)
  const [plannedDate, setPlannedDate] = useState(m.plannedDate ?? '')
  const [workPackageId, setWorkPackageId] = useState(m.workPackageId ?? '')

  useEffect(() => {
    setName(m.name)
    setPlannedDate(m.plannedDate ?? '')
    setWorkPackageId(m.workPackageId ?? '')
  }, [m])

  if (editing) {
    return (
      <div style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, minWidth: 120, padding: '5px 8px', border: '1px solid #d0d5dd', borderRadius: 4, fontSize: 12 }}
          />
          <input
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #d0d5dd', borderRadius: 4, fontSize: 12 }}
          />
          <select
            value={workPackageId}
            onChange={(e) => setWorkPackageId(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #d0d5dd', borderRadius: 4, fontSize: 12 }}
          >
            <option value="">Job-level</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => onSave({
              name: name.trim(),
              plannedDate: plannedDate || null,
              workPackageId: workPackageId || null,
            })}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#1565c0', color: '#fff', cursor: 'pointer' }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const dateLabel = m.status === 'COMPLETE' && m.actualDate
    ? formatOverviewDate(`${m.actualDate}T00:00:00.000Z`)
    : m.plannedDate
      ? formatOverviewDate(`${m.plannedDate}T00:00:00.000Z`)
      : 'Date not set'

  const statusLabel: Record<JobMilestoneStatus, string> = {
    OPEN: m.overdue ? 'Overdue' : 'Open',
    COMPLETE: 'Complete',
    CANCELLED: 'Cancelled',
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isPhone ? '1fr' : '100px 1fr auto',
      gap: isPhone ? 4 : 12,
      padding: '10px 0',
      borderBottom: '1px solid #f3f4f6',
      alignItems: 'center',
      fontSize: 13,
    }}>
      <div style={{
        fontWeight: 700,
        color: m.overdue ? '#b91c1c' : '#111',
        fontSize: 12,
      }}>
        {dateLabel}
        {m.status === 'COMPLETE' && m.plannedDate && m.actualDate && m.plannedDate !== m.actualDate && (
          <div style={{ fontWeight: 400, color: '#9ca3af', fontSize: 10 }}>
            planned {formatOverviewDate(`${m.plannedDate}T00:00:00.000Z`)}
          </div>
        )}
        {m.overdue && m.daysOverdue != null && (
          <div style={{ fontWeight: 600, color: '#b91c1c', fontSize: 10 }}>
            {m.daysOverdue}d overdue
          </div>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>
          {m.workPackageName ? `${m.workPackageName} · ` : ''}
          {m.name}
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          {m.typeLabel}
          {' · '}
          <span style={{ color: m.overdue ? '#b91c1c' : undefined, fontWeight: m.overdue ? 600 : 400 }}>
            {statusLabel[m.status]}
          </span>
        </div>
      </div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {m.status === 'OPEN' && (
            <button type="button" disabled={busy} onClick={onComplete} style={btnStyle}>Complete</button>
          )}
          {(m.status === 'COMPLETE' || m.status === 'CANCELLED') && (
            <button type="button" disabled={busy} onClick={onReopen} style={btnStyle}>Reopen</button>
          )}
          {m.status === 'OPEN' && (
            <button type="button" disabled={busy} onClick={onCancel} style={btnStyle}>Cancel</button>
          )}
          <button type="button" disabled={busy} onClick={onEdit} style={btnStyle}>Edit</button>
          <button type="button" disabled={busy} onClick={onDelete} style={{ ...btnStyle, color: '#b91c1c' }}>Delete</button>
        </div>
      )}
    </div>
  )
}

const btnStyle: CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid #d0d5dd',
  background: '#fff',
  cursor: 'pointer',
}

export function ScheduleOverviewSummary({
  summary,
  onViewSchedule,
}: {
  summary: JobScheduleSummary | null | undefined
  onViewSchedule?: () => void
}) {
  const empty = !summary || (summary.upcomingCount === 0 && summary.overdueCount === 0 && summary.undatedOpenCount === 0)
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Schedule
        </div>
        <span style={{ flex: 1 }} />
        {onViewSchedule && (
          <button
            type="button"
            onClick={onViewSchedule}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: '#1565c0', fontWeight: 600 }}
          >
            View schedule
          </button>
        )}
      </div>
      {empty ? (
        <div style={{ fontSize: 13, color: '#888' }}>No milestones yet. Manage them on the Schedule tab.</div>
      ) : (
        <>
          {summary!.overdue.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', marginBottom: 4 }}>Overdue</div>
              {summary!.overdue.map((row) => (
                <div key={row.id} style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
                  <strong style={{ color: '#b91c1c' }}>
                    {row.workPackageName ? `${row.workPackageName} · ` : ''}{row.name}
                  </strong>
                  <span style={{ color: '#6b7280' }}> — {row.daysOverdue}d overdue</span>
                </div>
              ))}
            </div>
          )}
          {summary!.upcoming.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Upcoming</div>
              {summary!.upcoming.map((row) => (
                <div key={row.id} style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
                  <strong>{formatOverviewDate(`${row.plannedDate}T00:00:00.000Z`)}</strong>
                  {' · '}
                  {row.workPackageName ? `${row.workPackageName} · ` : ''}
                  {row.name}
                </div>
              ))}
            </div>
          )}
          {summary!.undatedOpenCount > 0 && summary!.upcoming.length === 0 && summary!.overdue.length === 0 && (
            <div style={{ fontSize: 13, color: '#888' }}>
              {summary!.undatedOpenCount} open milestone{summary!.undatedOpenCount === 1 ? '' : 's'} without a date.
            </div>
          )}
        </>
      )}
    </div>
  )
}
