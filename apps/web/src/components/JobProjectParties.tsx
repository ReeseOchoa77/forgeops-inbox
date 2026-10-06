import { useEffect, useState } from 'react'
import {
  api,
  type JobParticipant,
  type JobParticipantRole,
  type ParticipantCandidateBucket,
} from '../api'
import { partyLabel } from '../job-overview-format'

const ROLE_LABELS: Record<JobParticipantRole, string> = {
  PROJECT_MANAGER: 'Project Manager',
  ESTIMATOR: 'Estimator',
  GENERAL_CONTRACTOR: 'Customer',
  CLIENT: 'Customer',
  OWNER: 'Owner',
  ARCHITECT: 'Architect',
  ENGINEER: 'Engineer',
  DETAILER: 'Detailer',
  ERECTOR: 'Erector',
  SUPPLIER: 'Supplier',
  OTHER: 'Other',
}

/** Hide duplicate CLIENT option — Customer uses GENERAL_CONTRACTOR. */
const ROLE_OPTIONS = (Object.entries(ROLE_LABELS) as Array<[JobParticipantRole, string]>).filter(
  ([role]) => role !== 'CLIENT',
)

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr 1.2fr auto',
  gap: 8,
  padding: '8px 0',
  borderBottom: '1px solid #f0f0f0',
  fontSize: 12,
  alignItems: 'start',
}

type Props = {
  workspaceId: string
  jobId: string
  participants: JobParticipant[]
  canEdit: boolean
  isPhone: boolean
  onChange: (participants: JobParticipant[]) => void
}

export function JobProjectParties({
  workspaceId,
  jobId,
  participants,
  canEdit,
  isPhone,
  onChange,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [role, setRole] = useState<JobParticipantRole>('PROJECT_MANAGER')
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<ParticipantCandidateBucket | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!adding) return
    const q = query.trim()
    if (q.length < 1) {
      setCandidates(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      api
        .searchJobParticipantCandidates(workspaceId, q)
        .then((result) => {
          if (!cancelled) setCandidates(result)
        })
        .catch(() => {
          if (!cancelled) setCandidates(null)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [adding, query, workspaceId])

  const refresh = async () => {
    const res = await api.listJobParticipants(workspaceId, jobId)
    onChange(res.participants)
  }

  const addParty = async (party: {
    userId?: string
    customerId?: string
    vendorId?: string
    contactId?: string
  }) => {
    setBusy(true)
    setError(null)
    try {
      await api.createJobParticipant(workspaceId, jobId, {
        role,
        ...party,
        isPrimary: role === 'PROJECT_MANAGER',
      })
      await refresh()
      setAdding(false)
      setQuery('')
      setCandidates(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add participant')
    } finally {
      setBusy(false)
    }
  }

  const removeParty = async (participantId: string) => {
    if (!confirm('Remove this participant from the job?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteJobParticipant(workspaceId, jobId, participantId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove participant')
    } finally {
      setBusy(false)
    }
  }

  const setPrimaryPm = async (participantId: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.updateJobParticipant(workspaceId, jobId, participantId, {
        isPrimary: true,
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update participant')
    } finally {
      setBusy(false)
    }
  }

  const flatCandidates = candidates
    ? [
        ...candidates.users.map((u) => ({
          key: `USER:${u.id}`,
          label: u.name?.trim() || u.email,
          sub: `${u.email} · Internal`,
          party: { userId: u.id },
        })),
        ...candidates.customers.map((c) => ({
          key: `CUSTOMER:${c.id}`,
          label: c.name,
          sub: [c.email, 'Customer'].filter(Boolean).join(' · '),
          party: { customerId: c.id },
        })),
        ...candidates.vendors.map((v) => ({
          key: `VENDOR:${v.id}`,
          label: v.name,
          sub: [v.email, 'Vendor'].filter(Boolean).join(' · '),
          party: { vendorId: v.id },
        })),
        ...candidates.contacts.map((c) => ({
          key: `CONTACT:${c.id}`,
          label: c.name?.trim() || c.email || 'Contact',
          sub: [c.organizationName, c.email, 'Contact'].filter(Boolean).join(' · '),
          party: { contactId: c.id },
        })),
      ]
    : []

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Project Parties
        </div>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding((v) => !v)}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer',
            }}
          >
            {adding ? 'Cancel' : 'Add participant'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: '#fce4ec', color: '#c62828', fontSize: 12 }}>
          {error}
        </div>
      )}

      {adding && (
        <div style={{ marginBottom: 12, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as JobParticipantRole)}
              style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d0d5dd' }}
            >
              {ROLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users, customers, vendors, contacts…"
              style={{ flex: 1, minWidth: 180, padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d0d5dd' }}
            />
          </div>
          {searching && <div style={{ fontSize: 11, color: '#888' }}>Searching…</div>}
          {!searching && query.trim() && flatCandidates.length === 0 && (
            <div style={{ fontSize: 11, color: '#888' }}>
              No matches. Create contacts/customers in Company Data if needed.
            </div>
          )}
          {flatCandidates.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={busy}
              onClick={() => void addParty(item.party)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: '#fff',
                border: '1px solid #eee', borderRadius: 6, padding: '7px 10px', marginBottom: 4,
                cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{item.sub}</div>
            </button>
          ))}
        </div>
      )}

      {participants.length === 0 ? (
        <div style={{ fontSize: 13, color: '#888' }}>No additional project parties yet.</div>
      ) : (
        <div>
          {!isPhone && (
            <div style={{ ...rowStyle, color: '#9ca3af', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>
              <div>Role</div>
              <div>Name / Org</div>
              <div>Contact</div>
              <div />
            </div>
          )}
          {participants.map((p) => (
            <div
              key={p.id}
              style={
                isPhone
                  ? { padding: '10px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }
                  : rowStyle
              }
            >
              <div style={{ fontWeight: 600, color: '#374151' }}>
                {ROLE_LABELS[p.role]}
                {p.role === 'PROJECT_MANAGER' && p.isPrimary ? ' · Primary' : ''}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{partyLabel(p.name)}</div>
                {p.organizationName && p.organizationName !== p.name && (
                  <div style={{ color: '#6b7280' }}>{p.organizationName}</div>
                )}
                {p.title ? <div style={{ color: '#9ca3af' }}>{p.title}</div> : null}
              </div>
              <div style={{ color: '#6b7280', lineHeight: 1.4 }}>
                {p.email || '—'}
                {p.phone ? <><br />{p.phone}</> : null}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {p.role === 'PROJECT_MANAGER' && !p.isPrimary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setPrimaryPm(p.id)}
                      style={{
                        background: 'none', border: '1px solid #e5e7eb', borderRadius: 4,
                        fontSize: 11, padding: '2px 6px', cursor: 'pointer',
                      }}
                    >
                      Set primary
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeParty(p.id)}
                    style={{
                      background: 'none', border: '1px solid #e5e7eb', borderRadius: 4,
                      fontSize: 11, color: '#b91c1c', padding: '2px 6px', cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
