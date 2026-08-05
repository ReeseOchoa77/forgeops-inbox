import { useEffect, useState, useCallback } from 'react'
import { api, type DiscoveredFolderItem, type JobFolderRootItem, type JobSummary } from '../api'

interface Props {
  workspaceId: string
  userRole: string
}

const FOLDER_STATUSES = ['ALL', 'DISCOVERED', 'MATCHED', 'APPROVED', 'IGNORED', 'ARCHIVED'] as const

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

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function relativeTime(d: string | null) {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(d)
}

export function OutlookFoldersView({ workspaceId, userRole }: Props) {
  const isAdmin = userRole === 'OWNER' || userRole === 'ADMIN'

  // Folder roots state
  const [roots, setRoots] = useState<JobFolderRootItem[]>([])
  const [rootsLoading, setRootsLoading] = useState(true)
  const [newRootName, setNewRootName] = useState('')
  const [addingRoot, setAddingRoot] = useState(false)
  const [rootError, setRootError] = useState('')

  // Discovered folders state
  const [folders, setFolders] = useState<DiscoveredFolderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Jobs for match dropdown
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [matchingFolderId, setMatchingFolderId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState('')

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [confirmCreateId, setConfirmCreateId] = useState<string | null>(null)

  // Load folder roots
  const loadRoots = useCallback(async () => {
    setRootsLoading(true)
    try {
      const res = await api.getJobFolderRoots(workspaceId)
      setRoots(res.roots)
    } catch { /* ignore */ } finally {
      setRootsLoading(false)
    }
  }, [workspaceId])

  // Load discovered folders
  const loadFolders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getDiscoveredFolders(workspaceId, {
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        search: search || undefined,
        page,
        pageSize: 25,
      })
      setFolders(res.folders)
      setTotalPages(res.pagination.totalPages)
      setTotalCount(res.pagination.totalCount)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [workspaceId, statusFilter, search, page])

  // Load jobs for match dropdown
  const loadJobs = useCallback(async () => {
    try {
      const res = await api.getJobs(workspaceId, { pageSize: 200 })
      setJobs(res.jobs)
    } catch { /* ignore */ }
  }, [workspaceId])

  useEffect(() => { loadRoots() }, [loadRoots])
  useEffect(() => { loadFolders() }, [loadFolders])
  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => { setPage(1) }, [statusFilter, search])

  // Root actions
  const handleAddRoot = async () => {
    if (!newRootName.trim()) return
    setAddingRoot(true)
    setRootError('')
    try {
      await api.addJobFolderRoot(workspaceId, { rootName: newRootName.trim() })
      setNewRootName('')
      loadRoots()
    } catch (e) {
      setRootError(e instanceof Error ? e.message : 'Failed to add root')
    } finally {
      setAddingRoot(false)
    }
  }

  const handleRemoveRoot = async (rootId: string) => {
    try {
      await api.removeJobFolderRoot(workspaceId, rootId)
      loadRoots()
    } catch { /* ignore */ }
  }

  // Folder actions
  const handleMatch = async (folderId: string) => {
    if (!selectedJobId) return
    setActionLoading(folderId)
    try {
      await api.matchDiscoveredFolder(workspaceId, folderId, selectedJobId)
      setMatchingFolderId(null)
      setSelectedJobId('')
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

  const handleCreateJob = async (folderId: string) => {
    setActionLoading(folderId)
    setConfirmCreateId(null)
    try {
      await api.createJobFromFolder(workspaceId, folderId)
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

  const actionBtnStyle = (bg: string, color: string): React.CSSProperties => ({
    padding: '4px 10px', border: 'none', borderRadius: 4, fontSize: 11,
    fontWeight: 600, cursor: 'pointer', background: bg, color,
  })

  const thStyle: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151',
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Outlook Folders</h2>
      </div>

      {/* Job Folder Roots Section */}
      {isAdmin && (
        <div style={{
          marginBottom: 24, padding: 16, background: '#f9fafb',
          border: '1px solid #e5e7eb', borderRadius: 8,
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: '#111' }}>
            Job Folder Roots
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
            Root folder names that contain job sub-folders in connected mailboxes.
          </p>

          {rootsLoading ? (
            <div style={{ color: '#888', fontSize: 13 }}>Loading roots...</div>
          ) : (
            <>
              {roots.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {roots.map(root => (
                    <div key={root.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
                    }}>
                      <div>
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{root.rootName}</span>
                        {root.mailboxEmail && (
                          <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>({root.mailboxEmail})</span>
                        )}
                        {!root.active && (
                          <span style={{
                            marginLeft: 8, padding: '1px 6px', borderRadius: 8,
                            fontSize: 10, fontWeight: 600, background: '#fef3c7', color: '#b45309',
                          }}>INACTIVE</span>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveRoot(root.id)}
                        style={{
                          padding: '4px 10px', border: '1px solid #fca5a5', borderRadius: 4,
                          background: '#fff', color: '#dc2626', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {roots.length === 0 && (
                <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>No folder roots configured yet.</div>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={newRootName}
                  onChange={e => setNewRootName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddRoot() }}
                  placeholder="Root folder name, e.g. Jobs"
                  style={{
                    flex: 1, maxWidth: 300, padding: '8px 12px',
                    border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, outline: 'none',
                  }}
                />
                <button
                  onClick={handleAddRoot}
                  disabled={addingRoot || !newRootName.trim()}
                  style={{
                    padding: '8px 16px', background: '#1a1a2e', color: '#fff', border: 'none',
                    borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    opacity: addingRoot || !newRootName.trim() ? 0.5 : 1,
                  }}
                >
                  {addingRoot ? 'Adding...' : '+ Add Root'}
                </button>
              </div>
              {rootError && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{rootError}</div>}
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search folders..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 220, padding: '8px 12px', border: '1px solid #d0d5dd',
            borderRadius: 6, fontSize: 13, outline: 'none',
          }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}
        >
          {FOLDER_STATUSES.map(s => (
            <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: '#888' }}>Loading folders...</div>
      )}

      {/* Empty state */}
      {!loading && folders.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: '#888' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: '#333' }}>No folders found</h3>
          <p style={{ margin: 0, fontSize: 14, color: '#888' }}>
            {search || statusFilter !== 'ALL' ? 'Try adjusting your filters.' : 'Discovered folders will appear here after syncing mailboxes.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && folders.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={thStyle}>Mailbox</th>
                  <th style={thStyle}>Folder Path</th>
                  <th style={thStyle}>Raw Name</th>
                  <th style={thStyle}>Job #</th>
                  <th style={thStyle}>Detected Name</th>
                  <th style={thStyle}>Matched Job</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Last Seen</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {folders.map(folder => (
                  <tr key={folder.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '10px 12px', color: '#555', fontSize: 12 }}>{folder.mailboxEmail}</td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12, fontFamily: 'monospace' }}>
                      {folder.folderPath ?? '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 500, color: '#111' }}>{folder.rawFolderName}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                      {folder.detectedJobNumber ?? '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#555' }}>{folder.detectedJobName ?? '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#555' }}>
                      {folder.matchedJob
                        ? `${folder.matchedJob.jobNumber ? folder.matchedJob.jobNumber + ' — ' : ''}${folder.matchedJob.name}`
                        : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={folder.status} /></td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{relativeTime(folder.lastSeenAt)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        {actionLoading === folder.id ? (
                          <span style={{ fontSize: 11, color: '#888' }}>Working...</span>
                        ) : (
                          <>
                            {/* Match button — for DISCOVERED */}
                            {folder.status === 'DISCOVERED' && matchingFolderId !== folder.id && (
                              <button
                                onClick={() => { setMatchingFolderId(folder.id); setSelectedJobId('') }}
                                style={actionBtnStyle('#dbeafe', '#1d4ed8')}
                              >
                                Match
                              </button>
                            )}

                            {/* Match dropdown */}
                            {matchingFolderId === folder.id && (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <select
                                  value={selectedJobId}
                                  onChange={e => setSelectedJobId(e.target.value)}
                                  style={{ padding: '3px 6px', border: '1px solid #d0d5dd', borderRadius: 4, fontSize: 11, background: '#fff', maxWidth: 160 }}
                                >
                                  <option value="">Select job...</option>
                                  {jobs.map(j => (
                                    <option key={j.id} value={j.id}>
                                      {j.jobNumber ? `${j.jobNumber} — ` : ''}{j.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleMatch(folder.id)}
                                  disabled={!selectedJobId}
                                  style={{ ...actionBtnStyle('#1d4ed8', '#fff'), opacity: selectedJobId ? 1 : 0.5 }}
                                >
                                  OK
                                </button>
                                <button
                                  onClick={() => { setMatchingFolderId(null); setSelectedJobId('') }}
                                  style={actionBtnStyle('#f3f4f6', '#374151')}
                                >
                                  ✕
                                </button>
                              </div>
                            )}

                            {/* Approve — for MATCHED */}
                            {folder.status === 'MATCHED' && (
                              <button onClick={() => handleApprove(folder.id)} style={actionBtnStyle('#dcfce7', '#16a34a')}>
                                Approve
                              </button>
                            )}

                            {/* Create Job — for DISCOVERED */}
                            {folder.status === 'DISCOVERED' && confirmCreateId !== folder.id && (
                              <button onClick={() => setConfirmCreateId(folder.id)} style={actionBtnStyle('#ede9fe', '#7c3aed')}>
                                Create Job
                              </button>
                            )}
                            {confirmCreateId === folder.id && (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <span style={{ fontSize: 11, color: '#666' }}>Confirm?</span>
                                <button onClick={() => handleCreateJob(folder.id)} style={actionBtnStyle('#7c3aed', '#fff')}>
                                  Yes
                                </button>
                                <button onClick={() => setConfirmCreateId(null)} style={actionBtnStyle('#f3f4f6', '#374151')}>
                                  No
                                </button>
                              </div>
                            )}

                            {/* Ignore — for DISCOVERED or MATCHED */}
                            {(folder.status === 'DISCOVERED' || folder.status === 'MATCHED') && (
                              <button onClick={() => handleIgnore(folder.id)} style={actionBtnStyle('#fef3c7', '#b45309')}>
                                Ignore
                              </button>
                            )}

                            {/* Restore — for IGNORED */}
                            {folder.status === 'IGNORED' && (
                              <button onClick={() => handleRestore(folder.id)} style={actionBtnStyle('#f3f4f6', '#374151')}>
                                Restore
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13, color: '#555' }}>
            <span>{totalCount} folder{totalCount !== 1 ? 's' : ''} total</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                style={{ padding: '6px 12px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: page > 1 ? 'pointer' : 'not-allowed', opacity: page <= 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                style={{ padding: '6px 12px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: page < totalPages ? 'pointer' : 'not-allowed', opacity: page >= totalPages ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
