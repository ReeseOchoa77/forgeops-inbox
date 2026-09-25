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
  mailboxUsesReconnectFlow,
  needsSendingAuthorization,
} from '../mailbox-authorization-display'
import {
  importProgressIndeterminate,
  importProgressLabel,
  importProgressPercent,
  isImportInProgress,
} from '../mailbox-import-progress'
import { ReclassifyEmailsModal } from './ReclassifyEmailsModal'
import {
  CLEAR_ALL_EMAILS_PHRASE,
  clearAllEmailsConfirmationMatches,
  type ClearInboxChoice,
} from '../clear-inbox'

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

const CLEAR_EMAIL_OPTIONS: Array<{
  mode: ClearInboxChoice
  title: string
  detail: string
  danger?: boolean
}> = [
  {
    mode: 'NON_JOB_ONLY',
    title: 'Clear Inbox',
    detail:
      'Removes emails that are not assigned to a Job. Emails saved under Jobs are preserved. New mail keeps syncing. Older unassigned mail does not come back unless you import it.',
  },
  {
    mode: 'HISTORICAL_IMPORT_ONLY',
    title: 'Remove Imported and Inbox',
    detail:
      'Removes emails from Import Previous Emails and regular inbox sync, including Job emails from those sources. Emails from project folder analysis stay. Jobs are not deleted. New mail keeps syncing.',
  },
  {
    mode: 'ALL_EMAILS',
    title: 'Clear All Emails',
    detail:
      'Removes all ForgeOps emails, including emails assigned to Jobs. Jobs themselves are not deleted.',
    danger: true,
  },
]

function countLine(
  mode: ClearInboxChoice,
  preview: {
    unassignedCount: number
    jobAssociatedCount: number
    nonProjectFolderCount: number
    projectFolderCount: number
  } | null,
): string | null {
  if (!preview) return null
  if (mode === 'NON_JOB_ONLY') {
    return `${preview.unassignedCount.toLocaleString()} emails will be removed. ${preview.jobAssociatedCount.toLocaleString()} Job emails will be preserved.`
  }
  if (mode === 'HISTORICAL_IMPORT_ONLY') {
    return `${preview.nonProjectFolderCount.toLocaleString()} emails will be removed. ${preview.projectFolderCount.toLocaleString()} project-folder emails will stay.`
  }
  const total = preview.unassignedCount + preview.jobAssociatedCount
  return `${total.toLocaleString()} emails will be removed, including ${preview.jobAssociatedCount.toLocaleString()} assigned to Jobs.`
}

