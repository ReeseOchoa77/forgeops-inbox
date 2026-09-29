import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type JobChange, type JobChangeOrder, type JobDirective, type JobRfi, type JobChangesSummary, type JobWorkPackage } from '../api'
import { formatOverviewDate } from '../job-overview-format'

type SubTab = 'rfis' | 'directives' | 'changes' | 'changeOrders'

type Props = {
  workspaceId: string
  jobId: string
  canEdit: boolean
  isPhone: boolean
  onSummaryChange?: (summary: JobChangesSummary) => void
}

export function moneyLabel(value: string | null | undefined): string {
  if (value == null) return 'Not priced'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Not priced'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
}

export function rebuildSummary(rfis: JobRfi[], changes: JobChange[], changeOrders: JobChangeOrder[]): JobChangesSummary {
  const open = rfis.filter((r) => r.status === 'OPEN' || r.status === 'DRAFT')
  const proposed = changes.filter((c) => c.status === 'PROPOSED' || c.status === 'PRICING')
  let sum: number | null = null
  for (const c of proposed) {
    if (c.sellImpact == null) continue
    const n = Number(c.sellImpact)
    if (!Number.isFinite(n)) continue
    sum = (sum ?? 0) + n
  }
  return {
    openRfiCount: open.length,
    overdueRfiCount: open.filter((r) => r.overdue).length,
    proposedChangeCount: proposed.length,
    proposedSellImpact: sum == null ? null : sum.toFixed(2),
    pendingChangeOrderCount: changeOrders.filter((c) => c.status === 'DRAFT' || c.status === 'SUBMITTED').length,
  }
}

