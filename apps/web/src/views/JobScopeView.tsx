import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type JobFabricationItem,
  type JobWorkPackage,
  type JobWorkPackageStatus,
  type JobWorkPackageSummary,
} from '../api'
import { formatHoursNumber, formatOverviewDate, formatQuantity, totalEstimatedHours } from '../job-overview-format'

const STATUS_OPTIONS: Array<{ value: JobWorkPackageStatus; label: string }> = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'DETAILING', label: 'Detailing' },
  { value: 'AWAITING_APPROVAL', label: 'Awaiting approval' },
  { value: 'FIELD_MEASURE', label: 'Field measure' },
  { value: 'READY_FOR_FABRICATION', label: 'Ready for fabrication' },
  { value: 'FABRICATING', label: 'Fabricating' },
  { value: 'READY_TO_SHIP', label: 'Ready to ship' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'INSTALLING', label: 'Installing' },
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'ON_HOLD', label: 'On hold' },
]

const statusColor: Record<JobWorkPackageStatus, { bg: string; fg: string }> = {
  NOT_STARTED: { bg: '#f3f4f6', fg: '#6b7280' },
  DETAILING: { bg: '#e0e7ff', fg: '#3730a3' },
  AWAITING_APPROVAL: { bg: '#fef3c7', fg: '#92400e' },
  FIELD_MEASURE: { bg: '#ffedd5', fg: '#9a3412' },
  READY_FOR_FABRICATION: { bg: '#dbeafe', fg: '#1e40af' },
  FABRICATING: { bg: '#dbeafe', fg: '#1d4ed8' },
  READY_TO_SHIP: { bg: '#d1fae5', fg: '#065f46' },
  DELIVERED: { bg: '#dcfce7', fg: '#166534' },
  INSTALLING: { bg: '#ccfbf1', fg: '#0f766e' },
  COMPLETE: { bg: '#e5e7eb', fg: '#374151' },
  ON_HOLD: { bg: '#fee2e2', fg: '#991b1b' },
}

type Draft = { name: string; quantity: string; hours: string }
const emptyDraft = (): Draft => ({ name: '', quantity: '1', hours: '' })

type Props = {
  workspaceId: string
  jobId: string
  canEdit: boolean
  isPhone: boolean
  onEstimatedHoursChange?: (hours: number) => void
  onSummaryChange?: (summary: JobWorkPackageSummary) => void
}

