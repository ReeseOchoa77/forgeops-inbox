import {
  buildClassificationEvidenceViewModel,
  extractN8nReviewReasons,
  type ClassificationEvidenceRecord,
} from '../../../../packages/shared/src/reference/classification-evidence-display'

type Props = {
  evidence: unknown
  mailboxCategory?: string | null
  routingHints?: unknown
  /** Shown next to confidence when no evidence-specific label applies. */
  confidence?: number | null
}

function formatSenderStatus(status: string | null): string {
  if (!status) return 'Unknown'
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatAdjustment(value: number | null): string {
  if (value == null) return '0'
  if (value > 0) return `+${value}`
  return String(value)
}

/** Email Review evidence panel — presents n8n decision evidence only (no recompute). */
export function ClassificationEvidencePanel({
  evidence,
  mailboxCategory,
  routingHints,
  confidence,
}: Props) {
  const vm = buildClassificationEvidenceViewModel(evidence, mailboxCategory)
  const n8nReasons = extractN8nReviewReasons(routingHints)

  if (!vm && n8nReasons.length === 0) return null

  return (
    <div style={{ background: '#f8f9fa', border: '1px solid #eee', borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
      {vm && vm.format === 'legacy_weighted' && (
        <LegacyWeightedEvidence evidence={evidence as ClassificationEvidenceRecord} vm={vm} />
      )}

      {vm && vm.format === 'new_flags' && (
        <NewFlagEvidence vm={vm} confidence={confidence} />
      )}

      {vm && vm.format === 'unknown' && (
        <div style={{ fontSize: 12, color: '#666' }}>Classification evidence present (unrecognized format).</div>
      )}

      {n8nReasons.length > 0 && (
        <div style={{ marginTop: vm ? 10 : 0, paddingTop: vm ? 8 : 0, borderTop: vm ? '1px solid #eee' : undefined }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Review reasons
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#555', lineHeight: 1.5 }}>
            {n8nReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function LegacyWeightedEvidence({
  evidence,
  vm,
}: {
  evidence: ClassificationEvidenceRecord
  vm: NonNullable<ReturnType<typeof buildClassificationEvidenceViewModel>>
}) {
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Classification Evidence (legacy weighted)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {(['content', 'sender', 'signature', 'job', 'subject'] as const).map((key) => {
          const signal = evidence[key]
          if (!signal || typeof signal !== 'object') return null
          const s = signal as { probability?: number; weight?: number; contribution?: number; explanation?: string; status?: string }
          const pct = Math.round((s.probability ?? 0) * 100)
          const contrib = Math.round((s.contribution ?? 0) * 100)
          const weight = s.weight ?? 0
          const barColor = pct >= 70 ? '#4caf50' : pct >= 40 ? '#ff9800' : '#e0e0e0'
          return (
            <div key={key} style={{ fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontWeight: 600, textTransform: 'capitalize', color: '#555' }}>{key}</span>
                <span style={{ color: '#888' }}>
                  {pct}% <span style={{ color: '#bbb', fontSize: 10 }}>({Math.round(weight * 100)}% wt)</span>
                </span>
              </div>
              <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: '#999', lineHeight: 1.3 }}>
                {s.explanation ?? `Contributes ${contrib}%`}
                {key === 'sender' && s.status && (
                  <span style={{ marginLeft: 4, fontWeight: 500, color: '#555' }}>({s.status})</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {vm.legacyFinalBusinessProbability != null && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>Final Business Probability</span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color:
                vm.legacyFinalBusinessProbability >= 0.85
                  ? '#2e7d32'
                  : vm.legacyFinalBusinessProbability <= 0.2
                    ? '#6a1b9a'
                    : '#f57f17',
            }}
          >
            {Math.round(vm.legacyFinalBusinessProbability * 100)}%
          </span>
        </div>
      )}
    </>
  )
}

function NewFlagEvidence({
  vm,
  confidence,
}: {
  vm: NonNullable<ReturnType<typeof buildClassificationEvidenceViewModel>>
  confidence?: number | null
}) {
  const semantic = vm.signals.filter((s) => s.key === 'content' || s.key === 'subject' || s.key === 'job')
  const sender = vm.signals.find((s) => s.key === 'sender')
  const signature = vm.signals.find((s) => s.key === 'signature')

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Classification
          </div>
          {vm.categoryLabel && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 700,
                background: vm.categoryLabel === 'BUSINESS' ? '#e3f2fd' : '#f3e5f5',
                color: vm.categoryLabel === 'BUSINESS' ? '#1565c0' : '#6a1b9a',
              }}
            >
              {vm.categoryLabel}
            </span>
          )}
        </div>
        {confidence != null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>{vm.confidenceLabel}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{Math.round(confidence * 100)}%</div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 2 }}>Decision</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#222' }}>{vm.decisionTitle}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.4 }}>{vm.decisionSummary}</div>
      </div>

      {vm.showOverrideBanner && (
        <div
          style={{
            background: '#fff3e0',
            border: '1px solid #ffcc80',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 8,
            fontSize: 12,
            color: '#e65100',
            fontWeight: 600,
          }}
        >
          Confirmed personal sender overridden — Requires Review
        </div>
      )}

      {vm.showConfirmedSenderBanner && !vm.showOverrideBanner && (
        <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
          {sender?.status ? formatSenderStatus(sender.status) : 'Confirmed sender'} determined classification.
          Cumulative scoring was not used.
        </div>
      )}

      {vm.showStrongSignals && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Strong signals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {semantic.map((s) => (
              <div key={s.key} style={{ fontSize: 12, color: '#444', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 14, textAlign: 'center', color: s.strongFlag ? '#2e7d32' : '#bbb' }}>
                  {s.strongFlag ? '✓' : '○'}
                </span>
                <span style={{ fontWeight: 600, minWidth: 64 }}>{s.label}</span>
                <span style={{ color: '#666' }}>
                  {s.probabilityPct != null ? `${s.probabilityPct}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sender && (
        <div style={{ marginBottom: 8, fontSize: 12, color: '#555' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 2 }}>Sender</div>
          <div>
            {formatSenderStatus(sender.status)}
            {vm.showCumulativeBreakdown && (
              <span style={{ color: '#888' }}>
                {' '}
                · Adjustment: {formatAdjustment(sender.cumulativeAdjustment)}
              </span>
            )}
          </div>
        </div>
      )}

      {vm.showCumulativeBreakdown && vm.cumulative && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e8e8e8',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Cumulative evidence score
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', fontSize: 12, color: '#444' }}>
            <span>Content</span>
            <span style={{ fontWeight: 600 }}>{vm.cumulative.contentPoints ?? '—'} points</span>
            <span>Subject</span>
            <span style={{ fontWeight: 600 }}>{vm.cumulative.subjectPoints ?? '—'} points</span>
            <span>Job</span>
            <span style={{ fontWeight: 600 }}>{vm.cumulative.jobPoints ?? '—'} points</span>
            <span>Sender adjustment</span>
            <span style={{ fontWeight: 600 }}>{formatAdjustment(vm.cumulative.senderAdjustment)}</span>
          </div>
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600, color: '#333' }}>
              {vm.cumulative.total ?? '—'} / {vm.cumulative.threshold ?? 150} required
            </span>
            <span style={{ fontWeight: 700, color: vm.categoryLabel === 'BUSINESS' ? '#1565c0' : '#6a1b9a' }}>
              → {vm.categoryLabel === 'BUSINESS' ? 'Business' : vm.categoryLabel === 'PERSONAL' ? 'Personal' : '—'}
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
            Evidence score (not a probability percentage)
          </div>
        </div>
      )}

      {signature && !signature.includedInDecision && (
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
          Signature excluded from classification
          {signature.probabilityPct != null ? ` (${signature.probabilityPct}%)` : ''}.
        </div>
      )}

      {vm.requiresReviewHint && (
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e65100', marginTop: 6 }}>Requires Review</div>
      )}
    </>
  )
}