export function JobChangesView({ workspaceId, jobId, canEdit, isPhone, onSummaryChange }: Props) {
  const [sub, setSub] = useState<SubTab>('rfis')
  const [rfis, setRfis] = useState<JobRfi[]>([])
  const [directives, setDirectives] = useState<JobDirective[]>([])
  const [changes, setChanges] = useState<JobChange[]>([])
  const [changeOrders, setChangeOrders] = useState<JobChangeOrder[]>([])
  const [packages, setPackages] = useState<JobWorkPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, d, c, co, scope] = await Promise.all([
        api.listJobRfis(workspaceId, jobId),
        api.listJobDirectives(workspaceId, jobId),
        api.listJobChanges(workspaceId, jobId),
        api.listJobChangeOrders(workspaceId, jobId),
        api.getJobScope(workspaceId, jobId),
      ])
      setRfis(r.rfis)
      setDirectives(d.directives)
      setChanges(c.changes)
      setChangeOrders(co.changeOrders)
      setPackages(scope.packages)
      onSummaryChange?.(rebuildSummary(r.rfis, c.changes, co.changeOrders))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load changes')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId, onSummaryChange])

  useEffect(() => {
    void load()
  }, [load])

  const createRfi = async () => {
    const number = window.prompt('RFI number', 'RFI-001')
    if (!number?.trim()) return
    const subject = window.prompt('Subject')
    if (!subject?.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.createJobRfi(workspaceId, jobId, { number: number.trim(), subject: subject.trim(), status: 'OPEN' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create RFI')
    } finally {
      setBusy(false)
    }
  }

  const answerRfi = async (rfi: JobRfi) => {
    const response = window.prompt('Response', rfi.response ?? '')
    if (response == null) return
    setBusy(true)
    try {
      await api.updateJobRfi(workspaceId, jobId, rfi.id, { status: 'ANSWERED', response })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to answer RFI')
    } finally {
      setBusy(false)
    }
  }

  const closeRfi = async (rfi: JobRfi) => {
    setBusy(true)
    try {
      await api.updateJobRfi(workspaceId, jobId, rfi.id, { status: 'CLOSED' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close RFI')
    } finally {
      setBusy(false)
    }
  }

  const createDirective = async () => {
    const type = window.prompt('Type: ASI, BULLETIN, ADDENDUM, or OTHER', 'ASI')?.toUpperCase()
    if (!type || !['ASI', 'BULLETIN', 'ADDENDUM', 'OTHER'].includes(type)) return
    const number = window.prompt('Directive number', 'ASI-01')
    if (!number?.trim()) return
    const title = window.prompt('Title')
    if (!title?.trim()) return
    setBusy(true)
    try {
      await api.createJobDirective(workspaceId, jobId, {
        type: type as 'ASI' | 'BULLETIN' | 'ADDENDUM' | 'OTHER',
        number: number.trim(),
        title: title.trim(),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create directive')
    } finally {
      setBusy(false)
    }
  }

  const createChange = async (from?: { rfiId?: string; directiveId?: string }) => {
    const number = window.prompt('Change number', 'CH-001')
    if (!number?.trim()) return
    const title = window.prompt('Title')
    if (!title?.trim()) return
    const sellRaw = window.prompt('Sell impact (blank = not priced, 0 = zero)', '')
    const costRaw = window.prompt('Cost impact (blank = not priced, 0 = zero)', '')
    setBusy(true)
    try {
      await api.createJobChange(workspaceId, jobId, {
        number: number.trim(),
        title: title.trim(),
        status: 'IDENTIFIED',
        sourceRfiId: from?.rfiId ?? null,
        sourceDirectiveId: from?.directiveId ?? null,
        sellImpact: sellRaw === '' || sellRaw == null ? null : Number(sellRaw),
        costImpact: costRaw === '' || costRaw == null ? null : Number(costRaw),
      })
      await load()
      setSub('changes')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create change')
    } finally {
      setBusy(false)
    }
  }

  const setChangeStatus = async (change: JobChange, status: JobChange['status']) => {
    setBusy(true)
    try {
      await api.updateJobChange(workspaceId, jobId, change.id, { status })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update change')
    } finally {
      setBusy(false)
    }
  }

  const createCO = async () => {
    const number = window.prompt('Change Order number', 'CO-01')
    if (!number?.trim()) return
    const eligible = changes.filter((c) => !c.changeOrder && (c.status === 'APPROVED' || c.status === 'PROPOSED'))
    const ids = eligible.map((c) => c.id)
    setBusy(true)
    try {
      await api.createJobChangeOrder(workspaceId, jobId, {
        number: number.trim(),
        changeIds: ids,
        status: 'DRAFT',
      })
      await load()
      setSub('changeOrders')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create change order')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading changes…</div>
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
        background: sub === key ? '#1a1a2e' : '#fff',
        color: sub === key ? '#fff' : '#374151',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {chip('rfis', `RFIs (${rfis.length})`)}
        {chip('directives', `Directives (${directives.length})`)}
        {chip('changes', `Changes (${changes.length})`)}
        {chip('changeOrders', `Change Orders (${changeOrders.length})`)}
      </div>
      {error && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: '#fce4ec', color: '#c62828', fontSize: 13 }}>
          {error}
        </div>
      )}

      {sub === 'rfis' && (
        <Section
          title="RFIs"
          action={canEdit ? { label: '+ RFI', onClick: () => void createRfi(), disabled: busy } : undefined}
        >
          {rfis.length === 0 ? (
            <Empty>No RFIs yet.</Empty>
          ) : (
            rfis.map((rfi) => (
              <Row key={rfi.id} isPhone={isPhone}>
                <strong style={{ color: rfi.overdue ? '#b91c1c' : undefined }}>{rfi.number}</strong>
                <div>
                  <div style={{ fontWeight: 600 }}>{rfi.subject}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {rfi.status}
                    {rfi.overdue ? ' · Overdue' : ''}
                    {rfi.responseDueDate ? ` · Due ${formatOverviewDate(`${rfi.responseDueDate}T00:00:00.000Z`)}` : ''}
                    {rfi.workPackages.length ? ` · ${rfi.workPackages.map((p) => p.name).join(', ')}` : ''}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {rfi.status === 'OPEN' && (
                      <Btn onClick={() => void answerRfi(rfi)} disabled={busy}>Answer</Btn>
                    )}
                    {(rfi.status === 'ANSWERED' || rfi.status === 'OPEN') && (
                      <Btn onClick={() => void closeRfi(rfi)} disabled={busy}>Close</Btn>
                    )}
                    <Btn onClick={() => void createChange({ rfiId: rfi.id })} disabled={busy}>Create Change</Btn>
                  </div>
                )}
              </Row>
            ))
          )}
        </Section>
      )}

      {sub === 'directives' && (
        <Section
          title="Directives"
          action={canEdit ? { label: '+ Directive', onClick: () => void createDirective(), disabled: busy } : undefined}
        >
          {directives.length === 0 ? (
            <Empty>No directives yet.</Empty>
          ) : (
            directives.map((d) => (
              <Row key={d.id} isPhone={isPhone}>
                <strong>{d.type}-{d.number}</strong>
                <div>
                  <div style={{ fontWeight: 600 }}>{d.title}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {d.status}
                    {d.issuedDate ? ` · ${formatOverviewDate(`${d.issuedDate}T00:00:00.000Z`)}` : ''}
                    {d.workPackages.length ? ` · ${d.workPackages.map((p) => p.name).join(', ')}` : ''}
                    {d.changes.length ? ` · ${d.changes.length} change(s)` : ''}
                  </div>
                </div>
                {canEdit && d.status === 'ACTIVE' && (
                  <Btn onClick={() => void createChange({ directiveId: d.id })} disabled={busy}>Create Change</Btn>
                )}
              </Row>
            ))
          )}
        </Section>
      )}

      {sub === 'changes' && (
        <Section
          title="Changes"
          action={canEdit ? { label: '+ Change', onClick: () => void createChange(), disabled: busy } : undefined}
        >
          {changes.length === 0 ? (
            <Empty>No changes yet.</Empty>
          ) : (
            changes.map((ch) => (
              <Row key={ch.id} isPhone={isPhone}>
                <strong>{ch.number}</strong>
                <div>
                  <div style={{ fontWeight: 600 }}>{ch.title}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {ch.status} · {ch.type}
                    {ch.sourceRfi ? ` · from ${ch.sourceRfi.number}` : ''}
                    {ch.sourceDirective ? ` · from ${ch.sourceDirective.number}` : ''}
                    {ch.changeOrder ? ` · ${ch.changeOrder.number}` : ''}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    Cost: <span style={{ color: ch.costImpact == null ? '#9ca3af' : '#111', fontStyle: ch.costImpact == null ? 'italic' : 'normal' }}>{moneyLabel(ch.costImpact)}</span>
                    {' · '}
                    Sell: <span style={{ color: ch.sellImpact == null ? '#9ca3af' : '#111', fontStyle: ch.sellImpact == null ? 'italic' : 'normal' }}>{moneyLabel(ch.sellImpact)}</span>
                    {ch.scheduleImpactDays != null ? ` · +${ch.scheduleImpactDays}d` : ''}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {ch.status === 'IDENTIFIED' && <Btn onClick={() => void setChangeStatus(ch, 'PROPOSED')} disabled={busy}>Propose</Btn>}
                    {(ch.status === 'PROPOSED' || ch.status === 'PRICING') && (
                      <Btn onClick={() => void setChangeStatus(ch, 'APPROVED')} disabled={busy}>Approve</Btn>
                    )}
                    {ch.status !== 'VOID' && ch.status !== 'REJECTED' && (
                      <Btn onClick={() => void setChangeStatus(ch, 'REJECTED')} disabled={busy}>Reject</Btn>
                    )}
                  </div>
                )}
              </Row>
            ))
          )}
        </Section>
      )}

      {sub === 'changeOrders' && (
        <Section
          title="Change Orders"
          action={canEdit ? { label: '+ Change Order', onClick: () => void createCO(), disabled: busy } : undefined}
        >
          {changeOrders.length === 0 ? (
            <Empty>No change orders yet.</Empty>
          ) : (
            changeOrders.map((co) => (
              <Row key={co.id} isPhone={isPhone}>
                <strong>{co.number}</strong>
                <div>
                  <div style={{ fontWeight: 600 }}>{co.title || 'Change Order'}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {co.status}
                    {co.submittedDate ? ` · Submitted ${formatOverviewDate(`${co.submittedDate}T00:00:00.000Z`)}` : ''}
                    {co.approvedDate ? ` · Approved ${formatOverviewDate(`${co.approvedDate}T00:00:00.000Z`)}` : ''}
                    {' · '}
                    Sell: <span style={{ fontStyle: co.sellAmount == null ? 'italic' : 'normal', color: co.sellAmount == null ? '#9ca3af' : undefined }}>{moneyLabel(co.sellAmount)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {co.changes.length} change(s): {co.changes.map((c) => c.number).join(', ') || '—'}
                  </div>
                </div>
                {canEdit && co.status === 'DRAFT' && (
                  <Btn
                    onClick={() => {
                      void api.updateJobChangeOrder(workspaceId, jobId, co.id, { status: 'SUBMITTED' }).then(load)
                    }}
                    disabled={busy}
                  >
                    Submit
                  </Btn>
                )}
                {canEdit && co.status === 'SUBMITTED' && (
                  <Btn
                    onClick={() => {
                      void api.updateJobChangeOrder(workspaceId, jobId, co.id, { status: 'APPROVED' }).then(load)
                    }}
                    disabled={busy}
                  >
                    Approve
                  </Btn>
                )}
              </Row>
            ))
          )}
        </Section>
      )}
      {/* packages available for future package pickers */}
      {packages.length === 0 ? null : null}
    </div>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: { label: string; onClick: () => void; disabled?: boolean }
  children: ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </div>
        <span style={{ flex: 1 }} />
        {action && (
          <button
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: '1px solid #1a1a2e', background: '#1a1a2e', color: '#fff', cursor: 'pointer',
            }}
          >
            {action.label}
          </button>
        )}
      </div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 12px' }}>
        {children}
      </div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: '16px 0', fontSize: 13, color: '#888' }}>{children}</div>
}

