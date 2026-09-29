import { useEffect, useState, type CSSProperties } from 'react'
import {
  api,
  type JobDocumentControl,
  type JobDocumentRecordType,
  type JobDocumentSubmittalStatus,
  type JobLibraryFile,
  type JobWorkPackage,
} from '../api'

const TYPE_OPTIONS: Array<{ value: JobDocumentRecordType; label: string }> = [
  { value: 'OTHER', label: 'Other' },
  { value: 'ARCHITECTURAL_DRAWING', label: 'Architectural drawing' },
  { value: 'STRUCTURAL_DRAWING', label: 'Structural drawing' },
  { value: 'CIVIL_DRAWING', label: 'Civil drawing' },
  { value: 'SPECIFICATION', label: 'Specification' },
  { value: 'SHOP_DRAWING', label: 'Shop drawing' },
  { value: 'SUBMITTAL', label: 'Submittal' },
  { value: 'RFI_DOCUMENT', label: 'RFI' },
  { value: 'ASI', label: 'ASI' },
  { value: 'BULLETIN', label: 'Bulletin' },
  { value: 'ADDENDUM', label: 'Addendum' },
  { value: 'PROPOSAL_QUOTE', label: 'Proposal / Quote' },
  { value: 'PURCHASE_ORDER', label: 'Purchase order' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'CHANGE_ORDER', label: 'Change order' },
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'DELIVERY_DOCUMENT', label: 'Delivery document' },
]

const SUBMITTAL_OPTIONS: Array<{ value: JobDocumentSubmittalStatus; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'APPROVED_AS_NOTED', label: 'Approved as noted' },
  { value: 'REVISE_AND_RESUBMIT', label: 'Revise and resubmit' },
  { value: 'REJECTED', label: 'Rejected' },
]

function allowsSubmittal(type: JobDocumentRecordType): boolean {
  return type === 'SHOP_DRAWING' || type === 'SUBMITTAL'
}

type Props = {
  workspaceId: string
  jobId: string
  file: JobLibraryFile
  packages: JobWorkPackage[]
  classifiedPeers: JobLibraryFile[]
  canEdit: boolean
  onSaved: (control: JobDocumentControl | null) => void
  onClose: () => void
}