export function JobScopeView({
  workspaceId,
  jobId,
  canEdit,
  isPhone,
  onEstimatedHoursChange,
  onSummaryChange,
}: Props) {
  const [packages, setPackages] = useState<JobWorkPackage[]>([])
  const [items, setItems] = useState<JobFabricationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingPackage, setAddingPackage] = useState(false)
  const [packageName, setPackageName] = useState('')
  const [packageParentId, setPackageParentId] = useState<string>('')
  const [addingItemFor, setAddingItemFor] = useState<string | 'unassigned' | null>(null)
  const [itemDraft, setItemDraft] = useState<Draft>(emptyDraft)

  const applyScope = useCallback((scope: {
    packages: JobWorkPackage[]
    items: JobFabricationItem[]
    estimatedHours: number
    summary: JobWorkPackageSummary
  }) => {
    setPackages(scope.packages)
    setItems(scope.items)
    onEstimatedHoursChange?.(scope.estimatedHours)
    onSummaryChange?.(scope.summary)
  }, [onEstimatedHoursChange, onSummaryChange])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const scope = await api.getJobScope(workspaceId, jobId)
      applyScope(scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scope')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId, applyScope])

  useEffect(() => {
    void load()
  }, [load])

  const roots = useMemo(
    () => packages.filter((p) => !p.parentId),
    [packages]
  )
  const childrenByParent = useMemo(() => {
    const map = new Map<string, JobWorkPackage[]>()
    for (const pkg of packages) {
      if (!pkg.parentId) continue
      const list = map.get(pkg.parentId) ?? []
      list.push(pkg)
      map.set(pkg.parentId, list)
    }
    return map
  }, [packages])

  const itemsByPackage = useMemo(() => {
    const map = new Map<string | null, JobFabricationItem[]>()
    for (const item of items) {
      const key = item.workPackageId ?? null
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return map
  }, [items])

  const createPackage = async () => {
    if (!packageName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.createJobWorkPackage(workspaceId, jobId, {
        name: packageName.trim(),
        parentId: packageParentId || null,
      })
      applyScope(res)
      setPackageName('')
      setPackageParentId('')
      setAddingPackage(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create package')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (packageId: string, status: JobWorkPackageStatus) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.updateJobWorkPackage(workspaceId, jobId, packageId, { status })
      applyScope(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  const renamePackage = async (pkg: JobWorkPackage) => {
    const next = window.prompt('Rename work package', pkg.name)
    if (next == null) return
    const name = next.trim()
    if (!name || name === pkg.name) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.updateJobWorkPackage(workspaceId, jobId, pkg.id, { name })
      applyScope(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename package')
    } finally {
      setBusy(false)
    }
  }

  const movePackage = async (packageId: string, direction: -1 | 1) => {
    const ordered = packages.map((p) => p.id)
    const index = ordered.indexOf(packageId)
    const swapWith = index + direction
    if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return
    const next = [...ordered]
    const tmp = next[index]!
    next[index] = next[swapWith]!
    next[swapWith] = tmp
    setBusy(true)
    setError(null)
    try {
      const res = await api.reorderJobWorkPackages(workspaceId, jobId, next)
      applyScope(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder packages')
    } finally {
      setBusy(false)
    }
  }

  const removePackage = async (pkg: JobWorkPackage) => {
    if (pkg.childCount > 0) {
      setError('Move or delete child packages first.')
      return
    }
    const msg = pkg.itemCount > 0
      ? `Delete “${pkg.name}”? ${pkg.itemCount} fabrication item(s) will become Unassigned. Packages with milestones cannot be deleted.`
      : `Delete “${pkg.name}”?`
    if (!confirm(msg)) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.deleteJobWorkPackage(workspaceId, jobId, pkg.id)
      applyScope(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete package')
    } finally {
      setBusy(false)
    }
  }

  const assignItem = async (itemId: string, workPackageId: string | null) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.assignFabricationItemWorkPackage(workspaceId, jobId, itemId, workPackageId)
      applyScope(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move item')
    } finally {
      setBusy(false)
    }
  }

  const addItem = async (workPackageId: string | null) => {
    const quantity = Number(itemDraft.quantity)
    const estimatedHoursPerPiece = Number(itemDraft.hours)
    if (!itemDraft.name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(estimatedHoursPerPiece) || estimatedHoursPerPiece < 0) {
      setError('Enter a name, quantity, and hours per piece.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await api.createJobFabricationItem(workspaceId, jobId, {
        name: itemDraft.name.trim(),
        quantity,
        estimatedHoursPerPiece,
      })
      let scope = {
        packages,
        items: created.items,
        estimatedHours: created.estimatedHours,
        summary: { total: packages.length, byStatus: [], active: [] } as JobWorkPackageSummary,
      }
      const newItem = created.items.find((i) => !items.some((old) => old.id === i.id))
      if (newItem && workPackageId) {
        scope = await api.assignFabricationItemWorkPackage(workspaceId, jobId, newItem.id, workPackageId)
      } else {
        const full = await api.getJobScope(workspaceId, jobId)
        scope = full
      }
      applyScope(scope)
      setItemDraft(emptyDraft())
      setAddingItemFor(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add item')
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (itemId: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.deleteJobFabricationItem(workspaceId, jobId, itemId)
      const scope = await api.getJobScope(workspaceId, jobId)
      applyScope(scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove item')
    } finally {
      setBusy(false)
    }
  }

  const renderItems = (packageId: string | null) => {
    const rows = itemsByPackage.get(packageId) ?? []
    if (rows.length === 0 && addingItemFor !== (packageId ?? 'unassigned')) {
      return <div style={{ fontSize: 12, color: '#9ca3af', padding: '4px 0 8px' }}>No fabrication items</div>
    }
    return (
      <div style={{ marginTop: 6 }}>
        {!isPhone && rows.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 70px 90px 80px 1fr auto',
            gap: 8,
            fontSize: 10,
            color: '#9ca3af',
            fontWeight: 600,
            padding: '0 0 4px',
          }}>
            <div>Item</div>
            <div>Qty</div>
            <div>Hrs / pc</div>
            <div>Total hrs</div>
            <div>Package</div>
            <div />
          </div>
        )}
        {rows.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'grid',
              gridTemplateColumns: isPhone ? '1fr' : '1.4fr 70px 90px 80px 1fr auto',
              gap: 8,
              fontSize: 12,
              padding: '6px 0',
              borderBottom: '1px solid #f3f4f6',
              alignItems: 'center',
            }}
          >
            <div style={{ fontWeight: 500 }}>{item.name}</div>
            <div>{formatQuantity(item.quantity)}</div>
            <div>{formatHoursNumber(item.estimatedHoursPerPiece)}</div>
            <div>{formatHoursNumber(item.totalHours)}</div>
            {canEdit ? (
              <select
                value={item.workPackageId ?? ''}
                disabled={busy}
                onChange={(e) => void assignItem(item.id, e.target.value || null)}
                style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, border: '1px solid #d0d5dd' }}
              >
                <option value="">Unassigned</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <div style={{ color: '#6b7280' }}>
                {packages.find((p) => p.id === item.workPackageId)?.name ?? 'Unassigned'}
              </div>
            )}
            {canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeItem(item.id)}
                style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11, color: '#b91c1c', padding: '2px 6px', cursor: 'pointer' }}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    )
  }

  const renderPackage = (pkg: JobWorkPackage, depth: number) => {
    const colors = statusColor[pkg.status]
    const kids = childrenByParent.get(pkg.id) ?? []
    return (
      <div key={pkg.id} style={{ marginBottom: 12, marginLeft: depth ? 16 : 0 }}>
        <div style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 12,
          background: '#fff',
        }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 120 }}>{pkg.name}</div>
            {canEdit ? (
              <select
                value={pkg.status}
                disabled={busy}
                onChange={(e) => void changeStatus(pkg.id, e.target.value as JobWorkPackageStatus)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 12,
                  border: '1px solid transparent',
                  background: colors.bg,
                  color: colors.fg,
                }}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12,
                background: colors.bg, color: colors.fg,
              }}>
                {pkg.statusLabel}
              </span>
            )}
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              {pkg.itemCount} item{pkg.itemCount === 1 ? '' : 's'} · {formatHoursNumber(pkg.estimatedHours)} hrs
            </span>
            {pkg.nextMilestone && (
              <span style={{
                fontSize: 11,
                color: pkg.nextMilestone.overdue ? '#b91c1c' : '#6b7280',
                fontWeight: pkg.nextMilestone.overdue ? 600 : 400,
              }}>
                Next: {pkg.nextMilestone.name}
                {pkg.nextMilestone.plannedDate
                  ? ` · ${formatOverviewDate(`${pkg.nextMilestone.plannedDate}T00:00:00.000Z`)}`
                  : ' · Date not set'}
              </span>
            )}
            {canEdit && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void renamePackage(pkg)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void movePackage(pkg.id, -1)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void movePackage(pkg.id, 1)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAddingItemFor(pkg.id)
                    setItemDraft(emptyDraft())
                  }}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
                >
                  + Item
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removePackage(pkg)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #e5e7eb', color: '#b91c1c', background: '#fff', cursor: 'pointer' }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
          {addingItemFor === pkg.id && (
            <ItemDraft
              draft={itemDraft}
              setDraft={setItemDraft}
              busy={busy}
              onSave={() => void addItem(pkg.id)}
              onCancel={() => setAddingItemFor(null)}
            />
          )}
          {renderItems(pkg.id)}
        </div>
        {kids.map((child) => renderPackage(child, depth + 1))}
      </div>
    )
  }

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading scope…</div>
  }

  const unassigned = itemsByPackage.get(null) ?? []
  const jobHours = totalEstimatedHours(items)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {packages.length} package{packages.length === 1 ? '' : 's'} · {items.length} item{items.length === 1 ? '' : 's'} · {formatHoursNumber(jobHours)} est. hrs
        </div>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAddingPackage((v) => !v)}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: '1px solid #1a1a2e', background: '#1a1a2e', color: '#fff', cursor: 'pointer',
            }}
          >
            {addingPackage ? 'Cancel' : '+ Work Package'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: '#fce4ec', color: '#c62828', fontSize: 13 }}>
          {error}
        </div>
      )}

      {addingPackage && (
        <div style={{ marginBottom: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              placeholder="Package name (e.g. Stair A)"
              style={{ flex: 1, minWidth: 160, padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
            />
            <select
              value={packageParentId}
              onChange={(e) => setPackageParentId(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12 }}
            >
              <option value="">No parent</option>
              {roots.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !packageName.trim()}
              onClick={() => void createPackage()}
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

      {roots.length === 0 && (
        <div style={{ padding: 28, textAlign: 'center', color: '#888', fontSize: 13, border: '1px dashed #e5e7eb', borderRadius: 8, marginBottom: 12 }}>
          No work packages yet. Create packages to organize fabrication scope by area, stair, rails, etc.
        </div>
      )}

      {roots.map((pkg) => renderPackage(pkg, 0))}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#fafafa' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Unassigned</div>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {unassigned.length} item{unassigned.length === 1 ? '' : 's'} · {formatHoursNumber(totalEstimatedHours(unassigned))} hrs
          </span>
          <span style={{ flex: 1 }} />
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAddingItemFor('unassigned')
                setItemDraft(emptyDraft())
              }}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
            >
              + Item
            </button>
          )}
        </div>
        {addingItemFor === 'unassigned' && (
          <ItemDraft
            draft={itemDraft}
            setDraft={setItemDraft}
            busy={busy}
            onSave={() => void addItem(null)}
            onCancel={() => setAddingItemFor(null)}
          />
        )}
        {renderItems(null)}
      </div>
    </div>
  )
}

