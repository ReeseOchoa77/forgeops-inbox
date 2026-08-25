import { useEffect, useState } from 'react'
import {
  api,
  type ConnectionSummary,
  type MailboxHistoricalImportStatus,
  type MailboxListenerSettings,
} from '../api'
import {
  mailboxAuthorizationLabel,
  mailboxAuthorizationTone,
  needsSendingAuthorization,
} from '../mailbox-authorization-display'

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
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

function processingLabel(source: string | undefined): string {
  if (source === 'NATIVE') return 'NATIVE'
  if (source === 'SHADOW') return 'SHADOW (reserved)'
  return 'N8N'
}

type Props = {
  workspaceId: string
  connections: ConnectionSummary[]
  userRole: string
  onRefresh: () => void
  onAuthorize: (c: ConnectionSummary) => void
  onReconnect: (c: ConnectionSummary) => void
  authAction:
    | { type: 'idle' }
    | { type: 'loading'; connectionId: string }
    | { type: 'error'; connectionId: string; message: string }
  clearing: string
  onClearInbox: (id: string, email: string) => void
  isOwner: boolean
  canManage: boolean
}

export function MonitoredMailboxesPanel({
  workspaceId,
  connections,
  onRefresh,
  onAuthorize,
  onReconnect,
  authAction,
  clearing,
  onClearInbox,
  isOwner,
  canManage,
}: Props) {
  const [settingsOpenFor, setSettingsOpenFor] = useState<string | null>(null)
  const [settings, setSettings] = useState<MailboxListenerSettings | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [importOpenFor, setImportOpenFor] = useState<string | null>(null)
  const [importPreset, setImportPreset] = useState<'25' | '50' | '100' | '250'>('50')
  const [importBusy, setImportBusy] = useState(false)
  const [activeImport, setActiveImport] = useState<MailboxHistoricalImportStatus | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeImport || !importOpenFor) return
    if (activeImport.status === 'COMPLETED' || activeImport.status === 'FAILED') return
    const connectionId = importOpenFor
    const timer = setInterval(() => {
      void api
        .getHistoricalImport(workspaceId, connectionId, activeImport.id)
        .then((r) => setActiveImport(r.import))
        .catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [activeImport, importOpenFor, workspaceId])

  const openSettings = async (c: ConnectionSummary) => {
    setSettingsOpenFor(c.id)
    setSettingsError(null)
    setSettingsBusy(true)
    try {
      const res = await api.getMailboxListenerSettings(workspaceId, c.id)
      setSettings(res.settings)
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Failed to load settings')
      setSettings(null)
    } finally {
      setSettingsBusy(false)
    }
  }

  const saveSettings = async (patch: Parameters<typeof api.patchMailboxListenerSettings>[2]) => {
    if (!settingsOpenFor) return
    setSettingsBusy(true)
    setSettingsError(null)
    try {
      const res = await api.patchMailboxListenerSettings(workspaceId, settingsOpenFor, patch)
      setSettings(res.settings)
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSettingsBusy(false)
    }
  }

  const startImport = async () => {
    if (!importOpenFor) return
    setImportBusy(true)
    setImportError(null)
    try {
      const res = await api.startHistoricalImport(workspaceId, importOpenFor, {
        preset: importPreset,
      })
      setActiveImport(res.import)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Failed to start import')
    } finally {
      setImportBusy(false)
    }
  }

  if (connections.length === 0) {
    return (
      <p style={{ color: '#aaa', fontSize: 12, margin: 0 }}>
        No inboxes connected. Contact your platform admin to add monitored mailboxes.
      </p>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {connections.map((c) => {
          const authTone = mailboxAuthorizationTone({
            authorizationStatus: c.authorizationStatus,
            emailSending: c.capabilities.emailSending,
          })
          const actionLoading =
            authAction.type === 'loading' && authAction.connectionId === c.id
          const lastActivity =
            c.lastProcessedAt || c.lastReceivedAt || c.lastSyncedAt || null

          return (
            <div
              key={c.id}
              style={{
                border: '1px solid #eee',
                borderRadius: 6,
                padding: '12px 14px',
                background: '#fafafa',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.email}</div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                    {providerLabel(c.provider)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => void openSettings(c)}
                      >
                        Listener Settings
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => {
                          setImportOpenFor(c.id)
                          setActiveImport(null)
                          setImportError(null)
                        }}
                      >
                        Import Previous Emails
                      </button>
                      {c.nativeListeningEnabled ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ fontSize: 10, padding: '2px 8px' }}
                          disabled={settingsBusy}
                          onClick={() =>
                            void api
                              .patchMailboxListenerSettings(workspaceId, c.id, {
                                nativeListeningEnabled: false,
                              })
                              .then(() => onRefresh())
                              .catch((e) =>
                                alert(e instanceof Error ? e.message : 'Failed')
                              )
                          }
                        >
                          Stop Listening
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          style={{ fontSize: 10, padding: '2px 8px' }}
                          disabled={settingsBusy || c.ingestionSource === 'N8N'}
                          title={
                            c.ingestionSource === 'N8N'
                              ? 'Switch processing mode to NATIVE in Listener Settings first'
                              : 'Start native listener for new mail'
                          }
                          onClick={() =>
                            void api
                              .patchMailboxListenerSettings(workspaceId, c.id, {
                                ingestionSource: 'NATIVE',
                                nativeListeningEnabled: true,
                              })
                              .then(() => onRefresh())
                              .catch((e) =>
                                alert(e instanceof Error ? e.message : 'Failed')
                              )
                          }
                        >
                          Start Listening
                        </button>
                      )}
                    </>
                  )}
                  {c.authorizationStatus === 'REQUIRED' &&
                    c.provider.toLowerCase() === 'outlook' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        disabled={actionLoading}
                        onClick={() => onAuthorize(c)}
                      >
                        {actionLoading ? 'Starting…' : 'Authorize'}
                      </button>
                    )}
                  {needsSendingAuthorization({
                    provider: c.provider,
                    authorizationStatus: c.authorizationStatus,
                    emailSending: c.capabilities.emailSending,
                  }) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      disabled={actionLoading}
                      onClick={() => onAuthorize(c)}
                    >
                      {actionLoading ? 'Starting…' : 'Authorize sending'}
                    </button>
                  )}
                  {(c.authorizationStatus === 'REAUTHORIZATION_REQUIRED' ||
                    c.authorizationStatus === 'CONNECTED') && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      disabled={actionLoading}
                      onClick={() => onReconnect(c)}
                    >
                      {actionLoading ? 'Starting…' : 'Reauthorize'}
                    </button>
                  )}
                  {isOwner && c.counts.messages > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      disabled={clearing === c.id}
                      onClick={() => onClearInbox(c.id, c.email)}
                    >
                      {clearing === c.id ? 'Clearing...' : 'Clear Inbox'}
                    </button>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '8px 16px',
                  marginTop: 12,
                  fontSize: 12,
                }}
              >
                <div>
                  <div style={{ color: '#888', fontSize: 10 }}>Authorization</div>
                  <span
                    style={{
                      display: 'inline-block',
                      marginTop: 2,
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background: authTone.bg,
                      color: authTone.color,
                    }}
                  >
                    {mailboxAuthorizationLabel({
                      authorizationStatus: c.authorizationStatus,
                      emailSending: c.capabilities.emailSending,
                    })}
                  </span>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: 10 }}>Sending</div>
                  <div style={{ marginTop: 2 }}>
                    {c.capabilities.emailSending ? 'Available' : 'Unavailable'}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: 10 }}>Attachments</div>
                  <div style={{ marginTop: 2 }}>
                    {c.capabilities.attachmentIngestion ? 'Available' : 'Unavailable'}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: 10 }}>Native Listener</div>
                  <div style={{ marginTop: 2, fontWeight: 600 }}>
                    {c.nativeListeningEnabled ? 'ON' : 'OFF'}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: 10 }}>Processing</div>
                  <div style={{ marginTop: 2, fontWeight: 600 }}>
                    {processingLabel(c.ingestionSource)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: 10 }}>Last Activity</div>
                  <div style={{ marginTop: 2 }}>{formatDateTime(lastActivity)}</div>
                </div>
                {c.lastSyncError && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ color: '#c62828', fontSize: 11 }}>{c.lastSyncError}</div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {settingsOpenFor && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => setSettingsOpenFor(null)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 420, margin: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Listener Settings</h3>
            {settingsBusy && !settings ? (
              <p style={{ fontSize: 12 }}>Loading…</p>
            ) : settings ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>Processing mode</span>
                  <select
                    value={settings.ingestionSource === 'SHADOW' ? 'N8N' : settings.ingestionSource}
                    disabled={!canManage || settingsBusy}
                    onChange={(e) =>
                      void saveSettings({
                        ingestionSource: e.target.value as 'NATIVE' | 'N8N',
                      }).then(() => onRefresh())
                    }
                  >
                    <option value="N8N">N8N (current production)</option>
                    <option value="NATIVE">NATIVE</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={settings.listener.listenIncoming}
                    disabled={!canManage || settingsBusy}
                    onChange={(e) =>
                      void saveSettings({ listenIncoming: e.target.checked }).then(() =>
                        onRefresh()
                      )
                    }
                  />
                  Listen for incoming mail
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={settings.listener.listenSent}
                    disabled={!canManage || settingsBusy}
                    onChange={(e) =>
                      void saveSettings({ listenSent: e.target.checked }).then(() =>
                        onRefresh()
                      )
                    }
                  />
                  Listen for sent / outgoing mail
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={settings.listener.excludeJunk}
                    disabled={!canManage || settingsBusy}
                    onChange={(e) =>
                      void saveSettings({ excludeJunk: e.target.checked }).then(() =>
                        onRefresh()
                      )
                    }
                  />
                  Exclude Junk
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={settings.listener.excludeTrash}
                    disabled={!canManage || settingsBusy}
                    onChange={(e) =>
                      void saveSettings({ excludeTrash: e.target.checked }).then(() =>
                        onRefresh()
                      )
                    }
                  />
                  Exclude Deleted / Trash
                </label>
                <p style={{ fontSize: 11, color: '#666', margin: 0, lineHeight: 1.4 }}>
                  Authorizing the mailbox does not turn the native listener on. Use Start
                  Listening only after switching processing to NATIVE.
                </p>
              </div>
            ) : null}
            {settingsError && (
              <p style={{ color: '#c62828', fontSize: 12 }}>{settingsError}</p>
            )}
            <div style={{ marginTop: 14, textAlign: 'right' }}>
              <button type="button" className="btn btn-sm" onClick={() => setSettingsOpenFor(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpenFor && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => {
            if (!importBusy) setImportOpenFor(null)
          }}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 420, margin: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Import Previous Emails</h3>
            {!activeImport ? (
              <>
                <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
                  Runs in the background. Does not enable the native listener.
                </p>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                  How many recent emails?
                  <select
                    value={importPreset}
                    onChange={(e) =>
                      setImportPreset(e.target.value as '25' | '50' | '100' | '250')
                    }
                    style={{ display: 'block', marginTop: 6, width: '100%' }}
                  >
                    <option value="25">Last 25</option>
                    <option value="50">Last 50</option>
                    <option value="100">Last 100</option>
                    <option value="250">Last 250</option>
                  </select>
                </label>
                {importError && (
                  <p style={{ color: '#c62828', fontSize: 12 }}>{importError}</p>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setImportOpenFor(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!canManage || importBusy}
                    onClick={() => void startImport()}
                  >
                    {importBusy ? 'Starting…' : 'Start import'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, marginTop: 0 }}>
                  {activeImport.status === 'COMPLETED'
                    ? 'Import complete'
                    : activeImport.status === 'FAILED'
                      ? 'Import failed'
                      : 'Importing previous emails…'}
                </p>
                <p style={{ fontSize: 13 }}>
                  {activeImport.processedCount} / {activeImport.requestedLimit} processed
                </p>
                <p style={{ fontSize: 12, color: '#555' }}>
                  Business: {activeImport.businessCount}
                  <br />
                  Personal: {activeImport.personalCount}
                  <br />
                  Failed: {activeImport.failedCount}
                </p>
                {activeImport.errorMessage && (
                  <p style={{ color: '#c62828', fontSize: 12 }}>{activeImport.errorMessage}</p>
                )}
                <div style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setImportOpenFor(null)
                      onRefresh()
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
