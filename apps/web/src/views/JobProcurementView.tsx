import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  api,
  type JobProcurementItem,
  type JobProcurementSummary,
  type JobPurchaseOrder,
  type JobWorkPackage,
} from '../api'
import { formatOverviewDate } from '../job-overview-format'
import { parseNullableMoneyInput } from '../job-crm-ui'
import {
  JobConfirmDialog,
  JobCrmField,
  JobCrmModal,
  JobCrmPrimaryButton,
  JobCrmSecondaryButton,
  jobCrmInputStyle,
} from '../components/JobCrmModal'

const PROCUREMENT_CATEGORIES = [
  'MATERIAL',
  'JOIST_DECK',
  'HARDWARE',
  'COATING',
  'OUTSOURCED_FABRICATION',
  'DETAILING',
  'ENGINEERING',
  'TESTING',
  'OTHER',
] as const

type SubTab = 'items' | 'orders'
type Filter = 'all' | 'needsAction' | 'ordered' | 'received' | 'atRisk'

type Props = {
  workspaceId: string
  jobId: string
  canEdit: boolean
  isPhone: boolean
  onSummaryChange?: (summary: JobProcurementSummary) => void
}

export function moneyLabel(value: string | null | undefined): string {
  if (value == null) return 'Not priced'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Not priced'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
}

export function rebuildProcurementSummary(items: JobProcurementItem[], orders: JobPurchaseOrder[]): JobProcurementSummary {
  let needsOrderingCount = 0
  let atRiskCount = 0
  let pastExpectedCount = 0
  for (const item of items) {
    if (item.status === 'NEEDED' || item.status === 'PRICING' || item.status === 'READY_TO_ORDER') {
      needsOrderingCount += 1
    }
    if (item.risk.atRisk) atRiskCount += 1
    if (item.risk.pastExpected) pastExpectedCount += 1
  }
  let sum: number | null = null
  for (const po of orders) {
    if (po.status === 'DRAFT' || po.status === 'CANCELLED') continue
    if (po.amount == null) continue
    const n = Number(po.amount)
    if (!Number.isFinite(n)) continue
    sum = (sum ?? 0) + n
  }
  return {
    needsOrderingCount,
    atRiskCount,
    pastExpectedCount,
    orderedAmount: sum == null ? null : sum.toFixed(2),
  }
}

