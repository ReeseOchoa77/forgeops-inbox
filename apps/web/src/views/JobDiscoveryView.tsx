import { useEffect, useState, useCallback } from 'react'
import { api, type DiscoveredFolderItem, type FolderSummaryMetrics, type FolderDetailResponse, type JobFolderRootItem, type JobLookup, type CustomerSummary } from '../api'
import { useBreakpoint } from '../hooks/useBreakpoint'

interface Props {
  workspaceId: string
  userRole: string
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DISCOVERED: { bg: '#f3f4f6', color: '#374151' },
  MATCHED: { bg: '#dbeafe', color: '#1d4ed8' },
  APPROVED: { bg: '#dcfce7', color: '#16a34a' },
  IGNORED: { bg: '#fef3c7', color: '#b45309' },
  ARCHIVED: { bg: '#e9ecef', color: '#6b7280' },
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_COLORS[status] ?? { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, background: style.bg, color: style.color,
      textTransform: 'uppercase', letterSpacing: 0.3
    }}>
      {status}
    </span>
  )
}

function relativeTime(d: string | null) {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function MetricCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb',
      borderRadius: 8, textAlign: 'center', minWidth: 90,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#111' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, marginTop: 2 }}>{label}</div>
    </div>
  )
}

export function JobDiscoveryView({ workspaceId, userRole }: Props) {
  const bp = useBreakpoint()
  const isPhone = bp === 'phone'
  const isTablet = bp === 'tablet'
  const isAdmin = userRole === 'OWNER' || userRole === 'ADMIN'

  // Data state
  const [folders, setFolders] = useState<DiscoveredFolderItem[]>([])
  const [summary, setSummary] = useState<FolderSummaryMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [roots, setRoots] = useState<JobFolderRootItem[]>([])
  const [jobs, setJobs] = useState<JobLookup[]>([])
  const [customers, setCustomers] = useState<CustomerSummary[]>([])

  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [mailboxFilter, setMailboxFilter] = useState('')
  const [rootFilter, setRootFilter] = useState('')
  const [search, setSearch] = useState('')
  const [hasMatch, setHasMatch] = useState<boolean | undefined>(undefined)

  // Modals / Drawer
  const [matchModalFolder, setMatchModalFolder] = useState<DiscoveredFolderItem | null>(null)
  const [matchJobSearch, setMatchJobSearch] = useState('')
  const [matchSelectedJobId, setMatchSelectedJobId] = useState('')
  const [createModalFolder, setCreateModalFolder] = useState<DiscoveredFolderItem | null>(null)
  const [createForm, setCreateForm] = useState({ jobNumber: '', name: '', status: 'ACTIVE', customerId: '', description: '', startDate: '', targetCompletionDate: '' })
  const [detailDrawer, setDetailDrawer] = useState<FolderDetailResponse | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)

  // Root management
  const [showRoots, setShowRoots] = useState(false)
  const [newRootName, setNewRootName] = useState('')
  const [addingRoot, setAddingRoot] = useState(false)

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadFolders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getDiscoveredFolders(workspaceId, {
        status: statusFilter || undefined,
        mailboxEmail: mailboxFilter || undefined,
        search: search || undefined,
        hasMatch,
        root: rootFilter || undefined,
        page,
        pageSize: 25,
      })
      setFolders(res.folders)
      setSummary(res.summary)
      setTotalPages(res.pagination.totalPages)
      setTotalCount(res.pagination.totalCount)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [workspaceId, statusFilter, mailboxFilter, search, hasMatch, rootFilter, page])

  const loadRoots = useCallback(async () => {
    try {
      const res = await api.getJobFolderRoots(workspaceId)
      setRoots(res.roots)
    } catch { /* ignore */ }
  }, [workspaceId])

  const loadJobs = useCallback(async () => {
    try {
      const res = await api.getJobsLookup(workspaceId)
      setJobs(res.jobs)
    } catch { /* ignore */ }
  }, [workspaceId])

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api.getCustomers(workspaceId)
      setCustomers(res.customers)
    } catch { /* ignore */ }
  }, [workspaceId])

  useEffect(() => { loadFolders() }, [loadFolders])
  useEffect(() => { loadRoots(); loadJobs(); loadCustomers() }, [loadRoots, loadJobs, loadCustomers])
  useEffect(() => { setPage(1) }, [statusFilter, mailboxFilter, search, hasMatch, rootFilter])

  // Actions
  const handleMatch = async () => {
    if (!matchModalFolder || !matchSelectedJobId) return
    setActionLoading(matchModalFolder.id)
    try {
      await api.matchDiscoveredFolder(workspaceId, matchModalFolder.id, matchSelectedJobId)
      setMatchModalFolder(null)
      setMatchSelectedJobId('')
      setMatchJobSearch('')
      loadFolders()
    } catch { /* ignore */ } finally {
      setActionLoading(null)
    }
  }

  const handleApprove = async (folderId: string) => {
    setActionLoading(folderId)
    try {
      await api.approveDiscoveredFolder(workspaceId, folderId)
      loadFolders()
    } catch { /* ignore */ } finally {
      setActionLoading(null)
    }
  }

  const handleCreateJob = async () => {
    if (!createModalFolder) return
    setActionLoading(createModalFolder.id)
    try {
      await api.createJobFromFolder(workspaceId, createModalFolder.id, {
        jobNumber: createForm.jobNumber || undefined,
        name: createForm.name || undefined,
        status: createForm.status || undefined,
        customerId: createForm.customerId || undefined,
        description: createForm.description || undefined,
        startDate: createForm.startDate || undefined,
        targetCompletionDate: createForm.targetCompletionDate || undefined,
      })
      setCreateModalFolder(null)
      loadFolders()
      loadJobs()
    } catch { /* ignore */ } finally {
      setActionLoading(null)
    }
  }

  const handleIgnore = async (folderId: string) => {
    setActionLoading(folderId)
    try {
      await api.ignoreDiscoveredFolder(workspaceId, folderId)
      loadFolders()
    } catch { /* ignore */ } finally {
      setActionLoading(null)
    }
  }

  const handleRestore = async (folderId: string) => {
    setActionLoading(folderId)
    try {
      await api.restoreDiscoveredFolder(workspaceId, folderId)
      loadFolders()
    } catch { /* ignore */ } finally {
      setActionLoading(null)
    }
  }

  const handleArchive = async (folderId: string) => {
    setActionLoading(folderId)
    try {
      await api.archiveDiscoveredFolder(workspaceId, folderId)
      loadFolders()
    } catch { /* ignore */ } finally {
      setActionLoading(null)
    }
  }

  const openDetailDrawer = async (folderId: string) => {
    setDrawerLoading(true)
    try {
      const res = await api.getDiscoveredFolderDetail(workspaceId, folderId)
      setDetailDrawer(res)
    } catch { /* ignore */ } finally {
      setDrawerLoading(false)
    }
  }

  const openCreateModal = (folder: DiscoveredFolderItem) => {
    setCreateModalFolder(folder)
    setCreateForm({
      jobNumber: folder.detectedJobNumber ?? '',
      name: folder.detectedJobName ?? folder.rawFolderName,
      status: 'ACTIVE',
      customerId: '',
      description: '',
      startDate: '',
      targetCompletionDate: '',
    })
  }

  const handleAddRoot = async () => {
    if (!newRootName.trim()) return
    setAddingRoot(true)
    try {
      await api.addJobFolderRoot(workspaceId, { rootName: newRootName.trim() })
      setNewRootName('')
      loadRoots()
    } catch { /* ignore */ } finally {
      setAddingRoot(false)
    }
  }

  const handleRemoveRoot = async (rootId: string) => {
    try {
      await api.removeJobFolderRoot(workspaceId, rootId)
      loadRoots()
    } catch { /* ignore */ }
  }

  const filteredJobs = matchJobSearch
    ? jobs.filter(j => (j.name + ' ' + (j.jobNumber ?? '')).toLowerCase().includes(matchJobSearch.toLowerCase()))
    : jobs

  const metricsGridCols = isPhone ? 2 : isTablet ? 4 : 6

  const btnStyle = (bg: string, color: string): React.CSSProperties => ({
    padding: '5px 10px', border: 'none', borderRadius: 4, fontSize: 11,
    fontWeight: 600, cursor: 'pointer', background: bg, color, whiteSpace: 'nowrap',
  })

  // Summary metrics
  const needsReview = (summary?.discovered ?? 0) + (summary?.matched ?? 0)

  return (
    <div style={{ padding: isPhone ? 12 : 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: isPhone ? 18 : 22, fontWeight: 700 }}>Job Discovery</h2>
        {isAdmin && (
          <button
            onClick={() => setShowRoots(!showRoots)}
            style={{ padding: '6px 14px', background: '#f3f4f6', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            {showRoots ? 'Hide Roots' : 'Manage Folder Roots'}
          </button>
        )}
      </div>

      {/* Summary Metrics Bar */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metricsGridCols}, 1fr)`, gap: 8, marginBottom: 16 }}>
          <MetricCard label="Total Synced" value={summary.total} />
          <MetricCard label="Discovered" value={summary.discovered} color="#374151" />
          <MetricCard label="Matched" value={summary.matched} color="#1d4ed8" />
          <MetricCard label="Approved" value={summary.approved} color="#16a34a" />
          <MetricCard label="Ignored" value={summary.ignored} color="#b45309" />
          {!isPhone && <MetricCard label="Needs Review" value={needsReview} color="#7c3aed" />}
        </div>
      )}

      {/* Last sync indicator */}
      {summary?.lastSyncAt && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          Last sync: {relativeTime(summary.lastSyncAt)}
          {summary.mailboxes.length > 0 && ` · ${summary.mailboxes.length} mailbox${summary.mailboxes.length > 1 ? 'es' : ''} connected`}
        </div>
      )}

      {/* Folder Roots Section */}
      {showRoots && isAdmin && (
        <div style={{ marginBottom: 20, padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Job Folder Roots</h3>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6b7280' }}>Root folders whose child folders are treated as job candidates.</p>
          {roots.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {roots.map(root => (
                <div key={root.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{root.rootName}{root.mailboxEmail ? ` (${root.mailboxEmail})` : ''}</span>
                  <button onClick={() => handleRemoveRoot(root.id)} style={{ ...btnStyle('#fff', '#dc2626'), border: '1px solid #fca5a5' }}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text" value={newRootName} onChange={e => setNewRootName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddRoot() }}
              placeholder="Root folder name, e.g. Jobs"
              style={{ flex: 1, maxWidth: 280, padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
            />
            <button onClick={handleAddRoot} disabled={addingRoot || !newRootName.trim()} style={{ ...btnStyle('#1a1a2e', '#fff'), padding: '7px 14px', opacity: addingRoot || !newRootName.trim() ? 0.5 : 1 }}>
              + Add
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search folders..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
        />
        {summary && summary.mailboxes.length > 1 && (
          <select value={mailboxFilter} onChange={e => setMailboxFilter(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12, background: '#fff' }}>
            <option value="">All Mailboxes</option>
            {summary.mailboxes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12, background: '#fff' }}>
          <option value="">All Statuses</option>
          <option value="DISCOVERED">Discovered</option>
          <option value="MATCHED">Matched</option>
          <option value="APPROVED">Approved</option>
          <option value="IGNORED">Ignored</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        {roots.length > 0 && (
          <select value={rootFilter} onChange={e => setRootFilter(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 12, background: '#fff' }}>
            <option value="">All Roots</option>
            {roots.map(r => <option key={r.id} value={r.rootName}>{r.rootName}</option>)}
          </select>
        )}
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={hasMatch === true} onChange={e => setHasMatch(e.target.checked ? true : undefined)} /> Has match
        </label>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={hasMatch === false} onChange={e => setHasMatch(e.target.checked ? false : undefined)} /> No match
        </label>
      </div>

      {/* Loading */}
      {loading && <div style={{ textAlign: 'center', padding: 48, color: '#888' }}>Loading folders...</div>}

      {/* Empty state */}
      {!loading && folders.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: '#888' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: '#333' }}>No folders found</h3>
          <p style={{ margin: 0, fontSize: 14 }}>
            {search || statusFilter || mailboxFilter ? 'Try adjusting your filters.' : 'Discovered folders will appear here after syncing mailboxes.'}
          </p>
        </div>
      )}

      {/* Folder list */}
      {!loading && folders.length > 0 && (
        <>
          {isPhone ? (
            /* Phone: stacked cards */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {folders.map(folder => (
                <div key={folder.id} style={{ padding: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <button onClick={() => openDetailDrawer(folder.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#111', textAlign: 'left' }}>
                      {folder.rawFolderName}
                    </button>
                    <StatusBadge status={folder.status} />
                  </div>
                  {folder.detectedJobNumber && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>Job# {folder.detectedJobNumber}</div>}
                  {folder.matchedJob && <div style={{ fontSize: 12, color: '#1d4ed8', marginBottom: 4 }}>→ {folder.matchedJob.jobNumber ? folder.matchedJob.jobNumber + ' — ' : ''}{folder.matchedJob.name}</div>}
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>{relativeTime(folder.lastSeenAt)}</div>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {actionLoading === folder.id ? <span style={{ fontSize: 11, color: '#888' }}>Working...</span> : (
                        <>
                          {folder.status === 'DISCOVERED' && <button onClick={() => setMatchModalFolder(folder)} style={btnStyle('#dbeafe', '#1d4ed8')}>Match</button>}
                          {folder.status === 'DISCOVERED' && <button onClick={() => openCreateModal(folder)} style={btnStyle('#ede9fe', '#7c3aed')}>Create Job</button>}
                          {folder.status === 'MATCHED' && <button onClick={() => handleApprove(folder.id)} style={btnStyle('#dcfce7', '#16a34a')}>Approve</button>}
                          {folder.status === 'MATCHED' && <button onClick={() => setMatchModalFolder(folder)} style={btnStyle('#dbeafe', '#1d4ed8')}>Change</button>}
                          {(folder.status === 'DISCOVERED' || folder.status === 'MATCHED') && <button onClick={() => handleIgnore(folder.id)} style={btnStyle('#fef3c7', '#b45309')}>Ignore</button>}
                          {folder.status === 'IGNORED' && <button onClick={() => handleRestore(folder.id)} style={btnStyle('#f3f4f6', '#374151')}>Restore</button>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Desktop/Tablet: table */
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Folder Name</th>
                    {!isTablet && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Path</th>}
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Mailbox</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Job#</th>
                    {!isTablet && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Detected Name</th>}
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Suggested Job</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Last Seen</th>
                    {isAdmin && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {folders.map(folder => (
                    <tr key={folder.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                        <button onClick={() => openDetailDrawer(folder.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#111', fontWeight: 500, fontSize: 13, textAlign: 'left' }}>
                          {folder.rawFolderName}
                        </button>
                      </td>
                      {!isTablet && <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12, fontFamily: 'monospace' }}>{folder.folderPath ?? '—'}</td>}
                      <td style={{ padding: '10px 12px', color: '#555', fontSize: 12 }}>{folder.mailboxEmail}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>{folder.detectedJobNumber ?? '—'}</td>
                      {!isTablet && <td style={{ padding: '10px 12px', color: '#555' }}>{folder.detectedJobName ?? '—'}</td>}
                      <td style={{ padding: '10px 12px', color: '#555', fontSize: 12 }}>
                        {folder.matchedJob ? `${folder.matchedJob.jobNumber ? folder.matchedJob.jobNumber + ' — ' : ''}${folder.matchedJob.name}` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}><StatusBadge status={folder.status} /></td>
                      <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{relativeTime(folder.lastSeenAt)}</td>
                      {isAdmin && (
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            {actionLoading === folder.id ? <span style={{ fontSize: 11, color: '#888' }}>Working...</span> : (
                              <>
                                {folder.status === 'DISCOVERED' && <button onClick={() => setMatchModalFolder(folder)} style={btnStyle('#dbeafe', '#1d4ed8')}>Match</button>}
                                {folder.status === 'DISCOVERED' && <button onClick={() => openCreateModal(folder)} style={btnStyle('#ede9fe', '#7c3aed')}>Create Job</button>}
                                {folder.status === 'DISCOVERED' && <button onClick={() => handleIgnore(folder.id)} style={btnStyle('#fef3c7', '#b45309')}>Ignore</button>}
                                {folder.status === 'MATCHED' && <button onClick={() => handleApprove(folder.id)} style={btnStyle('#dcfce7', '#16a34a')}>Approve</button>}
                                {folder.status === 'MATCHED' && <button onClick={() => setMatchModalFolder(folder)} style={btnStyle('#dbeafe', '#1d4ed8')}>Change</button>}
                                {folder.status === 'MATCHED' && <button onClick={() => handleIgnore(folder.id)} style={btnStyle('#fef3c7', '#b45309')}>Ignore</button>}
                                {folder.status === 'IGNORED' && <button onClick={() => handleRestore(folder.id)} style={btnStyle('#f3f4f6', '#374151')}>Restore</button>}
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 13, color: '#555' }}>
            <span>{totalCount} folder{totalCount !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '5px 12px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: page > 1 ? 'pointer' : 'not-allowed', opacity: page <= 1 ? 0.5 : 1 }}>Prev</button>
              <span>Page {page}/{totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '5px 12px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: page < totalPages ? 'pointer' : 'not-allowed', opacity: page >= totalPages ? 0.5 : 1 }}>Next</button>
            </div>
          </div>
        </>
      )}

      {/* Match Job Modal */}
      {matchModalFolder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: isPhone ? '100%' : 520, maxHeight: '80vh', background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Match to Existing Job</h3>
              <button onClick={() => { setMatchModalFolder(null); setMatchSelectedJobId(''); setMatchJobSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#999' }}>&times;</button>
            </div>
            <div style={{ padding: 18, overflow: 'auto', flex: 1 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>Folder: <strong>{matchModalFolder.rawFolderName}</strong></div>
                {matchModalFolder.detectedJobNumber && <div style={{ fontSize: 12, color: '#6b7280' }}>Detected: #{matchModalFolder.detectedJobNumber} — {matchModalFolder.detectedJobName}</div>}
              </div>
              <input
                type="text" placeholder="Search jobs by number or name..." value={matchJobSearch} onChange={e => setMatchJobSearch(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
              />
              {matchModalFolder.matchedJob && (
                <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>
                  <strong>Current match:</strong> {matchModalFolder.matchedJob.jobNumber ? matchModalFolder.matchedJob.jobNumber + ' — ' : ''}{matchModalFolder.matchedJob.name}
                </div>
              )}
              <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                {filteredJobs.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#888', fontSize: 13 }}>No jobs found</div>}
                {filteredJobs.map(job => (
                  <div
                    key={job.id}
                    onClick={() => setMatchSelectedJobId(job.id)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
                      background: matchSelectedJobId === job.id ? '#eff6ff' : '#fff',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{job.jobNumber ? `${job.jobNumber} — ` : ''}{job.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{job.status}</div>
                    </div>
                    {matchSelectedJobId === job.id && <span style={{ color: '#2563eb', fontWeight: 700 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e5e5', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setMatchModalFolder(null); setMatchSelectedJobId(''); setMatchJobSearch('') }} style={{ padding: '8px 16px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleMatch} disabled={!matchSelectedJobId || !!actionLoading} style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: matchSelectedJobId ? 1 : 0.5 }}>Confirm Match</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Job Modal */}
      {createModalFolder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: isPhone ? '100%' : 480, maxHeight: '85vh', background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Create Job from Folder</h3>
              <button onClick={() => setCreateModalFolder(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#999' }}>&times;</button>
            </div>
            <div style={{ padding: 18, overflow: 'auto', flex: 1 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>Folder: <strong>{createModalFolder.rawFolderName}</strong></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Job Number *</label>
                  <input type="text" value={createForm.jobNumber} onChange={e => setCreateForm(f => ({ ...f, jobNumber: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
                  <input type="text" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
                  <select value={createForm.status} onChange={e => setCreateForm(f => ({ ...f, status: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    <option value="ACTIVE">Active</option>
                    <option value="LEAD">Lead</option>
                    <option value="BIDDING">Bidding</option>
                    <option value="AWARDED">Awarded</option>
                  </select>
                </div>
                {customers.length > 0 && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Customer</label>
                    <select value={createForm.customerId} onChange={e => setCreateForm(f => ({ ...f, customerId: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                      <option value="">— None —</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
                  <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Start Date</label>
                    <input type="date" value={createForm.startDate} onChange={e => setCreateForm(f => ({ ...f, startDate: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target Completion</label>
                    <input type="date" value={createForm.targetCompletionDate} onChange={e => setCreateForm(f => ({ ...f, targetCompletionDate: e.target.value }))} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e5e5', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setCreateModalFolder(null)} style={{ padding: '8px 16px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleCreateJob} disabled={!createForm.name || !!actionLoading} style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: createForm.name ? 1 : 0.5 }}>Create Job</button>
            </div>
          </div>
        </div>
      )}

      {/* Folder Detail Drawer */}
      {(detailDrawer || drawerLoading) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} onClick={() => setDetailDrawer(null)} />
          <div style={{ position: 'relative', width: isPhone ? '100%' : 460, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Folder Detail</h3>
              <button onClick={() => setDetailDrawer(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>&times;</button>
            </div>
            {drawerLoading && <div style={{ color: '#888', fontSize: 13 }}>Loading...</div>}
            {detailDrawer && (
              <div style={{ fontSize: 13 }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>{detailDrawer.folder.rawFolderName}</div>
                  <StatusBadge status={detailDrawer.folder.status} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 20 }}>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Normalized Name</div><div>{detailDrawer.folder.normalizedFolderName}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Full Path</div><div style={{ fontFamily: 'monospace', fontSize: 12 }}>{detailDrawer.folder.folderPath ?? '—'}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Mailbox</div><div>{detailDrawer.folder.mailboxEmail}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Provider</div><div>{detailDrawer.folder.provider}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Provider Folder ID</div><div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{detailDrawer.folder.providerFolderId}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Parent Folder</div><div style={{ fontFamily: 'monospace', fontSize: 11 }}>{detailDrawer.folder.parentProviderFolderId ?? '(root)'}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Child Count</div><div>{detailDrawer.folder.childFolderCount}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>First Seen</div><div>{relativeTime(detailDrawer.folder.firstSeenAt)}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Last Seen</div><div>{relativeTime(detailDrawer.folder.lastSeenAt)}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Detected Job#</div><div>{detailDrawer.folder.detectedJobNumber ?? '—'}</div></div>
                  <div><div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>Detected Name</div><div>{detailDrawer.folder.detectedJobName ?? '—'}</div></div>
                </div>

                {detailDrawer.folder.matchedJob && (
                  <div style={{ marginBottom: 16, padding: 12, background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Matched Job</div>
                    <div style={{ fontWeight: 600 }}>{detailDrawer.folder.matchedJob.jobNumber ? detailDrawer.folder.matchedJob.jobNumber + ' — ' : ''}{detailDrawer.folder.matchedJob.name}</div>
                    {detailDrawer.folder.matchedJob.status && <div style={{ fontSize: 12, color: '#555' }}>Status: {detailDrawer.folder.matchedJob.status}</div>}
                  </div>
                )}

                {detailDrawer.alias && (
                  <div style={{ marginBottom: 16, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Alias</div>
                    <div style={{ fontWeight: 500 }}>{detailDrawer.alias.alias}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>Created: {relativeTime(detailDrawer.alias.createdAt)}</div>
                  </div>
                )}

                {/* Audit History */}
                {detailDrawer.auditHistory.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>History</h4>
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {detailDrawer.auditHistory.map(event => (
                        <div key={event.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                          <div style={{ fontWeight: 500 }}>{event.action}</div>
                          <div style={{ color: '#6b7280' }}>
                            {event.actorUser?.email ?? 'system'} · {relativeTime(event.createdAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Archive action at bottom of drawer */}
                {isAdmin && detailDrawer.folder.status !== 'ARCHIVED' && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
                    <button onClick={() => { handleArchive(detailDrawer.folder.id); setDetailDrawer(null) }} style={{ ...btnStyle('#fee2e2', '#991b1b'), padding: '8px 14px' }}>
                      Archive Folder
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