function Row({ children, isPhone }: { children: ReactNode; isPhone: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isPhone ? '1fr' : '90px 1fr auto',
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

export function ChangesOverviewSummary({
  summary,
  onViewChanges,
}: {
  summary: JobChangesSummary | null | undefined
  onViewChanges?: () => void
}) {
  const empty = !summary || (
    summary.openRfiCount === 0 &&
    summary.proposedChangeCount === 0 &&
    summary.pendingChangeOrderCount === 0
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Project Issues / Changes
        </div>
        <span style={{ flex: 1 }} />
        {onViewChanges && (
          <button
            type="button"
            onClick={onViewChanges}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: '#1565c0', fontWeight: 600 }}
          >
            View Changes
          </button>
        )}
      </div>
      {empty ? (
        <div style={{ fontSize: 13, color: '#888' }}>No open RFIs or pending changes.</div>
      ) : (
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
          {summary!.openRfiCount > 0 && (
            <div>
              {summary!.openRfiCount} open RFI{summary!.openRfiCount === 1 ? '' : 's'}
              {summary!.overdueRfiCount > 0 && (
                <span style={{ color: '#b91c1c', fontWeight: 600 }}> · {summary!.overdueRfiCount} overdue</span>
              )}
            </div>
          )}
          {summary!.proposedChangeCount > 0 && (
            <div>
              {summary!.proposedChangeCount} proposed/pricing change{summary!.proposedChangeCount === 1 ? '' : 's'}
              {summary!.proposedSellImpact != null && (
                <span> · {moneyLabel(summary!.proposedSellImpact)} sell</span>
              )}
              {summary!.proposedSellImpact == null && (
                <span style={{ color: '#9ca3af', fontStyle: 'italic' }}> · sell not fully priced</span>
              )}
            </div>
          )}
          {summary!.pendingChangeOrderCount > 0 && (
            <div>{summary!.pendingChangeOrderCount} pending change order{summary!.pendingChangeOrderCount === 1 ? '' : 's'}</div>
          )}
        </div>
      )}
    </div>
  )
}
