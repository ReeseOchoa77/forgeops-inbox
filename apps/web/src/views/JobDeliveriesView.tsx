import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  api,
  type JobDelivery,
  type JobDeliverySummary,
  type JobInstallationRecord,
  type JobWorkPackage,
  type JobFabricationItem,
} from '../api'
import { formatOverviewDate } from '../job-overview-format'
import {
  JobConfirmDialog,
  JobCrmField,
  JobCrmModal,
  JobCrmPrimaryButton,
  JobCrmSecondaryButton,
  jobCrmInputStyle,
} from '../components/JobCrmModal'

type SubTab = 'deliveries' | 'installation'

type Props = {
  workspaceId: string
  jobId: string
  canEdit: boolean
  isPhone: boolean
  onSummaryChange?: (summary: JobDeliverySummary) => void
}

export function rebuildDeliverySummary(deliveries: JobDelivery[]): JobDeliverySummary {
  let plannedCount = 0
  let inTransitCount = 0
  let lateCount = 0
  let nextDelivery: JobDeliverySummary['nextDelivery'] = null
  const sorted = [...deliveries].sort((a, b) =>
    (a.plannedDeliveryDate ?? '9999').localeCompare(b.plannedDeliveryDate ?? '9999')
  )
  for (const d of sorted) {
    if (d.status === 'PLANNED' || d.status === 'READY') plannedCount += 1
    if (d.status === 'IN_TRANSIT') inTransitCount += 1
    if (d.risk.atRisk) lateCount += 1
    if (
      !nextDelivery &&
      (d.status === 'PLANNED' || d.status === 'READY' || d.status === 'IN_TRANSIT') &&
      d.plannedDeliveryDate
    ) {
      nextDelivery = {
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        plannedDeliveryDate: d.plannedDeliveryDate,
        packageNames: d.packages.map((p) => p.name).slice(0, 3),
      }
    }
  }
  return { plannedCount, inTransitCount, lateCount, nextDelivery }
}