function ItemDraft({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' }}>
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Item name"
        style={{ flex: 1, minWidth: 120, padding: '5px 8px', fontSize: 12, border: '1px solid #d0d5dd', borderRadius: 4 }}
      />
      <input
        value={draft.quantity}
        onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
        placeholder="Qty"
        style={{ width: 64, padding: '5px 8px', fontSize: 12, border: '1px solid #d0d5dd', borderRadius: 4 }}
      />
      <input
        value={draft.hours}
        onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
        placeholder="Hrs/pc"
        style={{ width: 72, padding: '5px 8px', fontSize: 12, border: '1px solid #d0d5dd', borderRadius: 4 }}
      />
      <button type="button" disabled={busy} onClick={onSave} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 4, border: 'none', background: '#1565c0', color: '#fff', cursor: 'pointer' }}>
        Add
      </button>
      <button type="button" onClick={onCancel} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}>
        Cancel
      </button>
    </div>
  )
}

export function WorkPackageOverviewSummary({
  summary,
}: {
  summary: JobWorkPackageSummary | null | undefined
}) {
  if (!summary || summary.total === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Work Packages
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>No work packages yet. Manage them on the Scope tab.</div>
      </div>
    )
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Work Packages ({summary.total})
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: summary.active.length ? 10 : 0 }}>
        {summary.byStatus.map((row) => (
          <span
            key={row.status}
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 12,
              background: statusColor[row.status].bg,
              color: statusColor[row.status].fg,
              fontWeight: 600,
            }}
          >
            {row.label} · {row.count}
          </span>
        ))}
      </div>
      {summary.active.length > 0 && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          {summary.active.map((row) => (
            <div key={row.id}>
              <strong>{row.name}</strong>
              <span style={{ color: '#6b7280' }}> — {row.statusLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
