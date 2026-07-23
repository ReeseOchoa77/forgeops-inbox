import { useEffect, useState } from 'react'

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed: ${res.status}`)
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as { message?: string }).message ?? `${res.status}`) }
  return res.json() as Promise<T>
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as { message?: string }).message ?? `${res.status}`) }
  return res.json() as Promise<T>
}

interface DiscoveredFolder {
  id: string
  rawFolderName: string
  normalizedFolderName: string
  folderPath: string | null
  detectedJobNumber: string | null
  status: string
  childFolderCount: number
  lastSeenAt: string
  matchedJob: { id: string; name: string; jobNumber: string | null } | null
}

interface JobFolderRoot {
  id: string
  rootName: string
  active: boolean
}

interface Props {
  workspaceId: string
  connectionId: string
}

export function FoldersView({ workspaceId, connectionId }: Props) {
  const [folders, setFolders] = useState<DiscoveredFolder[]>([])
  const [roots, setRoots] = useState<JobFolderRoot[]>([])
  const [loading, setLoading] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [error, setError] = useState('')
  const [newRoot, setNewRoot] = useState('')
  const [filter, setFilter] = useState<'all' | 'DISCOVERED' | 'APPROVED' | 'IGNORED'>('all')

  const load = async () => {
    setLoading(true)
    try {
      const [f, r] = await Promise.all([
        fetchJson<{ folders: DiscoveredFolder[] }>(`/workspaces/${workspaceId}/folders`),
        fetchJson<{ roots: JobFolderRoot[] }>(`/workspaces/${workspaceId}/folders/roots`)
      ])
      setFolders(f.folders)
      setRoots(r.roots)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [workspaceId])

  const handleDiscover = async () => {
    setDiscovering(true)
    setError('')
    try {
      const result = await postJson<{ discovered: number; updated: number }>(`/workspaces/${workspaceId}/folders/discover`, { connectionId })
      setError(`Found ${result.discovered} new folders, updated ${result.updated}`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setDiscovering(false) }
  }

  const handleAddRoot = async () => {
    if (!newRoot.trim()) return
    try {
      await postJson(`/workspaces/${workspaceId}/folders/roots`, { rootName: newRoot.trim() })
      setNewRoot('')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
  }

  const handleApprove = async (folderId: string) => {
    await patchJson(`/workspaces/${workspaceId}/folders/${folderId}`, { status: 'APPROVED' })
    load()
  }

  const handleIgnore = async (folderId: string) => {
    await patchJson(`/workspaces/${workspaceId}/folders/${folderId}`, { status: 'IGNORED' })
    load()
  }

  const filteredFolders = filter === 'all' ? folders : folders.filter(f => f.status === filter)

  if (loading) return <p style={{ color: '#888', fontSize: 13 }}>Loading...</p>

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Job Folder Discovery</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>Discover Outlook folders and map them to jobs for classification evidence.</p>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 10, background: error.startsWith('Found') ? '#e6f4ea' : '#fce4ec', border: `1px solid ${error.startsWith('Found') ? '#a8d5a2' : '#e8a09a'}`, borderRadius: 4, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      {/* Job roots config */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px', fontWeight: 600 }}>Job Root Folders</h3>
        <p style={{ fontSize: 12, color: '#888', margin: '0 0 8px' }}>Subfolders under these roots will be discovered as potential job aliases.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={newRoot} onChange={e => setNewRoot(e.target.value)} placeholder="e.g. Jobs, Active Jobs, Projects"
            style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={handleAddRoot}>Add Root</button>
        </div>
        {roots.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {roots.map(r => (
              <span key={r.id} style={{ padding: '3px 10px', background: '#e3f2fd', color: '#1565c0', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{r.rootName}</span>
            ))}
          </div>
        )}
      </div>

      {/* Discover button */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={handleDiscover} disabled={discovering || !connectionId}>
          {discovering ? 'Discovering...' : 'Discover Folders'}
        </button>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'DISCOVERED', 'APPROVED', 'IGNORED'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '3px 10px', fontSize: 11, fontWeight: 500, borderRadius: 12,
              border: filter === f ? '1px solid #1a1a2e' : '1px solid #ddd',
              background: filter === f ? '#1a1a2e' : '#fff',
              color: filter === f ? '#fff' : '#666', cursor: 'pointer'
            }}>{f === 'all' ? `All (${folders.length})` : `${f} (${folders.filter(x => x.status === f).length})`}</button>
          ))}
        </div>
      </div>

      {/* Folder list */}
      {filteredFolders.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <h3>No folders discovered yet</h3>
          <p>Configure job root folders above, then click "Discover Folders" to scan your Outlook mailbox.</p>
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 500 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0 }}>
                <th style={{ padding: '7px 10px' }}>Folder Name</th>
                <th style={{ padding: '7px 10px' }}>Path</th>
                <th style={{ padding: '7px 10px' }}>Job #</th>
                <th style={{ padding: '7px 10px' }}>Matched Job</th>
                <th style={{ padding: '7px 10px' }}>Status</th>
                <th style={{ padding: '7px 10px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFolders.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 500 }}>{f.rawFolderName}</td>
                  <td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{f.folderPath ?? '—'}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{f.detectedJobNumber ?? '—'}</td>
                  <td style={{ padding: '6px 10px', fontSize: 11 }}>{f.matchedJob?.name ?? '—'}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: f.status === 'APPROVED' ? '#e6f4ea' : f.status === 'IGNORED' ? '#f0f0f0' : '#fff9c4',
                      color: f.status === 'APPROVED' ? '#2e7d32' : f.status === 'IGNORED' ? '#888' : '#f57f17'
                    }}>{f.status}</span>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {f.status !== 'APPROVED' && (
                        <button className="btn btn-sm btn-success" onClick={() => handleApprove(f.id)}>Approve</button>
                      )}
                      {f.status !== 'IGNORED' && (
                        <button className="btn btn-sm btn-outline" onClick={() => handleIgnore(f.id)}>Ignore</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