function ClearEmailsDialog({
  workspaceId,
  connectionId,
  email,
  busy,
  onClose,
  onConfirm,
}: {
  workspaceId: string
  connectionId: string
  email: string
  busy: boolean
  onClose: () => void
  onConfirm: (mode: ClearInboxChoice) => void
}) {
  const [choice, setChoice] = useState<ClearInboxChoice>('NON_JOB_ONLY')
  const [phrase, setPhrase] = useState('')
  const [preview, setPreview] = useState<{
    unassignedCount: number
    jobAssociatedCount: number
    nonProjectFolderCount: number
    projectFolderCount: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.previewClearInbox(workspaceId, connectionId).then(
      (counts) => {
        if (!cancelled) setPreview(counts)
      },
      () => {
        if (!cancelled) setPreview(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [workspaceId, connectionId])

  const phraseOk = choice !== 'ALL_EMAILS' || clearAllEmailsConfirmationMatches(phrase)
  const selected = CLEAR_EMAIL_OPTIONS.find((option) => option.mode === choice)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Clear emails for ${email}`}
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
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 20,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Clear emails</div>
        <div style={{ fontSize: 12, color: '#555', marginTop: 4, marginBottom: 14 }}>{email}</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {CLEAR_EMAIL_OPTIONS.map((option) => {
            const active = choice === option.mode
            return (
              <label
                key={option.mode}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '16px 1fr',
                  gap: 10,
                  alignItems: 'start',
                  padding: 10,
                  borderRadius: 6,
                  border: active
                    ? option.danger
                      ? '1px solid #9b1c1c'
                      : '1px solid #1a1a2e'
                    : '1px solid #e5e5e5',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="clear-email-choice"
                  checked={active}
                  disabled={busy}
                  onChange={() => {
                    setChoice(option.mode)
                    setPhrase('')
                  }}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      color: option.danger ? '#9b1c1c' : '#1a1a2e',
                    }}
                  >
                    {option.title}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: '#555', marginTop: 4, lineHeight: 1.45 }}>
                    {option.detail}
                  </span>
                  {active && countLine(option.mode, preview) && (
                    <span style={{ display: 'block', fontSize: 12, color: '#1a1a2e', marginTop: 6, fontWeight: 600 }}>
                      {countLine(option.mode, preview)}
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
        {choice === 'ALL_EMAILS' && (
          <label style={{ display: 'block', marginTop: 14, fontSize: 12, color: '#7f1d1d' }}>
            Type "{CLEAR_ALL_EMAILS_PHRASE}" to continue.
            <input
              value={phrase}
              disabled={busy}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              style={{ display: 'block', marginTop: 6, width: '100%', padding: '6px 8px' }}
            />
          </label>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !phraseOk}
            onClick={() => onConfirm(choice)}
            style={{
              background: selected?.danger ? '#9b1c1c' : '#1a1a2e',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: busy || !phraseOk ? 'default' : 'pointer',
              opacity: busy || !phraseOk ? 0.6 : 1,
            }}
          >
            {busy ? 'Clearing...' : selected?.title ?? 'Clear emails'}
          </button>
        </div>
      </div>
    </div>
  )
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
  onClearEmails: (id: string, mode: ClearInboxChoice) => void
  isOwner: boolean
  canManage: boolean
  onAddMailbox?: () => void
  onRemove?: (c: ConnectionSummary) => void
  removingId?: string
}

export function MonitoredMailboxesPanel({
  workspaceId,
  connections,
  onRefresh,
  onAuthorize,
  onReconnect,
  authAction,
  clearing,
  onClearEmails,
  isOwner,
  canManage,
  onAddMailbox,
  onRemove,
  removingId,
}: Props) {
  const [settingsOpenFor, setSettingsOpenFor] = useState<string | null>(null)
  const [settings, setSettings] = useState<MailboxListenerSettings | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [importOpenFor, setImportOpenFor] = useState<string | null>(null)
  const [importMode, setImportMode] = useState<'count' | 'since'>('count')
  const [importLimit, setImportLimit] = useState(50)
  const [importSinceDate, setImportSinceDate] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  /** Active/recent import progress keyed by inbox connection id (shown on the card). */
  const [importsByConnection, setImportsByConnection] = useState<
    Record<string, MailboxHistoricalImportStatus>
  >({})
  const [importError, setImportError] = useState<string | null>(null)
  const [reclassifyFor, setReclassifyFor] = useState<ConnectionSummary | null>(null)
  const [clearFor, setClearFor] = useState<{ id: string; email: string } | null>(null)

  // Resume any in-flight imports when the panel loads / mailbox set changes.
  // Depend on connection ids (not the connections array identity) so settings
  // patches that refresh the list do not re-list imports for every mailbox.
  const connectionIdsKey = connections
    .filter((c) => c.status !== 'DISCONNECTED')
    .map((c) => c.id)
    .sort()
    .join('|')

  useEffect(() => {
    let cancelled = false
    const connectionIds = connectionIdsKey
      ? connectionIdsKey.split('|')
      : []
    if (connectionIds.length === 0) return

    void Promise.all(
      connectionIds.map(async (connectionId) => {
        try {
          const res = await api.listHistoricalImports(workspaceId, connectionId)
          const active =
            res.imports.find((row) => isImportInProgress(row.status)) ??
            res.imports.find(
              (row) =>
                (row.status === 'COMPLETED' || row.status === 'FAILED') &&
                Date.now() - new Date(row.updatedAt).getTime() < 60_000
            )
          return active ? ([connectionId, active] as const) : null
        } catch {
          return null
        }
      })
    ).then((rows) => {
      if (cancelled) return
      setImportsByConnection((prev) => {
        const next = { ...prev }
        for (const row of rows) {
          if (!row) continue
          const [connectionId, imp] = row
          next[connectionId] = imp
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [workspaceId, connectionIdsKey])

  const activeImportKey = Object.entries(importsByConnection)
    .filter(([, imp]) => isImportInProgress(imp.status))
    .map(([connectionId, imp]) => `${connectionId}:${imp.id}`)
    .sort()
    .join('|')

  // Poll in-progress imports so the card progress bar stays live (modal optional).
  useEffect(() => {
    if (!activeImportKey) return
    const activeEntries = activeImportKey.split('|').map((pair) => {
      const [connectionId, importId] = pair.split(':')
      return { connectionId, importId }
    })

    const timer = setInterval(() => {
      for (const { connectionId, importId } of activeEntries) {
        if (!connectionId || !importId) continue
        void api
          .getHistoricalImport(workspaceId, connectionId, importId)
          .then((r) => {
            setImportsByConnection((prev) => ({
              ...prev,
              [connectionId]: r.import,
            }))
          })
          .catch(() => {})
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [activeImportKey, workspaceId])

  // Auto-clear finished banners after a short success/failure window.
  const finishedImportKey = Object.entries(importsByConnection)
    .filter(([, imp]) => imp.status === 'COMPLETED' || imp.status === 'FAILED')
    .map(([connectionId, imp]) => `${connectionId}:${imp.id}:${imp.status}`)
    .sort()
    .join('|')

  useEffect(() => {
    if (!finishedImportKey) return
    const finished = finishedImportKey.split('|').map((pair) => {
      const [connectionId, importId] = pair.split(':')
      return { connectionId, importId }
    })
    const timer = setTimeout(() => {
      setImportsByConnection((prev) => {
        const next = { ...prev }
        for (const { connectionId, importId } of finished) {
          if (!connectionId || !importId) continue
          const row = next[connectionId]
          if (row?.id === importId && !isImportInProgress(row.status)) {
            delete next[connectionId]
          }
        }
        return next
      })
    }, 12_000)
    return () => clearTimeout(timer)
  }, [finishedImportKey])

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
    const connectionId = importOpenFor
    setImportBusy(true)
    setImportError(null)
    try {
      const body =
        importMode === 'since'
          ? { sinceDate: importSinceDate }
          : { limit: Math.min(250, Math.max(1, Math.floor(importLimit))) }
      if (importMode === 'since' && !importSinceDate.trim()) {
        setImportError('Choose a start date')
        return
      }
      const res = await api.startHistoricalImport(workspaceId, connectionId, body)
      setImportsByConnection((prev) => ({
        ...prev,
        [connectionId]: res.import,
      }))
      // Close modal so progress is visible on the mailbox card.
      setImportOpenFor(null)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Failed to start import')
    } finally {
      setImportBusy(false)
    }
  }

  if (connections.length === 0) {
    return (
      <div>
        <p style={{ color: '#aaa', fontSize: 12, margin: '0 0 10px' }}>
          No inboxes connected yet.
          {canManage
            ? ' Add a monitored mailbox from a team member to begin authorization.'
            : ' Ask a workspace admin to add monitored mailboxes.'}
        </p>
        {canManage && onAddMailbox && (
          <button type="button" className="btn btn-sm btn-primary" onClick={onAddMailbox}>
            Add Monitored Mailbox
          </button>
        )}
      </div>
    )
  }

  const visibleConnections = connections

  if (visibleConnections.length === 0) {
    return (
      <div>
        <p style={{ color: '#aaa', fontSize: 12, margin: '0 0 10px' }}>
          No monitored mailboxes yet.
          {canManage ? ' Add a mailbox to start monitoring email.' : ''}
        </p>
        {canManage && onAddMailbox && (
          <button type="button" className="btn btn-sm btn-primary" onClick={onAddMailbox}>
            Add Monitored Mailbox
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visibleConnections.map((c) => {
          const authTone = mailboxAuthorizationTone({
            authorizationStatus: c.authorizationStatus,
            emailSending: c.capabilities.emailSending,
          })
          const actionLoading =
            authAction.type === 'loading' && authAction.connectionId === c.id
          const lastActivity =
            c.lastProcessedAt || c.lastReceivedAt || c.lastSyncedAt || null
          const mailboxImport = importsByConnection[c.id]
          const isDisconnected = c.status === 'DISCONNECTED'
          const useReconnect = mailboxUsesReconnectFlow({
            status: c.status,
            authorizationStatus: c.authorizationStatus,
          })

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
                    {isDisconnected ? ' · Disconnected' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {canManage && !isDisconnected && (
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
                          setImportError(null)
                        }}
                      >
                        Import Previous Emails
                      </button>
                      {c.ingestionSource === 'NATIVE' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ fontSize: 10, padding: '2px 8px' }}
                          title="Filter and reclassify already-ingested emails via the canonical classifier"
                          onClick={() => setReclassifyFor(c)}
                        >
                          Reclassify Emails
                        </button>
                      )}
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
                  {!isDisconnected &&
                    needsSendingAuthorization({
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
                  {(useReconnect ||
                    (!isDisconnected && c.authorizationStatus === 'CONNECTED')) && (
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
                  {canManage && onRemove && !isDisconnected && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      disabled={removingId === c.id || actionLoading}
                      onClick={() => onRemove(c)}
                    >
                      {removingId === c.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>

              {isOwner && !isDisconnected && c.counts.messages > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid #eee',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>Clear Emails</div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2, lineHeight: 1.4 }}>
                      Choose what to remove for this mailbox.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={clearing === c.id}
                    onClick={() => setClearFor({ id: c.id, email: c.email })}
                  >
                    {clearing === c.id ? 'Clearing...' : 'Clear Emails'}
                  </button>
                </div>
              )}

              {mailboxImport && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 6,
                      fontSize: 11,
                      color: '#555',
                    }}
                  >
                    <span>{importProgressLabel(mailboxImport)}</span>
                    {!importProgressIndeterminate(mailboxImport) && (
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#888' }}>
                        {importProgressPercent(mailboxImport)}%
                      </span>
                    )}
                  </div>
                  <div
                    className="mailbox-import-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={
                      importProgressIndeterminate(mailboxImport)
                        ? undefined
                        : importProgressPercent(mailboxImport)
                    }
                    aria-label={importProgressLabel(mailboxImport)}
                  >
                    <div
                      className={[
                        'mailbox-import-progress-fill',
                        importProgressIndeterminate(mailboxImport) ? 'indeterminate' : '',
                        mailboxImport.status === 'COMPLETED' ? 'complete' : '',
                        mailboxImport.status === 'FAILED' ? 'failed' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        width: `${importProgressPercent(mailboxImport)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

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
            <>
              <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
                Runs in the background. Progress appears on the mailbox card. Does not enable
                the native listener.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${importMode === 'count' ? 'btn-primary' : ''}`}
                  onClick={() => setImportMode('count')}
                >
                  By count
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${importMode === 'since' ? 'btn-primary' : ''}`}
                  onClick={() => setImportMode('since')}
                >
                  Since date
                </button>
              </div>
              {importMode === 'count' ? (
                <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                  Import up to 250 of the most recent emails
                  <input
                    type="number"
                    min={1}
                    max={250}
                    value={importLimit}
                    onChange={(e) => setImportLimit(Number(e.target.value) || 1)}
                    style={{ display: 'block', marginTop: 6, width: '100%', padding: '6px 8px' }}
                  />
                  <span style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {[25, 50, 100, 250].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="btn btn-sm"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => setImportLimit(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </span>
                </label>
              ) : (
                <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                  Import emails since
                  <input
                    type="date"
                    value={importSinceDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setImportSinceDate(e.target.value)}
                    style={{ display: 'block', marginTop: 6, width: '100%', padding: '6px 8px' }}
                  />
                  <span style={{ fontSize: 11, color: '#888', display: 'block', marginTop: 6 }}>
                    Imports all available inbox emails on or after this date. Large imports run
                    in batches in the background and may take several minutes.
                  </span>
                </label>
              )}
              {importOpenFor &&
                importsByConnection[importOpenFor] &&
                isImportInProgress(importsByConnection[importOpenFor].status) && (
                  <p style={{ fontSize: 12, color: '#666' }}>
                    An import is already running for this mailbox — check the progress bar on
                    the card.
                  </p>
                )}
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
                  disabled={
                    !canManage ||
                    importBusy ||
                    (importMode === 'since' && !importSinceDate) ||
                    (importMode === 'count' && (importLimit < 1 || importLimit > 250)) ||
                    Boolean(
                      importOpenFor &&
                        importsByConnection[importOpenFor] &&
                        isImportInProgress(importsByConnection[importOpenFor].status)
                    )
                  }
                  onClick={() => void startImport()}
                >
                  {importBusy ? 'Starting…' : 'Start import'}
                </button>
              </div>
            </>
          </div>
        </div>
      )}

      {reclassifyFor && (
        <ReclassifyEmailsModal
          workspaceId={workspaceId}
          connection={reclassifyFor}
          onClose={() => setReclassifyFor(null)}
        />
      )}

      {clearFor && (
        <ClearEmailsDialog
          workspaceId={workspaceId}
          connectionId={clearFor.id}
          email={clearFor.email}
          busy={clearing === clearFor.id}
          onClose={() => {
            if (clearing === clearFor.id) return
            setClearFor(null)
          }}
          onConfirm={(mode) => {
            const id = clearFor.id
            setClearFor(null)
            onClearEmails(id, mode)
          }}
        />
      )}
    </>
  )
}
