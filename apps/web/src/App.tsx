import { useEffect, useState, useCallback } from 'react'
import { api, type SessionResponse, type ConnectionSummary } from './api'
import { ComposeEditor } from './components/ComposeEditor'

const API_ORIGIN = import.meta.env.VITE_API_URL ?? ''
const signInUrl = `${API_ORIGIN}/api/v1/auth/google/start?redirect=true`
import { MessagesView } from './views/MessagesView'
import { MessageDetailView } from './views/MessageDetailView'
import { ReviewQueueView } from './views/ReviewQueueView'
import { SettingsView } from './views/SettingsView'
import { PlatformAdminView } from './views/PlatformAdminView'
import { TasksView } from './views/TasksView'
import { DashboardView } from './views/DashboardView'
import { WorkspaceView } from './views/WorkspaceView'
import { ReferenceDataView } from './views/ReferenceDataView'
import { DataImportView } from './views/DataImportView'

type Page = 'dashboard' | 'inbox' | 'message-detail' | 'review' | 'tasks' | 'documents' | 'reference' | 'workspace' | 'settings' | 'admin'

const NAV_ITEMS: Array<{ page: Page; label: string; icon: string; section?: string; adminOnly?: boolean }> = [
  { page: 'dashboard', label: 'Dashboard', icon: '\uD83D\uDCCA' },
  { page: 'inbox', label: 'Inbox', icon: '\u2709' },
  { page: 'review', label: 'Review Queue', icon: '\u2696' },
  { page: 'tasks', label: 'Tasks', icon: '\u2611' },
  { page: 'documents', label: 'Documents', icon: '\uD83D\uDCC1', section: 'Manage' },
  { page: 'reference', label: 'Reference Data', icon: '\uD83D\uDCDA' },
  { page: 'workspace', label: 'Workspace', icon: '\uD83C\uDFE2' },
  { page: 'settings', label: 'Settings', icon: '\u2699' },
  { page: 'admin', label: 'Platform Admin', icon: '\uD83D\uDD27', section: 'System', adminOnly: true },
]

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [error, setError] = useState('')
  const [accessDenied, setAccessDenied] = useState(false)
  const [connectionNotice, setConnectionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [composeSending, setComposeSending] = useState(false)

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
      setPage('workspace')
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
      setPage('workspace')
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
          const saved = localStorage.getItem('forgeops_workspace')
          const match = s.memberships.find(m => m.workspace.id === saved)
          setWorkspaceId(match ? match.workspace.id : s.memberships[0].workspace.id)
        }
      })
      .catch(e => setError(e.message))
  }, [])

  useEffect(() => {
    if (workspaceId) localStorage.setItem('forgeops_workspace', workspaceId)
  }, [workspaceId])

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

  // --- Pre-auth screens ---

  if (accessDenied) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <div style={{ textAlign: 'center', padding: 48, maxWidth: 460 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fce4ec', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>&#128274;</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 700 }}>Access Restricted</h2>
          <p style={{ color: '#666', margin: '0 0 8px', fontSize: 15, lineHeight: 1.6 }}>Your email address is not authorized for ForgeOps Inbox.</p>
          <p style={{ color: '#999', margin: '0 0 28px', fontSize: 14, lineHeight: 1.5 }}>This is a private application. Contact your administrator for access.</p>
          <a href={signInUrl} className="btn btn-outline">Try a different account</a>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <div style={{ textAlign: 'center', padding: 48, maxWidth: 460 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Something went wrong</h2>
          <p style={{ color: '#888', fontSize: 14, margin: '0 0 20px' }}>{error}</p>
          <a href={signInUrl} className="btn btn-primary">Sign in with Google</a>
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
          <p style={{ color: '#666', margin: '0 0 6px', fontSize: 16, lineHeight: 1.5 }}>Multi-provider inbox operations platform.</p>
          <p style={{ color: '#999', margin: '0 0 32px', fontSize: 14, lineHeight: 1.5 }}>Sync email from Gmail and Outlook, classify messages automatically, and extract actionable tasks for your team.</p>
          <a href={signInUrl} className="btn btn-primary" style={{ fontSize: 15, padding: '12px 32px' }}>Sign in with Google</a>
          <p style={{ color: '#bbb', margin: '20px 0 0', fontSize: 12 }}>Private access only. Contact your administrator for an invite.</p>
        </div>
      </div>
    )
  }

  // --- Zero workspaces ---
  if (session.memberships.length === 0 && !session.user?.isPlatformAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <div style={{ textAlign: 'center', padding: 48, maxWidth: 480 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Access Approved</h2>
          <p style={{ color: '#666', margin: '0 0 8px', fontSize: 15, lineHeight: 1.5 }}>Your account has been approved, but you haven't been assigned to a workspace yet.</p>
          <p style={{ color: '#999', margin: '0 0 24px', fontSize: 14 }}>Contact your administrator to be added to a workspace.</p>
          <button onClick={handleSignOut} className="btn btn-outline">Sign out</button>
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

  const handleNewComposeSend = async (payload: { to: string[]; cc: string[]; subject: string; html: string; files: File[] }) => {
    if (!connectionId) return
    setComposeSending(true)
    try {
      await api.sendMessage(workspaceId, connectionId, {
        action: 'new',
        to: payload.to,
        cc: payload.cc,
        subject: payload.subject,
        body: payload.html,
        bodyFormat: 'html'
      })
      setShowCompose(false)
    } catch { /* */ } finally {
      setComposeSending(false)
    }
  }

  const currentWorkspace = session.memberships.find(m => m.workspace.id === workspaceId)
  const currentRole = currentWorkspace?.workspaceRole ?? 'VIEWER'
  const needsConnection = ['inbox', 'review', 'message-detail', 'tasks'].includes(page) && connections.length === 0
  const isPlatformAdmin = session.user?.isPlatformAdmin || session.user?.platformRole === 'PLATFORM_ADMIN'

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span style={{ fontSize: 16, marginRight: 6 }}>&#9993;</span>
          ForgeOps
        </div>

        {/* Workspace switcher */}
        <div style={{ padding: '0 14px 10px' }}>
          {session.memberships.length > 1 ? (
            <select
              value={workspaceId}
              onChange={e => { setWorkspaceId(e.target.value); setConnectionId('') }}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, fontSize: 12, background: 'rgba(255,255,255,0.08)', color: '#dde', cursor: 'pointer' }}
            >
              {session.memberships.map(m => (
                <option key={m.workspace.id} value={m.workspace.id} style={{ color: '#333' }}>{m.workspace.name}</option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: 12, color: '#99a', padding: '4px 0', fontWeight: 500 }}>
              {currentWorkspace?.workspace.name ?? 'Workspace'}
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.filter(item => {
            if (item.adminOnly && !isPlatformAdmin) return false
            return true
          }).map((item, i, arr) => (
            <div key={item.page}>
              {item.section && (i === 0 || arr[i - 1]?.section !== item.section) && (
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
          {isPlatformAdmin && <div style={{ fontSize: 9, color: '#5c7cfa', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Platform Admin</div>}
          <button onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <div className="main-content">
        <div className="topbar">
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {currentWorkspace?.workspace.name ?? 'ForgeOps Inbox'}
          </span>

          <div style={{ flex: 1 }} />

          {connections.length > 0 && ['inbox', 'tasks', 'review', 'message-detail'].includes(page) && (
            <select value={connectionId} onChange={e => setConnectionId(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #d0d0d0', borderRadius: 4, fontSize: 12, background: '#fff' }}>
              {connections.map(c => (
                <option key={c.id} value={c.id}>{c.email} ({c.counts.messages} msgs)</option>
              ))}
            </select>
          )}

          {page === 'inbox' && connectionId && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowCompose(true)}>
              Compose
            </button>
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
              <p>Connect a Gmail or Outlook inbox from the Workspace page to start syncing.</p>
              <button className="btn btn-primary" onClick={() => navigate('workspace')}>Go to Workspace</button>
            </div>
          )}

          {page === 'dashboard' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <DashboardView workspaceId={workspaceId} connectionId={connectionId} onNavigate={(p: string) => setPage(p as Page)} />
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
          {!needsConnection && page === 'review' && connectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ReviewQueueView workspaceId={workspaceId} connectionId={connectionId} onSelectMessage={openMessage} />
            </div>
          )}
          {!needsConnection && page === 'tasks' && connectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <TasksView workspaceId={workspaceId} connectionId={connectionId} />
            </div>
          )}

          {page === 'workspace' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <WorkspaceView workspaceId={workspaceId} workspaceName={currentWorkspace?.workspace.name ?? ''} userRole={currentRole} />
            </div>
          )}
          {page === 'documents' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <DataImportView workspaceId={workspaceId} />
            </div>
          )}
          {page === 'reference' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ReferenceDataView workspaceId={workspaceId} />
            </div>
          )}
          {page === 'settings' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <SettingsView workspaceName={currentWorkspace?.workspace.name ?? ''} />
            </div>
          )}
          {page === 'admin' && isPlatformAdmin && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <PlatformAdminView />
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 24
        }}>
          <div style={{
            width: 560, maxHeight: '80vh', background: '#fff', borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid #e5e5e5',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>New Message</h3>
              <button onClick={() => setShowCompose(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#999' }}>&times;</button>
            </div>
            <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
              <ComposeEditor
                onSend={handleNewComposeSend}
                sending={composeSending}
                sendLabel="Send"
                onCancel={() => setShowCompose(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
