import { useEffect, useState, useCallback } from 'react'
import { api, type SessionResponse, type ConnectionSummary } from './api'

const API_ORIGIN = import.meta.env.VITE_API_URL ?? ''
const signInUrl = `${API_ORIGIN}/api/v1/auth/google/start?redirect=true`
import { MessagesView } from './views/MessagesView'
import { MessageDetailView } from './views/MessageDetailView'
import { TasksView } from './views/TasksView'
import { ReviewQueueView } from './views/ReviewQueueView'
import { ConnectionsView } from './views/ConnectionsView'
import { TeamAccessView } from './views/TeamAccessView'
import { SettingsView } from './views/SettingsView'
import { DataImportView } from './views/DataImportView'

type Page = 'inbox' | 'message-detail' | 'tasks' | 'review' | 'connections' | 'team' | 'import' | 'settings'

const NAV_ITEMS: Array<{ page: Page; label: string; icon: string; section?: string }> = [
  { page: 'inbox', label: 'Inbox', icon: '\u2709' },
  { page: 'tasks', label: 'Tasks', icon: '\u2611' },
  { page: 'review', label: 'Review Queue', icon: '\u2696' },
  { page: 'connections', label: 'Connections', icon: '\u26A1', section: 'Manage' },
  { page: 'team', label: 'Team Access', icon: '\uD83D\uDC65' },
  { page: 'import', label: 'Data Import', icon: '\uD83D\uDCC1' },
  { page: 'settings', label: 'Settings', icon: '\u2699' },
]

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [page, setPage] = useState<Page>('inbox')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [error, setError] = useState('')
  const [accessDenied, setAccessDenied] = useState(false)
  const [connectionNotice, setConnectionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (params.get('access') === 'denied') {
      setAccessDenied(true)
      window.history.replaceState({}, '', window.location.pathname)
      return
    }

    if (params.get('connected')) {
      const connectedId = params.get('connected')!
      setConnectionNotice({ type: 'success', message: 'Inbox connected. Syncing messages now...' })
      setPage('connections')
      window.history.replaceState({}, '', window.location.pathname)

      api.getSession().then(s => {
        if (s.authenticated && s.memberships.length > 0) {
          const wsId = s.memberships[0].workspace.id
          api.syncConnection(wsId, connectedId, false).catch(() => {})
        }
      })
    }

    if (params.get('connection_error')) {
      setConnectionNotice({ type: 'error', message: decodeURIComponent(params.get('connection_error')!) })
      setPage('connections')
      window.history.replaceState({}, '', window.location.pathname)
    }

    api.getSession()
      .then(s => {
        if (s.accessRevoked) {
          setAccessDenied(true)
          return
        }
        setSession(s)
        if (s.authenticated && s.memberships.length > 0) {
          setWorkspaceId(s.memberships[0].workspace.id)
        }
      })
      .catch(e => setError(e.message))
  }, [])

  const loadConnections = useCallback(() => {
    if (!workspaceId) return
    api.getConnections(workspaceId)
      .then(r => {
        setConnections(r.connections)
        if (r.connections.length > 0 && !connectionId) {
          setConnectionId(r.connections[0].id)
        }
      })
      .catch(e => setError(e.message))
  }, [workspaceId, connectionId])

  useEffect(() => { loadConnections() }, [workspaceId])

  if (accessDenied) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <div style={{ textAlign: 'center', padding: 48, maxWidth: 460 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fce4ec', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>&#128274;</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700 }}>Access Restricted</h2>
          <p style={{ color: '#666', margin: '0 0 8px', fontSize: 15, lineHeight: 1.6 }}>
            Your email address is not authorized for ForgeOps Inbox.
          </p>
          <p style={{ color: '#999', margin: '0 0 28px', fontSize: 14, lineHeight: 1.5 }}>
            This is a private application. If you believe you should have access, ask your workspace administrator to add your email in Team Access.
          </p>
          <a href={signInUrl} className="btn btn-outline" style={{ marginRight: 8 }}>
            Try a different account
          </a>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <div style={{ textAlign: 'center', padding: 48, maxWidth: 460 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>&#9888;&#65039;</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Something went wrong</h2>
          <p style={{ color: '#888', fontSize: 14, margin: '0 0 20px' }}>{error}</p>
          <a href={signInUrl} className="btn btn-primary">
            Sign in with Google
          </a>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <p style={{ color: '#888', fontSize: 15 }}>Loading...</p>
      </div>
    )
  }

  if (!session.authenticated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <div style={{ textAlign: 'center', padding: 48, maxWidth: 480 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 24, color: '#fff' }}>&#9993;</div>
          <h1 style={{ fontSize: 28, margin: '0 0 8px', fontWeight: 700, letterSpacing: '-0.5px', color: '#1a1a2e' }}>ForgeOps Inbox</h1>
          <p style={{ color: '#666', margin: '0 0 6px', fontSize: 16, lineHeight: 1.5 }}>
            Multi-provider inbox operations platform.
          </p>
          <p style={{ color: '#999', margin: '0 0 32px', fontSize: 14, lineHeight: 1.5 }}>
            Sync email from Gmail and Outlook, classify messages automatically, and extract actionable tasks for your team.
          </p>
          <a href={signInUrl} className="btn btn-primary" style={{ fontSize: 15, padding: '12px 32px' }}>
            Sign in with Google
          </a>
          <p style={{ color: '#bbb', margin: '20px 0 0', fontSize: 12 }}>
            Private access only. Contact your administrator for an invite.
          </p>
        </div>
      </div>
    )
  }

  const navigate = (p: Page) => {
    setPage(p)
    if (p !== 'message-detail') setSelectedMessageId('')
  }

  const openMessage = (id: string) => {
    setSelectedMessageId(id)
    setPage('message-detail')
  }

  const handleSignOut = async () => {
    await api.logout()
    window.location.href = '/'
  }

  const currentWorkspace = session.memberships.find(m => m.workspace.id === workspaceId)
  const needsConnection = ['inbox', 'tasks', 'review', 'message-detail'].includes(page) && connections.length === 0

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">ForgeOps Inbox</div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, i) => (
            <div key={item.page}>
              {item.section && (i === 0 || NAV_ITEMS[i - 1]?.section !== item.section) && (
                <div className="sidebar-section-label">{item.section}</div>
              )}
              <button
                className={page === item.page || (page === 'message-detail' && item.page === 'inbox') ? 'active' : ''}
                onClick={() => navigate(item.page)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-email">{session.user?.email}</div>
          <button onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <div className="main-content">
        <div className="topbar">
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {currentWorkspace?.workspace.name ?? 'Workspace'}
          </span>

          {session.memberships.length > 1 && (
            <select value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); setConnectionId('') }}>
              {session.memberships.map(m => (
                <option key={m.workspace.id} value={m.workspace.id}>{m.workspace.name}</option>
              ))}
            </select>
          )}

          {connections.length > 0 && ['inbox', 'tasks', 'review', 'message-detail'].includes(page) && (
            <select value={connectionId} onChange={e => setConnectionId(e.target.value)}>
              {connections.map(c => (
                <option key={c.id} value={c.id}>{c.email} ({c.counts.messages} msgs)</option>
              ))}
            </select>
          )}
        </div>

        <div className="page-content">
          {connectionNotice && (
            <div style={{
              padding: '10px 16px', marginBottom: 16, borderRadius: 6, fontSize: 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: connectionNotice.type === 'success' ? '#e6f4ea' : '#fce4ec',
              border: `1px solid ${connectionNotice.type === 'success' ? '#a8d5a2' : '#e8a09a'}`
            }}>
              <span>{connectionNotice.message}</span>
              <button onClick={() => setConnectionNotice(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>&times;</button>
            </div>
          )}

          {needsConnection && (
            <div className="empty-state">
              <div className="empty-icon">&#128233;</div>
              <h3>No inbox connected</h3>
              <p>Connect a Gmail or Outlook inbox to start syncing and analyzing your email.</p>
              <button className="btn btn-primary" onClick={() => navigate('connections')}>
                Go to Connections
              </button>
            </div>
          )}

          {!needsConnection && page === 'inbox' && connectionId && (
            <MessagesView workspaceId={workspaceId} connectionId={connectionId} onSelectMessage={openMessage} />
          )}
          {!needsConnection && page === 'message-detail' && connectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <MessageDetailView workspaceId={workspaceId} connectionId={connectionId} messageId={selectedMessageId} onBack={() => setPage('inbox')} />
            </div>
          )}
          {!needsConnection && page === 'tasks' && connectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <TasksView workspaceId={workspaceId} connectionId={connectionId} />
            </div>
          )}
          {!needsConnection && page === 'review' && connectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ReviewQueueView workspaceId={workspaceId} connectionId={connectionId} onSelectMessage={openMessage} />
            </div>
          )}

          {page === 'connections' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ConnectionsView workspaceId={workspaceId} connections={connections} onRefresh={loadConnections} />
            </div>
          )}
          {page === 'team' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <TeamAccessView workspaceId={workspaceId} />
            </div>
          )}
          {page === 'import' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <DataImportView workspaceId={workspaceId} />
            </div>
          )}
          {page === 'settings' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <SettingsView workspaceName={currentWorkspace?.workspace.name ?? ''} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
