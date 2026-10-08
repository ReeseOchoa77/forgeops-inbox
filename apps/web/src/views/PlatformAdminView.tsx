import { useEffect, useState } from 'react'
import { api, type AdminWorkspace, type AdminMember, type AdminMailbox } from '../api'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function providerLabel(provider: string): string {
  const p = provider.toLowerCase()
  if (p === 'outlook') return 'Outlook'
  if (p === 'gmail') return 'Gmail'
  return provider
}

export function PlatformAdminView() {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([])
  const [members, setMembers] = useState<{ wsId: string; list: AdminMember[] } | null>(null)
  const [connections, setConnections] = useState<{
    wsId: string
    list: AdminMailbox[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')

  const [newWsName, setNewWsName] = useState('')
  const [newWsSlug, setNewWsSlug] = useState('')

  const [ingestWorkspaceId, setIngestWorkspaceId] = useState('')
  const [ingestEmail, setIngestEmail] = useState('')
  const [ingestBusy, setIngestBusy] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const ws = await api.adminGetWorkspaces()
      setWorkspaces(ws.workspaces)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim() || !newWsSlug.trim()) return
    try {
      await api.adminCreateWorkspace(newWsName.trim(), newWsSlug.trim().toLowerCase())
      setNewWsName('')
      setNewWsSlug('')
      void loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm('Delete this workspace and ALL its data?')) return
    try {
      await api.adminDeleteWorkspace(id)
      if (members?.wsId === id) setMembers(null)
      if (connections?.wsId === id) setConnections(null)
      void loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  const showMembers = async (wsId: string) => {
    setDetailLoading(true)
    setConnections(null)
    try {
      const r = await api.adminGetMembers(wsId)
      setMembers({ wsId, list: r.members })
    } catch {
      setMembers(null)
      setError('Failed to load members')
    } finally {
      setDetailLoading(false)
    }
  }

  const showConnections = async (wsId: string) => {
    setDetailLoading(true)
    setMembers(null)
    try {
      const r = await api.adminGetMailboxes({ workspaceId: wsId })
      setConnections({ wsId, list: r.mailboxes })
    } catch {
      setConnections(null)
      setError('Failed to load connections')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleIngestMailbox = async () => {
    const workspaceId = ingestWorkspaceId.trim()
    const email = ingestEmail.trim()
    if (!workspaceId || !email) {
      setError('Select a workspace and enter a mailbox email')
      return
    }
    setIngestBusy(true)
    setError('')
    try {
      let mailboxId: string
      try {
        const registered = await api.adminRegisterMailbox({
          workspaceId,
          provider: 'OUTLOOK',
          email,
          ingestionSource: 'N8N',
        })
        mailboxId = registered.mailbox.id
      } catch (registerErr) {
        const msg =
          registerErr instanceof Error ? registerErr.message : String(registerErr)
        if (!/already (exists|registered)/i.test(msg)) {
          throw registerErr
        }
        const existing = await api.adminGetMailboxes({ workspaceId })
        const match = existing.mailboxes.find(
          (m) => m.email.toLowerCase() === email.toLowerCase()
        )
        if (!match) throw registerErr
        mailboxId = match.id
      }
      const auth = await api.adminAuthorizeDelegatedMailbox(mailboxId)
      if (!auth.authorizationUrl) {
        throw new Error('Microsoft authorization URL was not returned')
      }
      window.location.assign(auth.authorizationUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start mailbox ingest')
      setIngestBusy(false)
    }
  }

  const handleAuthorizeExistingDelegated = async (mailboxId: string) => {
    setIngestBusy(true)
    setError('')
    try {
      const auth = await api.adminAuthorizeDelegatedMailbox(mailboxId)
      if (!auth.authorizationUrl) {
        throw new Error('Microsoft authorization URL was not returned')
      }
      window.location.assign(auth.authorizationUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start delegated authorize')
      setIngestBusy(false)
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading admin data...</p>

  const detailWsName = (wsId: string) =>
    workspaces.find((w) => w.id === wsId)?.name ?? 'Workspace'

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Platform Admin</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
        Manage workspaces and members. Connections match Workspace → Monitored Mailboxes
        (disconnected mailboxes are excluded). Message totals update after Clear Inbox / sync.
        Ingest Mailbox lets you authorize a different Outlook mailbox than your ForgeOps login —
        Microsoft Graph must still grant access to that mailbox.
      </p>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            background: '#fce4ec',
            border: '1px solid #e8a09a',
            borderRadius: 4,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            &times;
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Name</label>
          <input
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            placeholder="Client Name"
            style={{
              padding: '5px 8px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 13,
              width: 180,
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Slug</label>
          <input
            value={newWsSlug}
            onChange={(e) => setNewWsSlug(e.target.value)}
            placeholder="client-name"
            style={{
              padding: '5px 8px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 13,
              width: 160,
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => void handleCreateWorkspace()}
        >
          Create
        </button>
      </div>

      <div
        className="card"
        style={{
          marginBottom: 16,
          padding: 12,
          border: '1px solid #e5e5e5',
          borderRadius: 6,
        }}
      >
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Ingest Mailbox</h3>
        <p style={{ fontSize: 12, color: '#888', margin: '0 0 10px' }}>
          Register an Outlook mailbox on a workspace, then complete Microsoft authorization.
          Sign in as an account that has Full Access / shared mailbox rights to the target.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Workspace</label>
            <select
              value={ingestWorkspaceId}
              onChange={(e) => setIngestWorkspaceId(e.target.value)}
              style={{
                padding: '5px 8px',
                border: '1px solid #ddd',
                borderRadius: 4,
                fontSize: 13,
                minWidth: 200,
              }}
            >
              <option value="">Select workspace…</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block' }}>
              Mailbox email
            </label>
            <input
              value={ingestEmail}
              onChange={(e) => setIngestEmail(e.target.value)}
              placeholder="estimating@company.com"
              style={{
                padding: '5px 8px',
                border: '1px solid #ddd',
                borderRadius: 4,
                fontSize: 13,
                width: 240,
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Provider</label>
            <input
              value="Outlook"
              disabled
              style={{
                padding: '5px 8px',
                border: '1px solid #ddd',
                borderRadius: 4,
                fontSize: 13,
                width: 100,
                background: '#f7f7f7',
              }}
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={ingestBusy}
            onClick={() => void handleIngestMailbox()}
          >
            {ingestBusy ? 'Starting…' : 'Authorize with Microsoft'}
          </button>
        </div>
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
          {workspaces.map((w) => (
            <tr key={w.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '7px 12px', fontWeight: 500 }}>{w.name}</td>
              <td
                style={{
                  padding: '7px 12px',
                  color: '#888',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                {w.slug}
              </td>
              <td style={{ padding: '7px 12px' }}>
                <button
                  type="button"
                  onClick={() => void showMembers(w.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#06c',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {w.counts.members}
                </button>
              </td>
              <td style={{ padding: '7px 12px' }}>
                <button
                  type="button"
                  onClick={() => void showConnections(w.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#06c',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                  title="Show monitored mailboxes for this workspace"
                >
                  {w.counts.connections}
                </button>
              </td>
              <td style={{ padding: '7px 12px' }}>{w.counts.messages.toLocaleString()}</td>
              <td style={{ padding: '7px 12px', color: '#999', fontSize: 12 }}>
                {formatDate(w.createdAt)}
              </td>
              <td style={{ padding: '7px 12px' }}>
                <button
                  type="button"
                  onClick={() => void handleDeleteWorkspace(w.id)}
                  className="btn btn-sm btn-danger"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detailLoading && (
        <p style={{ color: '#888', fontSize: 12, marginTop: 12 }}>Loading details…</p>
      )}

      {members && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>
              Members of {detailWsName(members.wsId)}
            </h3>
            <button
              type="button"
              onClick={() => setMembers(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}
            >
              &times;
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Email</th>
                <th style={{ padding: '6px 8px' }}>Name</th>
                <th style={{ padding: '6px 8px' }}>Role</th>
                <th style={{ padding: '6px 8px' }}>Admin</th>
                <th style={{ padding: '6px 8px' }}>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {members.list.map((m) => (
                <tr key={m.membershipId} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '5px 8px' }}>{m.email}</td>
                  <td style={{ padding: '5px 8px', color: '#888' }}>{m.name ?? '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{m.role}</td>
                  <td style={{ padding: '5px 8px' }}>{m.isPlatformAdmin ? 'Yes' : '—'}</td>
                  <td style={{ padding: '5px 8px', color: '#999' }}>
                    {formatDate(m.lastLoginAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connections && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>
              Connections · {detailWsName(connections.wsId)}
            </h3>
            <button
              type="button"
              onClick={() => setConnections(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}
            >
              &times;
            </button>
          </div>
          {connections.list.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
              No monitored mailboxes for this workspace.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Mailbox</th>
                  <th style={{ padding: '6px 8px' }}>Provider</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Mode</th>
                  <th style={{ padding: '6px 8px' }}>Listener</th>
                  <th style={{ padding: '6px 8px' }}>Messages</th>
                  <th style={{ padding: '6px 8px' }}>Last synced</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {connections.list.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 500 }}>{c.email}</td>
                    <td style={{ padding: '5px 8px' }}>{providerLabel(c.provider)}</td>
                    <td style={{ padding: '5px 8px' }}>{c.status}</td>
                    <td style={{ padding: '5px 8px' }}>{c.ingestionMode}</td>
                    <td style={{ padding: '5px 8px' }}>
                      {c.nativeListeningEnabled ? 'On' : 'Off'}
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      {c.counts.messages.toLocaleString()}
                    </td>
                    <td style={{ padding: '5px 8px', color: '#999' }}>
                      {formatDate(c.lastSyncedAt)}
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      {c.provider.toLowerCase() === 'outlook' ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={ingestBusy}
                          onClick={() => void handleAuthorizeExistingDelegated(c.id)}
                          title="Authorize or reauthorize with delegated Graph access"
                        >
                          Authorize
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: 11, color: '#999', margin: '10px 0 0' }}>
            Workspace message total:{' '}
            {connections.list
              .reduce((sum, c) => sum + c.counts.messages, 0)
              .toLocaleString()}{' '}
            (same basis as Workspace → Monitored Mailboxes). Manage listeners and Clear Inbox
            under Workspace for this client.
          </p>
        </div>
      )}
    </div>
  )
}
