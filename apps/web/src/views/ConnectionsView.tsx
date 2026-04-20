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
    case 'DISCONNECTED': return 'Disconnected'
    default: return status
  }
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'gmail': return 'Gmail'
    case 'outlook': return 'Outlook'
    default: return provider
  }
}

function providerIcon(provider: string): string {
  switch (provider) {
    case 'gmail': return '\uD83D\uDCE7'
    case 'outlook': return '\uD83D\uDCEC'
    default: return '\u2709'
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

type ActionState = { type: 'idle' } | { type: 'loading'; action: string; connectionId: string } | { type: 'success'; action: string; connectionId: string; detail?: string } | { type: 'error'; action: string; connectionId: string; message: string }

export function ConnectionsView({ workspaceId, connections, onRefresh }: Props) {
  const [actionState, setActionState] = useState<ActionState>({ type: 'idle' })

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Disconnect this inbox? The connection can be re-established later.')) return
    setActionState({ type: 'loading', action: 'disconnect', connectionId })
    try {
      await api.disconnectConnection(workspaceId, connectionId)
      setActionState({ type: 'idle' })
      onRefresh()
    } catch (e) {
      setActionState({ type: 'error', action: 'disconnect', connectionId, message: e instanceof Error ? e.message : 'Disconnect failed' })
    }
  }

  const handleReconnect = async (connectionId: string) => {
    try {
      const result = await api.reconnectConnection(workspaceId, connectionId)
      window.location.href = result.authorizationUrl
    } catch (e) {
      setActionState({ type: 'error', action: 'reconnect', connectionId, message: e instanceof Error ? e.message : 'Reconnect failed' })
    }
  }

  const isLoading = (connectionId: string, action: string) =>
    actionState.type === 'loading' && actionState.connectionId === connectionId && actionState.action === action

  const activeConnections = connections.filter(c => c.status !== 'DISCONNECTED')
  const disconnectedConnections = connections.filter(c => c.status === 'DISCONNECTED')

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Inbox Connections</h2>
      <p style={{ fontSize: 14, color: '#888', marginTop: 0, marginBottom: 20 }}>
        Connect email accounts to sync, classify, and extract tasks from your inbox.
      </p>

      {actionState.type === 'success' && (
        <div style={{ padding: '10px 16px', background: '#e6f4ea', border: '1px solid #a8d5a2', borderRadius: 6, marginBottom: 16, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {actionState.action === 'sync' ? 'Sync completed' : 'Analysis completed'}
            {actionState.detail && ` — ${actionState.detail}`}
          </span>
          <button onClick={() => setActionState({ type: 'idle' })} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#2e7d32' }}>&times;</button>
        </div>
      )}

      {actionState.type === 'error' && (
        <div style={{ padding: '10px 16px', background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 6, marginBottom: 16, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionState.message}</span>
          <button onClick={() => setActionState({ type: 'idle' })} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#c62828' }}>&times;</button>
        </div>
      )}

      {activeConnections.length === 0 && disconnectedConnections.length === 0 && (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <div className="empty-icon">&#128233;</div>
          <h3>No inboxes connected</h3>
          <p>Connect a Gmail or Outlook account below to get started.</p>
        </div>
      )}

      {activeConnections.map(c => (
        <div key={c.id} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 20 }}>{providerIcon(c.provider)}</span>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{c.email}</span>
                <span style={{ fontSize: 11, background: '#f0f0f0', padding: '1px 8px', borderRadius: 3 }}>{providerLabel(c.provider)}</span>
              </div>
              <div style={{ fontSize: 13, color: '#888', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span><span className={`status-dot ${statusDotClass(c.status)}`} />{statusLabel(c.status)}</span>
                <span>{c.counts.messages} messages</span>
                <span>{c.counts.threads} threads</span>
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                Connected {formatDate(c.connectedAt)} &middot; Last synced {formatDate(c.lastSyncedAt)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid #eee', paddingTop: 12 }}>
            {c.status === 'REQUIRES_REAUTH' && (
              <button className="btn btn-sm btn-primary" onClick={() => handleReconnect(c.id)}>
                Reconnect
              </button>
            )}
            <button className="btn btn-sm btn-outline"
              disabled={isLoading(c.id, 'disconnect')}
              onClick={() => handleDisconnect(c.id)}>
              {isLoading(c.id, 'disconnect') ? '...' : 'Disconnect'}
            </button>
          </div>
        </div>
      ))}

      {disconnectedConnections.length > 0 && (
        <details style={{ marginTop: 8, marginBottom: 24 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#888' }}>
            {disconnectedConnections.length} disconnected inbox{disconnectedConnections.length > 1 ? 'es' : ''}
          </summary>
          {disconnectedConnections.map(c => (
            <div key={c.id} className="card" style={{ opacity: 0.5, marginTop: 8, padding: 14 }}>
              <span style={{ fontSize: 16, marginRight: 8 }}>{providerIcon(c.provider)}</span>
              <span className="status-dot disconnected" />
              {c.email} — Disconnected
            </div>
          ))}
        </details>
      )}

      <h3 style={{ fontSize: 15, marginBottom: 12, marginTop: 28 }}>Add an Inbox</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={async () => {
            try {
              const result = await api.startInboxConnection(workspaceId, 'google')
              window.location.href = result.authorizationUrl
            } catch (e) {
              setActionState({ type: 'error', action: 'connect', connectionId: '', message: e instanceof Error ? e.message : 'Failed to start connection' })
            }
          }}
          className="card" style={{ flex: '1 1 280px', textDecoration: 'none', color: 'inherit', cursor: 'pointer', border: '2px dashed #d0d0d0', transition: 'border-color 0.15s', textAlign: 'left' }}
          onMouseOver={e => (e.currentTarget.style.borderColor = '#999')}
          onMouseOut={e => (e.currentTarget.style.borderColor = '#d0d0d0')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 28 }}>&#x1F4E7;</span>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Connect Gmail</span>
          </div>
          <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5 }}>
            Sync messages from a Google Workspace or personal Gmail account. You'll be redirected to Google to authorize read access to your inbox.
          </div>
        </button>

        <button
          onClick={async () => {
            try {
              const result = await api.startInboxConnection(workspaceId, 'outlook')
              window.location.href = result.authorizationUrl
            } catch (e) {
              setActionState({ type: 'error', action: 'connect', connectionId: '', message: e instanceof Error ? e.message : 'Failed to start connection' })
            }
          }}
          className="card" style={{ flex: '1 1 280px', textDecoration: 'none', color: 'inherit', cursor: 'pointer', border: '2px dashed #d0d0d0', transition: 'border-color 0.15s', textAlign: 'left' }}
          onMouseOver={e => (e.currentTarget.style.borderColor = '#999')}
          onMouseOut={e => (e.currentTarget.style.borderColor = '#d0d0d0')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 28 }}>&#x1F4EC;</span>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Connect Outlook</span>
          </div>
          <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5 }}>
            Sync messages from a Microsoft 365 or Outlook.com account. You'll be redirected to Microsoft to authorize read access.
          </div>
        </button>
      </div>
    </div>
  )
}
