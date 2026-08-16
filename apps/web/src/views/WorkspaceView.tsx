import { useEffect, useState } from 'react'
import { api, type ApprovedAccessEntry, type AuthorizationStatus, type ConnectionSummary } from '../api'
import { FoldersView } from './FoldersView'

/** Full-page navigation to an external OAuth authorize URL. */
function redirectToOAuth(url: string): void {
  window.location.assign(url)
}

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

function authorizationLabel(status: AuthorizationStatus): string {
  switch (status) {
    case 'REQUIRED':
      return 'Additional authorization required'
    case 'CONNECTED':
      return 'Fully connected'
    case 'REAUTHORIZATION_REQUIRED':
      return 'Reauthorization required'
  }
}

function authorizationTone(status: AuthorizationStatus): { bg: string; color: string } {
  switch (status) {
    case 'REQUIRED':
      return { bg: '#fff8e1', color: '#f57f17' }
    case 'CONNECTED':
      return { bg: '#e6f4ea', color: '#2e7d32' }
    case 'REAUTHORIZATION_REQUIRED':
      return { bg: '#fce4ec', color: '#c62828' }
  }
}

type AuthActionState =
  | { type: 'idle' }
  | { type: 'loading'; connectionId: string }
  | { type: 'error'; connectionId: string; message: string }

export function WorkspaceView({ workspaceId, workspaceName, userRole, connectionId }: Props) {
  const [members, setMembers] = useState<ApprovedAccessEntry[]>([])
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [wsTab, setWsTab] = useState<'overview' | 'folders'>('overview')
  const [clearing, setClearing] = useState('')
  const [authAction, setAuthAction] = useState<AuthActionState>({ type: 'idle' })
  const isOwner = userRole === 'OWNER'
  const loading = loadedFor !== workspaceId

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    Promise.all([
      api.getApprovedAccess(workspaceId).catch(() => ({ entries: [] as ApprovedAccessEntry[] })),
      api.getConnections(workspaceId).catch(() => ({ connections: [] as ConnectionSummary[] }))
    ]).then(([m, c]) => {
      if (cancelled) return
      setMembers(m.entries)
      setConnections(c.connections)
      setLoadedFor(workspaceId)
    })
    return () => { cancelled = true }
  }, [workspaceId])

  const handleClearInbox = async (connId: string, email: string) => {
    if (!confirm(`Clear all emails from ${email}? This removes messages, threads, classifications, and tasks. Reference data is preserved.`)) return
    setClearing(connId)
    try {
      const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'
      await fetch(`${BASE}/admin/test-data/archive`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, mode: 'all', dryRun: false })
      })
      await fetch(`${BASE}/admin/test-data/delete`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, onlyArchived: true, confirmPhrase: 'PERMANENTLY DELETE' })
      })
      window.location.reload()
    } catch { /* */ }
    finally { setClearing('') }
  }

  const handleAuthorize = async (conn: ConnectionSummary) => {
    setAuthAction({ type: 'loading', connectionId: conn.id })
    try {
      const result = await api.authorizeConnection(workspaceId, conn.id)
      redirectToOAuth(result.authorizationUrl)
    } catch (e) {
      setAuthAction({
        type: 'error',
        connectionId: conn.id,
        message: e instanceof Error ? e.message : 'Failed to start authorization',
      })
    }
  }

  const handleReconnect = async (conn: ConnectionSummary) => {
    setAuthAction({ type: 'loading', connectionId: conn.id })
    try {
      const result = await api.reconnectConnection(workspaceId, conn.id)
      redirectToOAuth(result.authorizationUrl)
    } catch (e) {
      setAuthAction({
        type: 'error',
        connectionId: conn.id,
        message: e instanceof Error ? e.message : 'Failed to start reconnect',
      })
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 8, fontSize: 13 }}>Loading workspace...</p>

  const needsAuthCount = connections.filter(c => c.authorizationStatus === 'REQUIRED').length

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
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
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as never }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 400 }}>
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
      </div>

      {/* Monitored Mailboxes */}
      <div className="card">
        <h3 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>Monitored Mailboxes</h3>
        {needsAuthCount > 0 && (
          <p style={{ fontSize: 12, color: '#f57f17', margin: '0 0 10px', lineHeight: 1.45 }}>
            {needsAuthCount === 1
              ? '1 mailbox needs Microsoft authorization for direct provider access and attachment ingestion.'
              : `${needsAuthCount} mailboxes need Microsoft authorization for direct provider access and attachment ingestion.`}
          </p>
        )}
        {authAction.type === 'error' && (
          <div style={{
            padding: '6px 10px', marginBottom: 10, fontSize: 12,
            background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4,
            display: 'flex', justifyContent: 'space-between', gap: 8,
          }}>
            <span>{authAction.message}</span>
            <button type="button" onClick={() => setAuthAction({ type: 'idle' })} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
          </div>
        )}
        {connections.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: 12, margin: 0 }}>No inboxes connected. Contact your platform admin to add monitored mailboxes.</p>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as never }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Email</th>
                <th style={{ padding: '6px 8px' }}>Provider</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Authorization</th>
                <th style={{ padding: '6px 8px' }}>Messages</th>
                <th style={{ padding: '6px 8px' }}>Last Synced</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {connections.map(c => {
                const authTone = authorizationTone(c.authorizationStatus)
                const actionLoading = authAction.type === 'loading' && authAction.connectionId === c.id
                return (
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
                    <td style={{ padding: '5px 8px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                        fontSize: 10, fontWeight: 600, background: authTone.bg, color: authTone.color,
                      }}>
                        {authorizationLabel(c.authorizationStatus)}
                      </span>
                    </td>
                    <td style={{ padding: '5px 8px' }}>{c.counts.messages.toLocaleString()}</td>
                    <td style={{ padding: '5px 8px', color: '#888' }}>{formatDate(c.lastSyncedAt)}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {c.authorizationStatus === 'REQUIRED' && c.provider.toLowerCase() === 'outlook' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            style={{ fontSize: 10, padding: '2px 8px' }}
                            disabled={actionLoading}
                            onClick={() => handleAuthorize(c)}
                          >
                            {actionLoading ? 'Starting…' : 'Authorize Outlook'}
                          </button>
                        )}
                        {c.authorizationStatus === 'REAUTHORIZATION_REQUIRED' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            style={{ fontSize: 10, padding: '2px 8px' }}
                            disabled={actionLoading}
                            onClick={() => handleReconnect(c)}
                          >
                            {actionLoading ? 'Starting…' : 'Reconnect'}
                          </button>
                        )}
                        {isOwner && c.counts.messages > 0 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            style={{ fontSize: 10, padding: '2px 8px' }}
                            disabled={clearing === c.id}
                            onClick={() => handleClearInbox(c.id, c.email)}
                          >
                            {clearing === c.id ? 'Clearing...' : 'Clear Inbox'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      </>}
    </div>
  )
}
