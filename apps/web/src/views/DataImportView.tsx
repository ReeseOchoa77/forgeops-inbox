import { useState, useRef } from 'react'
import { api, type ImportResult, type ExtractionResult, type ExtractedRecord } from '../api'

interface Props {
  workspaceId: string
}

type ImportTarget = 'customers' | 'vendors' | 'jobs'
type Step = 'upload' | 'extracting' | 'review' | 'importing' | 'done'

const TARGET_LABELS: Record<ImportTarget, string> = {
  customers: 'Customers',
  vendors: 'Vendors',
  jobs: 'Jobs'
}

function inferTarget(type: ExtractionResult['inferredType']): ImportTarget {
  switch (type) {
    case 'vendor': return 'vendors'
    case 'job': return 'jobs'
    default: return 'customers'
  }
}

function mapRecordsToImportRows(records: ExtractedRecord[], target: ImportTarget): Array<Record<string, unknown>> {
  return records.map(r => {
    if (target === 'jobs') {
      return {
        name: r.name,
        jobNumber: r.jobNumber ?? null,
        customerName: r.company ?? null,
        notes: r.notes ?? null
      }
    }
    return {
      name: r.name,
      primaryEmail: r.email ?? null,
      domain: r.domain ?? null,
      phone: r.phone ?? null,
      notes: r.notes ?? null
    }
  })
}

export function DataImportView({ workspaceId }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [target, setTarget] = useState<ImportTarget>('customers')
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('upload')
    setExtraction(null)
    setResult(null)
    setError('')
    setFileName('')
    setSelectedRows(new Set())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setError('')
    setStep('extracting')

    try {
      const extracted = await api.aiExtract(workspaceId, file)
      setExtraction(extracted)
      setTarget(inferTarget(extracted.inferredType))
      setSelectedRows(new Set(extracted.records.map((_, i) => i)))
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed')
      setStep('upload')
    }
  }

  const handleConfirmImport = async () => {
    if (!extraction) return
    setStep('importing')
    setError('')

    const selectedRecords = extraction.records.filter((_, i) => selectedRows.has(i))
    const rows = mapRecordsToImportRows(selectedRecords, target)

    try {
      const res = await api.importJson(workspaceId, target, rows)
      setResult(res)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStep('review')
    }
  }

  const toggleRow = (i: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toggleAll = () => {
    if (!extraction) return
    if (selectedRows.size === extraction.records.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(extraction.records.map((_, i) => i)))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 17, margin: '0 0 2px' }}>Data Import</h2>
          <p style={{ fontSize: 12, color: '#999', margin: 0 }}>Upload a file and AI will extract importable records for your review.</p>
        </div>
        {step !== 'upload' && (
          <button className="btn btn-sm btn-outline" onClick={reset}>Start over</button>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, marginBottom: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="card">
          <h3 style={{ fontSize: 14, margin: '0 0 8px', fontWeight: 600 }}>Upload a Document</h3>
          <p style={{ fontSize: 12, color: '#888', margin: '0 0 14px', lineHeight: 1.5 }}>
            Upload a CSV, PDF, or text file containing a list of customers, vendors, contacts, or jobs.
            AI will analyze the content and suggest records to import.
          </p>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            Choose File
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.pdf,.txt,text/csv,text/plain,application/pdf"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </label>
          <span style={{ marginLeft: 12, fontSize: 12, color: '#999' }}>CSV, PDF, or TXT</span>
        </div>
      )}

      {/* Step 2: Extracting */}
      {step === 'extracting' && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>&#129504;</div>
          <div style={{ fontSize: 14, color: '#666' }}>Analyzing <strong>{fileName}</strong>...</div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>AI is extracting records from your document. This may take a few seconds.</div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 'review' && extraction && (
        <>
          <div className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{extraction.records.length} records found</span>
                <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>
                  from {fileName} · Confidence: {extraction.confidence}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: '#888' }}>Import as:</label>
                <select value={target} onChange={e => setTarget(e.target.value as ImportTarget)}
                  style={{ padding: '3px 6px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}>
                  {(Object.keys(TARGET_LABELS) as ImportTarget[]).map(t => (
                    <option key={t} value={t}>{TARGET_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #e5e5e5', borderRadius: 4 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', width: 30 }}>
                      <input type="checkbox" checked={selectedRows.size === extraction.records.length} onChange={toggleAll} />
                    </th>
                    <th style={{ padding: '6px 8px' }}>Name</th>
                    <th style={{ padding: '6px 8px' }}>Email</th>
                    <th style={{ padding: '6px 8px' }}>Phone</th>
                    <th style={{ padding: '6px 8px' }}>Domain</th>
                    {target === 'jobs' && <th style={{ padding: '6px 8px' }}>Job #</th>}
                    <th style={{ padding: '6px 8px' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {extraction.records.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', opacity: selectedRows.has(i) ? 1 : 0.4 }}>
                      <td style={{ padding: '5px 8px' }}>
                        <input type="checkbox" checked={selectedRows.has(i)} onChange={() => toggleRow(i)} />
                      </td>
                      <td style={{ padding: '5px 8px', fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: '5px 8px', color: '#666' }}>{r.email ?? '—'}</td>
                      <td style={{ padding: '5px 8px', color: '#666' }}>{r.phone ?? '—'}</td>
                      <td style={{ padding: '5px 8px', color: '#666' }}>{r.domain ?? '—'}</td>
                      {target === 'jobs' && <td style={{ padding: '5px 8px', color: '#666' }}>{r.jobNumber ?? '—'}</td>}
                      <td style={{ padding: '5px 8px', color: '#999', fontSize: 11 }}>{r.notes ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888' }}>{selectedRows.size} of {extraction.records.length} selected</span>
            <button className="btn btn-primary" onClick={handleConfirmImport} disabled={selectedRows.size === 0}>
              Import {selectedRows.size} {TARGET_LABELS[target]}
            </button>
          </div>
        </>
      )}

      {/* Step 4: Importing */}
      {step === 'importing' && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 14, color: '#666' }}>Importing records...</div>
        </div>
      )}

      {/* Step 5: Done */}
      {step === 'done' && result && (
        <div className="card" style={{ borderLeft: '3px solid #4caf50' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>Import Complete</h3>
          <div style={{ display: 'flex', gap: 20, fontSize: 13 }}>
            <div><span style={{ fontWeight: 700, color: '#2e7d32' }}>{result.created}</span> created</div>
            <div><span style={{ fontWeight: 700, color: '#1565c0' }}>{result.updated}</span> updated</div>
            <div><span style={{ fontWeight: 700, color: '#999' }}>{result.skipped}</span> skipped</div>
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#e65100' }}>
              {result.errors.length} errors: {result.errors.map(e => `Row ${e.row}: ${e.error}`).join('; ')}
            </div>
          )}
          <button className="btn btn-sm btn-outline" style={{ marginTop: 12 }} onClick={reset}>Import another file</button>
        </div>
      )}
    </div>
  )
}
