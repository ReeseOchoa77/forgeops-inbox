import { useEffect, useMemo, useState } from 'react'

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

interface SenderRecord {
  id: string; senderEmail: string; senderDomain: string; displayName: string | null
  businessEvidenceCount: number; personalEvidenceCount: number
  manualBusinessConfirmations: number; manualPersonalConfirmations: number
  status: string; confidence: string; lastBusinessAt: string | null; lastPersonalAt: string | null
}

interface DomainRecord {
  id: string; domain: string; isPublicDomain: boolean
  businessEvidenceCount: number; personalEvidenceCount: number
  status: string; confidence: string
}

interface Props { workspaceId: string }

type SortMode = 'most_emails' | 'least_emails' | 'alphabetical'

const STATUS_TAGS = [
  'OBSERVED',
  'LIKELY_BUSINESS',
  'CONFIRMED_BUSINESS',
  'CONFIRMED_PERSONAL',
  'BLOCKED',
] as const

const SORT_OPTIONS: Array<{ key: SortMode; label: string }> = [
  { key: 'most_emails', label: 'Most emails sent' },
  { key: 'least_emails', label: 'Least emails sent' },
  { key: 'alphabetical', label: 'Alphabetical' },
]

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  OBSERVED: { bg: '#f5f5f5', fg: '#888' },
  LIKELY_BUSINESS: { bg: '#e3f2fd', fg: '#1565c0' },
  CONFIRMED_BUSINESS: { bg: '#e6f4ea', fg: '#2e7d32' },
  CONFIRMED_PERSONAL: { bg: '#f3e5f5', fg: '#6a1b9a' },
  BLOCKED: { bg: '#fce4ec', fg: '#c62828' }
}

function emailVolume(biz: number, personal: number): number {
  return biz + personal
}

function toggleStatus(prev: Set<string>, status: string): Set<string> {
  const next = new Set(prev)
  if (next.has(status)) next.delete(status)
  else next.add(status)
  return next
}

function sortSenders(list: SenderRecord[], sortBy: SortMode): SenderRecord[] {
  return [...list].sort((a, b) => {
    if (sortBy === 'alphabetical') {
      const an = (a.displayName || a.senderEmail).toLowerCase()
      const bn = (b.displayName || b.senderEmail).toLowerCase()
      return an.localeCompare(bn) || a.senderEmail.localeCompare(b.senderEmail)
    }
    const ca = emailVolume(a.businessEvidenceCount, a.personalEvidenceCount)
    const cb = emailVolume(b.businessEvidenceCount, b.personalEvidenceCount)
    if (sortBy === 'most_emails') return cb - ca || a.senderEmail.localeCompare(b.senderEmail)
    return ca - cb || a.senderEmail.localeCompare(b.senderEmail)
  })
}

function sortDomains(list: DomainRecord[], sortBy: SortMode): DomainRecord[] {
  return [...list].sort((a, b) => {
    if (sortBy === 'alphabetical') {
      return a.domain.localeCompare(b.domain)
    }
    const ca = emailVolume(a.businessEvidenceCount, a.personalEvidenceCount)
    const cb = emailVolume(b.businessEvidenceCount, b.personalEvidenceCount)
    if (sortBy === 'most_emails') return cb - ca || a.domain.localeCompare(b.domain)
    return ca - cb || a.domain.localeCompare(b.domain)
  })
}

