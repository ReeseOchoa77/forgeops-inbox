/**
 * Model Selection Panel for Job Matcher historical evaluations.
 * Registry-driven — not hardcoded to exactly three policies.
 */
import type { CSSProperties } from 'react'
import {
  getProductionJobMatchIdentityPolicy,
  listEvaluationSelectablePolicies,
  type JobMatchIdentityPolicyId,
  type JobMatchPolicyRegistryEntry,
} from '@forgeops/shared/jobs/job-match-policy-registry'

export type ModelSelectionMode = 'SINGLE' | 'COMPARE'

export type ModelSelectionState = {
  mode: ModelSelectionMode
  selectedPolicyIds: JobMatchIdentityPolicyId[]
}

export function defaultModelSelection(): ModelSelectionState {
  const production = getProductionJobMatchIdentityPolicy()
  return { mode: 'SINGLE', selectedPolicyIds: [production] }
}

/** Map legacy evaluationMode dropdown values onto the new panel state. */
export function modelSelectionFromLegacyEvalMode(
  evaluationMode: string | null | undefined
): ModelSelectionState {
  const production = getProductionJobMatchIdentityPolicy()
  switch (evaluationMode) {
    case 'COMPARE_V2_1':
      return {
        mode: 'COMPARE',
        selectedPolicyIds: [production, 'CONTEXT_AWARE_V2_1'],
      }
    case 'COMPARE_V2_2':
      return {
        mode: 'COMPARE',
        selectedPolicyIds: [production, 'CONTEXT_AWARE_V2_2'],
      }
    case 'COMPARE_ALL':
      return {
        mode: 'COMPARE',
        selectedPolicyIds: [
          production,
          'CONTEXT_AWARE_V2_1',
          'CONTEXT_AWARE_V2_2',
        ],
      }
    case 'COMPARE_V1':
      return {
        mode: 'COMPARE',
        selectedPolicyIds: ['BASELINE', 'CONTEXT_AWARE_V1'],
      }
    case 'COMPARE_V2':
      return {
        mode: 'COMPARE',
        selectedPolicyIds: ['CONTEXT_AWARE_V1', production],
      }
    default:
      return defaultModelSelection()
  }
}

export function canRunModelSelection(state: ModelSelectionState): boolean {
  if (state.mode === 'SINGLE') return state.selectedPolicyIds.length === 1
  return state.selectedPolicyIds.length >= 2
}

export function JobMatcherModelSelectionPanel({
  value,
  onChange,
  disabled,
}: {
  value: ModelSelectionState
  onChange: (next: ModelSelectionState) => void
  disabled?: boolean
}) {
  const options = listEvaluationSelectablePolicies()
  const production = getProductionJobMatchIdentityPolicy()

  const setMode = (mode: ModelSelectionMode) => {
    if (mode === 'SINGLE') {
      const keep =
        value.selectedPolicyIds.find((id) =>
          options.some((o) => o.id === id)
        ) ?? production
      onChange({ mode: 'SINGLE', selectedPolicyIds: [keep] })
      return
    }
    // Entering compare: keep current selection if ≥2, else production + first other.
    if (value.selectedPolicyIds.length >= 2) {
      onChange({ mode: 'COMPARE', selectedPolicyIds: value.selectedPolicyIds })
      return
    }
    const first = value.selectedPolicyIds[0] ?? production
    const second =
      options.find((o) => o.id !== first)?.id ??
      options.find((o) => o.id === production)?.id ??
      options[0]?.id
    const ids = second && second !== first ? [first, second] : [first]
    onChange({ mode: 'COMPARE', selectedPolicyIds: ids })
  }

  const selectSingle = (id: JobMatchIdentityPolicyId) => {
    onChange({ mode: 'SINGLE', selectedPolicyIds: [id] })
  }

  const toggleCompare = (id: JobMatchIdentityPolicyId) => {
    const set = new Set(value.selectedPolicyIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    const next = options
      .map((o) => o.id)
      .filter((pid) => set.has(pid))
    onChange({ mode: 'COMPARE', selectedPolicyIds: next })
  }

  const compareReady = canRunModelSelection(value)

  return (
    <div
      data-testid="job-matcher-model-selection"
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '10px 12px',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontWeight: 650, fontSize: 12 }}>Model selection</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <ModeChip
            active={value.mode === 'SINGLE'}
            disabled={disabled}
            onClick={() => setMode('SINGLE')}
            label="Single model"
            testId="job-matcher-mode-single"
          />
          <ModeChip
            active={value.mode === 'COMPARE'}
            disabled={disabled}
            onClick={() => setMode('COMPARE')}
            label="Compare models"
            testId="job-matcher-mode-compare"
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 8,
        }}
      >
        {options.map((entry) =>
          value.mode === 'SINGLE' ? (
            <SingleCard
              key={entry.id}
              entry={entry}
              selected={value.selectedPolicyIds[0] === entry.id}
              disabled={disabled}
              onSelect={() => selectSingle(entry.id)}
            />
          ) : (
            <CompareCard
              key={entry.id}
              entry={entry}
              checked={value.selectedPolicyIds.includes(entry.id)}
              disabled={disabled}
              onToggle={() => toggleCompare(entry.id)}
            />
          )
        )}
      </div>

      {value.mode === 'COMPARE' && !compareReady ? (
        <div
          data-testid="job-matcher-compare-min-hint"
          style={{ fontSize: 11, color: '#92400e' }}
        >
          Select at least two models to run a comparison.
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          Production remains {production}. Experimental models never change
          production assignment.
        </div>
      )}
    </div>
  )
}

function ModeChip({
  active,
  disabled,
  onClick,
  label,
  testId,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...chipStyle,
        background: active ? '#111827' : '#fff',
        color: active ? '#fff' : '#111827',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  )
}

function SingleCard({
  entry,
  selected,
  disabled,
  onSelect,
}: {
  entry: JobMatchPolicyRegistryEntry
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`job-matcher-model-single-${entry.id}`}
      disabled={disabled}
      onClick={onSelect}
      style={{
        ...cardStyle,
        borderColor: selected ? '#111827' : '#e5e7eb',
        background: selected ? '#f9fafb' : '#fff',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            marginTop: 2,
            borderRadius: '50%',
            border: selected ? '4px solid #111827' : '2px solid #9ca3af',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        />
        <CardBody entry={entry} />
      </div>
    </button>
  )
}

function CompareCard({
  entry,
  checked,
  disabled,
  onToggle,
}: {
  entry: JobMatchPolicyRegistryEntry
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <label
      data-testid={`job-matcher-model-compare-${entry.id}`}
      style={{
        ...cardStyle,
        borderColor: checked ? '#111827' : '#e5e7eb',
        background: checked ? '#f9fafb' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          style={{ marginTop: 2 }}
        />
        <CardBody entry={entry} />
      </div>
    </label>
  )
}

function CardBody({ entry }: { entry: JobMatchPolicyRegistryEntry }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 650, fontSize: 12 }}>{entry.displayName}</span>
        {entry.productionDefault ? (
          <span style={badge('#dcfce7', '#166534')}>Production</span>
        ) : null}
        {entry.experimental ? (
          <span style={badge('#fef3c7', '#92400e')}>Experimental</span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
        {entry.description}
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
        {entry.id}
        {entry.experimentSummary ? ` · ${entry.experimentSummary}` : ''}
      </div>
    </div>
  )
}

function badge(bg: string, color: string): CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 650,
    padding: '1px 6px',
    borderRadius: 4,
    background: bg,
    color,
  }
}

const chipStyle: CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
}

const cardStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'block',
}
