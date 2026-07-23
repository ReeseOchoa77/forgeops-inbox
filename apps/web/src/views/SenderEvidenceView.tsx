import { useEffect, useState } from 'react'

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

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  OBSERVED: { bg: '#f5f5f5', fg: '#888' },
  LIKELY_BUSINESS: { bg: '#e3f2fd', fg: '#1565c0' },
  CONFIRMED_BUSINESS: { bg: '#e6f4ea', fg: '#2e7d32' },
  CONFIRMED_PERSONAL: { bg: '#f3e5f5', fg: '#6a1b9a' },
  BLOCKED: { bg: '#fce4ec', fg: '#c62828' }
}

export function SenderEvidenceView({ workspaceId }: Props) {
  const [senders, setSenders] = useState<SenderRecord[]>([])
  const [domains, setDomains] = useState<DomainRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'senders' | 'domains'>('senders')
  const [filter, setFilter] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const url = `${BASE}/workspaces/${workspaceId}/sender-evidence${filter ? `?status=${filter}` : ''}`
      const res = await fetch(url, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json() as { senders: SenderRecord[]; domains: DomainRecord[] }
        setSenders(data.senders)
        setDomains(data.domains)
      }
    } catch { /* */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [workspaceId, filter])

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
          }}>{t} ({t === 'senders' ? senders.length : domains.length})</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {['', 'OBSERVED', 'LIKELY_BUSINESS', 'CONFIRMED_BUSINESS', 'CONFIRMED_PERSONAL', 'BLOCKED'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '3px 10px', fontSize: 11, borderRadius: 12,
            border: filter === s ? '1px solid #1a1a2e' : '1px solid #ddd',
            background: filter === s ? '#1a1a2e' : '#fff',
            color: filter === s ? '#fff' : '#666', cursor: 'pointer'
          }}>{s || 'All'}</button>
        ))}
      </div>

      {tab === 'senders' && (
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 500 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0 }}>
              <th style={{ padding: '7px 10px' }}>Email</th>
              <th style={{ padding: '7px 10px' }}>Name</th>
              <th style={{ padding: '7px 10px' }}>Domain</th>
              <th style={{ padding: '7px 10px' }}>Biz</th>
              <th style={{ padding: '7px 10px' }}>Pers</th>
              <th style={{ padding: '7px 10px' }}>Status</th>
              <th style={{ padding: '7px 10px' }}>Conf</th>
              <th style={{ padding: '7px 10px' }}>Actions</th>
            </tr></thead>
            <tbody>
              {senders.map(s => {
                const c = STATUS_COLORS[s.status] ?? { bg: '#eee', fg: '#333' }
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 10px' }}>{s.senderEmail}</td>
                    <td style={{ padding: '6px 10px', color: '#888' }}>{s.displayName ?? '—'}</td>
                    <td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{s.senderDomain}</td>
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
        </div>
      )}

      {tab === 'domains' && (
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 500 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }}>
              <th style={{ padding: '7px 10px' }}>Domain</th>
              <th style={{ padding: '7px 10px' }}>Public</th>
              <th style={{ padding: '7px 10px' }}>Biz</th>
              <th style={{ padding: '7px 10px' }}>Pers</th>
              <th style={{ padding: '7px 10px' }}>Status</th>
              <th style={{ padding: '7px 10px' }}>Conf</th>
            </tr></thead>
            <tbody>
              {domains.map(d => {
                const c = STATUS_COLORS[d.status] ?? { bg: '#eee', fg: '#333' }
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 500 }}>{d.domain}</td>
                    <td style={{ padding: '6px 10px' }}>{d.isPublicDomain ? 'Yes' : '—'}</td>
                    <td style={{ padding: '6px 10px' }}>{d.businessEvidenceCount}</td>
                    <td style={{ padding: '6px 10px' }}>{d.personalEvidenceCount}</td>
                    <td style={{ padding: '6px 10px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg }}>{d.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{(Number(d.confidence) * 100).toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
