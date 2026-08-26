import { useEffect, useState } from 'react'
import { api, type AdminWorkspace, type AdminMember } from '../api'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

export function PlatformAdminView() {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([])
  const [members, setMembers] = useState<{ wsId: string; list: AdminMember[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newWsName, setNewWsName] = useState('')
  const [newWsSlug, setNewWsSlug] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const ws = await api.adminGetWorkspaces()
      setWorkspaces(ws.workspaces)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData() }, [])

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim() || !newWsSlug.trim()) return
    try {
      await api.adminCreateWorkspace(newWsName.trim(), newWsSlug.trim().toLowerCase())
      setNewWsName('')
      setNewWsSlug('')
      void loadData()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm('Delete this workspace and ALL its data?')) return
    try { await api.adminDeleteWorkspace(id); void loadData() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  const showMembers = async (wsId: string) => {
    try {
      const r = await api.adminGetMembers(wsId)
      setMembers({ wsId, list: r.members })
    } catch { setMembers(null) }
  }

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading admin data...</p>

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Platform Admin</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
        Manage workspaces and members. Monitored mailboxes are configured per workspace under Workspace → Monitored Mailboxes.
      </p>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Name</label>
          <input value={newWsName} onChange={e => setNewWsName(e.target.value)} placeholder="Client Name" style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, width: 180 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Slug</label>
          <input value={newWsSlug} onChange={e => setNewWsSlug(e.target.value)} placeholder="client-name" style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, width: 160 }} />
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleCreateWorkspace()}>Create</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }}>
            <th style={{ padding: '8px 12px' }}>Workspace</th>
            <th style={{ padding: '8px 12px' }}>Slug</th>
            <th style={{ padding: '8px 12px' }}>Members</th>
            <th style={{ padding: '8px 12px' }}>Connections</th>
            <th style={{ padding: '8px 12px' }}>Messages</th>
            <th style={{ padding: '8px 12px' }}>Created</th>
            <th style={{ padding: '8px 12px' }}></th>
          </tr>
        </thead>
        <tbody>
          {workspaces.map(w => (
            <tr key={w.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '7px 12px', fontWeight: 500 }}>{w.name}</td>
              <td style={{ padding: '7px 12px', color: '#888', fontFamily: 'monospace', fontSize: 12 }}>{w.slug}</td>
              <td style={{ padding: '7px 12px' }}>
                <button type="button" onClick={() => void showMembers(w.id)} style={{ background: 'none', border: 'none', color: '#06c', cursor: 'pointer', fontSize: 13 }}>
                  {w.counts.members}
                </button>
              </td>
              <td style={{ padding: '7px 12px' }}>{w.counts.connections}</td>
              <td style={{ padding: '7px 12px' }}>{w.counts.messages.toLocaleString()}</td>
              <td style={{ padding: '7px 12px', color: '#999', fontSize: 12 }}>{formatDate(w.createdAt)}</td>
              <td style={{ padding: '7px 12px' }}>
                <button type="button" onClick={() => void handleDeleteWorkspace(w.id)} className="btn btn-sm btn-danger">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {members && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>Members of {workspaces.find(w => w.id === members.wsId)?.name}</h3>
            <button type="button" onClick={() => setMembers(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>&times;</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>Email</th><th style={{ padding: '6px 8px' }}>Name</th>
              <th style={{ padding: '6px 8px' }}>Role</th><th style={{ padding: '6px 8px' }}>Admin</th>
              <th style={{ padding: '6px 8px' }}>Last Login</th>
            </tr></thead>
            <tbody>
              {members.list.map(m => (
                <tr key={m.membershipId} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '5px 8px' }}>{m.email}</td>
                  <td style={{ padding: '5px 8px', color: '#888' }}>{m.name ?? '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{m.role}</td>
                  <td style={{ padding: '5px 8px' }}>{m.isPlatformAdmin ? 'Yes' : '—'}</td>
                  <td style={{ padding: '5px 8px', color: '#999' }}>{formatDate(m.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