export function JobDeliveriesView({ workspaceId, jobId, canEdit, isPhone, onSummaryChange }: Props) {
  const [sub, setSub] = useState<SubTab>('deliveries')
  const [deliveries, setDeliveries] = useState<JobDelivery[]>([])
  const [installations, setInstallations] = useState<JobInstallationRecord[]>([])
  const [packages, setPackages] = useState<JobWorkPackage[]>([])
  const [fabItems, setFabItems] = useState<JobFabricationItem[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<
    | null
    | { type: 'createDelivery' }
    | { type: 'ship'; delivery: JobDelivery }
    | { type: 'deliver'; delivery: JobDelivery }
    | { type: 'addLine'; delivery: JobDelivery }
    | { type: 'installation' }
  >(null)
  const [cancelTarget, setCancelTarget] = useState<JobDelivery | null>(null)
  const [deliveryNumber, setDeliveryNumber] = useState('DEL-001')
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [deliverDate, setDeliverDate] = useState('')
  const [lineMode, setLineMode] = useState<'FAB' | 'PKG' | 'CUSTOM'>('FAB')
  const [lineFabId, setLineFabId] = useState('')
  const [linePkgId, setLinePkgId] = useState('')
  const [lineDescription, setLineDescription] = useState('')
  const [lineQty, setLineQty] = useState('')
  const [installEventType, setInstallEventType] = useState<'STARTED' | 'PROGRESS' | 'COMPLETED'>('STARTED')
  const [installPackageId, setInstallPackageId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [d, i, scope] = await Promise.all([
        api.listJobDeliveries(workspaceId, jobId),
        api.listJobInstallations(workspaceId, jobId),
        api.getJobScope(workspaceId, jobId),
      ])
      setDeliveries(d.deliveries)
      setInstallations(i.installations)
      setPackages(scope.packages)
      setFabItems(scope.items)
      onSummaryChange?.(rebuildDeliverySummary(d.deliveries))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deliveries')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId, onSummaryChange])

  useEffect(() => {
    void load()
  }, [load])

  const today = () => new Date().toISOString().slice(0, 10)

  const openCreateDelivery = () => {
    setDeliveryNumber('DEL-001')
    setPlannedDeliveryDate('')
    setModal({ type: 'createDelivery' })
  }

  const submitCreateDelivery = async () => {
    if (!deliveryNumber.trim()) return
    setBusy(true)
    try {
      await api.createJobDelivery(workspaceId, jobId, {
        deliveryNumber: deliveryNumber.trim(),
        plannedDeliveryDate: plannedDeliveryDate.trim() || null,
        useJobSite: true,
      })
      setModal(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create delivery')
    } finally {
      setBusy(false)
    }
  }

  const openMarkShipped = (d: JobDelivery) => {
    setShipDate(today())
    setModal({ type: 'ship', delivery: d })
  }

  const submitMarkShipped = async () => {
    if (modal?.type !== 'ship') return
    setBusy(true)
    try {
      await api.updateJobDelivery(workspaceId, jobId, modal.delivery.id, {
        status: 'IN_TRANSIT',
        actualShipDate: shipDate.trim() || null,
      })
      setModal(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark shipped')
    } finally {
      setBusy(false)
    }
  }

  const openMarkDelivered = (d: JobDelivery) => {
    setDeliverDate(today())
    setModal({ type: 'deliver', delivery: d })
  }

  const submitMarkDelivered = async () => {
    if (modal?.type !== 'deliver') return
    setBusy(true)
    try {
      await api.updateJobDelivery(workspaceId, jobId, modal.delivery.id, {
        status: 'DELIVERED',
        actualDeliveryDate: deliverDate.trim() || null,
      })
      setModal(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark delivered')
    } finally {
      setBusy(false)
    }
  }

  const confirmCancelDelivery = async () => {
    if (!cancelTarget) return
    setBusy(true)
    try {
      await api.updateJobDelivery(workspaceId, jobId, cancelTarget.id, { status: 'CANCELLED' })
      setCancelTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel')
    } finally {
      setBusy(false)
    }
  }

  const openAddLine = (d: JobDelivery) => {
    const firstFab = fabItems[0]
    setLineMode('FAB')
    setLineFabId(firstFab?.id ?? '')
    setLinePkgId(packages[0]?.id ?? '')
    setLineDescription('')
    setLineQty(firstFab ? String(firstFab.quantity) : '')
    setModal({ type: 'addLine', delivery: d })
  }

  const submitAddLine = async () => {
    if (modal?.type !== 'addLine') return
    const d = modal.delivery
    setBusy(true)
    try {
      if (lineMode === 'FAB') {
        const item = fabItems.find((f) => f.id === lineFabId)
        if (!item) throw new Error('Invalid fabrication item')
        const trimmed = lineQty.trim()
        let quantity: number | null = null
        if (trimmed) {
          const n = Number(trimmed)
          if (!Number.isFinite(n)) throw new Error('Invalid quantity')
          quantity = n
        }
        await api.addJobDeliveryItem(workspaceId, jobId, d.id, {
          fabricationItemId: item.id,
          workPackageId: item.workPackageId,
          quantity,
        })
      } else if (lineMode === 'PKG') {
        const pkg = packages.find((p) => p.id === linePkgId)
        if (!pkg) throw new Error('Invalid package')
        await api.addJobDeliveryItem(workspaceId, jobId, d.id, {
          workPackageId: pkg.id,
          description: pkg.name,
        })
      } else {
        if (!lineDescription.trim()) {
          setBusy(false)
          return
        }
        const trimmed = lineQty.trim()
        let quantity: number | null = null
        if (trimmed) {
          const n = Number(trimmed)
          if (!Number.isFinite(n)) throw new Error('Invalid quantity')
          quantity = n
        }
        await api.addJobDeliveryItem(workspaceId, jobId, d.id, {
          description: lineDescription.trim(),
          quantity,
        })
      }
      setModal(null)
      await load()
      setExpandedId(d.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add line')
    } finally {
      setBusy(false)
    }
  }

  const openRecordInstallation = () => {
    setInstallEventType('STARTED')
    setInstallPackageId('')
    setModal({ type: 'installation' })
  }

  const submitRecordInstallation = async () => {
    setBusy(true)
    try {
      await api.createJobInstallation(workspaceId, jobId, {
        eventType: installEventType,
        workPackageId: installPackageId || null,
      })
      setModal(null)
      await load()
      setSub('installation')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record installation')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading deliveries…</div>
  }

  const chip = (key: SubTab, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setSub(key)}
      style={{
        fontSize: 12,
        fontWeight: sub === key ? 700 : 500,
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid #e5e7eb',
        background: sub === key ? '#eff6ff' : '#fff',
        color: sub === key ? '#1d4ed8' : '#374151',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {chip('deliveries', `Deliveries (${deliveries.length})`)}
        {chip('installation', `Installation (${installations.length})`)}
        <span style={{ flex: 1 }} />
        {canEdit && sub === 'deliveries' && (
          <Btn onClick={openCreateDelivery} disabled={busy}>New Delivery</Btn>
        )}
        {canEdit && sub === 'installation' && (
          <Btn onClick={openRecordInstallation} disabled={busy}>Record Event</Btn>
        )}
      </div>

      {error && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {sub === 'deliveries' && (
        deliveries.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>No deliveries yet.</div>
        ) : (
          deliveries.map((d) => (
            <div key={d.id} style={{ borderBottom: '1px solid #f3f4f6', padding: '10px 0' }}>
              <Row isPhone={isPhone}>
                <div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <strong style={{ color: d.risk.atRisk ? '#b91c1c' : undefined }}>{d.deliveryNumber}</strong>
                  </button>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {d.status.replace(/_/g, ' ')}
                    {d.risk.lateToShip ? ' · Late to ship' : ''}
                    {d.risk.lateDelivery ? ' · Late delivery' : ''}
                    {d.packages.length ? ` · ${d.packages.map((p) => p.name).join(', ')}` : ''}
                    {` · ${d.lineCount} line${d.lineCount === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#374151' }}>
                  <div>Ship {formatOverviewDate(d.plannedShipDate)} → {formatOverviewDate(d.actualShipDate)}</div>
                  <div>Del {formatOverviewDate(d.plannedDeliveryDate)} → {formatOverviewDate(d.actualDeliveryDate)}</div>
                  <div style={{ color: '#6b7280' }}>
                    {[d.destinationName, d.destinationCity, d.destinationState].filter(Boolean).join(', ') || 'No destination'}
                    {d.carrierName ? ` · ${d.carrierName}` : ''}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {d.status !== 'DELIVERED' && d.status !== 'CANCELLED' && d.status !== 'IN_TRANSIT' && (
                      <Btn onClick={() => openMarkShipped(d)} disabled={busy}>Mark Shipped</Btn>
                    )}
                    {d.status !== 'DELIVERED' && d.status !== 'CANCELLED' && (
                      <Btn onClick={() => openMarkDelivered(d)} disabled={busy}>Mark Delivered</Btn>
                    )}
                    {(d.status === 'PLANNED' || d.status === 'READY' || d.status === 'IN_TRANSIT') && (
                      <Btn onClick={() => openAddLine(d)} disabled={busy}>Add Line</Btn>
                    )}
                    {d.status !== 'CANCELLED' && d.status !== 'DELIVERED' && (
                      <Btn onClick={() => setCancelTarget(d)} disabled={busy}>Cancel</Btn>
                    )}
                  </div>
                )}
              </Row>
              {expandedId === d.id && (
                <div style={{ marginTop: 8, marginLeft: isPhone ? 0 : 8, fontSize: 12, color: '#374151' }}>
                  {d.items.length === 0 ? (
                    <div style={{ color: '#888' }}>No contents yet.</div>
                  ) : (
                    d.items.map((item) => (
                      <div key={item.id} style={{ padding: '4px 0', borderTop: '1px solid #f9fafb' }}>
                        {item.workPackage?.name ? `${item.workPackage.name} · ` : ''}
                        {item.description}
                        {item.quantity != null ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
                        {item.fabricationItem ? ' · from scope' : ''}
                      </div>
                    ))
                  )}
                  {d.documents.length > 0 && (
                    <div style={{ marginTop: 6, color: '#6b7280' }}>
                      Docs: {d.documents.map((doc) => doc.documentNumber || doc.title || 'linked').join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )
      )}

      {sub === 'installation' && (
        installations.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>No installation events.</div>
        ) : (
          installations.map((ev) => (
            <Row key={ev.id} isPhone={isPhone}>
              <div>
                <strong>{ev.eventType}</strong>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {ev.workPackage?.name ?? 'Job-level'}
                  {ev.shipment ? ` · ${ev.shipment.deliveryNumber}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 12 }}>{formatOverviewDate(ev.eventDate)}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{ev.notes ?? ''}</div>
            </Row>
          ))
        )
      )}

      <JobCrmModal
        title="New delivery"
        open={modal?.type === 'createDelivery'}
        onClose={() => setModal(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton
              onClick={() => void submitCreateDelivery()}
              disabled={busy || !deliveryNumber.trim()}
            >
              Create
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="Delivery number" required>
          <input style={jobCrmInputStyle} value={deliveryNumber} onChange={(e) => setDeliveryNumber(e.target.value)} />
        </JobCrmField>
        <JobCrmField label="Planned delivery date" hint="YYYY-MM-DD">
          <input
            type="date"
            style={jobCrmInputStyle}
            value={plannedDeliveryDate}
            onChange={(e) => setPlannedDeliveryDate(e.target.value)}
          />
        </JobCrmField>
      </JobCrmModal>

      <JobCrmModal
        title="Mark shipped"
        open={modal?.type === 'ship'}
        onClose={() => setModal(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton onClick={() => void submitMarkShipped()} disabled={busy}>
              Mark shipped
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="Actual ship date" hint="YYYY-MM-DD">
          <input type="date" style={jobCrmInputStyle} value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
        </JobCrmField>
      </JobCrmModal>

      <JobCrmModal
        title="Mark delivered"
        open={modal?.type === 'deliver'}
        onClose={() => setModal(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton onClick={() => void submitMarkDelivered()} disabled={busy}>
              Mark delivered
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="Actual delivery date" hint="YYYY-MM-DD">
          <input type="date" style={jobCrmInputStyle} value={deliverDate} onChange={(e) => setDeliverDate(e.target.value)} />
        </JobCrmField>
      </JobCrmModal>

      <JobCrmModal
        title="Add delivery line"
        open={modal?.type === 'addLine'}
        onClose={() => setModal(null)}
        wide
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton
              onClick={() => void submitAddLine()}
              disabled={
                busy ||
                (lineMode === 'FAB' && !lineFabId) ||
                (lineMode === 'PKG' && !linePkgId) ||
                (lineMode === 'CUSTOM' && !lineDescription.trim())
              }
            >
              Add
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="Line type" required>
          <select
            style={jobCrmInputStyle}
            value={lineMode}
            onChange={(e) => {
              const mode = e.target.value as 'FAB' | 'PKG' | 'CUSTOM'
              setLineMode(mode)
              if (mode === 'FAB') {
                const fab = fabItems.find((f) => f.id === lineFabId) ?? fabItems[0]
                if (fab) {
                  setLineFabId(fab.id)
                  setLineQty(String(fab.quantity))
                }
              }
            }}
          >
            <option value="FAB">Fabrication item</option>
            <option value="PKG">Work package</option>
            <option value="CUSTOM">Custom line</option>
          </select>
        </JobCrmField>
        {lineMode === 'FAB' && (
          <>
            <JobCrmField label="Fabrication item" required>
              <select
                style={jobCrmInputStyle}
                value={lineFabId}
                onChange={(e) => {
                  const id = e.target.value
                  setLineFabId(id)
                  const fab = fabItems.find((f) => f.id === id)
                  if (fab) setLineQty(String(fab.quantity))
                }}
              >
                {fabItems.length === 0 ? (
                  <option value="">No fabrication items</option>
                ) : (
                  fabItems.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} (qty {f.quantity})
                    </option>
                  ))
                )}
              </select>
            </JobCrmField>
            <JobCrmField label="Quantity on this load" hint="Blank = none">
              <input style={jobCrmInputStyle} value={lineQty} onChange={(e) => setLineQty(e.target.value)} />
            </JobCrmField>
          </>
        )}
        {lineMode === 'PKG' && (
          <JobCrmField label="Work package" required>
            <select style={jobCrmInputStyle} value={linePkgId} onChange={(e) => setLinePkgId(e.target.value)}>
              {packages.length === 0 ? (
                <option value="">No packages</option>
              ) : (
                packages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))
              )}
            </select>
          </JobCrmField>
        )}
        {lineMode === 'CUSTOM' && (
          <>
            <JobCrmField label="Description" required>
              <input style={jobCrmInputStyle} value={lineDescription} onChange={(e) => setLineDescription(e.target.value)} />
            </JobCrmField>
            <JobCrmField label="Quantity" hint="Blank = none">
              <input style={jobCrmInputStyle} value={lineQty} onChange={(e) => setLineQty(e.target.value)} />
            </JobCrmField>
          </>
        )}
      </JobCrmModal>

      <JobCrmModal
        title="Record installation event"
        open={modal?.type === 'installation'}
        onClose={() => setModal(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton onClick={() => void submitRecordInstallation()} disabled={busy}>
              Record
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="Event type" required>
          <select
            style={jobCrmInputStyle}
            value={installEventType}
            onChange={(e) => setInstallEventType(e.target.value as typeof installEventType)}
          >
            <option value="STARTED">Started</option>
            <option value="PROGRESS">Progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </JobCrmField>
        <JobCrmField label="Work package" hint="Optional — job-level if blank">
          <select
            style={jobCrmInputStyle}
            value={installPackageId}
            onChange={(e) => setInstallPackageId(e.target.value)}
          >
            <option value="">Job-level</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </JobCrmField>
      </JobCrmModal>

      <JobConfirmDialog
        open={cancelTarget != null}
        title="Cancel delivery"
        message={cancelTarget ? `Cancel ${cancelTarget.deliveryNumber}?` : ''}
        confirmLabel="Cancel delivery"
        danger
        busy={busy}
        onConfirm={() => void confirmCancelDelivery()}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}

function Row({ children, isPhone }: { children: ReactNode; isPhone: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isPhone ? '1fr' : '1.2fr 1fr auto',
      gap: 8,
      alignItems: 'center',
      fontSize: 13,
    }}>
      {children}
    </div>
  )
}

function Btn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
    >
      {children}
    </button>
  )
}

export function DeliveryOverviewSummary({
  summary,
  onViewDeliveries,
}: {
  summary: JobDeliverySummary | null | undefined
  onViewDeliveries?: () => void
}) {
  const empty = !summary || (
    summary.plannedCount === 0 &&
    summary.inTransitCount === 0 &&
    summary.lateCount === 0 &&
    !summary.nextDelivery
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Deliveries
        </div>
        <span style={{ flex: 1 }} />
        {onViewDeliveries && (
          <button
            type="button"
            onClick={onViewDeliveries}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: '#1565c0', fontWeight: 600 }}
          >
            View Deliveries
          </button>
        )}
      </div>
      {empty ? (
        <div style={{ fontSize: 13, color: '#888' }}>No planned or in-transit deliveries.</div>
      ) : (
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
          {summary!.plannedCount > 0 && (
            <div>{summary!.plannedCount} planned deliver{summary!.plannedCount === 1 ? 'y' : 'ies'}</div>
          )}
          {summary!.inTransitCount > 0 && (
            <div>{summary!.inTransitCount} in transit</div>
          )}
          {summary!.lateCount > 0 && (
            <div style={{ color: '#b91c1c', fontWeight: 600 }}>{summary!.lateCount} late</div>
          )}
          {summary!.nextDelivery && (
            <div>
              Next: {summary!.nextDelivery.packageNames.join(', ') || summary!.nextDelivery.deliveryNumber}
              {summary!.nextDelivery.plannedDeliveryDate
                ? ` · ${formatOverviewDate(summary!.nextDelivery.plannedDeliveryDate)}`
                : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
