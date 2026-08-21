import {
  buildPriorityDecisionViewModel,
  type PriorityDecisionPayload,
} from '../../../../packages/shared/src/reference/priority-decision'

type Props = {
  priority?: string | null
  evidence?: unknown
  priorityDecision?: PriorityDecisionPayload | null
}

/** TEMP: hide priority UI — set true to restore Priority Reason panel. */
const SHOW_PRIORITY_UI = false

/** Email Review — n8n priority explanation (absent for historical records). */
export function PriorityDecisionPanel({ priority, evidence, priorityDecision }: Props) {
  if (!SHOW_PRIORITY_UI) return null

  const vm = buildPriorityDecisionViewModel({ priority, evidence, priorityDecision })
  if (!vm) return null

  return (
    <div
      style={{
        background: '#fff8f0',
        border: '1px solid #ffe0b2',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#e65100',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 6,
        }}
      >
        Priority Reason
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 6 }}>
        {vm.displayLabel}
      </div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 8, lineHeight: 1.4 }}>
        <span style={{ color: '#888' }}>Reason:</span> {vm.reason}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 12px',
          fontSize: 12,
          color: '#444',
        }}
      >
        {vm.showJobConfidence && vm.jobConfidencePct != null && (
          <>
            <span style={{ color: '#888' }}>Job confidence</span>
            <span style={{ fontWeight: 600 }}>{vm.jobConfidencePct}%</span>
          </>
        )}
        {vm.jobThresholdPct != null && (
          <>
            <span style={{ color: '#888' }}>Job-related threshold</span>
            <span style={{ fontWeight: 600 }}>{vm.jobThresholdPct}%</span>
          </>
        )}
        {vm.showActionRequested && vm.actionRequestedLabel != null && (
          <>
            <span style={{ color: '#888' }}>Action requested</span>
            <span style={{ fontWeight: 600 }}>{vm.actionRequestedLabel}</span>
          </>
        )}
        {vm.showDeadline && vm.deadlineLabel != null && (
          <>
            <span style={{ color: '#888' }}>Deadline</span>
            <span style={{ fontWeight: 600 }}>{vm.deadlineLabel}</span>
          </>
        )}
      </div>
    </div>
  )
}
