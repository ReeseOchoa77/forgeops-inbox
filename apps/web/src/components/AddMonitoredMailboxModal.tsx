import { useMemo, useState } from 'react'
import {
  api,
  type ApprovedAccessEntry,
  type ConnectionSummary,
} from '../api'
import {
  deriveMemberMailboxState,
  eligibleTeamMembers,
  findExistingMemberConnection,
  memberMailboxStateLabel,
  normalizeMailboxEmail,
} from '../monitored-mailbox-eligibility'

type ProviderChoice = 'outlook' | 'gmail'

type Props = {
  workspaceId: string
  members: ApprovedAccessEntry[]
  connections: ConnectionSummary[]
  open: boolean
  onClose: () => void
  onAuthorize: (connection: ConnectionSummary) => void
  onReconnect: (connection: ConnectionSummary) => void
  onRegistered: () => void
}

export function AddMonitoredMailboxModal({
  workspaceId,
  members,
  connections,
  open,
  onClose,
  onAuthorize,
  onReconnect,
  onRegistered,
}: Props) {
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderChoice>('outlook')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eligible = useMemo(() => eligibleTeamMembers(members), [members])

  const selected = eligible.find(
    (m) => normalizeMailboxEmail(m.email) === normalizeMailboxEmail(selectedEmail ?? '')
  )

  const existingForProvider = selected
    ? findExistingMemberConnection(selected.email, provider, connections)
    : null

  const existingSameProvider =
    existingForProvider &&
    existingForProvider.provider.toLowerCase() ===
      (provider === 'gmail' ? 'gmail' : 'outlook')
      ? existingForProvider
      : null

  if (!open) return null

  const startAuthorizeExisting = (conn: ConnectionSummary) => {
    if (conn.authorizationStatus === 'REAUTHORIZATION_REQUIRED') {
      onReconnect(conn)
    } else {
      onAuthorize(conn)
    }
  }

  const handleContinue = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      if (existingSameProvider) {
        startAuthorizeExisting(existingSameProvider)
        return
      }

      const result = await api.registerMonitoredMailbox(workspaceId, {
        email: selected.email,
        provider: provider === 'gmail' ? 'GMAIL' : 'OUTLOOK',
      })

      onRegistered()

      if (result.alreadyExists && result.connection.authorizationStatus === 'CONNECTED') {
        onClose()
        return
      }

      const summary: ConnectionSummary = {
        id: result.connection.id,
        provider: result.connection.provider,
        email: result.connection.email,
        displayName: result.connection.displayName,
        status: result.connection.status,
        connectedAt: null,
        lastSyncedAt: null,
        ingestionSource: result.connection.ingestionSource,
        nativeListeningEnabled: result.connection.nativeListeningEnabled,
        authorizationStatus: result.connection.authorizationStatus,
        capabilities: result.connection.capabilities,
        counts: { messages: 0, threads: 0 },
      }

      if (summary.authorizationStatus === 'REAUTHORIZATION_REQUIRED') {
        onReconnect(summary)
      } else if (summary.authorizationStatus !== 'CONNECTED') {
        onAuthorize(summary)
      } else {
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register mailbox')
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add Monitored Mailbox"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 20,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add Monitored Mailbox</h3>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#666', margin: '0 0 14px', lineHeight: 1.45 }}>
          Select a team member, then authorize their mailbox with Microsoft or Google.
          The signed-in provider account must match their email exactly.
        </p>

        {error && (
          <div style={{
            padding: '8px 10px', marginBottom: 12, fontSize: 12,
            background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4,
          }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Team member</div>
          {eligible.length === 0 ? (
            <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
              No active team members. Add people under Team Access first.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' }}>
              {eligible.map((m) => {
                const state = deriveMemberMailboxState(m.email, connections)
                const selectedRow =
                  selectedEmail != null &&
                  normalizeMailboxEmail(selectedEmail) === normalizeMailboxEmail(m.email)
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedEmail(m.email)
                      setError(null)
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: selectedRow ? '1px solid #1a1a2e' : '1px solid #e5e5e5',
                      background: selectedRow ? '#f4f6fb' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{m.email}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      Role: {m.role} · {memberMailboxStateLabel(state)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {selected && (
          <>
            <div style={{ marginBottom: 14, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Mailbox email</div>
              <div>{selected.email}</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Provider</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { id: 'outlook' as const, label: 'Microsoft Outlook' },
                  { id: 'gmail' as const, label: 'Gmail' },
                ]).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: provider === p.id ? '1px solid #1a1a2e' : '1px solid #ddd',
                      background: provider === p.id ? '#1a1a2e' : '#fff',
                      color: provider === p.id ? '#fff' : '#333',
                      cursor: 'pointer',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {existingSameProvider && (
              <p style={{ fontSize: 12, color: '#f57f17', margin: '0 0 12px', lineHeight: 1.4 }}>
                {existingSameProvider.authorizationStatus === 'CONNECTED'
                  ? 'This mailbox is already connected. Use Reauthorize if scopes need refreshing.'
                  : 'This mailbox is already registered. Continue to authorize (no duplicate will be created).'}
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {existingSameProvider?.authorizationStatus === 'CONNECTED' ? (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy || !selected}
              onClick={() => {
                onClose()
                onReconnect(existingSameProvider)
              }}
            >
              Reauthorize
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy || !selected}
              onClick={() => void handleContinue()}
            >
              {busy
                ? 'Starting…'
                : existingSameProvider
                  ? 'Authorize existing'
                  : 'Authorize with OAuth'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
