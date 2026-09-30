import { Fragment, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  api,
  type JobBillingSnapshot,
  type JobChangeOrder,
  type JobInvoice,
  type JobInvoiceStatus,
  type BillingPeriodDelivery,
  type BillingPeriodInstallation,
} from '../api'
import { formatFinancialMoney, formatMarginPercent } from '../job-financial-format'
import { formatOverviewDate } from '../job-overview-format'
import { JobConfirmDialog } from '../components/JobCrmModal'

type Props = {
  workspaceId: string
  jobId: string
  canEdit: boolean
  isPhone: boolean
  onSnapshotChange?: (snapshot: JobBillingSnapshot | null) => void
}

function moneyLabel(v: string | null | undefined): string {
  return formatFinancialMoney(v)
}

function periodLabel(start: string | null, end: string | null): string {
  if (!start && !end) return '—'
  if (start && end) return `${formatOverviewDate(start)} – ${formatOverviewDate(end)}`
  return formatOverviewDate(start ?? end)
}

function statusColor(status: JobInvoiceStatus): string {
  switch (status) {
    case 'DRAFT':
      return '#6b7280'
    case 'SUBMITTED':
      return '#2563eb'
    case 'APPROVED':
      return '#15803d'
    case 'REJECTED':
      return '#b45309'
    case 'VOID':
      return '#9ca3af'
    default:
      return '#374151'
  }
}

type FormState = {
  invoiceNumber: string
  invoiceDate: string
  billingPeriodStart: string
  billingPeriodEnd: string
  dueDate: string
  amount: string
  billToCustomerId: string
  notes: string
  coIds: string[]
}

const emptyForm = (): FormState => ({
  invoiceNumber: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  billingPeriodStart: '',
  billingPeriodEnd: '',
  dueDate: '',
  amount: '',
  billToCustomerId: '',
  notes: '',
  coIds: [],
})

