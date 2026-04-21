import { useState } from 'react'
import { api, type ConnectionSummary } from '../api'

interface Props {
  workspaceId: string
  connections: ConnectionSummary[]
  onRefresh: () => void
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'active'
    case 'ERROR':
    case 'REQUIRES_REAUTH': return 'error'
    case 'PAUSED': return 'paused'
    default: return 'disconnected'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'Connected'
    case 'REQUIRES_REAUTH': return 'Needs Reconnect'
    case 'ERROR': return 'Error'
    case 'PAUSED': return 'Paused'
    default: return status
  }
}

function providerLabel(provider: string): string {
  return provider === 'gmail' ? 'Gmail' : provider === 'outlook' ? 'Outlook' : provider
}

function providerIcon(provider: string): string {
  return provider === 'gmail' ? '\uD83D\uDCE7' : provider === 'outlook' ? '\uD83D\uDCEC' : '\u2709'
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

type ActionState = { type: 'idle' } | { type: 'loading'; connectionId: string } | { type: 'error'; connectionId: string; message: string }

export function ConnectionsView({ workspaceId, connections, onRefresh }: Props) {
  const [actionState, setActionState] = useState<ActionState>({ type: 'idle' })

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Disconnect this inbox?')) return
    setActionState({ type: 'loading', connectionId })
    try {
      await api.disconnectConnection(workspaceId, connectionId)
      setActionState({ type: 'idle' })
      onRefresh()
    } catch (e) {
      setActionState({ type: 'error', connectionId, message: e instanceof Error ? e.message : 'Failed' })
    }
  }

  const handleReconnect = async (connectionId: string) => {
    try {
      const result = await api.reconnectConnection(workspaceId, connectionId)
      window.location.href = result.authorizationUrl
    } catch (e) {
      setActionState({ type: 'error', connectionId, message: e instanceof Error ? e.message : 'Failed' })
    }
  }

  const activeConnections = connections.filter(c => c.status !== 'DISCONNECTED')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 17, margin: '0 0 2px' }}>Connections</h2>
          <p style={{ fontSize: 12, color: '#999', margin: 0 }}>Manage connected email accounts.</p>
        </div>
      </div>

      {actionState.type === 'error' && (
        <div style={{ padding: '6px 12px', background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, marginBottom: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span>{actionState.message}</span>
          <button onClick={() => setActionState({ type: 'idle' })} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      {activeConnections.map(c => (
        <div key={c.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>{providerIcon(c.provider)}</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.email}</span>
                <span style={{ fontSize: 10, background: '#f0f0f0', padding: '1px 6px', borderRadius: 3, color: '#666' }}>{providerLabel(c.provider)}</span>
              </div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>
                <span className={`status-dot ${statusDotClass(c.status)}`} />{statusLabel(c.status)}
                <span style={{ color: '#ddd' }}> · </span>{c.counts.messages} msgs
                <span style={{ color: '#ddd' }}> · </span>Synced {formatDate(c.lastSyncedAt)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {c.status === 'REQUIRES_REAUTH' && (
              <button className="btn btn-sm btn-primary" onClick={() => handleReconnect(c.id)}>Reconnect</button>
            )}
            <button className="btn btn-sm btn-outline"
              disabled={actionState.type === 'loading' && actionState.connectionId === c.id}
              onClick={() => handleDisconnect(c.id)}>
              Disconnect
            </button>
          </div>
        </div>
      ))}

      {activeConnections.length === 0 && (
        <div className="empty-state" style={{ padding: 28 }}>
          <div className="empty-icon">&#128233;</div>
          <h3>No inboxes connected</h3>
          <p>Connect a Gmail or Outlook account below.</p>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8, color: '#666' }}>Add an Inbox</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              try {
                const result = await api.startInboxConnection(workspaceId, 'google')
                window.location.href = result.authorizationUrl
              } catch (e) {
                setActionState({ type: 'error', connectionId: '', message: e instanceof Error ? e.message : 'Failed' })
              }
            }}
            className="card" style={{ flex: '1 1 240px', cursor: 'pointer', border: '1px dashed #ccc', textAlign: 'left', padding: '12px 14px' }}
            onMouseOver={e => (e.currentTarget.style.borderColor = '#999')}
            onMouseOut={e => (e.currentTarget.style.borderColor = '#ccc')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>&#x1F4E7;</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Connect Gmail</span>
            </div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.4 }}>Google Workspace or personal Gmail account.</div>
          </button>

          <button
            onClick={async () => {
              try {
                const result = await api.startInboxConnection(workspaceId, 'outlook')
                window.location.href = result.authorizationUrl
              } catch (e) {
                setActionState({ type: 'error', connectionId: '', message: e instanceof Error ? e.message : 'Failed' })
              }
            }}
            className="card" style={{ flex: '1 1 240px', cursor: 'pointer', border: '1px dashed #ccc', textAlign: 'left', padding: '12px 14px' }}
            onMouseOver={e => (e.currentTarget.style.borderColor = '#999')}
            onMouseOut={e => (e.currentTarget.style.borderColor = '#ccc')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>&#x1F4EC;</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Connect Outlook</span>
            </div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.4 }}>Microsoft 365 or Outlook.com account.</div>
          </button>
        </div>
      </div>
    </div>
  )
}