export function SenderEvidenceView({ workspaceId }: Props) {
  const [senders, setSenders] = useState<SenderRecord[]>([])
  const [domains, setDomains] = useState<DomainRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'senders' | 'domains'>('senders')
  /** Empty set = show all statuses. Passive sort stays applied regardless. */
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<SortMode>('most_emails')

  const load = async () => {
    setLoading(true)
    try {
      // Always load full list; tag filters + sort are applied client-side so sort stays independent.
      const url = `${BASE}/workspaces/${workspaceId}/sender-evidence`
      const res = await fetch(url, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json() as { senders: SenderRecord[]; domains: DomainRecord[] }
        setSenders(data.senders)
        setDomains(data.domains)
      }
    } catch { /* */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [workspaceId])

  const confirm = async (id: string, classification: 'BUSINESS' | 'PERSONAL') => {
    await fetch(`${BASE}/workspaces/${workspaceId}/sender-evidence/${id}/confirm`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification })
    })
    load()
  }

  const reset = async (id: string) => {
    await fetch(`${BASE}/workspaces/${workspaceId}/sender-evidence/${id}/reset`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    load()
  }

  const visibleSenders = useMemo(() => {
    const filtered = selectedStatuses.size === 0
      ? senders
      : senders.filter(s => selectedStatuses.has(s.status))
    return sortSenders(filtered, sortBy)
  }, [senders, selectedStatuses, sortBy])

  const visibleDomains = useMemo(() => {
    const filtered = selectedStatuses.size === 0
      ? domains
      : domains.filter(d => selectedStatuses.has(d.status))
    return sortDomains(filtered, sortBy)
  }, [domains, selectedStatuses, sortBy])

  if (loading) return <p style={{ color: '#888', fontSize: 13 }}>Loading...</p>

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Sender Evidence</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>Track sender classification patterns and manually confirm business or personal senders.</p>

      <div style={{ display: 'flex', gap: 0, marginBottom: 8, borderBottom: '2px solid #e5e5e5' }}>
        {(['senders', 'domains'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 18px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? '#1a1a2e' : '#888', background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #1a1a2e' : '2px solid transparent',
            marginBottom: -2, cursor: 'pointer', textTransform: 'capitalize'
          }}>{t} ({t === 'senders' ? visibleSenders.length : visibleDomains.length})</button>
        ))}
      </div>

      <div style={{
        display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#999', marginRight: 2 }}>Tags</span>
          <button
            type="button"
            onClick={() => setSelectedStatuses(new Set())}
            style={{
              padding: '3px 10px', fontSize: 11, borderRadius: 12,
              border: selectedStatuses.size === 0 ? '1px solid #1a1a2e' : '1px solid #ddd',
              background: selectedStatuses.size === 0 ? '#1a1a2e' : '#fff',
              color: selectedStatuses.size === 0 ? '#fff' : '#666', cursor: 'pointer'
            }}
          >All</button>
          {STATUS_TAGS.map(s => {
            const active = selectedStatuses.has(s)
            return (
              <button
                key={s}
                type="button"
                title={active ? 'Remove tag filter' : 'Add tag filter'}
                onClick={() => setSelectedStatuses(prev => toggleStatus(prev, s))}
                style={{
                  padding: '3px 10px', fontSize: 11, borderRadius: 12,
                  border: active ? '1px solid #1a1a2e' : '1px solid #ddd',
                  background: active ? '#1a1a2e' : '#fff',
                  color: active ? '#fff' : '#666', cursor: 'pointer'
                }}
              >{s.replace(/_/g, ' ')}</button>
            )
          })}
          {selectedStatuses.size > 0 && (
            <span style={{ fontSize: 11, color: '#888' }}>
              {selectedStatuses.size} selected
            </span>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
          Sort
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortMode)}
            aria-label="Sort senders"
            style={{
              padding: '4px 8px', fontSize: 12, borderRadius: 5,
              border: '1px solid #ddd', background: '#fff', color: '#333', cursor: 'pointer',
            }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      {tab === 'senders' && (
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 500 }}>
          {visibleSenders.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>No senders match the selected tags.</div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0 }}>
              <th style={{ padding: '7px 10px' }}>Email</th>
              <th style={{ padding: '7px 10px' }}>Name</th>
              <th style={{ padding: '7px 10px' }}>Domain</th>
              <th style={{ padding: '7px 10px' }}>Emails</th>
              <th style={{ padding: '7px 10px' }}>Biz</th>
              <th style={{ padding: '7px 10px' }}>Pers</th>
              <th style={{ padding: '7px 10px' }}>Status</th>
              <th style={{ padding: '7px 10px' }}>Conf</th>
              <th style={{ padding: '7px 10px' }}>Actions</th>
            </tr></thead>
            <tbody>
              {visibleSenders.map(s => {
                const c = STATUS_COLORS[s.status] ?? { bg: '#eee', fg: '#333' }
                const total = emailVolume(s.businessEvidenceCount, s.personalEvidenceCount)
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 10px' }}>{s.senderEmail}</td>
                    <td style={{ padding: '6px 10px', color: '#888' }}>{s.displayName ?? '—'}</td>
                    <td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{s.senderDomain}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{total}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 500 }}>{s.businessEvidenceCount}{s.manualBusinessConfirmations > 0 && <span style={{ color: '#2e7d32', fontSize: 10 }}> +{s.manualBusinessConfirmations}m</span>}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 500 }}>{s.personalEvidenceCount}{s.manualPersonalConfirmations > 0 && <span style={{ color: '#6a1b9a', fontSize: 10 }}> +{s.manualPersonalConfirmations}m</span>}</td>
                    <td style={{ padding: '6px 10px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg }}>{s.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{(Number(s.confidence) * 100).toFixed(0)}%</td>
                    <td style={{ padding: '6px 10px' }}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button onClick={() => confirm(s.id, 'BUSINESS')} className="btn btn-sm btn-success" style={{ fontSize: 10, padding: '2px 6px' }}>Biz</button>
                        <button onClick={() => confirm(s.id, 'PERSONAL')} className="btn btn-sm btn-outline" style={{ fontSize: 10, padding: '2px 6px' }}>Pers</button>
                        <button onClick={() => reset(s.id)} className="btn btn-sm btn-outline" style={{ fontSize: 10, padding: '2px 6px', color: '#999' }}>Reset</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}
        </div>
      )}

      {tab === 'domains' && (
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 500 }}>
          {visibleDomains.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>No domains match the selected tags.</div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }}>
              <th style={{ padding: '7px 10px' }}>Domain</th>
              <th style={{ padding: '7px 10px' }}>Public</th>
              <th style={{ padding: '7px 10px' }}>Emails</th>
              <th style={{ padding: '7px 10px' }}>Biz</th>
              <th style={{ padding: '7px 10px' }}>Pers</th>
              <th style={{ padding: '7px 10px' }}>Status</th>
              <th style={{ padding: '7px 10px' }}>Conf</th>
            </tr></thead>
            <tbody>
              {visibleDomains.map(d => {
                const c = STATUS_COLORS[d.status] ?? { bg: '#eee', fg: '#333' }
                const total = emailVolume(d.businessEvidenceCount, d.personalEvidenceCount)
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 500 }}>{d.domain}</td>
                    <td style={{ padding: '6px 10px' }}>{d.isPublicDomain ? 'Yes' : '—'}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{total}</td>
                    <td style={{ padding: '6px 10px' }}>{d.businessEvidenceCount}</td>
                    <td style={{ padding: '6px 10px' }}>{d.personalEvidenceCount}</td>
                    <td style={{ padding: '6px 10px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg }}>{d.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{(Number(d.confidence) * 100).toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}
        </div>
      )}
    </div>
  )
}
