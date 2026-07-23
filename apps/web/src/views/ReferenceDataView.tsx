import { useEffect, useState } from 'react'
import { SenderEvidenceView } from './SenderEvidenceView'

type Tab = 'customers' | 'vendors' | 'jobs' | 'contacts' | 'aliases' | 'documents' | 'senders' | 'imports'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'customers', label: 'Customers' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'aliases', label: 'Aliases' },
  { key: 'documents', label: 'Documents' },
  { key: 'senders', label: 'Senders' },
  { key: 'imports', label: 'Imports' },
]

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

interface Props { workspaceId: string }

export function ReferenceDataView({ workspaceId }: Props) {
  const [tab, setTab] = useState<Tab>('customers')
  const [data, setData] = useState<Record<string, unknown[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [importStep, setImportStep] = useState<'idle' | 'preview' | 'importing' | 'done'>('idle')
  const [importType, setImportType] = useState<'CUSTOMER' | 'VENDOR'>('CUSTOMER')
  const [importText, setImportText] = useState('')
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([])
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null)

  const load = async (t: Tab) => {
    setLoading(true)
    setError('')
    try {
      const r = await fetchJson<Record<string, unknown[]>>(`/workspaces/${workspaceId}/reference/${t}`)
      setData(prev => ({ ...prev, [t]: Object.values(r)[0] as unknown[] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(tab) }, [tab, workspaceId])

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
      load(importType === 'CUSTOMER' ? 'customers' : 'vendors')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setImportStep('preview')
    }
  }

  const items = (data[tab] ?? []) as Array<Record<string, unknown>>

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Reference Data</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>Customers, vendors, jobs, contacts, and classification knowledge for this workspace.</p>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 10, background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '2px solid #e5e5e5', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setImportStep('idle') }} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? '#1a1a2e' : '#888', background: 'none', border: 'none',
            borderBottom: tab === t.key ? '2px solid #1a1a2e' : '2px solid transparent',
            marginBottom: -2, cursor: 'pointer'
          }}>{t.label} {data[t.key] ? `(${(data[t.key] as unknown[]).length})` : ''}</button>
        ))}
      </div>

      {/* Import controls for customers/vendors */}
      {(tab === 'customers' || tab === 'vendors') && importStep === 'idle' && (
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
            <button className="btn btn-sm btn-primary" onClick={handlePreview} disabled={!importText.trim()}>Preview Import</button>
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
            <button className="btn btn-sm btn-primary" onClick={handleCommit}>Commit Import</button>
            <button className="btn btn-sm btn-outline" onClick={() => setImportStep('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {importStep === 'importing' && <p style={{ color: '#888', fontSize: 13 }}>Importing...</p>}

      {importStep === 'done' && importResult && (
        <div style={{ marginBottom: 16, padding: 12, background: '#e6f4ea', border: '1px solid #a8d5a2', borderRadius: 6, fontSize: 13 }}>
          Import complete: {importResult.created as number} created, {importResult.updated as number} updated, {importResult.skipped as number} skipped
          <button onClick={() => { setImportStep('idle'); setImportText(''); setPreviewRows([]); setImportResult(null) }}
            className="btn btn-sm btn-outline" style={{ marginLeft: 12 }}>Done</button>
        </div>
      )}

      {/* Senders tab */}
      {tab === 'senders' && (
        <SenderEvidenceView workspaceId={workspaceId} />
      )}

      {/* Data table */}
      {tab !== 'senders' && (loading ? <p style={{ color: '#888', fontSize: 13 }}>Loading...</p> : items.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <h3>No {tab} yet</h3>
          <p>{tab === 'customers' || tab === 'vendors' ? 'Import from CSV or paste names above.' : `${tab} will appear here as data is imported.`}</p>
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', overflow: 'auto', maxHeight: 500 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left', position: 'sticky', top: 0 }}>
                {tab === 'customers' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Email</th><th style={{ padding: '7px 10px' }}>Domain</th><th style={{ padding: '7px 10px' }}>Phone</th><th style={{ padding: '7px 10px' }}>Aliases</th><th style={{ padding: '7px 10px' }}>Contacts</th><th style={{ padding: '7px 10px' }}>Jobs</th></>}
                {tab === 'vendors' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Email</th><th style={{ padding: '7px 10px' }}>Domain</th><th style={{ padding: '7px 10px' }}>Phone</th><th style={{ padding: '7px 10px' }}>Aliases</th><th style={{ padding: '7px 10px' }}>Contacts</th></>}
                {tab === 'jobs' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Job #</th><th style={{ padding: '7px 10px' }}>Customer</th><th style={{ padding: '7px 10px' }}>Status</th><th style={{ padding: '7px 10px' }}>Aliases</th></>}
                {tab === 'contacts' && <><th style={{ padding: '7px 10px' }}>Name</th><th style={{ padding: '7px 10px' }}>Email</th><th style={{ padding: '7px 10px' }}>Domain</th><th style={{ padding: '7px 10px' }}>Phone</th><th style={{ padding: '7px 10px' }}>Entity</th><th style={{ padding: '7px 10px' }}>Source</th></>}
                {tab === 'aliases' && <><th style={{ padding: '7px 10px' }}>Alias</th><th style={{ padding: '7px 10px' }}>Normalized</th><th style={{ padding: '7px 10px' }}>Type</th><th style={{ padding: '7px 10px' }}>Entity</th><th style={{ padding: '7px 10px' }}>Source</th></>}
                {tab === 'documents' && <><th style={{ padding: '7px 10px' }}>Filename</th><th style={{ padding: '7px 10px' }}>Type</th><th style={{ padding: '7px 10px' }}>Status</th><th style={{ padding: '7px 10px' }}>Size</th><th style={{ padding: '7px 10px' }}>Created</th></>}
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
                  {tab === 'aliases' && <><td style={{ padding: '6px 10px' }}>{item.alias as string}</td><td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{item.normalizedAlias as string}</td><td style={{ padding: '6px 10px', fontSize: 11 }}>{item.entityType as string}</td><td style={{ padding: '6px 10px', fontSize: 11 }}>{(item.customer as Record<string, string>)?.name ?? (item.vendor as Record<string, string>)?.name ?? (item.job as Record<string, string>)?.name ?? '—'}</td><td style={{ padding: '6px 10px', fontSize: 11, color: '#888' }}>{item.source as string}</td></>}
                  {tab === 'documents' && <><td style={{ padding: '6px 10px' }}>{item.filename as string}</td><td style={{ padding: '6px 10px', fontSize: 11 }}>{(item.documentType as string).replace(/_/g, ' ')}</td><td style={{ padding: '6px 10px' }}>{item.status as string}</td><td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{item.fileSize ? `${Math.round((item.fileSize as number) / 1024)} KB` : '—'}</td><td style={{ padding: '6px 10px', color: '#888', fontSize: 11 }}>{formatDate(item.createdAt as string)}</td></>}
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