export function JobProcurementView({ workspaceId, jobId, canEdit, isPhone, onSummaryChange }: Props) {
  const [sub, setSub] = useState<SubTab>('items')
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<JobProcurementItem[]>([])
  const [orders, setOrders] = useState<JobPurchaseOrder[]>([])
  const [packages, setPackages] = useState<JobWorkPackage[]>([])
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<
    | null
    | { type: 'createItem' }
    | { type: 'receive'; item: JobProcurementItem }
    | { type: 'createPo' }
  >(null)
  const [cancelTarget, setCancelTarget] = useState<JobProcurementItem | null>(null)
  const [itemDescription, setItemDescription] = useState('')
  const [itemCategory, setItemCategory] = useState<string>('MATERIAL')
  const [itemEstimatedCost, setItemEstimatedCost] = useState('')
  const [receiveQty, setReceiveQty] = useState('')
  const [receiveComplete, setReceiveComplete] = useState(true)
  const [poNumber, setPoNumber] = useState('PO-001')
  const [poAmount, setPoAmount] = useState('')
  const [poIssueNow, setPoIssueNow] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [i, o, scope, vendorRes] = await Promise.all([
        api.listJobProcurementItems(workspaceId, jobId),
        api.listJobPurchaseOrders(workspaceId, jobId),
        api.getJobScope(workspaceId, jobId),
        api.listReferenceVendors(workspaceId),
      ])
      setItems(i.items)
      setOrders(o.purchaseOrders)
      setPackages(scope.packages)
      setVendors(vendorRes.vendors.map((v) => ({ id: v.id, name: v.name })))
      onSummaryChange?.(rebuildProcurementSummary(i.items, o.purchaseOrders))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load procurement')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId, onSummaryChange])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'needsAction') {
        return item.status === 'NEEDED' || item.status === 'PRICING' || item.status === 'READY_TO_ORDER' || item.risk.atRisk
      }
      if (filter === 'ordered') return item.status === 'ORDERED' || item.status === 'PARTIALLY_RECEIVED'
      if (filter === 'received') return item.status === 'RECEIVED'
      if (filter === 'atRisk') return item.risk.atRisk
      return true
    })
  }, [items, filter])

  const openCreateItem = () => {
    setItemDescription('')
    setItemCategory('MATERIAL')
    setItemEstimatedCost('')
    setModal({ type: 'createItem' })
  }

  const submitCreateItem = async () => {
    if (!itemDescription.trim()) return
    const estimatedCost = parseNullableMoneyInput(itemEstimatedCost)
    if (estimatedCost === undefined) {
      setError('Enter a valid estimated cost, or leave blank for not priced.')
      return
    }
    setBusy(true)
    try {
      await api.createJobProcurementItem(workspaceId, jobId, {
        description: itemDescription.trim(),
        category: itemCategory,
        estimatedCost,
      })
      setModal(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create item')
    } finally {
      setBusy(false)
    }
  }

  const openReceiveItem = (item: JobProcurementItem) => {
    setReceiveQty('')
    setReceiveComplete(false)
    setModal({ type: 'receive', item })
  }

  const submitReceiveItem = async () => {
    if (modal?.type !== 'receive') return
    const item = modal.item
    let quantityReceived: number | null = null
    if (!item.isService) {
      const trimmed = receiveQty.trim()
      if (trimmed) {
        const n = Number(trimmed)
        if (!Number.isFinite(n)) {
          setError('Enter a valid quantity or leave blank for none.')
          return
        }
        quantityReceived = n
      }
    }
    setBusy(true)
    try {
      await api.recordJobProcurementReceipt(workspaceId, jobId, item.id, {
        quantityReceived,
        marksComplete: receiveComplete,
      })
      setModal(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record receipt')
    } finally {
      setBusy(false)
    }
  }

  const confirmCancelItem = async () => {
    if (!cancelTarget) return
    setBusy(true)
    try {
      await api.updateJobProcurementItem(workspaceId, jobId, cancelTarget.id, { status: 'CANCELLED' })
      setCancelTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel')
    } finally {
      setBusy(false)
    }
  }

  const openCreatePo = () => {
    setPoNumber('PO-001')
    setPoAmount('')
    setPoIssueNow(false)
    setModal({ type: 'createPo' })
  }

  const submitCreatePo = async () => {
    if (!poNumber.trim()) return
    const amount = parseNullableMoneyInput(poAmount)
    if (amount === undefined) {
      setError('Enter a valid PO amount, or leave blank for not set.')
      return
    }
    const eligible = items.filter(
      (i) =>
        !i.purchaseOrder &&
        (i.status === 'NEEDED' || i.status === 'PRICING' || i.status === 'READY_TO_ORDER' || i.status === 'ORDERED')
    )
    setBusy(true)
    try {
      await api.createJobPurchaseOrder(workspaceId, jobId, {
        poNumber: poNumber.trim(),
        status: poIssueNow ? 'ISSUED' : 'DRAFT',
        itemIds: eligible.map((i) => i.id),
        amount,
        vendorId: eligible.find((i) => i.vendor)?.vendor?.id ?? null,
      })
      setModal(null)
      await load()
      setSub('orders')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create PO')
    } finally {
      setBusy(false)
    }
  }

  const issuePO = async (po: JobPurchaseOrder) => {
    setBusy(true)
    try {
      await api.updateJobPurchaseOrder(workspaceId, jobId, po.id, { status: 'ISSUED' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to issue PO')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading procurement…</div>
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

  const filterChip = (key: Filter, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      style={{
        fontSize: 11,
        padding: '4px 8px',
        borderRadius: 4,
        border: '1px solid #e5e7eb',
        background: filter === key ? '#f3f4f6' : '#fff',
        fontWeight: filter === key ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {chip('items', `Items (${items.length})`)}
        {chip('orders', `Purchase Orders (${orders.length})`)}
        <span style={{ flex: 1 }} />
        {canEdit && sub === 'items' && (
          <Btn onClick={openCreateItem} disabled={busy}>Add Item</Btn>
        )}
        {canEdit && (
          <Btn onClick={openCreatePo} disabled={busy}>Create PO</Btn>
        )}
      </div>

      {error && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {sub === 'items' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {filterChip('all', 'All')}
            {filterChip('needsAction', 'Needs Action')}
            {filterChip('ordered', 'Ordered')}
            {filterChip('received', 'Received')}
            {filterChip('atRisk', 'Late / At Risk')}
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>No procurement items.</div>
          ) : (
            filtered.map((item) => (
              <Row key={item.id} isPhone={isPhone}>
                <div>
                  <strong style={{ color: item.risk.atRisk ? '#b91c1c' : undefined }}>{item.description}</strong>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {item.category.replace(/_/g, ' ')}
                    {item.workPackage ? ` · ${item.workPackage.name}` : ' · Job-level'}
                    {item.risk.atRisk ? ' · At risk' : ''}
                    {item.isService ? ' · Service' : ''}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#374151' }}>
                  <div>{item.status.replace(/_/g, ' ')}</div>
                  <div style={{ color: '#6b7280' }}>
                    {item.vendor?.name ?? 'No vendor'}
                    {item.quantity != null ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
                    {item.quantityReceivedTotal != null && item.quantity != null
                      ? ` · ${item.quantityReceivedTotal}/${item.quantity}`
                      : ''}
                  </div>
                  <div style={{ color: '#6b7280' }}>
                    Req {formatOverviewDate(item.requiredDate)} · Exp {formatOverviewDate(item.expectedDate)}
                    {item.receivedDate ? ` · Rec ${formatOverviewDate(item.receivedDate)}` : ''}
                  </div>
                  <div style={{ color: item.estimatedCost == null ? '#9ca3af' : '#374151', fontStyle: item.estimatedCost == null ? 'italic' : undefined }}>
                    Est {moneyLabel(item.estimatedCost)}
                    {item.purchaseOrder ? ` · ${item.purchaseOrder.poNumber}` : ''}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(item.status === 'ORDERED' || item.status === 'PARTIALLY_RECEIVED') && (
                      <Btn onClick={() => openReceiveItem(item)} disabled={busy}>
                        {item.isService ? 'Complete' : 'Receive'}
                      </Btn>
                    )}
                    {item.status !== 'CANCELLED' && item.status !== 'RECEIVED' && (
                      <Btn onClick={() => setCancelTarget(item)} disabled={busy}>Cancel</Btn>
                    )}
                  </div>
                )}
              </Row>
            ))
          )}
        </>
      )}

      {sub === 'orders' && (
        orders.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>No purchase orders.</div>
        ) : (
          orders.map((po) => (
            <Row key={po.id} isPhone={isPhone}>
              <div>
                <strong>{po.poNumber}</strong>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {po.vendor?.name ?? 'No vendor'} · {po.items.length} item{po.items.length === 1 ? '' : 's'}
                  {po.documentRecord ? ` · Doc ${po.documentRecord.documentNumber ?? po.documentRecord.title ?? 'linked'}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 12 }}>
                <div>{po.status.replace(/_/g, ' ')}</div>
                <div style={{ color: '#6b7280' }}>
                  Ordered {formatOverviewDate(po.orderedDate)} · Exp {formatOverviewDate(po.expectedDate)}
                </div>
                <div style={{ color: po.amount == null ? '#9ca3af' : undefined, fontStyle: po.amount == null ? 'italic' : undefined }}>
                  {moneyLabel(po.amount)}
                </div>
              </div>
              {canEdit && po.status === 'DRAFT' && (
                <Btn onClick={() => void issuePO(po)} disabled={busy}>Issue</Btn>
              )}
            </Row>
          ))
        )
      )}

      {/* Keep packages/vendors referenced so tree-shaking doesn't drop load side-effects in tests */}
      <span style={{ display: 'none' }}>{packages.length}{vendors.length}</span>

      <JobCrmModal
        title="Add procurement item"
        open={modal?.type === 'createItem'}
        onClose={() => setModal(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton
              onClick={() => void submitCreateItem()}
              disabled={busy || !itemDescription.trim()}
            >
              Create
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="Description" required>
          <input
            style={jobCrmInputStyle}
            value={itemDescription}
            onChange={(e) => setItemDescription(e.target.value)}
            placeholder="e.g. W12x26 beams, Joists"
          />
        </JobCrmField>
        <JobCrmField label="Category">
          <select
            style={jobCrmInputStyle}
            value={itemCategory}
            onChange={(e) => setItemCategory(e.target.value)}
          >
            {PROCUREMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </JobCrmField>
        <JobCrmField label="Estimated cost" hint="Blank = not priced; 0 = zero">
          <input style={jobCrmInputStyle} value={itemEstimatedCost} onChange={(e) => setItemEstimatedCost(e.target.value)} />
        </JobCrmField>
      </JobCrmModal>

      <JobCrmModal
        title={modal?.type === 'receive' && modal.item.isService ? 'Complete service' : 'Record receipt'}
        open={modal?.type === 'receive'}
        onClose={() => setModal(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton onClick={() => void submitReceiveItem()} disabled={busy}>
              Save
            </JobCrmPrimaryButton>
          </>
        }
      >
        {modal?.type === 'receive' && !modal.item.isService && (
          <JobCrmField
            label="Qty received"
            hint={
              modal.item.quantity != null
                ? `Ordered ${modal.item.quantity}${modal.item.unit ? ` ${modal.item.unit}` : ''}; blank = none`
                : 'Blank = none'
            }
          >
            <input style={jobCrmInputStyle} value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} />
          </JobCrmField>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={receiveComplete}
            onChange={(e) => setReceiveComplete(e.target.checked)}
          />
          {modal?.type === 'receive' && modal.item.isService
            ? 'Mark this service complete'
            : 'Mark fully received/complete'}
        </label>
      </JobCrmModal>

      <JobCrmModal
        title="Create purchase order"
        open={modal?.type === 'createPo'}
        onClose={() => setModal(null)}
        footer={
          <>
            <JobCrmSecondaryButton onClick={() => setModal(null)} disabled={busy}>Cancel</JobCrmSecondaryButton>
            <JobCrmPrimaryButton onClick={() => void submitCreatePo()} disabled={busy || !poNumber.trim()}>
              Create
            </JobCrmPrimaryButton>
          </>
        }
      >
        <JobCrmField label="PO number" required>
          <input style={jobCrmInputStyle} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </JobCrmField>
        <JobCrmField label="PO amount" hint="Blank = not set; may include freight/fees">
          <input style={jobCrmInputStyle} value={poAmount} onChange={(e) => setPoAmount(e.target.value)} />
        </JobCrmField>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={poIssueNow} onChange={(e) => setPoIssueNow(e.target.checked)} />
          Issue PO now (otherwise saved as draft)
        </label>
      </JobCrmModal>

      <JobConfirmDialog
        open={cancelTarget != null}
        title="Cancel procurement item"
        message={cancelTarget ? `Cancel ${cancelTarget.description}?` : ''}
        confirmLabel="Cancel item"
        danger
        busy={busy}
        onConfirm={() => void confirmCancelItem()}
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
      padding: '10px 0',
      borderBottom: '1px solid #f3f4f6',
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

export function ProcurementOverviewSummary({
  summary,
  onViewProcurement,
}: {
  summary: JobProcurementSummary | null | undefined
  onViewProcurement?: () => void
}) {
  const empty = !summary || (
    summary.needsOrderingCount === 0 &&
    summary.atRiskCount === 0 &&
    summary.pastExpectedCount === 0
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Procurement
        </div>
        <span style={{ flex: 1 }} />
        {onViewProcurement && (
          <button
            type="button"
            onClick={onViewProcurement}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: '#1565c0', fontWeight: 600 }}
          >
            View Procurement
          </button>
        )}
      </div>
      {empty ? (
        <div style={{ fontSize: 13, color: '#888' }}>No open procurement needs.</div>
      ) : (
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
          {summary!.needsOrderingCount > 0 && (
            <div>{summary!.needsOrderingCount} item{summary!.needsOrderingCount === 1 ? '' : 's'} need ordering</div>
          )}
          {summary!.atRiskCount > 0 && (
            <div style={{ color: '#b91c1c', fontWeight: 600 }}>{summary!.atRiskCount} at risk</div>
          )}
          {summary!.pastExpectedCount > 0 && (
            <div>{summary!.pastExpectedCount} past expected</div>
          )}
          {summary!.orderedAmount != null && (
            <div>{moneyLabel(summary!.orderedAmount)} ordered</div>
          )}
        </div>
      )}
    </div>
  )
}
