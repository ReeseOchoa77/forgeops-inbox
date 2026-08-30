import { useEffect, useState, useCallback, useRef } from 'react'
import { api, type SessionResponse, type ConnectionSummary } from './api'
import { ComposeEditor } from './components/ComposeEditor'
import { useBreakpoint } from './hooks/useBreakpoint'

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
import { ReferenceDataView, isReferenceDataTab, type ReferenceDataTab } from './views/ReferenceDataView'
import { JobsView } from './views/JobsView'
import { JobDetailView } from './views/JobDetailView'
import { JobDiscoveryView } from './views/JobDiscoveryView'
import { CalendarView } from './views/CalendarView'
import {
  ALL_MAILBOXES_CONNECTION_ID,
  isAllMailboxesConnectionId,
  pickDefaultInboxConnectionId,
} from './mailbox-selection'

type Page = 'dashboard' | 'inbox' | 'message-detail' | 'review' | 'tasks' | 'calendar' | 'jobs' | 'job-detail' | 'outlook-folders' | 'documents' | 'reference' | 'team-access' | 'workspace' | 'settings' | 'admin'

type UserRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER'

const NAV_ITEMS: Array<{ page: Page; label: string; icon: string; section?: string; adminOnly?: boolean; minRole?: UserRole }> = [
  { page: 'dashboard', label: 'Dashboard', icon: '\uD83D\uDCCA' },
  { page: 'inbox', label: 'Inbox', icon: '\u2709' },
  { page: 'tasks', label: 'Tasks', icon: '\u2611' },
  { page: 'calendar', label: 'Calendar', icon: '\uD83D\uDCC5' },
  { page: 'jobs', label: 'Jobs', icon: '\uD83D\uDD28' },
  { page: 'reference', label: 'Company Data', icon: '\uD83D\uDCDA', section: 'Manage' },
  { page: 'outlook-folders', label: 'Job Discovery', icon: '📂', section: 'Manage' },
  { page: 'workspace', label: 'Workspace', icon: '\uD83C\uDFE2' },
  { page: 'review', label: 'Email Classification', icon: '\u2696', section: 'System', minRole: 'ADMIN' },
  { page: 'admin', label: 'Platform Admin', icon: '\uD83D\uDD27', section: 'System', adminOnly: true },
]

const PAGE_TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  inbox: 'Inbox',
  'message-detail': 'Message',
  review: 'Email Classification',
  tasks: 'Tasks',
  calendar: 'Calendar',
  jobs: 'Jobs',
  'job-detail': 'Job Detail',
  'outlook-folders': 'Job Discovery',
  documents: 'Documents',
  reference: 'Company Data',
  'team-access': 'Team Access',
  workspace: 'Workspace',
  settings: 'Settings',
  admin: 'Platform Admin',
}

const ROLE_HIERARCHY: Record<UserRole, number> = { VIEWER: 0, MEMBER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 }

function hasMinRole(current: UserRole, required: UserRole): boolean {
  return ROLE_HIERARCHY[current] >= ROLE_HIERARCHY[required]
}

const SIDEBAR_COLLAPSED_KEY = 'forgeops_sidebar_collapsed'

