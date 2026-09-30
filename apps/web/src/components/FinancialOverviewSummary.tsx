import type { JobBillingSnapshot, JobFinancialSnapshot } from '../api'
import { buildFinancialOverviewRows } from '../job-financial-format'
import { BillingOverviewSummary } from '../views/JobBillingView'

function Row({
  label,
  value,
  muted,
  emphasize,
  incomplete,
}: {
  label: string
  value: string
  muted?: boolean
  emphasize?: boolean
  incomplete?: boolean
}) {
  const unknown = value === 'Unknown'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: emphasize ? 13 : 12,
        fontWeight: emphasize ? 600 : 400,
        color: muted || unknown ? '#9ca3af' : '#374151',
        fontStyle: unknown ? 'italic' : undefined,
        lineHeight: 1.55,
      }}
    >
      <span>
        {label}
        {incomplete ? (
          <span style={{ fontWeight: 400, fontStyle: 'italic', color: '#9ca3af' }}> (incomplete)</span>
        ) : null}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export function FinancialOverviewSummary({
  snapshot,
  billingSnapshot,
  onViewChanges,
  onViewProcurement,
  onViewBilling,
}: {
  snapshot: JobFinancialSnapshot | null | undefined
  billingSnapshot?: JobBillingSnapshot | null
  onViewChanges?: () => void
  onViewProcurement?: () => void
  onViewBilling?: () => void
}) {
  if (!snapshot) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Financial
        </div>
        <div style={{ fontSize: 13, color: '#888', marginTop: 8 }}>Financial baselines not loaded.</div>
      </div>
    )
  }

  const rows = buildFinancialOverviewRows(snapshot)

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Financial
        </div>
        <span style={{ flex: 1 }} />
        {onViewChanges && (
          <button
            type="button"
            onClick={onViewChanges}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: '#1565c0', fontWeight: 600 }}
          >
            Changes
          </button>
        )}
        {onViewProcurement && (
          <button
            type="button"
            onClick={onViewProcurement}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: '#1565c0', fontWeight: 600 }}
          >
            Procurement
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        <section>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Contract</div>
          {rows.contract.map((r) => (
            <Row key={r.label} {...r} />
          ))}
          {rows.pending.map((r) => (
            <Row key={r.label} {...r} />
          ))}
          <BillingOverviewSummary snapshot={billingSnapshot} onViewBilling={onViewBilling} />
        </section>

        <section>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Estimate</div>
          {rows.estimate.map((r) => (
            <Row key={r.label} {...r} />
          ))}
          {rows.margin.map((r) => (
            <Row key={r.label} {...r} />
          ))}
        </section>

        <section>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Commitments</div>
          {rows.commitments.map((r) => (
            <Row key={r.label} {...r} />
          ))}
          {rows.fabricationHours != null && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Estimated fabrication hours: {rows.fabricationHours}
              <span style={{ fontStyle: 'italic', color: '#9ca3af' }}> (operational — no labor rate)</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
