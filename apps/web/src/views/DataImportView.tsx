import { useState, useRef } from 'react'
import { api, type ImportResult } from '../api'

interface Props {
  workspaceId: string
}

type EntityType = 'customers' | 'vendors' | 'jobs'

const ENTITY_CONFIG: Record<EntityType, { label: string; singular: string; csvColumns: string; example: string }> = {
  customers: {
    label: 'Customers',
    singular: 'customer',
    csvColumns: 'name, primaryEmail, domain, phone, externalRef, notes',
    example: 'name,primaryEmail,domain,phone\n"Acme Construction",contact@acme.com,acme.com,555-0100\n"Baker Industries",info@baker.co,baker.co,'
  },
  vendors: {
    label: 'Vendors',
    singular: 'vendor',
    csvColumns: 'name, primaryEmail, domain, phone, externalRef, notes',
    example: 'name,primaryEmail,domain,phone\n"ABC Supply",orders@abcsupply.com,abcsupply.com,555-0200\n"FastShip Logistics",dispatch@fastship.io,fastship.io,'
  },
  jobs: {
    label: 'Jobs',
    singular: 'job',
    csvColumns: 'name, jobNumber, customerName, status, externalRef, notes',
    example: 'name,jobNumber,customerName,status\n"Downtown Office Renovation",J-2024-001,Acme Construction,ACTIVE\n"Warehouse Expansion",J-2024-002,Baker Industries,ACTIVE'
  }
}

export function DataImportView({ workspaceId }: Props) {
  const [activeTab, setActiveTab] = useState<EntityType>('customers')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const config = ENTITY_CONFIG[activeTab]

  const handleFileUpload = async (file: File) => {
    setImporting(true)
    setResult(null)
    setError('')

    try {
      const text = await file.text()
      const res = await api.importCsv(workspaceId, activeTab, text)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFileDrop = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

  const handleExampleImport = async () => {
    setImporting(true)
    setResult(null)
    setError('')

    try {
      const res = await api.importCsv(workspaceId, activeTab, config.example)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Data Import</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px' }}>
        Import customer, vendor, and job reference data from CSV files. This data will be used for future email matching and enrichment.
      </p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {(Object.keys(ENTITY_CONFIG) as EntityType[]).map(entity => (
          <button key={entity} onClick={() => { setActiveTab(entity); setResult(null); setError('') }}
            className={`btn btn-sm ${activeTab === entity ? 'btn-primary' : 'btn-outline'}`}>
            {ENTITY_CONFIG[entity].label}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, margin: '0 0 8px', fontWeight: 600 }}>Import {config.label}</h3>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px', lineHeight: 1.5 }}>
          Upload a CSV file with these columns: <code style={{ background: '#f0f0f0', padding: '1px 4px', borderRadius: 2 }}>{config.csvColumns}</code>
        </p>
        <p style={{ fontSize: 12, color: '#aaa', margin: '0 0 16px' }}>
          The <strong>name</strong> column is required. Duplicates are matched by normalized name — importing the same {config.singular} twice will update the existing record, not create a duplicate.
        </p>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            {importing ? 'Importing...' : `Upload ${config.label} CSV`}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileDrop}
              disabled={importing}
              style={{ display: 'none' }}
            />
          </label>

          <button className="btn btn-sm btn-outline" onClick={handleExampleImport} disabled={importing}>
            Import example data
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {result && (
        <div className="card" style={{ borderLeft: `3px solid ${result.errors.length > 0 ? '#f57f17' : '#4caf50'}` }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px', fontWeight: 600 }}>Import Results</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12, marginBottom: result.errors.length > 0 ? 16 : 0 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#333' }}>{result.totalRows}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Total rows</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#2e7d32' }}>{result.created}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Created</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1565c0' }}>{result.updated}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Updated</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#999' }}>{result.skipped}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Skipped</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#e65100' }}>
                {result.errors.length} row{result.errors.length > 1 ? 's' : ''} had errors:
              </div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
                  Row {e.row}: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px', fontWeight: 600, color: '#888' }}>Example CSV format</h3>
        <pre style={{
          whiteSpace: 'pre-wrap', background: '#f8f9fa', padding: 12, borderRadius: 4,
          fontSize: 12, lineHeight: 1.6, border: '1px solid #eee', margin: 0, overflow: 'auto'
        }}>
          {config.example}
        </pre>
      </div>
    </div>
  )
}
