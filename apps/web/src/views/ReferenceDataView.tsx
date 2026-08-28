import { useEffect, useState, useRef } from 'react'
import { SenderEvidenceView } from './SenderEvidenceView'
import { DataImportView } from './DataImportView'
import { api } from '../api'

export type ReferenceDataTab =
  | 'customers'
  | 'vendors'
  | 'jobs'
  | 'contacts'
  | 'aliases'
  | 'documents'
  | 'senders'
  | 'imports'

const TABS: Array<{ key: ReferenceDataTab; label: string }> = [
  { key: 'customers', label: 'Customers' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'aliases', label: 'Aliases' },
  { key: 'documents', label: 'Documents' },
  { key: 'senders', label: 'Senders' },
  { key: 'imports', label: 'Imports' },
]

const VALID_TABS = new Set<string>(TABS.map((t) => t.key))

export function isReferenceDataTab(value: string | null | undefined): value is ReferenceDataTab {
  return Boolean(value && VALID_TABS.has(value))
}

const REFERENCE_TAB_STORAGE_KEY = 'forgeops_reference_tab'

function persistReferenceTab(tab: ReferenceDataTab): void {
  try {
    sessionStorage.setItem(REFERENCE_TAB_STORAGE_KEY, tab)
  } catch { /* ignore */ }
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('refTab', tab)
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  } catch { /* ignore */ }
}

