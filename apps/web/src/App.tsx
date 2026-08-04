import { useEffect, useState, useCallback } from 'react'
import { api, type SessionResponse, type ConnectionSummary } from './api'
import { ComposeEditor } from './components/ComposeEditor'

const API_ORIGIN = import.meta.env.VITE_API_URL ?? ''
const googleSignInUrl = `${API_ORIGIN}/api/v1/auth/google/start?redirect=true`
const microsoftSignInUrl = `${API_ORIGIN}/api/v1/auth/microsoft/start?redirect=true`
import { MessagesView } from './views/MessagesView'
import { MessageDetailView } from './views/MessageDetailView'
import { ReviewQueueView } from './views/ReviewQueueView'
import { SettingsView } from './views/SettingsView'
import { PlatformAdminView } from './views/PlatformAdminView'
import { TasksView } from './views/TasksView'
import { DashboardView } from './views/DashboardView'
import { WorkspaceView } from './views/WorkspaceView'
import { ReferenceDataView } from './views/ReferenceDataView'
import { TeamAccessView } from './views/TeamAccessView'
import { DataImportView } from './views/DataImportView'
import { JobsView } from './views/JobsView'
import { JobDetailView } from './views/JobDetailView'

type Page = 'dashboard' | 'inbox' | 'message-detail' | 'review' | 'tasks' | 'jobs' | 'job-detail' | 'documents' | 'reference' | 'team-access' | 'workspace' | 'settings' | 'admin'

type UserRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER'

const NAV_ITEMS: Array<{ page: Page; label: string; icon: string; section?: string; adminOnly?: boolean; minRole?: UserRole }> = [
  { page: 'dashboard', label: 'Dashboard', icon: '\uD83D\uDCCA' },
  { page: 'inbox', label: 'Inbox', icon: '\u2709' },
  { page: 'review', label: 'Email Review', icon: '\u2696', minRole: 'ADMIN' },
  { page: 'tasks', label: 'Tasks', icon: '\u2611' },
  { page: 'jobs', label: 'Jobs', icon: '\uD83D\uDD28' },
  { page: 'documents', label: 'Documents', icon: '\uD83D\uDCC1', section: 'Manage' },
  { page: 'reference', label: 'Reference Data', icon: '\uD83D\uDCDA' },
  { page: 'team-access', label: 'Team Access', icon: '\uD83D\uDC65' },
  { page: 'workspace', label: 'Workspace', icon: '\uD83C\uDFE2' },
  { page: 'settings', label: 'Settings', icon: '\u2699' },
  { page: 'admin', label: 'Platform Admin', icon: '\uD83D\uDD27', section: 'System', adminOnly: true },
]

const ROLE_HIERARCHY: Record<UserRole, number> = { VIEWER: 0, MEMBER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 }

