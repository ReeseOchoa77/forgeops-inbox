import { useMemo, useRef, useState } from 'react'
import { api, type JobImportPreviewRow, type JobImportPreviewResponse } from '../api'

interface Props {
  workspaceId: string
  onClose: () => void
  onImported: () => void
}

type RowEdit = {
  import: boolean
  customerAction: 'LINK' | 'CREATE' | 'NONE'
  customerId: string | null
}

function statusColor(status: string): { bg: string; color: string } {
  switch (status) {
    case 'READY': return { bg: '#dcfce7', color: '#166534' }
    case 'EXISTING': return { bg: '#e5e7eb', color: '#374151' }
    case 'CONFLICT': return { bg: '#fee2e2', color: '#991b1b' }
    case 'CUSTOMER_NOT_FOUND':
    case 'CUSTOMER_AMBIGUOUS': return { bg: '#fef3c7', color: '#92400e' }
    default: return { bg: '#ffe4e6', color: '#9f1239' }
  }
}

export function JobImportView({ workspaceId, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<JobImportPreviewResponse | null>(null)
  const [edits, setEdits] = useState<Record<number, RowEdit>>({})
  const [result, setResult] = useState<{
    createdCount: number
    skippedCount: number
    errorCount: number
    errors: Array<{ rowIndex: number; error: string }>
  } | null>(null)

  const selectedCount = useMemo(() => {
    if (!preview) return 0
    return preview.rows.filter((r) => edits[r.rowIndex]?.import).length
  }, [preview, edits])

  const handleFile = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const res = await api.previewJobImport(workspaceId, file)
      setPreview(res)
      const next: Record<number, RowEdit> = {}
      for (const row of res.rows) {
        let customerAction: RowEdit['customerAction'] = 'NONE'
        let customerId: string | null = null
        if (row.customerStatus === 'MATCHED' && row.matchedCustomerId) {
          customerAction = 'LINK'
          customerId = row.matchedCustomerId
        } else {
          // NOT_FOUND / AMBIGUOUS / EMPTY: do not auto-create customers
          customerAction = 'NONE'
        }
        next[row.rowIndex] = {
          import: row.selected,
          customerAction,
          customerId,
        }
      }
      setEdits(next)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const updateEdit = (rowIndex: number, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [rowIndex]: { ...prev[rowIndex]!, ...patch },
    }))
  }

  const setAllImportable = (value: boolean) => {
    if (!preview) return
    setEdits((prev) => {
      const next = { ...prev }
      for (const row of preview.rows) {
        // Only auto-toggle READY rows; customer-review rows need explicit choice
        if (row.status !== 'READY') {
          if (!value) next[row.rowIndex] = { ...next[row.rowIndex]!, import: false }
          continue
        }
        next[row.rowIndex] = { ...next[row.rowIndex]!, import: value }
      }
      return next
    })
  }

  const confirm = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const rows = preview.rows.map((row) => {
        const edit = edits[row.rowIndex]!
        return {
          rowIndex: row.rowIndex,
          import: edit.import,
          date: row.date,
          jobNumber: row.jobNumber,
          name: row.name,
          rawCustomerName: row.rawCustomerName,
          customerAction: edit.customerAction,
          customerId: edit.customerAction === 'LINK' ? edit.customerId : null,
        }
      })
      const res = await api.confirmJobImport(workspaceId, {
        filename: preview.filename,
        rows,
      })
      setResult({
        createdCount: res.createdCount,
        skippedCount: res.skippedCount,
        errorCount: res.errorCount,
        errors: res.errors,
      })
      setStep('done')
      if (res.createdCount > 0) onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 'min(1100px, 96vw)', maxHeight: '90vh', background: '#fff', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Import Jobs</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>
              Upload XLSX/CSV (preferred) or PDF. Preview and confirm before any jobs are created.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#999', minWidth: 44, minHeight: 44 }}>&times;</button>
        </div>

        <div style={{ padding: 18, overflow: 'auto', flex: 1 }}>
          {error && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 6, fontSize: 13 }}>
              {error}
            </div>
          )}

          {step === 'upload' && (
            <div style={{ border: '1px dashed #ccc', borderRadius: 8, padding: 32, textAlign: 'center' }}>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>
                Columns: Date, Job Number, Job Name, Customer (header aliases supported).
                Job numbers stay as text (e.g. 2164B). Historical dates map to Job start date.
              </p>
              <label className="btn btn-primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'Parsing…' : 'Choose File'}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  disabled={busy}
                  style={{ display: 'none' }}
                  onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          )}

          {step === 'preview' && preview && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, fontSize: 13 }}>
                <span><strong>{preview.summary.total}</strong> rows</span>
                <span style={{ color: '#166534' }}>{preview.summary.ready} ready</span>
                <span style={{ color: '#374151' }}>{preview.summary.existing} existing</span>
                <span style={{ color: '#991b1b' }}>{preview.summary.conflict} conflict</span>
                <span style={{ color: '#92400e' }}>{preview.summary.customerReview} customer review</span>
                <span style={{ color: '#9f1239' }}>{preview.summary.invalid} invalid</span>
              </div>
              {preview.warnings.length > 0 && (
                <div style={{ marginBottom: 10, fontSize: 12, color: '#92400e' }}>
                  {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setAllImportable(true)}>Select ready</button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setAllImportable(false)}>Clear selection</button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setStep('upload')}>Upload different file</button>
              </div>
              <div style={{ overflow: 'auto', border: '1px solid #e5e5e5', borderRadius: 8, maxHeight: '55vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', textAlign: 'left', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '8px 10px' }}>Import?</th>
                      <th style={{ padding: '8px 10px' }}>Date</th>
                      <th style={{ padding: '8px 10px' }}>Job #</th>
                      <th style={{ padding: '8px 10px' }}>Job Name</th>
                      <th style={{ padding: '8px 10px' }}>Customer (file)</th>
                      <th style={{ padding: '8px 10px' }}>Matched / Action</th>
                      <th style={{ padding: '8px 10px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row: JobImportPreviewRow) => {
                      const edit = edits[row.rowIndex]!
                      const sc = statusColor(row.status)
                      const blocked = row.status === 'EXISTING' || row.status === 'CONFLICT' || row.status === 'INVALID'
                      return (
                        <tr key={row.rowIndex} style={{ borderTop: '1px solid #f0f0f0', opacity: blocked && !edit.import ? 0.75 : 1 }}>
                          <td style={{ padding: '7px 10px' }}>
                            <input
                              type="checkbox"
                              disabled={blocked}
                              checked={Boolean(edit?.import)}
                              onChange={(e) => updateEdit(row.rowIndex, { import: e.target.checked })}
                            />
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{row.date ?? '—'}</td>
                          <td style={{ padding: '7px 10px', fontWeight: 600 }}>{row.jobNumber || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{row.name || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{row.rawCustomerName ?? '—'}</td>
                          <td style={{ padding: '7px 10px', minWidth: 200 }}>
                            {blocked ? (
                              <span style={{ color: '#888' }}>{row.matchedCustomerName ?? '—'}</span>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <select
                                  value={edit.customerAction}
                                  onChange={(e) => {
                                    const action = e.target.value as RowEdit['customerAction']
                                    updateEdit(row.rowIndex, {
                                      customerAction: action,
                                      customerId:
                                        action === 'LINK'
                                          ? (edit.customerId ?? row.matchedCustomerId ?? preview.customers[0]?.id ?? null)
                                          : null,
                                    })
                                  }}
                                  style={{ fontSize: 12, padding: '3px 6px' }}
                                >
                                  <option value="NONE">Leave unassigned</option>
                                  <option value="LINK">Link existing customer</option>
                                  <option value="CREATE">Create new customer</option>
                                </select>
                                {edit.customerAction === 'LINK' && (
                                  <select
                                    value={edit.customerId ?? ''}
                                    onChange={(e) => updateEdit(row.rowIndex, { customerId: e.target.value || null })}
                                    style={{ fontSize: 12, padding: '3px 6px' }}
                                  >
                                    <option value="">Select…</option>
                                    {(row.customerCandidates.length
                                      ? row.customerCandidates.map((c) => ({ id: c.id, name: c.name }))
                                      : preview.customers
                                    ).map((c) => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                    {/* Ensure full list available */}
                                    {preview.customers
                                      .filter((c) => !row.customerCandidates.some((x) => x.id === c.id))
                                      .map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                      ))}
                                  </select>
                                )}
                                {edit.customerAction === 'CREATE' && (
                                  <span style={{ fontSize: 11, color: '#666' }}>
                                    Will create: {row.rawCustomerName || '(needs name)'}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                              fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.color,
                            }}>
                              {row.status}
                            </span>
                            {row.errors[0] && (
                              <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }}>{row.errors[0]}</div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === 'done' && result && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 8px' }}>Import complete</h3>
              <p style={{ margin: 0, color: '#555', fontSize: 14 }}>
                Created <strong>{result.createdCount}</strong>
                {' · '}Skipped <strong>{result.skippedCount}</strong>
                {' · '}Errors <strong>{result.errorCount}</strong>
              </p>
              {result.errors.length > 0 && (
                <div style={{ marginTop: 16, textAlign: 'left', maxWidth: 520, marginInline: 'auto', fontSize: 12, color: '#991b1b' }}>
                  {result.errors.slice(0, 10).map((e, i) => (
                    <div key={i}>Row {e.rowIndex}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e5e5', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'preview' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || selectedCount === 0}
              onClick={() => void confirm()}
            >
              {busy ? 'Importing…' : `Import ${selectedCount} Jobs`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
