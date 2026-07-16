import { useEffect, useState } from 'react'
import { api, type AdminWorkspace, type AdminMailbox, type AdminMember } from '../api'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'ACTIVE' ? '#4caf50' : status === 'PAUSED' ? '#ff9800' : status === 'ERROR' || status === 'REQUIRES_REAUTH' ? '#f44336' : '#9e9e9e'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />
}

export function PlatformAdminView() {
  const [tab, setTab] = useState<'workspaces' | 'mailboxes'>('workspaces')
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([])
  const [mailboxes, setMailboxes] = useState<AdminMailbox[]>([])
  const [members, setMembers] = useState<{ wsId: string; list: AdminMember[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newWsName, setNewWsName] = useState('')
  const [newWsSlug, setNewWsSlug] = useState('')
  const [newMbWorkspace, setNewMbWorkspace] = useState('')
  const [newMbEmail, setNewMbEmail] = useState('')
  const [newMbProvider, setNewMbProvider] = useState<'OUTLOOK' | 'GMAIL'>('OUTLOOK')
  const [newMbMode, setNewMbMode] = useState<'N8N' | 'NATIVE'>('N8N')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [ws, mb] = await Promise.all([api.adminGetWorkspaces(), api.adminGetMailboxes()])
      setWorkspaces(ws.workspaces)
      setMailboxes(mb.mailboxes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim() || !newWsSlug.trim()) return
    try {
      await api.adminCreateWorkspace(newWsName.trim(), newWsSlug.trim().toLowerCase())
      setNewWsName('')
      setNewWsSlug('')
      loadData()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm('Delete this workspace and ALL its data?')) return
    try { await api.adminDeleteWorkspace(id); loadData() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  const handleRegisterMailbox = async () => {
    if (!newMbWorkspace || !newMbEmail.trim()) return
    try {
      await api.adminRegisterMailbox({
        workspaceId: newMbWorkspace,
        provider: newMbProvider,
        email: newMbEmail.trim().toLowerCase(),
        ingestionSource: newMbMode
      })
      setNewMbEmail('')
      loadData()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  const handlePause = async (id: string) => { await api.adminPauseMailbox(id); loadData() }
  const handleResume = async (id: string) => { await api.adminResumeMailbox(id); loadData() }
  const handleChangeMode = async (id: string, mode: 'NATIVE' | 'N8N') => { await api.adminChangeIngestionMode(id, mode); loadData() }

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
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>Manage workspaces, monitored mailboxes, and members.</p>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid #e5e5e5' }}>
        {(['workspaces', 'mailboxes'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#1a1a2e' : '#888',
            background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #1a1a2e' : '2px solid transparent',
            marginBottom: -2, cursor: 'pointer', textTransform: 'capitalize'
          }}>{t}</button>
        ))}
      </div>

      {tab === 'workspaces' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Name</label>
              <input value={newWsName} onChange={e => setNewWsName(e.target.value)} placeholder="Client Name" style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, width: 180 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Slug</label>
              <input value={newWsSlug} onChange={e => setNewWsSlug(e.target.value)} placeholder="client-name" style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, width: 160 }} />
            </div>
            <button className="btn btn-sm btn-primary" onClick={handleCreateWorkspace}>Create</button>
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
                    <button onClick={() => showMembers(w.id)} style={{ background: 'none', border: 'none', color: '#06c', cursor: 'pointer', fontSize: 13 }}>
                      {w.counts.members}
                    </button>
                  </td>
                  <td style={{ padding: '7px 12px' }}>{w.counts.connections}</td>
                  <td style={{ padding: '7px 12px' }}>{w.counts.messages.toLocaleString()}</td>
                  <td style={{ padding: '7px 12px', color: '#999', fontSize: 12 }}>{formatDate(w.createdAt)}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <button onClick={() => handleDeleteWorkspace(w.id)} className="btn btn-sm btn-danger">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {members && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>Members of {workspaces.find(w => w.id === members.wsId)?.name}</h3>
                <button onClick={() => setMembers(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>&times;</button>
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
      )}

      {tab === 'mailboxes' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Workspace</label>
              <select value={newMbWorkspace} onChange={e => setNewMbWorkspace(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}>
                <option value="">Select...</option>
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Email</label>
              <input value={newMbEmail} onChange={e => setNewMbEmail(e.target.value)} placeholder="inbox@client.com" style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, width: 200 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Provider</label>
              <select value={newMbProvider} onChange={e => setNewMbProvider(e.target.value as 'OUTLOOK' | 'GMAIL')} style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}>
                <option value="OUTLOOK">Outlook</option>
                <option value="GMAIL">Gmail</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Mode</label>
              <select value={newMbMode} onChange={e => setNewMbMode(e.target.value as 'N8N' | 'NATIVE')} style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}>
                <option value="N8N">n8n</option>
                <option value="NATIVE">Native</option>
              </select>
            </div>
            <button className="btn btn-sm btn-primary" onClick={handleRegisterMailbox}>Register</button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>Mailbox</th>
                <th style={{ padding: '8px 12px' }}>Workspace</th>
                <th style={{ padding: '8px 12px' }}>Provider</th>
                <th style={{ padding: '8px 12px' }}>Mode</th>
                <th style={{ padding: '8px 12px' }}>Status</th>
                <th style={{ padding: '8px 12px' }}>Messages</th>
                <th style={{ padding: '8px 12px' }}>Last Received</th>
                <th style={{ padding: '8px 12px' }}>Last Processed</th>
                <th style={{ padding: '8px 12px' }}>Last Error</th>
                <th style={{ padding: '8px 12px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '7px 12px', fontWeight: 500 }}>{m.email}</td>
                  <td style={{ padding: '7px 12px', color: '#888', fontSize: 12 }}>{m.workspaceName}</td>
                  <td style={{ padding: '7px 12px' }}>{m.provider}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: m.ingestionMode === 'N8N' ? '#f3e5f5' : '#e3f2fd',
                      color: m.ingestionMode === 'N8N' ? '#6a1b9a' : '#1565c0'
                    }}>{m.ingestionMode}</span>
                  </td>
                  <td style={{ padding: '7px 12px' }}><StatusDot status={m.status} />{m.status}</td>
                  <td style={{ padding: '7px 12px' }}>{m.counts.messages.toLocaleString()}</td>
                  <td style={{ padding: '7px 12px', color: '#999', fontSize: 12 }}>{formatDate(m.lastReceivedAt)}</td>
                  <td style={{ padding: '7px 12px', color: '#999', fontSize: 12 }}>{formatDate(m.lastProcessedAt)}</td>
                  <td style={{ padding: '7px 12px', color: m.lastError ? '#c62828' : '#ccc', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.lastError ?? '—'}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {m.status === 'ACTIVE' && (
                        <button className="btn btn-sm btn-outline" onClick={() => handlePause(m.id)}>Pause</button>
                      )}
                      {m.status === 'PAUSED' && (
                        <button className="btn btn-sm btn-outline" onClick={() => handleResume(m.id)}>Resume</button>
                      )}
                      <button className="btn btn-sm btn-outline" onClick={() => handleChangeMode(m.id, m.ingestionMode === 'N8N' ? 'NATIVE' : 'N8N')}>
                        Switch to {m.ingestionMode === 'N8N' ? 'Native' : 'n8n'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
