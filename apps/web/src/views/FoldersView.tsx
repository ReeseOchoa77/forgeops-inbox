import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  ApiRequestError,
  type ConnectionSummary,
  type DiscoveredFolderItem,
  type JobLookup,
  type ProjectFolderScanSummary,
} from '../api'
import { JobAssignPicker, formatJobPrimaryLabel, formatJobSecondaryLabel } from '../components/JobAssignPicker'

type MatchUi = 'UNMATCHED' | 'SUGGESTED' | 'VERIFIED' | 'IGNORED' | 'ARCHIVED'

function toMatchUi(status: DiscoveredFolderItem['status']): MatchUi {
  switch (status) {
    case 'DISCOVERED':
      return 'UNMATCHED'
    case 'MATCHED':
      return 'SUGGESTED'
    case 'APPROVED':
      return 'VERIFIED'
    case 'IGNORED':
      return 'IGNORED'
    case 'ARCHIVED':
      return 'ARCHIVED'
  }
}

function matchBadgeStyle(status: MatchUi): { bg: string; color: string } {
  switch (status) {
    case 'VERIFIED':
      return { bg: '#e6f4ea', color: '#2e7d32' }
    case 'SUGGESTED':
      return { bg: '#fff8e1', color: '#f57f17' }
    case 'UNMATCHED':
      return { bg: '#f5f5f5', color: '#666' }
    case 'IGNORED':
      return { bg: '#eeeeee', color: '#757575' }
    case 'ARCHIVED':
      return { bg: '#eceff1', color: '#546e7a' }
  }
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function isOutlookConnection(c: ConnectionSummary): boolean {
  return c.provider.toLowerCase() === 'outlook' && c.status !== 'DISCONNECTED'
}

function isProjectFolderEligible(c: ConnectionSummary): boolean {
  return (
    isOutlookConnection(c) &&
    c.authorizationStatus === 'CONNECTED' &&
    c.capabilities.directProviderAccess
  )
}

function friendlyLoadError(raw: string, cause?: unknown): string {
  const msg = raw.trim()
  const causeObj =
    cause && typeof cause === 'object'
      ? (cause as {
          prismaCode?: string | null
          message?: string
          stage?: string
          name?: string
        })
      : null
  const parts: string[] = []
  if (causeObj?.stage) parts.push(`stage=${causeObj.stage}`)
  if (causeObj?.prismaCode) parts.push(`[${causeObj.prismaCode}]`)
  if (causeObj?.message) parts.push(causeObj.message.slice(0, 240))
  else if (causeObj?.name) parts.push(causeObj.name)
  const causeSuffix = parts.length ? ` — ${parts.join(' ')}` : ''

  // Prefer the server's full message (now includes Unexpected detail / stage).
  if (msg) return msg + (causeSuffix && !msg.includes('stage=') && !msg.includes('[P') ? causeSuffix : '')
  return 'Could not load discovered folders' + causeSuffix
}

/** Human-readable matchReason from matchFolderToExistingJobs / manual actions. */
function formatMatchReason(reason: string | null | undefined): string {
  if (!reason) return '—'
  switch (reason) {
    case 'exact_job_number':
      return 'Exact job number'
    case 'exact_job_name':
      return 'Normalized job name'
    case 'alias':
      return 'Job alias'
    case 'ambiguous_job_number':
      return 'Ambiguous job number'
    case 'ambiguous_job_name':
      return 'Ambiguous job name'
    case 'ambiguous_alias':
      return 'Ambiguous alias'
    case 'manual':
    case 'user_match':
      return 'Manual selection'
    default:
      return reason.replace(/_/g, ' ')
  }
}

interface Props {
  workspaceId: string
  /** Global inbox selection — used as initial mailbox hint only. */
  connectionId: string
  userRole?: string
}

/**
 * Workspace → Email Analysis: native /Projects folder discovery + Job matching.
 * Scan is explicit — never runs on Workspace mount.
 */
export function FoldersView({ workspaceId, connectionId, userRole = 'MEMBER' }: Props) {
  const canEdit = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'].includes(userRole)
  const canAdmin = userRole === 'OWNER' || userRole === 'ADMIN'

  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [folders, setFolders] = useState<DiscoveredFolderItem[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [connectionsLoaded, setConnectionsLoaded] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanSummary, setScanSummary] = useState<ProjectFolderScanSummary | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | MatchUi>('all')
  const [matchFolderId, setMatchFolderId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState('')
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeRunId, setAnalyzeRunId] = useState<string | null>(null)
  const [analyzeProgress, setAnalyzeProgress] = useState<{
    status: string
    currentFolderName: string | null
    processed: number
    created: number
    existing: number
    assigned: number
    classifyQueued: number
    conflicts: number
    failed: number
    foldersDone: number
    foldersTotal: number
    errorMessage: string | null
  } | null>(null)
  const loadSeqRef = useRef(0)

  const outlookConnections = useMemo(
    () => connections.filter(isOutlookConnection),
    [connections]
  )

  const selectedConn = outlookConnections.find((c) => c.id === selectedConnectionId) ?? null
  const mailboxReady = Boolean(selectedConn && isProjectFolderEligible(selectedConn))
  const mailboxNeedsAuth = Boolean(
    selectedConn &&
      (selectedConn.authorizationStatus === 'REQUIRED' ||
        selectedConn.authorizationStatus === 'REAUTHORIZATION_REQUIRED' ||
        !selectedConn.capabilities.directProviderAccess)
  )

  const loadFolders = useCallback(
    async (connectionIdForScope: string) => {
      const seq = ++loadSeqRef.current
      setLoadingList(true)
      setError('')
      try {
        const res = await api.getDiscoveredFolders(workspaceId, {
          connectionId: connectionIdForScope,
          pageSize: 200,
        })
        // Ignore stale responses from overlapping loads (Strict Mode / connection churn).
        if (seq !== loadSeqRef.current) return
        setFolders(res.folders)
        setError('')
      } catch (e) {
        if (seq !== loadSeqRef.current) return
        console.error('[Email Analysis] discovered-folders failed', {
          workspaceId,
          connectionId: connectionIdForScope,
          message: e instanceof Error ? e.message : e,
          status: e instanceof ApiRequestError ? e.status : undefined,
          code: e instanceof ApiRequestError ? e.code : undefined,
          stage: e instanceof ApiRequestError ? e.stage : undefined,
          cause: e instanceof ApiRequestError ? e.causePayload : undefined,
        })
        setFolders([])
        const causeForUi =
          e instanceof ApiRequestError
            ? {
                ...(typeof e.causePayload === 'object' && e.causePayload
                  ? (e.causePayload as object)
                  : {}),
                ...(e.stage ? { stage: e.stage } : {}),
                ...(e.errorName ? { name: e.errorName } : {}),
              }
            : undefined
        setError(
          friendlyLoadError(
            e instanceof Error ? e.message : 'Could not load discovered folders',
            causeForUi
          )
        )
      } finally {
        if (seq === loadSeqRef.current) setLoadingList(false)
      }
    },
    [workspaceId]
  )

  // Load connections when Email Analysis tab is shown — not a folder scan.
  useEffect(() => {
    let cancelled = false
    setConnectionsLoaded(false)
    api
      .getConnections(workspaceId)
      .then((r) => {
        if (cancelled) return
        setConnections(r.connections)
        const outlook = r.connections.filter(isOutlookConnection)
        const preferred =
          outlook.find((c) => c.id === connectionId)?.id ??
          (outlook.length === 1 ? outlook[0]?.id : undefined) ??
          outlook.find((c) => c.status === 'ACTIVE' && isProjectFolderEligible(c))?.id ??
          ''
        setSelectedConnectionId(preferred || '')
        setConnectionsLoaded(true)
      })
      .catch((e) => {
        if (cancelled) return
        setConnections([])
        setSelectedConnectionId('')
        setConnectionsLoaded(true)
        setError(
          friendlyLoadError(e instanceof Error ? e.message : 'Could not load mailboxes')
        )
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, connectionId])

  // Load persisted folders only for a selected Outlook mailbox (no Graph scan).
  useEffect(() => {
    setSelectedFolderIds(new Set())
    setScanSummary(null)
    if (!selectedConnectionId) {
      setFolders([])
      return
    }
    if (!outlookConnections.some((c) => c.id === selectedConnectionId)) {
      setFolders([])
      return
    }
    void loadFolders(selectedConnectionId)
  }, [selectedConnectionId, outlookConnections, loadFolders])

  const handleScan = async () => {
    if (!selectedConnectionId || !selectedConn) {
      setError('No Outlook mailbox selected')
      return
    }
    if (!isProjectFolderEligible(selectedConn)) {
      setError('Outlook authorization required')
      return
    }
    setScanning(true)
    setError('')
    setScanSummary(null)
    try {
      const summary = await api.scanProjectFolders(workspaceId, selectedConnectionId)
      setScanSummary(summary)
      await loadFolders(selectedConnectionId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed'
      if (/not authorized|reconnect/i.test(msg)) setError('Outlook authorization required')
      else if (/Projects folder not found/i.test(msg)) setError('Projects folder not found')
      else if (/Multiple top-level Projects/i.test(msg))
        setError('Multiple top-level Projects folders found')
      else if (/migration has not been applied/i.test(msg))
        setError('Required database migration has not been applied')
      else setError(msg)
    } finally {
      setScanning(false)
    }
  }

  const pollAnalyzeRun = async (runId: string) => {
    for (;;) {
      const res = await api.getProjectFolderEmailAnalyzeRun(workspaceId, runId)
      const p = res.run.progress
      setAnalyzeProgress({
        status: res.run.status,
        currentFolderName: p.currentFolderName,
        processed: p.processed,
        created: p.created,
        existing: p.existing,
        assigned: p.assigned,
        classifyQueued: p.classifyQueued,
        conflicts: p.conflicts,
        failed: p.failed,
        foldersDone: p.foldersDone,
        foldersTotal: p.foldersTotal,
        errorMessage: res.run.errorMessage,
      })
      if (res.run.status === 'COMPLETED' || res.run.status === 'FAILED') {
        setAnalyzing(false)
        if (res.run.status === 'FAILED' && res.run.errorMessage) {
          setError(res.run.errorMessage)
        }
        return
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  const startAnalyzeForFolderIds = async (folderIds: string[]) => {
    if (!selectedConnectionId || !selectedConn) {
      setError('No Outlook mailbox selected')
      return
    }
    if (!isProjectFolderEligible(selectedConn)) {
      setError('Outlook authorization required')
      return
    }
    if (folderIds.length === 0) {
      setError('Select one or more VERIFIED folders to analyze')
      return
    }
    setAnalyzing(true)
    setError('')
    setAnalyzeProgress(null)
    try {
      const { runId } = await api.analyzeProjectFolderEmails(
        workspaceId,
        selectedConnectionId,
        folderIds
      )
      setAnalyzeRunId(runId)
      await pollAnalyzeRun(runId)
    } catch (e) {
      setAnalyzing(false)
      const msg = e instanceof Error ? e.message : 'Analyze emails failed'
      if (/not authorized|reconnect/i.test(msg)) setError('Outlook authorization required')
      else setError(msg)
    }
  }

  const handleAnalyzeEmails = async (mode: 'selected' | 'all') => {
    const verifiedIds = eligibleVerified.map((f) => f.id)
    const folderIds =
      mode === 'all'
        ? verifiedIds
        : verifiedIds.filter((id) => selectedFolderIds.has(id))
    if (folderIds.length === 0) {
      setError(
        mode === 'selected'
          ? 'Select one or more eligible VERIFIED folders to analyze'
          : 'No eligible VERIFIED folders for this mailbox'
      )
      return
    }
    await startAnalyzeForFolderIds(folderIds)
  }

  const toggleFolderSelected = (folderId: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const handleConfirm = async (folderId: string) => {
    setBusyId(folderId)
    try {
      await api.approveDiscoveredFolder(workspaceId, folderId)
      if (selectedConnectionId) await loadFolders(selectedConnectionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId('')
    }
  }

  const handleUnmatch = async (folderId: string) => {
    if (!confirm('Unmatch this folder from its Job? The Job itself is not deleted.')) return
    setBusyId(folderId)
    try {
      await api.unmatchDiscoveredFolder(workspaceId, folderId)
      if (selectedConnectionId) await loadFolders(selectedConnectionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unmatch failed')
    } finally {
      setBusyId('')
    }
  }

  const handleManualMatch = async (folderId: string, job: JobLookup) => {
    setBusyId(folderId)
    try {
      await api.matchDiscoveredFolder(workspaceId, folderId, job.id)
      setMatchFolderId(null)
      if (selectedConnectionId) await loadFolders(selectedConnectionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match failed')
    } finally {
      setBusyId('')
    }
  }

  const withUi = folders.map((f) => ({ ...f, matchUi: toMatchUi(f.status) }))
  const filtered =
    filter === 'all' ? withUi : withUi.filter((f) => f.matchUi === filter)

  const mailboxEmailLower = selectedConn?.email.toLowerCase() ?? ''
  const isMailboxSafeFolder = (f: DiscoveredFolderItem) => {
    if (f.missingFromProvider) return false
    if (!f.matchedJobId || !f.providerFolderId) return false
    if (f.inboxConnectionId && selectedConnectionId && f.inboxConnectionId === selectedConnectionId)
      return true
    // Deterministic legacy: same mailbox email, unscoped connection id
    if (
      f.inboxConnectionId == null &&
      mailboxEmailLower &&
      f.mailboxEmail.toLowerCase() === mailboxEmailLower
    ) {
      return true
    }
    return false
  }

  const counts = {
    verified: withUi.filter((f) => f.matchUi === 'VERIFIED').length,
    suggested: withUi.filter((f) => f.matchUi === 'SUGGESTED').length,
    unmatched: withUi.filter((f) => f.matchUi === 'UNMATCHED').length,
  }

  const eligibleVerified = withUi.filter(
    (f) => f.matchUi === 'VERIFIED' && isMailboxSafeFolder(f)
  )
  const verifiedSelectedCount = eligibleVerified.filter((f) =>
    selectedFolderIds.has(f.id)
  ).length

  const scanDisabled =
    scanning || analyzing || !selectedConnectionId || !mailboxReady
  const analyzeSelectedDisabled =
    analyzing || scanning || !selectedConnectionId || !mailboxReady || verifiedSelectedCount === 0
  const analyzeAllDisabled =
    analyzing ||
    scanning ||
    !selectedConnectionId ||
    !mailboxReady ||
    eligibleVerified.length === 0

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Email Analysis</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 8px' }}>
        Two separate operations: <strong>Scan Project Folders</strong> discovers Outlook{' '}
        <code>/Projects</code> directory mappings only (no email import).{' '}
        <strong>Analyze Emails</strong> later imports messages from VERIFIED folder↔Job mappings.
        Folders are never Jobs — existing ForgeOps Jobs stay the source of truth.
      </p>
      <ol
        style={{
          margin: '0 0 12px',
          paddingLeft: 18,
          fontSize: 12,
          color: '#666',
          lineHeight: 1.5,
        }}
      >
        <li>
          <strong>Scan Project Folders</strong> — enumerate /Projects folder names &amp; IDs, match to
          existing Jobs
        </li>
        <li>
          <strong>Review &amp; verify</strong> — accept suggestions or Match Job manually
        </li>
        <li>
          <strong>Analyze Emails</strong> — import/reuse messages from verified folders only
        </li>
      </ol>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 10,
            background: '#fce4ec',
            border: '1px solid #e8a09a',
            borderRadius: 4,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            ×
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12, padding: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#555', minWidth: 220, flex: 1 }}>
            Connected mailbox
            <select
              value={selectedConnectionId}
              onChange={(e) => {
                setSelectedConnectionId(e.target.value)
                setScanSummary(null)
                setError('')
              }}
              style={{ padding: '6px 8px', fontSize: 13, borderRadius: 6, border: '1px solid #ddd' }}
            >
              <option value="">Select Outlook mailbox…</option>
              {outlookConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email} ({c.status}
                  {c.authorizationStatus !== 'CONNECTED' ? ` · ${c.authorizationStatus}` : ''})
                </option>
              ))}
            </select>
          </label>
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={scanDisabled}
              title={
                !selectedConnectionId
                  ? 'Select an Outlook mailbox first'
                  : mailboxNeedsAuth
                    ? 'Authorize Outlook / Reconnect required'
                    : 'Directory discovery only — does not import emails'
              }
              onClick={() => void handleScan()}
            >
              {scanning ? 'Scanning Projects…' : 'Scan Project Folders'}
            </button>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                className="btn btn-outline"
                disabled={analyzeSelectedDisabled}
                title={
                  !selectedConnectionId
                    ? 'Select an Outlook mailbox first'
                    : verifiedSelectedCount === 0
                      ? 'Select one or more VERIFIED folders'
                      : undefined
                }
                onClick={() => void handleAnalyzeEmails('selected')}
              >
                Analyze Emails (selected)
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={analyzeAllDisabled}
                title={
                  !selectedConnectionId
                    ? 'Select an Outlook mailbox first'
                    : eligibleVerified.length === 0
                      ? 'No eligible VERIFIED folders for this mailbox'
                      : undefined
                }
                onClick={() => void handleAnalyzeEmails('all')}
              >
                Analyze Emails (all verified)
              </button>
            </>
          )}
        </div>

        {mailboxNeedsAuth && selectedConn && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#b71c1c' }}>
            Outlook authorization required for {selectedConn.email}. Use Monitored Mailboxes →
            Authorize Outlook / Reconnect before scanning or analyzing emails.
          </p>
        )}

        {scanning && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#1565c0' }}>
            Folder scan: resolving /Projects directory and matching folder names to Jobs (no email
            import)…
          </p>
        )}

        {scanSummary && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: '#333',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <span style={{ fontWeight: 600, width: '100%' }}>Folder scan result</span>
            <span>
              Root: <strong>{scanSummary.projectsRoot.path}</strong>
            </span>
            <span>Found {scanSummary.candidates} folders</span>
            <span>Verified {scanSummary.verified}</span>
            <span>Suggested {scanSummary.suggested}</span>
            <span>Unmatched {scanSummary.unmatched}</span>
            {(scanSummary.created > 0 || scanSummary.updated > 0) && (
              <span style={{ color: '#888' }}>
                ({scanSummary.created} new · {scanSummary.updated} updated
                {scanSummary.missingMarked ? ` · ${scanSummary.missingMarked} missing` : ''})
              </span>
            )}
          </div>
        )}

        {(analyzing || analyzeProgress) && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#333' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {analyzing
                ? `Email analysis: ${analyzeProgress?.currentFolderName ?? 'verified folders'}…`
                : `Email analysis ${analyzeProgress?.status === 'COMPLETED' ? 'complete' : analyzeProgress?.status}`}
              {analyzeRunId && (
                <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>
                  run {analyzeRunId.slice(0, 8)}…
                </span>
              )}
            </div>
            {analyzeProgress && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <span>
                  Folders {analyzeProgress.foldersDone}/{analyzeProgress.foldersTotal}
                </span>
                <span>Emails processed: {analyzeProgress.processed}</span>
                <span>Created: {analyzeProgress.created}</span>
                <span>Reused: {analyzeProgress.existing}</span>
                <span>Job assigned: {analyzeProgress.assigned}</span>
                <span>Classify queued: {analyzeProgress.classifyQueued}</span>
                <span>Conflicts: {analyzeProgress.conflicts}</span>
                <span>Failed: {analyzeProgress.failed}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {!selectedConnectionId ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <h3>Select an Outlook mailbox</h3>
          <p>
            Project Folder discovery is mailbox-scoped. Choose a connected Outlook mailbox above
            before viewing discovered folders or running analysis.
            {!connectionsLoaded ? ' Loading mailboxes…' : outlookConnections.length === 0 ? ' No Outlook mailboxes found in this workspace.' : ''}
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {(
              [
                ['all', `All (${withUi.length})`],
                ['VERIFIED', `Verified (${counts.verified})`],
                ['SUGGESTED', `Suggested (${counts.suggested})`],
                ['UNMATCHED', `Unmatched (${counts.unmatched})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 12,
                  border: filter === id ? '1px solid #1a1a2e' : '1px solid #ddd',
                  background: filter === id ? '#1a1a2e' : '#fff',
                  color: filter === id ? '#fff' : '#666',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
            {loadingList && <span style={{ fontSize: 12, color: '#999' }}>Refreshing…</span>}
          </div>

          {filtered.length === 0 && !loadingList ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <h3>No project folders yet</h3>
              <p>
                Click <strong>Scan Project Folders</strong> to discover folder names/IDs under /Projects for{' '}
                {selectedConn?.email}. Matching uses existing Jobs only.
              </p>
            </div>
          ) : filtered.length > 0 ? (
            <div
              style={{
                border: '1px solid #e5e5e5',
                borderRadius: 6,
                background: '#fff',
                overflow: 'auto',
                maxHeight: 560,
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr
                    style={{
                      background: '#fafafa',
                      borderBottom: '1px solid #e5e5e5',
                      textAlign: 'left',
                      position: 'sticky',
                      top: 0,
                    }}
                  >
                    <th style={{ padding: '7px 10px', width: 28 }} />
                    <th style={{ padding: '7px 10px' }}>Folder</th>
                    <th style={{ padding: '7px 10px' }}>Matched Job</th>
                    <th style={{ padding: '7px 10px' }}>Status</th>
                    <th style={{ padding: '7px 10px' }}>Reason</th>
                    <th style={{ padding: '7px 10px' }}>Last Seen</th>
                    <th style={{ padding: '7px 10px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const badge = matchBadgeStyle(f.matchUi)
                    const jobLabel = f.matchedJob
                      ? `${formatJobPrimaryLabel(f.matchedJob, 40)}${
                          f.matchedJob.jobNumber ? ` · #${f.matchedJob.jobNumber}` : ''
                        }`
                      : '—'
                    const legacyUnscoped = f.inboxConnectionId == null
                    return (
                      <tr key={f.id} style={{ borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' }}>
                        <td style={{ padding: '8px 10px' }}>
                      {f.matchUi === 'VERIFIED' && isMailboxSafeFolder(f) && (
                        <input
                          type="checkbox"
                          checked={selectedFolderIds.has(f.id)}
                          onChange={() => toggleFolderSelected(f.id)}
                          aria-label={`Select ${f.rawFolderName}`}
                        />
                      )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontWeight: 600, color: '#1a1a2e' }}>{f.rawFolderName}</div>
                          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{f.folderPath ?? '—'}</div>
                          {legacyUnscoped && (
                            <div style={{ fontSize: 10, color: '#ef6c00', marginTop: 2 }}>
                              Legacy row (no inboxConnectionId) — matched by mailbox email
                            </div>
                          )}
                          {f.matchUi === 'VERIFIED' && canEdit && isMailboxSafeFolder(f) && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              style={{ marginTop: 6 }}
                              disabled={analyzing || !mailboxReady}
                              onClick={() => void startAnalyzeForFolderIds([f.id])}
                            >
                              Analyze Emails
                            </button>
                          )}
                          {f.matchUi === 'VERIFIED' && canEdit && !isMailboxSafeFolder(f) && (
                            <div style={{ fontSize: 10, color: '#c62828', marginTop: 6 }}>
                              Rescan required before analyze
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {f.matchedJob ? (
                            <div>
                              <div style={{ fontWeight: 500 }}>{jobLabel}</div>
                              {formatJobSecondaryLabel(f.matchedJob) && (
                                <div style={{ fontSize: 10, color: '#888' }}>
                                  {formatJobSecondaryLabel(f.matchedJob)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#aaa' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              background: badge.bg,
                              color: badge.color,
                            }}
                          >
                            {f.matchUi}
                          </span>
                          {f.missingFromProvider && (
                            <div style={{ fontSize: 10, color: '#c62828', marginTop: 4 }}>Missing in mailbox</div>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 11, color: '#666' }}>
                          {formatMatchReason(f.matchReason)}
                          {f.matchConfidence != null && (
                            <div style={{ fontSize: 10, color: '#999' }}>
                              {(Number(f.matchConfidence) * 100).toFixed(0)}%
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
                          {formatWhen(f.lastSeenAt)}
                        </td>
                        <td style={{ padding: '8px 10px', position: 'relative' }}>
                          {canAdmin && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                              {f.matchUi === 'SUGGESTED' && f.matchedJobId && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-success"
                                  disabled={busyId === f.id}
                                  onClick={() => void handleConfirm(f.id)}
                                >
                                  Confirm
                                </button>
                              )}
                              {f.matchUi !== 'VERIFIED' && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  disabled={busyId === f.id}
                                  onClick={() => setMatchFolderId(matchFolderId === f.id ? null : f.id)}
                                >
                                  {f.matchedJobId ? 'Change Job' : 'Match Job'}
                                </button>
                              )}
                              {f.matchUi === 'VERIFIED' && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  disabled={busyId === f.id}
                                  onClick={() => setMatchFolderId(matchFolderId === f.id ? null : f.id)}
                                >
                                  Change Job
                                </button>
                              )}
                              {f.matchedJobId && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  disabled={busyId === f.id}
                                  onClick={() => void handleUnmatch(f.id)}
                                >
                                  Unmatch
                                </button>
                              )}
                              {matchFolderId === f.id && (
                                <div style={{ marginTop: 4, width: 280 }}>
                                  <JobAssignPicker
                                    workspaceId={workspaceId}
                                    selectedJobId={f.matchedJobId}
                                    variant="panel"
                                    onSelect={(job) => void handleManualMatch(f.id, job)}
                                    onClose={() => setMatchFolderId(null)}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
