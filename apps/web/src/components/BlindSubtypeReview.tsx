import { useEffect, useState } from 'react'
import { businessTypeLabels } from './Badges'
import type { BlindSubtypePacket, SubtypeVerificationResult } from '../api'

export const BLIND_REVIEW_CONTRACT = {
  prompt: 'What is the primary business purpose of this email?',
  ambiguousLabel: 'Ambiguous / insufficient information',
  nextKey: 'N',
  revealsStoredSubtypeOnlyAfterSubmit: true,
} as const

const AMBIGUITY_REASONS: Array<{ id: string; label: string }> = [
  { id: 'MULTI_PURPOSE', label: 'Genuinely multi-purpose' },
  { id: 'INSUFFICIENT_MESSAGE', label: 'Insufficient current message' },
  { id: 'MISSING_THREAD', label: 'Missing thread context' },
  { id: 'TAXONOMY_GAP', label: 'Taxonomy gap' },
  { id: 'OTHER', label: 'Other' },
]

export function BlindSubtypeReview({
  packet,
  loading,
  busy,
  reveal,
  progress,
  onSubmitSubtype,
  onSubmitAmbiguous,
  onNext,
  onClose,
}: {
  packet: BlindSubtypePacket | null
  loading: boolean
  busy: boolean
  reveal: SubtypeVerificationResult | null
  progress: { reviewed: number; target: number; remaining: number; labeled: number; ambiguous: number }
  onSubmitSubtype: (businessType: string) => void
  onSubmitAmbiguous: (reason: string) => void
  onNext: () => void
  onClose: () => void
}) {
  const [choice, setChoice] = useState('')
  const [ambiguity, setAmbiguity] = useState('')

  useEffect(() => {
    setChoice('')
    setAmbiguity('')
  }, [packet?.classificationId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'n' && event.key !== 'N') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return
      }
      if (!reveal) return
      event.preventDefault()
      onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reveal, onNext])

  return (
    <aside style={{
      width: 520,
      maxWidth: '100%',
      borderLeft: '1px solid #e5e5e5',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      flexShrink: 0,
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Blind subtype validation</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            Reviewed {progress.reviewed} / {progress.target}
            {' · '}{progress.labeled} labeled
            {' · '}{progress.ambiguous} ambiguous
            {' · '}{progress.remaining} remaining
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close validation" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888' }}>
          &times;
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14, fontSize: 12 }}>
        {loading || !packet ? (
          <p style={{ color: '#888' }}>Loading email evidence…</p>
        ) : (
          <>
            <p style={{ marginTop: 0, color: '#555' }}>
              Choose the primary business purpose from the email. The stored subtype stays hidden until you submit.
            </p>
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <div><strong>Subject:</strong> {packet.subject || '(no subject)'}</div>
              <div><strong>From:</strong> {packet.sender.name ? `${packet.sender.name} ` : ''}&lt;{packet.sender.email}&gt;</div>
              <div>
                <strong>Job:</strong>{' '}
                {packet.job ? `${packet.job.jobNumber} ${packet.job.name}`.trim() : 'None'}
              </div>
              <div>
                <strong>Attachments:</strong>{' '}
                {packet.attachmentNames.length > 0 ? packet.attachmentNames.join(', ') : 'None'}
              </div>
              <div>
                <strong>Current message</strong>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 4, color: '#222', lineHeight: 1.45 }}>
                  {packet.currentMessage || '(empty)'}
                </div>
              </div>
              <div>
                <strong>Recent thread</strong>
                {packet.thread.length === 0 ? (
                  <div style={{ color: '#888' }}>None</div>
                ) : (
                  packet.thread.map((row) => (
                    <div key={`${row.senderEmail}-${row.subject}-${row.snippet}`} style={{ color: '#444', marginTop: 4 }}>
                      {row.senderEmail} · {row.subject} · {row.snippet}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ fontWeight: 700, marginBottom: 8 }}>{BLIND_REVIEW_CONTRACT.prompt}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {Object.entries(businessTypeLabels).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={busy || Boolean(reveal)}
                  onClick={() => setChoice(key)}
                  style={{
                    fontSize: 11,
                    padding: '5px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: choice === key ? '1px solid #1a1a2e' : '1px solid #ddd',
                    background: choice === key ? '#1a1a2e' : '#fff',
                    color: choice === key ? '#fff' : '#333',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || !choice || Boolean(reveal)}
              onClick={() => onSubmitSubtype(choice)}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 4, border: '1px solid #1a1a2e', background: '#1a1a2e', color: '#fff', cursor: 'pointer' }}
            >
              Save label
            </button>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{BLIND_REVIEW_CONTRACT.ambiguousLabel}</div>
              <select
                value={ambiguity}
                onChange={(event) => setAmbiguity(event.target.value)}
                disabled={busy || Boolean(reveal)}
                aria-label="Why this email is ambiguous"
                style={{ fontSize: 12, marginRight: 8 }}
              >
                <option value="">Why…</option>
                {AMBIGUITY_REASONS.map((reason) => (
                  <option key={reason.id} value={reason.id}>{reason.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !ambiguity || Boolean(reveal)}
                onClick={() => onSubmitAmbiguous(ambiguity)}
                style={{ fontSize: 12, padding: '6px 10px', borderRadius: 4, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}
              >
                Save ambiguous
              </button>
            </div>

            {reveal && (
              <div style={{ marginTop: 16, padding: 10, background: '#f7f7f8', borderRadius: 6 }} data-testid="subtype-comparison">
                <div><strong>Human label:</strong> {reveal.ambiguous ? `Ambiguous (${reveal.ambiguityReason})` : reveal.humanLabel}</div>
                <div><strong>Existing production subtype:</strong> {reveal.productionSubtype ?? '—'}</div>
                <div>
                  <strong>Match:</strong>{' '}
                  {reveal.matchesProduction == null ? 'n/a' : reveal.matchesProduction ? 'Yes' : 'No'}
                </div>
                <div><strong>Existing confidence:</strong> {reveal.confidence == null ? '—' : `${Math.round(reveal.confidence * 100)}%`}</div>
                <div><strong>Existing competing subtype:</strong> {reveal.competingType ?? 'null'}</div>
                <div><strong>Classifier version:</strong> {reveal.classifierVersion ?? '—'}</div>
                {reveal.evidence.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                    {reveal.evidence.map((marker) => (
                      <li key={marker}>{marker}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={onNext}
                  style={{ marginTop: 10, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 4, border: '1px solid #1a1a2e', background: '#fff', cursor: 'pointer' }}
                >
                  Next (N)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