function readStoredReferenceTab(): ReferenceDataTab | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('refTab')
    if (isReferenceDataTab(fromUrl)) return fromUrl
  } catch { /* ignore */ }
  try {
    const stored = sessionStorage.getItem(REFERENCE_TAB_STORAGE_KEY)
    if (isReferenceDataTab(stored)) return stored
  } catch { /* ignore */ }
  return null
}

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed: ${res.status}`)
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message?: string }).message ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

interface Props {
  workspaceId: string
  userRole?: string
  /** Preferred section when opening Company Data (e.g. redirected from Documents). */
  initialTab?: ReferenceDataTab
}

export function ReferenceDataView({
  workspaceId,
  userRole = 'MEMBER',
  initialTab,
}: Props) {
  const isViewer = userRole === 'VIEWER'
  const [tab, setTab] = useState<ReferenceDataTab>(() => {
    if (initialTab && isReferenceDataTab(initialTab)) return initialTab
    return readStoredReferenceTab() ?? 'customers'
  })
  const [data, setData] = useState<Record<string, unknown[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [importStep, setImportStep] = useState<'idle' | 'preview' | 'importing' | 'done'>('idle')
  const [importType, setImportType] = useState<'CUSTOMER' | 'VENDOR'>('CUSTOMER')
  const [importText, setImportText] = useState('')
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([])
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null)
  const [docUploading, setDocUploading] = useState(false)
  const [docUploadMsg, setDocUploadMsg] = useState('')
  const [runDocAi, setRunDocAi] = useState(true)
  const docFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (initialTab && isReferenceDataTab(initialTab)) {
      setTab(initialTab)
      persistReferenceTab(initialTab)
    }
  }, [initialTab, workspaceId])

  const selectTab = (next: ReferenceDataTab) => {
    setTab(next)
    setImportStep('idle')
    persistReferenceTab(next)
  }

  const load = async (t: ReferenceDataTab) => {
    setLoading(true)
    setError('')
    try {
      const q = t === 'customers' ? '?includeCounts=true' : ''
      const r = await fetchJson<Record<string, unknown[]>>(`/workspaces/${workspaceId}/reference/${t}${q}`)
      setData(prev => ({ ...prev, [t]: Object.values(r)[0] as unknown[] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'senders') return
    void load(tab)
  }, [tab, workspaceId])

  const handlePreview = async () => {
    if (!importText.trim()) return
    setError('')
    try {
      const lines = importText.split('\n').map(l => l.trim()).filter(Boolean)
      const rows = lines.map(name => ({ name }))
      const r = await postJson<{ preview: Array<Record<string, unknown>> }>(
        `/workspaces/${workspaceId}/reference/import/preview`,
        { entityType: importType, rows }
      )
      setPreviewRows(r.preview)
      setImportStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    }
  }

  const handleCommit = async () => {
    setImportStep('importing')
    try {
      const rows = previewRows.map(r => ({
        name: r.name as string,
        action: (r as { duplicates?: unknown[] }).duplicates?.length ? 'skip' : 'create'
      }))
      const result = await postJson<Record<string, unknown>>(
        `/workspaces/${workspaceId}/reference/import/commit`,
        { entityType: importType, rows }
      )
      setImportResult(result)
      setImportStep('done')
      void load(importType === 'CUSTOMER' ? 'customers' : 'vendors')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setImportStep('preview')
    }
  }

  const items = (data[tab] ?? []) as Array<Record<string, unknown>>
  const showEntityTable = tab !== 'senders' && tab !== 'documents'

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Company Data</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
        Customers, vendors, jobs, contacts, documents, and classification knowledge for this workspace.
      </p>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 10, background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '2px solid #e5e5e5', overflowX: 'auto', WebkitOverflowScrolling: 'touch' as never, flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => selectTab(t.key)} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? '#1a1a2e' : '#888', background: 'none', border: 'none',
            borderBottom: tab === t.key ? '2px solid #1a1a2e' : '2px solid transparent',
            marginBottom: -2, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
          }}>{t.label} {t.key !== 'documents' && data[t.key] ? `(${(data[t.key] as unknown[]).length})` : ''}</button>
        ))}
      </div>

      {tab === 'documents' && (
        <div style={{ marginBottom: 20 }}>
          {!isViewer && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 4px', fontWeight: 600 }}>Upload Document</h3>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px', lineHeight: 1.45 }}>
                Store the original file, extract text/tables, and optionally run AI analysis.
                Supports PDF, DOCX, XLSX/XLS, CSV, TXT, JSON, and common images. Google Sheets is not a local file type — connect Drive later.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <label className="btn btn-primary" style={{ cursor: docUploading ? 'wait' : 'pointer' }}>
                  {docUploading ? 'Uploading…' : 'Choose File'}
                  <input
                    ref={docFileRef}
                    type="file"
                    disabled={docUploading}
                    accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.pptx,.rtf,.xml,.zip"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setDocUploading(true)
                      setDocUploadMsg('')
                      setError('')
                      try {
                        const r = await api.uploadWorkspaceDocument(workspaceId, file, {
                          runAiAnalysis: runDocAi,
                        })
                        setDocUploadMsg(
                          `${r.document.filename}: ${r.document.processingStatus}` +
                            (r.document.aiAnalysisStatus !== 'NOT_REQUESTED'
                              ? ` · AI ${r.document.aiAnalysisStatus}`
                              : '')
                        )
                        void load('documents')
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Upload failed')
                      } finally {
                        setDocUploading(false)
                        if (docFileRef.current) docFileRef.current.value = ''
                      }
                    }}
                  />
                </label>
                <label style={{ fontSize: 12, color: '#555', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={runDocAi}
                    onChange={(e) => setRunDocAi(e.target.checked)}
                  />
                  Run AI analysis after extract
                </label>
              </div>
              {docUploadMsg && (
                <p style={{ fontSize: 12, color: '#2e7d32', margin: '10px 0 0' }}>{docUploadMsg}</p>
              )}
            </div>
          )}

          <DataImportView workspaceId={workspaceId} userRole={userRole} embedded />
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 8px', fontWeight: 600 }}>Stored documents</h3>
            {loading ? (
              <p style={{ color: '#888', fontSize: 13 }}>Loading...</p>
            ) : items.length === 0 ? (
              <p style={{ color: '#aaa', fontSize: 12, margin: 0 }}>
                No stored documents yet. Upload above to store originals and extraction status.
              </p>
            ) : (
              <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 400, WebkitOverflowScrolling: 'touch' as never }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '7px 10px' }}>Filename</th>
                      <th style={{ padding: '7px 10px' }}>Status</th>
                      <th style={{ padding: '7px 10px' }}>AI</th>
                      <th style={{ padding: '7px 10px' }}>Text</th>
                      <th style={{ padding: '7px 10px' }}>Job</th>
                      <th style={{ padding: '7px 10px' }}>Size</th>
                      <th style={{ padding: '7px 10px' }}>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={(item.id as string) ?? i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '6px 10px' }}>{item.filename as string}</td>
                        <td style={{ padding: '6px 10px' }}>{String(item.processingStatus ?? item.status ?? '')}</td>
                        <td style={{ padding: '6px 10px', fontSize: 11 }}>{String(item.aiAnalysisStatus ?? '—')}</td>
                        <td style={{ padding: '6px 10px', fontSize: 11 }}>{item.extractedTextAvailable ? 'Yes' : 'No'}</td>
                        <td style={{ padding: '6px 10px', fontSize: 11, color: '#666' }}>
                          {item.linkedJob
                            ? String((item.linkedJob as { jobNumber?: string; name?: string }).jobNumber
                              ?? (item.linkedJob as { name?: string }).name
                              ?? '')
                            : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{item.fileSize ? `${Math.round((item.fileSize as number) / 1024)} KB` : '—'}</td>
                        <td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{formatDate(String(item.uploadedAt ?? item.createdAt ?? ''))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {!isViewer && (tab === 'customers' || tab === 'vendors') && importStep === 'idle' && (
        <div style={{ marginBottom: 16, padding: 12, background: '#f8f9fa', borderRadius: 6, border: '1px solid #eee' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block' }}>Type</label>
              <select value={importType} onChange={e => setImportType(e.target.value as 'CUSTOMER' | 'VENDOR')}
                style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }}>
                <option value="CUSTOMER">Customer</option>
                <option value="VENDOR">Vendor</option>
              </select>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => void handlePreview()} disabled={!importText.trim()}>Preview Import</button>
          </div>
          <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={4}
            placeholder="Paste names (one per line):&#10;JE Dunn Construction&#10;Kraus-Anderson&#10;River City Erectors Inc."
            style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, fontSize: 12, resize: 'vertical' }} />
        </div>
      )}

      {importStep === 'preview' && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Import Preview — {previewRows.length} rows</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }}>
                <th style={{ padding: '6px 10px' }}>Name</th>
                <th style={{ padding: '6px 10px' }}>Normalized</th>
                <th style={{ padding: '6px 10px' }}>Duplicates</th>
                <th style={{ padding: '6px 10px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => {
                const dupes = (r.duplicates as Array<{ existingName: string; score: number }>) ?? []
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '5px 10px' }}>{r.name as string}</td>
                    <td style={{ padding: '5px 10px', color: '#888', fontFamily: 'monospace', fontSize: 11 }}>{r.normalizedName as string}</td>
                    <td style={{ padding: '5px 10px' }}>
                      {dupes.length > 0 ? (
                        <span style={{ color: '#e65100', fontSize: 11 }}>
                          {dupes.map(d => `${d.existingName} (${Math.round(d.score * 100)}%)`).join(', ')}
                        </span>
                      ) : <span style={{ color: '#4caf50', fontSize: 11 }}>New</span>}
                    </td>
                    <td style={{ padding: '5px 10px', fontSize: 11, fontWeight: 500 }}>
                      {r.suggestedAction as string}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void handleCommit()}>Commit Import</button>
            <button className="btn btn-sm btn-outline" onClick={() => setImportStep('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {importStep === 'importing' && <p style={{ color: '#888', fontSize: 13 }}>Importing...</p>}

      {importStep === 'done' && importResult && (
        <div style={{ marginBottom: 16, padding: 12, background: '#e6f4ea', border: '1px solid #a8d5a2', borderRadius: 6, fontSize: 13 }}>
          Import complete: {importResult.created as number} created, {importResult.updated as number} updated, {importResult.skipped as number} skipped
          <button type="button" onClick={() => { setImportStep('idle'); setImportText(''); setPreviewRows([]); setImportResult(null) }}
            className="btn btn-sm btn-outline" style={{ marginLeft: 12 }}>Done</button>
        </div>
      )}

      {tab === 'senders' && (
        <SenderEvidenceView workspaceId={workspaceId} />
      )}

      {showEntityTable && (loading ? <p style={{ color: '#888', fontSize: 13 }}>Loading...</p> : items.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <h3>No {tab} yet</h3>
          <p>{tab === 'customers' || tab === 'vendors' ? 'Import from CSV or paste names above.' : `${tab} will appear here as data is imported.`}</p>
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 500, WebkitOverflowScrolling: 'touch' as never }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0 }}>
                {tab === 'customers' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Email</th><th style={{ padding: '7px 10px' }}>Domain</th><th style={{ padding: '7px 10px' }}>Phone</th><th style={{ padding: '7px 10px' }}>Aliases</th><th style={{ padding: '7px 10px' }}>Contacts</th><th style={{ padding: '7px 10px' }}>Jobs</th></>}
                {tab === 'vendors' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Email</th><th style={{ padding: '7px 10px' }}>Domain</th><th style={{ padding: '7px 10px' }}>Phone</th><th style={{ padding: '7px 10px' }}>Aliases</th><th style={{ padding: '7px 10px' }}>Contacts</th></>}
                {tab === 'jobs' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Job #</th><th style={{ padding: '7px 10px' }}>Customer</th><th style={{ padding: '7px 10px' }}>Status</th><th style={{ padding: '7px 10px' }}>Aliases</th></>}
                {tab === 'contacts' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Email</th><th style={{ padding: '7px 10px' }}>Domain</th><th style={{ padding: '7px 10px' }}>Phone</th><th style={{ padding: '7px 10px' }}>Entity</th><th style={{ padding: '7px 10px' }}>Source</th></>}
                {tab === 'aliases' && <><th style={{ padding: '7px 10px' }}>Alias</th><th style={{ padding: '7px 10px' }}>Normalized</th><th style={{ padding: '7px 10px' }}>Type</th><th style={{ padding: '7px 10px' }}>Entity</th><th style={{ padding: '7px 10px' }}>Source</th></>}
                {tab === 'imports' && <><th style={{ padding: '7px 10px' }}>Type</th><th style={{ padding: '7px 10px' }}>Status</th><th style={{ padding: '7px 10px' }}>Rows</th><th style={{ padding: '7px 10px' }}>Created</th><th style={{ padding: '7px 10px' }}>Skipped</th><th style={{ padding: '7px 10px' }}>Errors</th><th style={{ padding: '7px 10px' }}>Date</th></>}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {tab === 'customers' && <><td style={{ padding: '6px 10px', fontWeight: 500 }}>{item.name as string}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.primaryEmail as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.domain as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.phone as string) ?? '—'}</td><td style={{ padding: '6px 10px' }}>{((item._count as Record<string, number>)?.aliases) ?? 0}</td><td style={{ padding: '6px 10px' }}>{((item._count as Record<string, number>)?.contacts) ?? 0}</td><td style={{ padding: '6px 10px' }}>{((item._count as Record<string, number>)?.jobs) ?? 0}</td></>}
                  {tab === 'vendors' && <><td style={{ padding: '6px 10px', fontWeight: 500 }}>{item.name as string}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.primaryEmail as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.domain as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.phone as string) ?? '—'}</td><td style={{ padding: '6px 10px' }}>{((item._count as Record<string, number>)?.aliases) ?? 0}</td><td style={{ padding: '6px 10px' }}>{((item._count as Record<string, number>)?.contacts) ?? 0}</td></>}
                  {tab === 'jobs' && <><td style={{ padding: '6px 10px', fontWeight: 500 }}>{item.name as string}</td><td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{(item.jobNumber as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.customer as Record<string, string>)?.name ?? '—'}</td><td style={{ padding: '6px 10px' }}>{item.status as string}</td><td style={{ padding: '6px 10px' }}>{((item._count as Record<string, number>)?.aliases) ?? 0}</td></>}
                  {tab === 'contacts' && <><td style={{ padding: '6px 10px' }}>{(item.name as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.email as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.domain as string) ?? '—'}</td><td style={{ padding: '6px 10px', color: '#888' }}>{(item.phone as string) ?? '—'}</td><td style={{ padding: '6px 10px', fontSize: 11 }}>{(item.customer as Record<string, string>)?.name ?? (item.vendor as Record<string, string>)?.name ?? '—'}</td><td style={{ padding: '6px 10px', fontSize: 11, color: '#888' }}>{item.source as string}</td></>}
                  {tab === 'aliases' && <><td style={{ padding: '6px 10px' }}>{item.alias as string}</td><td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{item.normalizedAlias as string}</td><td style={{ padding: '6px 10px', fontSize: 11 }}>{item.entityType as string}</td><td style={{ padding: '6px 10px', fontSize: 11 }}>{(item.customer as Record<string, string>)?.name ?? (item.vendor as Record<string, string>)?.name ?? (item.job as Record<string, string>)?.name ?? '—'}</td><td style={{ padding: '6px 10px', fontSize: 11, color: '#888' }}>{item.source as string}</td></>}
                  {tab === 'imports' && <><td style={{ padding: '6px 10px' }}>{item.importType as string}</td><td style={{ padding: '6px 10px' }}>{item.status as string}</td><td style={{ padding: '6px 10px' }}>{item.rowsRead as number}</td><td style={{ padding: '6px 10px' }}>{item.createdCount as number}</td><td style={{ padding: '6px 10px' }}>{item.skippedCount as number}</td><td style={{ padding: '6px 10px', color: (item.errorCount as number) > 0 ? '#c62828' : '#888' }}>{item.errorCount as number}</td><td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{formatDate(item.createdAt as string)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
