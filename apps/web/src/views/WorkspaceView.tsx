import { useEffect, useState } from 'react'
import { api, type ApprovedAccessEntry, type ConnectionSummary } from '../api'
import { FoldersView } from './FoldersView'

interface Props {
  workspaceId: string
  workspaceName: string
  userRole: string
  connectionId: string
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso ?? '—' }
}

export function WorkspaceView({ workspaceId, workspaceName, userRole, connectionId }: Props) {
  const [members, setMembers] = useState<ApprovedAccessEntry[]>([])
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [wsTab, setWsTab] = useState<'overview' | 'folders'>('overview')
  const isOwner = userRole === 'OWNER'

  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    Promise.all([
      api.getApprovedAccess(workspaceId).catch(() => ({ entries: [] })),
      api.getConnections(workspaceId).catch(() => ({ connections: [] }))
    ]).then(([m, c]) => {
      setMembers(m.entries)
      setConnections(c.connections)
    }).finally(() => setLoading(false))
  }, [workspaceId])

  if (loading) return <p style={{ color: '#888', padding: 8, fontSize: 13 }}>Loading workspace...</p>

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{workspaceName}</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>Workspace overview, members, and monitored mailboxes.</p>

      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '2px solid #e5e5e5' }}>
        {(['overview', 'folders'] as const).map(t => (
          <button key={t} onClick={() => setWsTab(t)} style={{
            padding: '7px 18px', fontSize: 13, fontWeight: wsTab === t ? 600 : 400,
            color: wsTab === t ? '#1a1a2e' : '#888', background: 'none', border: 'none',
            borderBottom: wsTab === t ? '2px solid #1a1a2e' : '2px solid transparent',
            marginBottom: -2, cursor: 'pointer', textTransform: 'capitalize'
          }}>{t === 'folders' ? 'Job Folders' : 'Overview'}</button>
        ))}
      </div>

      {wsTab === 'folders' && (
        <FoldersView workspaceId={workspaceId} connectionId={connectionId} />
      )}

      {wsTab === 'overview' && <>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        <div className="card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1565c0' }}>{members.filter(m => m.status === 'ACTIVE').length}</div>
          <div style={{ fontSize: 12, color: '#888' }}>Active Members</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#2e7d32' }}>{connections.filter(c => c.status === 'ACTIVE').length}</div>
          <div style={{ fontSize: 12, color: '#888' }}>Connected Inboxes</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#333' }}>{connections.reduce((sum, c) => sum + c.counts.messages, 0).toLocaleString()}</div>
          <div style={{ fontSize: 12, color: '#888' }}>Total Messages</div>
        </div>
      </div>

      {/* Members */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>Members</h3>
        {!isOwner && <p style={{ fontSize: 11, color: '#999', margin: '0 0 8px' }}>Only workspace owners can manage members.</p>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>Email</th>
              <th style={{ padding: '6px 8px' }}>Role</th>
              <th style={{ padding: '6px 8px' }}>Status</th>
              <th style={{ padding: '6px 8px' }}>Added</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '5px 8px' }}>{m.email}</td>
                <td style={{ padding: '5px 8px' }}>{m.role}</td>
                <td style={{ padding: '5px 8px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: m.status === 'ACTIVE' ? '#e6f4ea' : '#fce4ec',
                    color: m.status === 'ACTIVE' ? '#2e7d32' : '#c62828'
                  }}>{m.status}</span>
                </td>
                <td style={{ padding: '5px 8px', color: '#888' }}>{formatDate(m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Monitored Mailboxes */}
      <div className="card">
        <h3 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>Monitored Mailboxes</h3>
        {connections.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: 12, margin: 0 }}>No inboxes connected. Contact your platform admin to add monitored mailboxes.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Email</th>
                <th style={{ padding: '6px 8px' }}>Provider</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Messages</th>
                <th style={{ padding: '6px 8px' }}>Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '5px 8px' }}>{c.email}</td>
                  <td style={{ padding: '5px 8px' }}>{c.provider}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{
                      display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginRight: 5,
                      background: c.status === 'ACTIVE' ? '#4caf50' : c.status === 'ERROR' || c.status === 'REQUIRES_REAUTH' ? '#f44336' : '#9e9e9e'
                    }} />
                    {c.status}
                  </td>
                  <td style={{ padding: '5px 8px' }}>{c.counts.messages.toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', color: '#888' }}>{formatDate(c.lastSyncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>}
    </div>
  )
}