export function JobBillingView({ workspaceId, jobId, canEdit, isPhone, onSnapshotChange }: Props) {
  const [invoices, setInvoices] = useState<JobInvoice[]>([])
  const [snapshot, setSnapshot] = useState<JobBillingSnapshot | null>(null)
  const [changeOrders, setChangeOrders] = useState<JobChangeOrder[]>([])
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [evidence, setEvidence] = useState<{
    deliveries: BillingPeriodDelivery[]
    installations: BillingPeriodInstallation[]
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<JobInvoice | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [inv, cos, parties] = await Promise.all([
        api.listJobInvoices(workspaceId, jobId),
        api.listJobChangeOrders(workspaceId, jobId),
        api.getJobPartyOptions(workspaceId),
      ])
      setInvoices(inv.invoices)
      setSnapshot(inv.billingSnapshot)
      onSnapshotChange?.(inv.billingSnapshot)
      setChangeOrders(cos.changeOrders.filter((c) => c.status === 'APPROVED' || c.status === 'SUBMITTED'))
      setCustomers(parties.customers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load billing')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId, onSnapshotChange])

  useEffect(() => {
    void load()
  }, [load])

  const loadEvidence = useCallback(
    async (start: string, end: string) => {
      if (!start || !end) {
        setEvidence(null)
        return
      }
      try {
        const res = await api.getBillingPeriodEvidence(workspaceId, jobId, start, end)
        setEvidence(res)
      } catch {
        setEvidence(null)
      }
    },
    [workspaceId, jobId]
  )

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setEvidence(null)
    setShowForm(true)
  }

  const openEdit = (inv: JobInvoice) => {
    setEditingId(inv.id)
    setForm({
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      billingPeriodStart: inv.billingPeriodStart ?? '',
      billingPeriodEnd: inv.billingPeriodEnd ?? '',
      dueDate: inv.dueDate ?? '',
      amount: inv.amount ?? '',
      billToCustomerId: inv.billToCustomerId ?? '',
      notes: inv.notes ?? '',
      coIds: inv.changeOrderAllocations.map((a) => a.changeOrderId),
    })
    setShowForm(true)
    if (inv.billingPeriodStart && inv.billingPeriodEnd) {
      void loadEvidence(inv.billingPeriodStart, inv.billingPeriodEnd)
    } else {
      setEvidence(null)
    }
  }

  const saveForm = async () => {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber.trim(),
        invoiceDate: form.invoiceDate,
        billingPeriodStart: form.billingPeriodStart || null,
        billingPeriodEnd: form.billingPeriodEnd || null,
        dueDate: form.dueDate || null,
        amount: form.amount.trim() === '' ? null : form.amount.trim(),
        billToCustomerId: form.billToCustomerId || null,
        notes: form.notes.trim() || null,
        changeOrderAllocations: form.coIds.map((changeOrderId) => ({ changeOrderId, amount: null })),
      }
      if (editingId) {
        await api.updateJobInvoice(workspaceId, jobId, editingId, body)
      } else {
        await api.createJobInvoice(workspaceId, jobId, body)
      }
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save invoice')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (inv: JobInvoice, status: JobInvoiceStatus) => {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      await api.updateJobInvoice(workspaceId, jobId, inv.id, { status })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    const inv = deleteTarget
    if (!inv || !canEdit || inv.status !== 'DRAFT') return
    setBusy(true)
    try {
      await api.deleteJobInvoice(workspaceId, jobId, inv.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>Loading billing…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {snapshot && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Billing summary
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>
              <div style={{ color: '#6b7280', fontSize: 11 }}>Revised Contract</div>
              <div style={{ fontWeight: 600 }}>
                {moneyLabel(snapshot.revisedContractValue)}
                {!snapshot.revisedContractValueComplete && (
                  <span style={{ color: '#9ca3af', fontWeight: 400, fontStyle: 'italic' }}> (incomplete)</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: 11 }}>Billed to Date</div>
              <div style={{ fontWeight: 600 }}>{moneyLabel(snapshot.totalBilled)}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                {snapshot.totalBilledInvoiceCount} submitted/approved
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: 11 }}>Remaining Unbilled</div>
              <div style={{ fontWeight: 600, color: snapshot.billingExceedsKnownContract ? '#b91c1c' : undefined }}>
                {moneyLabel(snapshot.remainingToBill)}
                {!snapshot.remainingToBillComplete && (
                  <span style={{ color: '#9ca3af', fontWeight: 400, fontStyle: 'italic' }}> (incomplete)</span>
                )}
              </div>
              {snapshot.billingPercentOfRevisedContract != null && (
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {formatMarginPercent(snapshot.billingPercentOfRevisedContract)} of contract
                </div>
              )}
            </div>
          </div>
          {snapshot.billingExceedsKnownContract && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
              Billing exceeds known revised contract — check unrecorded COs or invoice amounts.
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
            Total billed includes Submitted + Approved only. Draft / Rejected / Void excluded. No payment tracking.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>Invoices</div>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            disabled={busy}
            style={{
              padding: '6px 12px',
              background: '#1a1a2e',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            New Invoice
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            {editingId ? 'Edit Invoice' : 'New Invoice'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: 10 }}>
            <Field label="Invoice #">
              <input
                value={form.invoiceNumber}
                onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Invoice date">
              <input
                type="date"
                value={form.invoiceDate}
                onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Period start">
              <input
                type="date"
                value={form.billingPeriodStart}
                onChange={(e) => {
                  const billingPeriodStart = e.target.value
                  setForm((f) => ({ ...f, billingPeriodStart }))
                  void loadEvidence(billingPeriodStart, form.billingPeriodEnd)
                }}
                style={inputStyle}
              />
            </Field>
            <Field label="Period end">
              <input
                type="date"
                value={form.billingPeriodEnd}
                onChange={(e) => {
                  const billingPeriodEnd = e.target.value
                  setForm((f) => ({ ...f, billingPeriodEnd }))
                  void loadEvidence(form.billingPeriodStart, billingPeriodEnd)
                }}
                style={inputStyle}
              />
            </Field>
            <Field label="Due date">
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Amount">
              <input
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="Unknown until entered"
                style={inputStyle}
              />
            </Field>
            <Field label="Bill to">
              <select
                value={form.billToCustomerId}
                onChange={(e) => setForm((f) => ({ ...f, billToCustomerId: e.target.value }))}
                style={inputStyle}
              >
                <option value="">Not set</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          {changeOrders.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                Include Change Orders (optional provenance)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {changeOrders.map((co) => {
                  const checked = form.coIds.includes(co.id)
                  return (
                    <label
                      key={co.id}
                      style={{
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 8px',
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        background: checked ? '#eff6ff' : '#fff',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setForm((f) => ({
                            ...f,
                            coIds: checked ? f.coIds.filter((id) => id !== co.id) : [...f.coIds, co.id],
                          }))
                        }
                      />
                      {co.number}
                      {co.sellAmount != null ? ` (${moneyLabel(co.sellAmount)})` : ''}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {evidence && (form.billingPeriodStart && form.billingPeriodEnd) && (
            <div style={{ marginTop: 12, padding: 12, background: '#f9fafb', borderRadius: 6, fontSize: 12 }}>
              <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>
                Period evidence (context only — does not set amount)
              </div>
              {evidence.deliveries.length === 0 && evidence.installations.length === 0 ? (
                <div style={{ color: '#9ca3af' }}>No deliveries or installation in this period.</div>
              ) : (
                <>
                  {evidence.deliveries.map((d) => (
                    <div key={d.id}>
                      {formatOverviewDate(d.actualDeliveryDate)} — {d.deliveryNumber}
                      {d.packageNames.length ? ` — ${d.packageNames.join(', ')}` : ''}
                      {d.itemSummary ? ` — ${d.itemSummary}` : ''}
                    </div>
                  ))}
                  {evidence.installations.map((i) => (
                    <div key={i.id}>
                      {formatOverviewDate(i.eventDate)} — Install {i.eventType}
                      {i.workPackageName ? ` — ${i.workPackageName}` : ''}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => void saveForm()}
              disabled={busy || !form.invoiceNumber.trim() || !form.invoiceDate}
              style={{
                padding: '7px 14px',
                background: '#1a1a2e',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                padding: '7px 14px',
                background: '#fff',
                border: '1px solid #d0d5dd',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <div style={{ padding: 24, color: '#888', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          No invoices yet. Create a billing record when you submit a monthly invoice or pay application.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={th}>Invoice #</th>
                {!isPhone && <th style={th}>Period</th>}
                <th style={th}>Date</th>
                <th style={th}>Status</th>
                {!isPhone && <th style={th}>Bill To</th>}
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                {!isPhone && <th style={th}>COs</th>}
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <Fragment key={inv.id}>
                  <tr
                    style={{ borderTop: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                  >
                    <td style={td}>{inv.invoiceNumber}</td>
                    {!isPhone && <td style={td}>{periodLabel(inv.billingPeriodStart, inv.billingPeriodEnd)}</td>}
                    <td style={td}>{formatOverviewDate(inv.invoiceDate)}</td>
                    <td style={td}>
                      <span style={{ color: statusColor(inv.status), fontWeight: 600 }}>{inv.status}</span>
                    </td>
                    {!isPhone && <td style={td}>{inv.billToCustomerName ?? '—'}</td>}
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {moneyLabel(inv.amount)}
                    </td>
                    {!isPhone && (
                      <td style={td}>
                        {inv.changeOrderAllocations.length
                          ? inv.changeOrderAllocations.map((a) => a.changeOrderNumber).join(', ')
                          : '—'}
                      </td>
                    )}
                    <td style={td} onClick={(e) => e.stopPropagation()}>
                      {canEdit && inv.status === 'DRAFT' && (
                        <button type="button" style={linkBtn} onClick={() => openEdit(inv)}>
                          Edit
                        </button>
                      )}
                      {canEdit && inv.status === 'DRAFT' && (
                        <button type="button" style={linkBtn} onClick={() => void setStatus(inv, 'SUBMITTED')}>
                          Submit
                        </button>
                      )}
                      {canEdit && inv.status === 'SUBMITTED' && (
                        <button type="button" style={linkBtn} onClick={() => void setStatus(inv, 'APPROVED')}>
                          Approve
                        </button>
                      )}
                      {canEdit && inv.status === 'SUBMITTED' && (
                        <button type="button" style={linkBtn} onClick={() => void setStatus(inv, 'DRAFT')}>
                          Reopen
                        </button>
                      )}
                      {canEdit && inv.status !== 'VOID' && (
                        <button type="button" style={{ ...linkBtn, color: '#b91c1c' }} onClick={() => void setStatus(inv, 'VOID')}>
                          Void
                        </button>
                      )}
                      {canEdit && inv.status === 'DRAFT' && (
                        <button type="button" style={{ ...linkBtn, color: '#b91c1c' }} onClick={() => setDeleteTarget(inv)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === inv.id && (
                    <tr>
                      <td colSpan={isPhone ? 5 : 8} style={{ padding: '10px 12px', background: '#f9fafb', fontSize: 12 }}>
                        <div>Due: {inv.dueDate ? formatOverviewDate(inv.dueDate) : '—'}</div>
                        {inv.notes && <div style={{ marginTop: 4 }}>Notes: {inv.notes}</div>}
                        {inv.documentRecord && (
                          <div style={{ marginTop: 4 }}>
                            Document: {inv.documentRecord.documentNumber ?? inv.documentRecord.title ?? inv.documentRecord.id}
                          </div>
                        )}
                        {inv.changeOrderAllocations.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            COs:{' '}
                            {inv.changeOrderAllocations
                              .map((a) => `${a.changeOrderNumber}${a.amount != null ? ` ${moneyLabel(a.amount)}` : ''}`)
                              .join('; ')}
                          </div>
                        )}
                        {canEdit && inv.status === 'SUBMITTED' && (
                          <div style={{ marginTop: 6 }}>
                            <button type="button" style={linkBtn} onClick={() => void setStatus(inv, 'REJECTED')}>
                              Reject
                            </button>
                          </div>
                        )}
                        {canEdit && inv.status === 'REJECTED' && (
                          <button type="button" style={linkBtn} onClick={() => void setStatus(inv, 'DRAFT')}>
                            Return to Draft
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snapshot && snapshot.changeOrderBilled.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Change Order billing
          </div>
          {snapshot.changeOrderBilled.map((co) => (
            <div key={co.changeOrderId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, lineHeight: 1.6 }}>
              <span>
                {co.number} · approved {moneyLabel(co.approvedSellAmount)}
              </span>
              <span>
                billed {moneyLabel(co.billedToDate)} · remaining {moneyLabel(co.remainingUnbilled)}
                {!co.remainingComplete && <span style={{ color: '#9ca3af', fontStyle: 'italic' }}> (incomplete)</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      <JobConfirmDialog
        open={deleteTarget != null}
        title="Delete draft invoice"
        message={
          deleteTarget
            ? `Delete draft invoice ${deleteTarget.invoiceNumber}?`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
}

const th: CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  color: '#6b7280',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
}

const td: CSSProperties = {
  padding: '8px 10px',
  color: '#374151',
  verticalAlign: 'middle',
}

const linkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#1565c0',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0 6px 0 0',
}

export function BillingOverviewSummary({
  snapshot,
  onViewBilling,
}: {
  snapshot: JobBillingSnapshot | null | undefined
  onViewBilling?: () => void
}) {
  if (!snapshot) return null
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, display: 'flex', alignItems: 'center' }}>
        Billing
        <span style={{ flex: 1 }} />
        {onViewBilling && (
          <button
            type="button"
            onClick={onViewBilling}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid #d0d5dd',
              background: '#fff',
              cursor: 'pointer',
              color: '#1565c0',
              fontWeight: 600,
            }}
          >
            View Billing
          </button>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, lineHeight: 1.55 }}>
        <span>Billed to Date</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{moneyLabel(snapshot.totalBilled)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, lineHeight: 1.55 }}>
        <span>
          Remaining
          {!snapshot.remainingToBillComplete && (
            <span style={{ color: '#9ca3af', fontStyle: 'italic' }}> (incomplete)</span>
          )}
        </span>
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
            color: snapshot.billingExceedsKnownContract ? '#b91c1c' : undefined,
          }}
        >
          {moneyLabel(snapshot.remainingToBill)}
        </span>
      </div>
      {snapshot.billingPercentOfRevisedContract != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, lineHeight: 1.55, color: '#6b7280' }}>
          <span>Billing Progress</span>
          <span>{formatMarginPercent(snapshot.billingPercentOfRevisedContract)}</span>
        </div>
      )}
    </div>
  )
}
