import { useEffect, useState } from 'react'
import { api, type ApprovedAccessEntry, type ConnectionSummary } from '../api'
import { AddMonitoredMailboxModal } from '../components/AddMonitoredMailboxModal'
import { MonitoredMailboxesPanel } from '../components/MonitoredMailboxesPanel'
import { TeamAccessView } from './TeamAccessView'
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
  /** Optional tab when redirecting from legacy Team Access nav. */
  initialTab?: 'mailboxes' | 'team' | 'folders'
}

type AuthActionState =
  | { type: 'idle' }
  | { type: 'loading'; connectionId: string }
  | { type: 'error'; connectionId: string; message: string }

type WsTab = 'mailboxes' | 'team' | 'folders'

export function WorkspaceView({
  workspaceId,
  workspaceName,
  userRole,
  connectionId,
  initialTab = 'mailboxes',
}: Props) {
  const [members, setMembers] = useState<ApprovedAccessEntry[]>([])
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [wsTab, setWsTab] = useState<WsTab>(initialTab)
  const [clearing, setClearing] = useState('')
  const [authAction, setAuthAction] = useState<AuthActionState>({ type: 'idle' })
  const [addMailboxOpen, setAddMailboxOpen] = useState(false)
  const [removingId, setRemovingId] = useState('')
  const isOwner = userRole === 'OWNER'
  const canManageMailboxes = userRole === 'OWNER' || userRole === 'ADMIN'
  const loading = loadedFor !== workspaceId

  useEffect(() => {
    setWsTab(initialTab)
  }, [initialTab, workspaceId])

  const refreshAll = () => {
    void Promise.all([
      api.getApprovedAccess(workspaceId).catch(() => ({ entries: [] as ApprovedAccessEntry[] })),
      api.getConnections(workspaceId, { includeCounts: true }).catch(() => ({ connections: [] as ConnectionSummary[] })),
    ]).then(([m, c]) => {
      setMembers(m.entries)
      setConnections(c.connections)
    })
  }

  const refreshConnections = () => {
    void api.getConnections(workspaceId, { includeCounts: true }).then((c) => setConnections(c.connections)).catch(() => {})
  }

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    const t0 = performance.now()
    let painted = false

    // Lean connections first so mailboxes list can paint without waiting on counts/members.
    api.getConnections(workspaceId)
      .then((c) => {
        if (cancelled) return
        setConnections(c.connections)
        setLoadedFor(workspaceId)
        if (!painted) {
          painted = true
          console.info({
            event: 'workspaceInitialUsefulPaintMs',
            source: 'lean',
            ms: Math.round(performance.now() - t0),
            connectionCount: c.connections.length,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setLoadedFor(workspaceId)
      })

    void Promise.all([
      api.getApprovedAccess(workspaceId).catch(() => ({ entries: [] as ApprovedAccessEntry[] })),
      api.getConnections(workspaceId, { includeCounts: true }).catch(() => ({ connections: [] as ConnectionSummary[] })),
    ]).then(([m, c]) => {
      if (cancelled) return
      setMembers(m.entries)
      if (c.connections.length > 0) setConnections(c.connections)
      if (!painted) {
        painted = true
        setLoadedFor(workspaceId)
        console.info({
          event: 'workspaceInitialUsefulPaintMs',
          source: 'full',
          ms: Math.round(performance.now() - t0),
        })
      }
    })

    return () => { cancelled = true }
  }, [workspaceId])

  const handleClearInbox = async (connId: string, email: string) => {
    if (
      !confirm(
        `Clear ForgeOps inbox for ${email}?\n\n` +
          `This removes current ForgeOps inbox data for this mailbox. ` +
          `New emails will continue syncing. Older emails will only return if you explicitly import previous emails.`
      )
    ) {
      return
    }
    setClearing(connId)
    try {
      await api.clearInbox(workspaceId, connId)
      window.location.reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to clear inbox')
    } finally {
      setClearing('')
    }
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

  const handleRemoveMailbox = async (conn: ConnectionSummary) => {
    if (
      !confirm(
        `Remove monitored mailbox ${conn.email}? This disconnects provider access and stops native listening. Existing imported messages are kept.`
      )
    ) {
      return
    }
    setRemovingId(conn.id)
    try {
      await api.disconnectConnection(workspaceId, conn.id)
      refreshConnections()
    } catch (e) {
      setAuthAction({
        type: 'error',
        connectionId: conn.id,
        message: e instanceof Error ? e.message : 'Failed to remove mailbox',
      })
    } finally {
      setRemovingId('')
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 8, fontSize: 13 }}>Loading workspace...</p>

  const activeConnections = connections.filter((c) => c.status !== 'DISCONNECTED')
  const needsAuthCount = connections.filter(
    (c) =>
      c.authorizationStatus === 'REQUIRED' ||
      c.authorizationStatus === 'REAUTHORIZATION_REQUIRED'
  ).length
  const tabs: Array<{ id: WsTab; label: string }> = [
    { id: 'mailboxes', label: 'Monitored Mailboxes' },
    { id: 'team', label: 'Team Access' },
    { id: 'folders', label: 'Email Analysis' },
  ]

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{workspaceName}</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
        Monitored mailboxes, team access, and workspace settings.
      </p>

      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '2px solid #e5e5e5', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => setWsTab(t.id)} style={{
            padding: '7px 18px', fontSize: 13, fontWeight: wsTab === t.id ? 600 : 400,
            color: wsTab === t.id ? '#1a1a2e' : '#888', background: 'none', border: 'none',
            borderBottom: wsTab === t.id ? '2px solid #1a1a2e' : '2px solid transparent',
            marginBottom: -2, cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {wsTab === 'folders' && (
        <FoldersView workspaceId={workspaceId} connectionId={connectionId} userRole={userRole} />
      )}

      {wsTab === 'team' && (
        <TeamAccessView workspaceId={workspaceId} userRole={userRole} embedded />
      )}

      {wsTab === 'mailboxes' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            <div className="card" style={{ textAlign: 'center', padding: 14 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1565c0' }}>{members.filter(m => m.status === 'ACTIVE').length}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Active Members</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: 14 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#2e7d32' }}>{activeConnections.filter(c => c.status === 'ACTIVE').length}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Connected Inboxes</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: 14 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#333' }}>{activeConnections.reduce((sum, c) => sum + c.counts.messages, 0).toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Total Messages</div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>Monitored Mailboxes</h3>
              {canManageMailboxes && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setAddMailboxOpen(true)}
                >
                  Add Monitored Mailbox
                </button>
              )}
            </div>
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
            <MonitoredMailboxesPanel
              workspaceId={workspaceId}
              connections={connections}
              userRole={userRole}
              canManage={canManageMailboxes}
              isOwner={isOwner}
              authAction={authAction}
              clearing={clearing}
              removingId={removingId}
              onRefresh={refreshConnections}
              onAuthorize={(c) => void handleAuthorize(c)}
              onReconnect={(c) => void handleReconnect(c)}
              onClearInbox={(id, email) => void handleClearInbox(id, email)}
              onAddMailbox={canManageMailboxes ? () => setAddMailboxOpen(true) : undefined}
              onRemove={canManageMailboxes ? (c) => void handleRemoveMailbox(c) : undefined}
            />
          </div>

          <AddMonitoredMailboxModal
            workspaceId={workspaceId}
            members={members}
            connections={connections}
            open={addMailboxOpen}
            onClose={() => setAddMailboxOpen(false)}
            onAuthorize={(c) => void handleAuthorize(c)}
            onReconnect={(c) => void handleReconnect(c)}
            onRegistered={refreshAll}
          />
        </>
      )}
    </div>
  )
}
