import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import type { JobsInlineField } from '../jobs-inline-edit'

type Props = {
  jobId: string
  field: JobsInlineField
  editMode: boolean
  active: boolean
  saving: boolean
  error: string | null
  display: string
  draft: string
  onActivate: () => void
  onDraftChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  /** When true, blur should not auto-save (select/date open interactions). */
  suppressBlurSave?: boolean
  children?: ReactNode
  mono?: boolean
  ariaLabel: string
}

const idleEditableStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  margin: 0,
  padding: '4px 6px',
  border: '1px solid transparent',
  borderRadius: 4,
  background: 'transparent',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  cursor: 'text',
  minHeight: 28,
}

const hoverHintStyle: CSSProperties = {
  ...idleEditableStyle,
  borderColor: '#dbe3f0',
  background: '#f8fafc',
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid #93c5fd',
  borderRadius: 4,
  font: 'inherit',
  background: '#fff',
  outline: 'none',
  boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.15)',
}

/**
 * Jobs-list inline field.
 * Edit mode OFF → plain text. Edit mode ON → subtle interactive cell; click opens editor.
 */
export function JobsInlineFieldCell({
  jobId,
  field,
  editMode,
  active,
  saving,
  error,
  display,
  draft,
  onActivate,
  onDraftChange,
  onSave,
  onCancel,
  suppressBlurSave = false,
  children,
  mono = false,
  ariaLabel,
}: Props) {
  if (!editMode) {
    return (
      <span
        style={{
          fontFamily: mono ? 'monospace' : undefined,
          fontSize: mono ? 12 : undefined,
        }}
      >
        {display}
      </span>
    )
  }

  if (active) {
    return (
      <div
        data-testid={`job-inline-editor-${jobId}-${field}`}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', minWidth: 0 }}
      >
        {children ?? (
          <input
            autoFocus
            aria-label={ariaLabel}
            value={draft}
            disabled={saving}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSave()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
            onBlur={() => {
              if (suppressBlurSave || saving) return
              onSave()
            }}
            style={{
              ...inputStyle,
              fontFamily: mono ? 'monospace' : undefined,
              fontSize: mono ? 12 : 13,
              opacity: saving ? 0.7 : 1,
            }}
          />
        )}
        {saving ? (
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>Saving…</div>
        ) : null}
        {error ? (
          <div role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{error}</div>
        ) : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-testid={`job-inline-cell-${jobId}-${field}`}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onActivate()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onActivate()
        }
      }}
      style={{
        ...hoverHintStyle,
        fontFamily: mono ? 'monospace' : undefined,
        fontSize: mono ? 12 : undefined,
        color: display === '—' ? '#9ca3af' : 'inherit',
      }}
      title="Click to edit"
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {display}
        </span>
        <span aria-hidden style={{ color: '#94a3b8', fontSize: 11 }}>✎</span>
      </span>
    </button>
  )
}