export function JobDocumentControlForm({
  workspaceId,
  jobId,
  file,
  packages,
  classifiedPeers,
  canEdit,
  onSaved,
  onClose,
}: Props) {
  const existing = file.control
  const [documentType, setDocumentType] = useState<JobDocumentRecordType>(existing?.documentType ?? 'OTHER')
  const [documentNumber, setDocumentNumber] = useState(existing?.documentNumber ?? '')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [revision, setRevision] = useState(existing?.revision ?? '')
  const [documentDate, setDocumentDate] = useState(existing?.documentDate ?? '')
  const [workPackageId, setWorkPackageId] = useState(existing?.workPackageId ?? '')
  const [submittalStatus, setSubmittalStatus] = useState<JobDocumentSubmittalStatus | ''>(
    existing?.submittalStatus ?? ''
  )
  const [supersedesId, setSupersedesId] = useState(existing?.supersedesId ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDocumentType(existing?.documentType ?? 'OTHER')
    setDocumentNumber(existing?.documentNumber ?? '')
    setTitle(existing?.title ?? '')
    setRevision(existing?.revision ?? '')
    setDocumentDate(existing?.documentDate ?? '')
    setWorkPackageId(existing?.workPackageId ?? '')
    setSubmittalStatus(existing?.submittalStatus ?? '')
    setSupersedesId(existing?.supersedesId ?? '')
    setNotes(existing?.notes ?? '')
  }, [existing, file.id])

  const peers = classifiedPeers.filter(
    (p) => p.control && p.control.id !== existing?.id && `${p.sourceType}:${p.id}` !== `${file.sourceType}:${file.id}`
  )

  const save = async () => {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.upsertJobDocumentControl(workspaceId, jobId, {
        sourceType: file.sourceType,
        sourceId: file.id,
        documentType,
        documentNumber: documentNumber.trim() || null,
        title: title.trim() || null,
        revision: revision.trim() || null,
        documentDate: documentDate || null,
        workPackageId: workPackageId || null,
        submittalStatus: allowsSubmittal(documentType)
          ? (submittalStatus || null)
          : null,
        supersedesId: supersedesId || null,
        notes: notes.trim() || null,
        isCurrent: true,
      })
      onSaved(res.control)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save document details')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (!existing || !canEdit) return
    if (!confirm('Remove document details? The file itself will not be deleted.')) return
    setBusy(true)
    setError(null)
    try {
      await api.clearJobDocumentControl(workspaceId, jobId, existing.id)
      onSaved(null)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear details')
    } finally {
      setBusy(false)
    }
  }

  const field: CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid #d0d5dd',
    borderRadius: 4,
    fontSize: 12,
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      marginTop: 8,
      padding: 10,
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      background: '#fafafa',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>
        {existing ? 'Edit document details' : 'Add document details'}
      </div>
      {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>}
      <select value={documentType} disabled={!canEdit || busy} onChange={(e) => setDocumentType(e.target.value as JobDocumentRecordType)} style={field}>
        {TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <input value={documentNumber} disabled={!canEdit || busy} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="Document number (e.g. S2.1)" style={field} />
      <input value={title} disabled={!canEdit || busy} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={field} />
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={revision} disabled={!canEdit || busy} onChange={(e) => setRevision(e.target.value)} placeholder="Rev" style={{ ...field, flex: 1 }} />
        <input type="date" value={documentDate} disabled={!canEdit || busy} onChange={(e) => setDocumentDate(e.target.value)} style={{ ...field, flex: 1.4 }} />
      </div>
      <select value={workPackageId} disabled={!canEdit || busy} onChange={(e) => setWorkPackageId(e.target.value)} style={field}>
        <option value="">Job-level (no package)</option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {allowsSubmittal(documentType) && (
        <select
          value={submittalStatus}
          disabled={!canEdit || busy}
          onChange={(e) => setSubmittalStatus(e.target.value as JobDocumentSubmittalStatus | '')}
          style={field}
        >
          <option value="">Submittal status…</option>
          {SUBMITTAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
      <select value={supersedesId} disabled={!canEdit || busy} onChange={(e) => setSupersedesId(e.target.value)} style={field}>
        <option value="">Does not supersede another document</option>
        {peers.map((p) => (
          <option key={p.control!.id} value={p.control!.id}>
            {[p.control!.documentNumber, p.control!.title || p.filename, p.control!.revision ? `Rev ${p.control!.revision}` : null]
              .filter(Boolean)
              .join(' · ')}
          </option>
        ))}
      </select>
      <textarea
        value={notes}
        disabled={!canEdit || busy}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        rows={2}
        style={{ ...field, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 4, border: 'none', background: '#1565c0', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
          >
            Save
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          style={{ fontSize: 11, padding: '5px 10px', borderRadius: 4, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}
        >
          Cancel
        </button>
        {canEdit && existing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 4, border: '1px solid #e5e7eb', background: '#fff', color: '#b91c1c', cursor: 'pointer', marginLeft: 'auto' }}
          >
            Clear details
          </button>
        )}
      </div>
    </div>
  )
}

export function DocumentControlSummary({ control }: { control: JobDocumentControl }) {
  return (
    <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.4 }}>
      <div style={{ fontWeight: 600 }}>
        {[control.documentNumber, control.title].filter(Boolean).join(' · ') || control.documentTypeLabel}
        {control.revision ? ` · Rev ${control.revision}` : ''}
      </div>
      <div style={{ color: '#6b7280' }}>
        {control.documentTypeLabel}
        {control.submittalStatusLabel ? ` · ${control.submittalStatusLabel}` : ''}
        {control.workPackageName ? ` · ${control.workPackageName}` : ''}
        {!control.isCurrent ? ' · Superseded' : ''}
      </div>
    </div>
  )
}
