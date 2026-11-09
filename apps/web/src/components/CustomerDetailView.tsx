import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { api, type CustomerDetailResponse } from '../api'
import { lifecycleLabel } from './BidCandidateDetail'

type Props = {
  workspaceId: string
  customerId: string
  canEdit: boolean
  onBack: () => void
  onOpenJob?: (jobId: string) => void
  onOpenBid?: (candidateId: string) => void
}

export function CustomerDetailView({
  workspaceId,
  customerId,
  canEdit,
  onBack,
  onOpenJob,
  onOpenBid,
}: Props) {
  const [data, setData] = useState<CustomerDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [domain, setDomain] = useState('')
  const [notes, setNotes] = useState('')
  const [externalRef, setExternalRef] = useState('')

  const load = () => {
    setLoading(true)
    setError(null)
    api
      .getCustomer(workspaceId, customerId)
      .then((res) => {
        setData(res)
        setName(res.customer.name)
        setPhone(res.customer.phone ?? '')
        setEmail(res.customer.primaryEmail ?? '')
        setDomain(res.customer.domain ?? '')
        setNotes(res.customer.notes ?? '')
        setExternalRef(res.customer.externalRef ?? '')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load customer'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, customerId])

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.updateCustomer(workspaceId, customerId, {
        name: name.trim(),
        phone: phone.trim() || null,
        primaryEmail: email.trim() || null,
        domain: domain.trim() || null,
        notes: notes.trim() || null,
        externalRef: externalRef.trim() || null,
      })
      setEditing(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update customer')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: 12 }}>Loading customer…</div>
  }
  if (!data) {
    return (
      <div>
        <button type="button" onClick={onBack} style={linkBtn}>← Customers</button>
        <div style={{ color: '#b42318', fontSize: 13, marginTop: 12 }}>{error ?? 'Not found'}</div>
      </div>
    )
  }

  const c = data.customer

  return (
    <div>
      <button type="button" onClick={onBack} style={linkBtn}>← Customers</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>{c.name}</h2>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} style={secondaryBtn}>Edit</button>
        )}
      </div>
      {error && (
        <div role="alert" style={{ color: '#b42318', fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}

      <Section title="Overview">
        {editing ? (
          <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
            <Labeled label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Labeled>
            <Labeled label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Labeled>
            <Labeled label="Domain">
              <input value={domain} onChange={(e) => setDomain(e.target.value)} style={inputStyle} />
            </Labeled>
            <Labeled label="Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </Labeled>
            <Labeled label="External ref">
              <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} style={inputStyle} />
            </Labeled>
            <Labeled label="Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </Labeled>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void save()} disabled={saving} style={primaryBtn}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setName(c.name)
                  setPhone(c.phone ?? '')
                  setEmail(c.primaryEmail ?? '')
                  setDomain(c.domain ?? '')
                  setNotes(c.notes ?? '')
                  setExternalRef(c.externalRef ?? '')
                }}
                disabled={saving}
                style={secondaryBtn}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <KV label="Email" value={c.primaryEmail || '—'} />
            <KV label="Domain" value={c.domain || '—'} />
            <KV label="Phone" value={c.phone || '—'} />
            <KV label="External ref" value={c.externalRef || '—'} />
            <KV label="Notes" value={c.notes || '—'} />
            <KV label="Jobs" value={String(c._count.jobs)} />
            <KV label="Active Bids" value={String(c._count.bidCandidates)} />
            <KV label="Contacts" value={String(c._count.contacts)} />
          </div>
        )}
      </Section>

      <Section title="Jobs">
        {data.jobs.length === 0 ? (
          <Empty>No Jobs linked to this Customer.</Empty>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Job #</th>
                <th style={th}>Name</th>
                <th style={th}>Status</th>
                <th style={th}>Start</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr
                  key={j.id}
                  onClick={() => onOpenJob?.(j.id)}
                  style={{ cursor: onOpenJob ? 'pointer' : 'default' }}
                >
                  <td style={td}>{j.jobNumber || '—'}</td>
                  <td style={{ ...td, fontWeight: 500, color: onOpenJob ? '#1d4ed8' : undefined }}>{j.name}</td>
                  <td style={td}>{j.status}{j.archivedAt ? ' (archived)' : ''}</td>
                  <td style={td}>{formatUtcDate(j.startDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Active Bids">
        {data.bidCandidates.length === 0 ? (
          <Empty>No Bid Candidates linked to this Customer.</Empty>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Project</th>
                <th style={th}>Lifecycle</th>
                <th style={th}>Bid due</th>
                <th style={th}>Start</th>
                <th style={th}>Quote</th>
              </tr>
            </thead>
            <tbody>
              {data.bidCandidates.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => onOpenBid?.(b.id)}
                  style={{ cursor: onOpenBid ? 'pointer' : 'default' }}
                >
                  <td style={{ ...td, fontWeight: 500, color: onOpenBid ? '#1d4ed8' : undefined }}>
                    {b.projectName || '—'}
                  </td>
                  <td style={td}>{lifecycleLabel(b.lifecycle as never)}</td>
                  <td style={td}>{formatUtcDate(b.bidDueAt)}</td>
                  <td style={td}>{formatUtcDate(b.anticipatedStartAt)}</td>
                  <td style={td}>
                    {b.quotes[0]?.quotedAmount != null ? String(b.quotes[0].quotedAmount) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Contacts">
        {data.contacts.length === 0 ? (
          <Empty>No contacts linked to this Customer.</Empty>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Phone</th>
                <th style={th}>Role</th>
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((ct) => (
                <tr key={ct.id}>
                  <td style={td}>{ct.name || '—'}</td>
                  <td style={td}>{ct.email || '—'}</td>
                  <td style={td}>{ct.phone || '—'}</td>
                  <td style={td}>{ct.role || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 650, color: '#111827' }}>{title}</h3>
      {children}
    </section>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 12, color: '#374151' }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ width: 110, color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, color: '#9ca3af' }}>{children}</div>
}

function formatUtcDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const linkBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  color: '#1d4ed8',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
}
const secondaryBtn: CSSProperties = {
  padding: '6px 12px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  background: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
const primaryBtn: CSSProperties = {
  ...secondaryBtn,
  background: '#1a1a2e',
  color: '#fff',
  borderColor: '#1a1a2e',
}
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
}
const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
}
const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  color: '#6b7280',
  fontWeight: 600,
  fontSize: 12,
}
const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #f3f4f6',
  color: '#111827',
}