export default function App() {
  const bp = useBreakpoint()
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [messageConnectionId, setMessageConnectionId] = useState('')
  const [pinningMailbox, setPinningMailbox] = useState(false)
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [error, setError] = useState('')
  const [accessDenied, setAccessDenied] = useState(false)
  const [connectionNotice, setConnectionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [composeSending, setComposeSending] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [sendableMailboxes, setSendableMailboxes] = useState<Array<{
    id: string
    email: string
    displayName: string | null
    provider: string
  }>>([])
  const [sendableLoading, setSendableLoading] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState('')
  const [messageBackPage, setMessageBackPage] = useState<Page>('inbox')
  const [workspaceTabHint, setWorkspaceTabHint] = useState<'mailboxes' | 'team' | 'folders'>('mailboxes')
  const [referenceTabHint, setReferenceTabHint] = useState<ReferenceDataTab>(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('refTab')
      if (isReferenceDataTab(fromUrl)) return fromUrl
    } catch { /* ignore */ }
    return 'customers'
  })

  // Legacy Team Access top-level page → Workspace → Team Access tab
  useEffect(() => {
    if (page !== 'team-access') return
    setWorkspaceTabHint('team')
    setPage('workspace')
  }, [page])

  // Legacy Documents top-level page → Company Data → Documents tab
  useEffect(() => {
    if (page !== 'documents') return
    setReferenceTabHint('documents')
    setPage('reference')
  }, [page])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true' } catch { return false }
  })
  const [drawerOpen, setDrawerOpen] = useState(false)

  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed)) } catch { /* */ }
  }, [sidebarCollapsed])

  // Close drawer on breakpoint change away from phone
  useEffect(() => {
    if (bp !== 'phone') setDrawerOpen(false)
  }, [bp])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
      // Focus the drawer
      setTimeout(() => drawerRef.current?.focus(), 50)
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  // Escape key closes drawer
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false)
        menuBtnRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (params.get('access') === 'denied') {
      setAccessDenied(true)
      window.history.replaceState({}, '', window.location.pathname)
      return
    }

    if (params.get('connected')) {
      setConnectionNotice({
        type: 'success',
        message: 'Mailbox authorized and connected. Configure listening from Monitored Mailboxes when ready.',
      })
      setWorkspaceTabHint('mailboxes')
      setPage('workspace')
      window.history.replaceState({}, '', window.location.pathname)
      // Do not auto-trigger inbox sync here. Canonical sync is POST .../sync and
      // requires native listening ON; OAuth reconnect intentionally leaves listening off.
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
    if (!workspaceId || !session) return
    api.getConnections(workspaceId)
      .then(r => {
        setConnections(r.connections)
        const membership = session.memberships.find(m => m.workspace.id === workspaceId)
        setConnectionId(prev => {
          if (isAllMailboxesConnectionId(prev) && r.connections.length > 0) return prev
          if (prev && r.connections.some(c => c.id === prev)) return prev
          return pickDefaultInboxConnectionId({
            connections: r.connections,
            pinnedInboxConnectionId: membership?.pinnedInboxConnectionId,
            signedInEmail: session.user?.email,
          })
        })
      })
      .catch(e => setError(e.message))
  }, [workspaceId, session])

  useEffect(() => { loadConnections() }, [loadConnections])

  // --- Pre-auth screens ---

  if (accessDenied) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8', padding: 16 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8', padding: 16 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8', padding: 16 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f7f7f8', padding: 16 }}>
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
    if (p === 'team-access') {
      setWorkspaceTabHint('team')
      setPage('workspace')
    } else if (p === 'documents') {
      setReferenceTabHint('documents')
      setPage('reference')
    } else {
      if (p === 'workspace') setWorkspaceTabHint('mailboxes')
      if (p === 'reference') setReferenceTabHint((prev) => prev || 'customers')
      setPage(p)
    }
    // All Mailboxes is Inbox-only; resolve to a concrete mailbox for other pages.
    if (
      p !== 'inbox' &&
      p !== 'message-detail' &&
      isAllMailboxesConnectionId(connectionId)
    ) {
      const membership = session.memberships.find(m => m.workspace.id === workspaceId)
      setConnectionId(
        pickDefaultInboxConnectionId({
          connections,
          pinnedInboxConnectionId: membership?.pinnedInboxConnectionId,
          signedInEmail: session.user?.email,
        })
      )
    }
    if (p !== 'message-detail') setSelectedMessageId('')
    if (bp === 'phone') setDrawerOpen(false)
  }

  const openMessage = (id: string, opts?: { connectionId?: string; backPage?: Page }) => {
    const owning =
      opts?.connectionId && !isAllMailboxesConnectionId(opts.connectionId)
        ? opts.connectionId
        : !isAllMailboxesConnectionId(connectionId)
          ? connectionId
          : ''
    if (owning) setMessageConnectionId(owning)
    // Job/detail deep-links may switch the list mailbox; Inbox All view keeps selection.
    if (opts?.connectionId && opts.backPage && opts.backPage !== 'inbox') {
      setConnectionId(opts.connectionId)
    }
    setMessageBackPage(opts?.backPage ?? 'inbox')
    setSelectedMessageId(id)
    setPage('message-detail')
  }

  const pinCurrentMailbox = async () => {
    if (!workspaceId || !connectionId || isAllMailboxesConnectionId(connectionId)) return
    setPinningMailbox(true)
    try {
      const r = await api.patchWorkspacePreferences(workspaceId, {
        pinnedInboxConnectionId: connectionId,
      })
      setSession(prev => {
        if (!prev) return prev
        return {
          ...prev,
          memberships: prev.memberships.map(m =>
            m.workspace.id === workspaceId
              ? { ...m, pinnedInboxConnectionId: r.pinnedInboxConnectionId }
              : m
          ),
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pin mailbox')
    } finally {
      setPinningMailbox(false)
    }
  }

  const unpinMailbox = async () => {
    if (!workspaceId) return
    setPinningMailbox(true)
    try {
      await api.patchWorkspacePreferences(workspaceId, { pinnedInboxConnectionId: null })
      setSession(prev => {
        if (!prev) return prev
        return {
          ...prev,
          memberships: prev.memberships.map(m =>
            m.workspace.id === workspaceId
              ? { ...m, pinnedInboxConnectionId: null }
              : m
          ),
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unpin mailbox')
    } finally {
      setPinningMailbox(false)
    }
  }

  const openJob = (id: string) => {
    setSelectedJobId(id)
    setPage('job-detail')
  }

  const openCompose = () => {
    setComposeError(null)
    setShowCompose(true)
    if (!workspaceId) return
    setSendableLoading(true)
    api.getSendableMailboxes(workspaceId)
      .then((r) => setSendableMailboxes(r.mailboxes))
      .catch(() => setSendableMailboxes([]))
      .finally(() => setSendableLoading(false))
  }

  const handleNewComposeSend = async (payload: {
    inboxConnectionId: string
    to: string[]
    cc: string[]
    bcc: string[]
    subject: string
    html: string
    files: File[]
    existingAttachmentIds?: string[]
  }) => {
    setComposeSending(true)
    setComposeError(null)
    try {
      await api.sendMessage(workspaceId, payload.inboxConnectionId, {
        action: 'new',
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        body: payload.html,
        bodyFormat: 'html',
        files: payload.files,
        existingAttachmentIds: payload.existingAttachmentIds,
      })
      setShowCompose(false)
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setComposeSending(false)
    }
  }

  const currentWorkspace = session.memberships.find(m => m.workspace.id === workspaceId)
  const currentRole = (currentWorkspace?.role ?? 'VIEWER') as UserRole
  const userEmail = session.user?.email ?? ''
  const pinnedInboxConnectionId = currentWorkspace?.pinnedInboxConnectionId ?? null
  const concreteConnectionId = isAllMailboxesConnectionId(connectionId)
    ? pickDefaultInboxConnectionId({
        connections,
        pinnedInboxConnectionId,
        signedInEmail: userEmail,
      })
    : connectionId
  const detailConnectionId = messageConnectionId || concreteConnectionId
  const needsConnection = ['inbox', 'review', 'message-detail', 'tasks'].includes(page) && connections.length === 0
  const isPlatformAdmin = session.user?.isPlatformAdmin || session.user?.platformRole === 'PLATFORM_ADMIN'
  const showAllMailboxesOption = page === 'inbox' || (page === 'message-detail' && messageBackPage === 'inbox')
  const isPinnedSelected =
    Boolean(pinnedInboxConnectionId) &&
    pinnedInboxConnectionId === connectionId &&
    !isAllMailboxesConnectionId(connectionId)

  const isPhone = bp === 'phone'
  const isTablet = bp === 'tablet'
  const effectiveCollapsed = isTablet ? true : sidebarCollapsed
  const sidebarWidth = effectiveCollapsed ? 56 : 200

  const filteredNav = NAV_ITEMS.filter(item => {
    if (item.adminOnly && !(isPlatformAdmin && currentRole === 'OWNER')) return false
    if (item.minRole && !hasMinRole(currentRole, item.minRole)) return false
    return true
  })

  const sidebarContent = (forDrawer: boolean) => (
    <>
      <div className="sidebar-brand" style={effectiveCollapsed && !forDrawer ? { padding: '16px 0 10px', textAlign: 'center', fontSize: 18 } : undefined}>
        {effectiveCollapsed && !forDrawer ? (
          <span style={{ fontSize: 18 }}>&#9993;</span>
        ) : (
          <>
            <span style={{ fontSize: 16, marginRight: 6 }}>&#9993;</span>
            ForgeOps
          </>
        )}
      </div>

      {/* Workspace switcher */}
      {(!effectiveCollapsed || forDrawer) && (
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
      )}

      <nav className="sidebar-nav">
        {filteredNav.map((item, i, arr) => (
          <div key={item.page}>
            {item.section && (i === 0 || arr[i - 1]?.section !== item.section) && (
              (!effectiveCollapsed || forDrawer) ? (
                <div className="sidebar-section-label">{item.section}</div>
              ) : (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '6px 8px' }} />
              )
            )}
            <button
              className={page === item.page || (page === 'message-detail' && item.page === 'inbox') || (page === 'job-detail' && item.page === 'jobs') ? 'active' : ''}
              onClick={() => navigate(item.page)}
              title={effectiveCollapsed && !forDrawer ? item.label : undefined}
              style={effectiveCollapsed && !forDrawer ? { justifyContent: 'center', padding: '10px 0' } : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {(!effectiveCollapsed || forDrawer) && item.label}
            </button>
          </div>
        ))}
      </nav>

      {/* Collapse toggle (desktop only, not in drawer) */}
      {!forDrawer && !isTablet && (
        <div style={{ padding: '4px 8px' }}>
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              width: '100%', padding: '6px 0', background: 'none', border: 'none',
              color: '#667', fontSize: 14, cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 4,
            }}
          >
            {sidebarCollapsed ? '\u276F' : '\u276E'}
            {!sidebarCollapsed && <span style={{ fontSize: 11 }}>Collapse</span>}
          </button>
        </div>
      )}

      <div className="sidebar-footer" style={effectiveCollapsed && !forDrawer ? { padding: '10px 4px', textAlign: 'center' } : undefined}>
        {(!effectiveCollapsed || forDrawer) && (
          <>
            <div className="user-email">{session.user?.email}</div>
            {isPlatformAdmin && <div style={{ fontSize: 9, color: '#5c7cfa', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Platform Admin</div>}
          </>
        )}
        <button onClick={handleSignOut} style={effectiveCollapsed && !forDrawer ? { padding: '3px 6px', fontSize: 10 } : undefined}>
          {effectiveCollapsed && !forDrawer ? '✕' : 'Sign out'}
        </button>
      </div>
    </>
  )

  return (
    <div className="app-layout">
      {/* Desktop / Tablet sidebar */}
      {!isPhone && (
        <aside
          className="sidebar"
          style={{ width: sidebarWidth, transition: 'width 0.2s ease' }}
        >
          {sidebarContent(false)}
        </aside>
      )}

      {/* Phone drawer overlay */}
      {isPhone && drawerOpen && (
        <div
          className="drawer-backdrop"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 900,
          }}
          onClick={() => { setDrawerOpen(false); menuBtnRef.current?.focus() }}
        />
      )}

      {/* Phone drawer sidebar */}
      {isPhone && (
        <aside
          ref={drawerRef}
          role="dialog"
          aria-label="Navigation menu"
          aria-modal="true"
          tabIndex={-1}
          className="sidebar"
          style={{
            position: 'fixed', top: 0, left: 0, bottom: 0,
            width: 280, zIndex: 910,
            transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s ease',
          }}
        >
          {sidebarContent(true)}
        </aside>
      )}

      {/* Main area */}
      <div className="main-content">
        {/* Phone top bar */}
        {isPhone ? (
          <header className="mobile-header" style={{
            height: 52, padding: '0 12px', background: '#fff', borderBottom: '1px solid #e5e5e5',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          }}>
            <button
              ref={menuBtnRef}
              onClick={() => setDrawerOpen(o => !o)}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              style={{
                background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
                padding: '4px 6px', color: '#333', lineHeight: 1,
                minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              &#9776;
            </button>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 15, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {PAGE_TITLES[page]}
            </span>
            <span style={{
              width: 32, height: 32, borderRadius: '50%', background: '#e0e7ff', color: '#4338ca',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600, flexShrink: 0,
            }}>
              {(session.user?.email ?? '?')[0].toUpperCase()}
            </span>
          </header>
        ) : (
          <div className="topbar">
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {currentWorkspace?.workspace.name ?? 'ForgeOps Inbox'}
            </span>

            <div style={{ flex: 1 }} />

            {connections.length > 0 && ['inbox', 'tasks', 'review', 'message-detail'].includes(page) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select
                  value={connectionId}
                  onChange={e => setConnectionId(e.target.value)}
                  style={{ padding: '4px 8px', border: '1px solid #d0d0d0', borderRadius: 4, fontSize: 12, background: '#fff' }}
                >
                  {showAllMailboxesOption && (
                    <option value={ALL_MAILBOXES_CONNECTION_ID}>All Mailboxes</option>
                  )}
                  {connections.map(c => (
                    <option key={c.id} value={c.id}>
                      {pinnedInboxConnectionId === c.id ? '📌 ' : ''}
                      {c.email}
                    </option>
                  ))}
                </select>
                {page === 'inbox' && !isAllMailboxesConnectionId(connectionId) && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={pinningMailbox}
                    title={isPinnedSelected ? 'Unpin default mailbox' : 'Always open this mailbox'}
                    onClick={() => (isPinnedSelected ? void unpinMailbox() : void pinCurrentMailbox())}
                    style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {isPinnedSelected ? 'Unpin' : 'Pin default'}
                  </button>
                )}
              </div>
            )}

            {page === 'inbox' && connections.length > 0 && currentRole !== 'VIEWER' && (
              <button className="btn btn-sm btn-primary" onClick={openCompose}>
                Compose
              </button>
            )}
          </div>
        )}

        {/* Phone-only topbar extras (connection selector, compose) */}
        {isPhone && connections.length > 0 && ['inbox', 'tasks', 'review', 'message-detail'].includes(page) && (
          <div style={{ padding: '6px 12px', background: '#fafafa', borderBottom: '1px solid #eee', display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={connectionId}
              onChange={e => setConnectionId(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: 4, fontSize: 12, background: '#fff' }}
            >
              {showAllMailboxesOption && (
                <option value={ALL_MAILBOXES_CONNECTION_ID}>All Mailboxes</option>
              )}
              {connections.map(c => (
                <option key={c.id} value={c.id}>
                  {pinnedInboxConnectionId === c.id ? '📌 ' : ''}
                  {c.email}
                </option>
              ))}
            </select>
            {page === 'inbox' && connections.length > 0 && currentRole !== 'VIEWER' && (
              <button className="btn btn-sm btn-primary" onClick={openCompose}>
                Compose
              </button>
            )}
          </div>
        )}

        <div className="page-content" style={isPhone ? { padding: '12px' } : undefined}>
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
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <DashboardView workspaceId={workspaceId} connectionId={concreteConnectionId} connections={connections} onNavigate={(p) => setPage(p)} breakpoint={bp} />
            </div>
          )}

          {/* Keep Inbox mounted while viewing a message opened from Inbox so back restores
              list state (page, filters, scroll) without remount/refetch. */}
          {!needsConnection && connectionId && (
            page === 'inbox' || (page === 'message-detail' && messageBackPage === 'inbox')
          ) && (
            <div
              style={{
                display: page === 'inbox' ? 'flex' : 'none',
                flex: 1,
                overflow: 'hidden',
                minHeight: 0,
                flexDirection: 'column',
              }}
              aria-hidden={page !== 'inbox'}
            >
              <MessagesView
                workspaceId={workspaceId}
                connectionId={connectionId}
                onSelectMessage={openMessage}
                userRole={currentRole}
                userEmail={userEmail}
                connections={connections}
                breakpoint={bp}
                openedMessageId={
                  page === 'message-detail' && messageBackPage === 'inbox'
                    ? selectedMessageId
                    : null
                }
              />
            </div>
          )}
          {!needsConnection && page === 'message-detail' && detailConnectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <MessageDetailView
                workspaceId={workspaceId}
                connectionId={detailConnectionId}
                messageId={selectedMessageId}
                connections={connections}
                onBack={() => setPage(messageBackPage === 'job-detail' && selectedJobId ? 'job-detail' : 'inbox')}
                breakpoint={bp}
              />
            </div>
          )}
          {!needsConnection && page === 'review' && concreteConnectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ReviewQueueView workspaceId={workspaceId} connectionId={concreteConnectionId} />
            </div>
          )}
          {!needsConnection && page === 'tasks' && concreteConnectionId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <TasksView workspaceId={workspaceId} connectionId={concreteConnectionId} connections={connections} onSelectMessage={openMessage} userRole={currentRole} />
            </div>
          )}

          {page === 'calendar' && (
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <CalendarView
                workspaceId={workspaceId}
                userRole={currentRole}
                onOpenJob={openJob}
              />
            </div>
          )}

          {page === 'jobs' && (
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <JobsView workspaceId={workspaceId} userRole={currentRole} onSelectJob={openJob} breakpoint={bp} />
            </div>
          )}
          {page === 'job-detail' && selectedJobId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <JobDetailView
                workspaceId={workspaceId}
                jobId={selectedJobId}
                userRole={currentRole}
                onBack={() => setPage('jobs')}
                onOpenMessage={(messageId, inboxConnectionId) =>
                  openMessage(messageId, { connectionId: inboxConnectionId, backPage: 'job-detail' })
                }
                breakpoint={bp}
              />
            </div>
          )}

          {page === 'outlook-folders' && workspaceId && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <JobDiscoveryView workspaceId={workspaceId} userRole={currentRole} />
            </div>
          )}

          {page === 'workspace' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <WorkspaceView
                workspaceId={workspaceId}
                workspaceName={currentWorkspace?.workspace.name ?? ''}
                userRole={currentRole}
                connectionId={connectionId}
                initialTab={workspaceTabHint}
              />
            </div>
          )}
          {page === 'reference' && (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <ReferenceDataView
                workspaceId={workspaceId}
                userRole={currentRole}
                initialTab={referenceTabHint}
              />
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

      {/* Compose modal — centered */}
      {showCompose && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: isPhone ? 0 : 24
        }}>
          <div style={{
            width: isPhone ? '100%' : 'min(860px, 94vw)', maxHeight: isPhone ? '100vh' : '90vh',
            height: isPhone ? '100%' : undefined,
            background: '#fff', borderRadius: isPhone ? 0 : 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            <div style={{
              padding: '14px 18px', borderBottom: '1px solid #e5e5e5',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Compose Email</h3>
              <button onClick={() => setShowCompose(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#999', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
            </div>
            <div style={{ padding: 18, overflow: 'auto', flex: 1, minHeight: 0 }}>
              <ComposeEditor
                workspaceId={workspaceId}
                sendableMailboxes={sendableMailboxes}
                mailboxesLoading={sendableLoading}
                onSend={handleNewComposeSend}
                sending={composeSending}
                sendError={composeError}
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