function hasMinRole(current: UserRole, required: UserRole): boolean {
  return ROLE_HIERARCHY[current] >= ROLE_HIERARCHY[required]
}

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
  const [selectedJobId, setSelectedJobId] = useState('')

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
          <a href={googleSignInUrl} className="btn btn-outline">Try a different account</a>
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
          <a href={googleSignInUrl} className="btn btn-primary">Sign in with Google</a>
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
    const showMicrosoft = session.microsoftAuthAvailable

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8' }}>
        <div style={{ textAlign: 'center', padding: 48, maxWidth: 480 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 24, color: '#fff' }}>&#9993;</div>
          <h1 style={{ fontSize: 28, margin: '0 0 8px', fontWeight: 700, letterSpacing: '-0.5px', color: '#1a1a2e' }}>ForgeOps Inbox</h1>
          <p style={{ color: '#666', margin: '0 0 6px', fontSize: 16, lineHeight: 1.5 }}>Multi-provider inbox operations platform.</p>
          <p style={{ color: '#999', margin: '0 0 32px', fontSize: 14, lineHeight: 1.5 }}>Sync email from Gmail and Outlook, classify messages automatically, and extract actionable tasks for your team.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <a
              href={googleSignInUrl}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                padding: '12px 28px', fontSize: 15, fontWeight: 500,
                border: '1px solid #dadce0', borderRadius: 6,
                background: '#fff', color: '#3c4043',
                textDecoration: 'none', cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                transition: 'box-shadow 0.2s, background 0.2s',
                minWidth: 240, justifyContent: 'center'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 019.5 24c0-1.59.28-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 000 24c0 3.77.9 7.35 2.56 10.53l7.97-5.94z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.94C6.51 42.62 14.62 48 24 48z"/></svg>
              Sign in with Google
            </a>
            {showMicrosoft && (
              <a
                href={microsoftSignInUrl}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  padding: '12px 28px', fontSize: 15, fontWeight: 500,
                  border: '1px solid #dadce0', borderRadius: 6,
                  background: '#fff', color: '#3c4043',
                  textDecoration: 'none', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  transition: 'box-shadow 0.2s, background 0.2s',
                  minWidth: 240, justifyContent: 'center'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                Sign in with Microsoft
              </a>
            )}
          </div>
          <p style={{ color: '#bbb', margin: '20px 0 0', fontSize: 12 }}>Private access only. Contact your administrator for an invite.</p>
        </div>
      </div>
    )
  }

  const handleSignOut = async () => {
    await api.logout()
    window.location.href = '/'
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

  const openJob = (id: string) => {
    setSelectedJobId(id)
    setPage('job-detail')
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
  const currentRole = (currentWorkspace?.role ?? 'VIEWER') as UserRole
  const userEmail = session.user?.email ?? ''
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
            if (item.adminOnly && !(isPlatformAdmin && currentRole === 'OWNER')) return false
            if (item.minRole && !hasMinRole(currentRole, item.minRole)) return false
            return true
          }).map((item, i, arr) => (
            <div key={item.page}>
              {item.section && (i === 0 || arr[i - 1]?.section !== item.section) && (
                <div className="sidebar-section-label">{item.section}</div>
              )}
              <button
                className={page === item.page || (page === 'message-detail' && item.page === 'inbox') || (page === 'job-detail' && item.page === 'jobs') ? 'active' : ''}
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

          {page === 'inbox' && connectionId && currentRole !== 'VIEWER' && (
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
              <DashboardView workspaceId={workspaceId} connectionId={connectionId} onNavigate={(p) => setPage(p)} />
            </div>
          )}

          {!needsConnection && page === 'inbox' && connectionId && (
            <MessagesView workspaceId={workspaceId} connectionId={connectionId} onSelectMessage={openMessage} userRole={currentRole} userEmail={userEmail} connections={connections} />
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
              <TasksView workspaceId={workspaceId} connectionId={connectionId} onSelectMessage={openMessage} userRole={currentRole} />
            </div>
          )}

          {page === 'jobs' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <JobsView workspaceId={workspaceId} userRole={currentRole} onSelectJob={openJob} />
            </div>
          )}
          {page === 'job-detail' && selectedJobId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <JobDetailView workspaceId={workspaceId} jobId={selectedJobId} userRole={currentRole} onBack={() => setPage('jobs')} />
            </div>
          )}

          {page === 'team-access' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <TeamAccessView workspaceId={workspaceId} userRole={currentRole} />
            </div>
          )}
          {page === 'workspace' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <WorkspaceView workspaceId={workspaceId} workspaceName={currentWorkspace?.workspace.name ?? ''} userRole={currentRole} connectionId={connectionId} />
            </div>
          )}
          {page === 'documents' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <DataImportView workspaceId={workspaceId} userRole={currentRole} />
            </div>
          )}
          {page === 'reference' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ReferenceDataView workspaceId={workspaceId} userRole={currentRole} />
            </div>
          )}
          {page === 'settings' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <SettingsView workspaceName={currentWorkspace?.workspace.name ?? ''} />
            </div>
          )}
          {page === 'admin' && isPlatformAdmin && currentRole === 'OWNER' && (
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
