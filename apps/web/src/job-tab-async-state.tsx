import type { ReactNode } from 'react'

export type JobTabViewState = 'loading' | 'success' | 'error'

/**
 * Deterministic Job CRM module tab view state.
 * A failed request must never remain on Loading after the request settles.
 */
export function jobTabViewState(loading: boolean, error: string | null): JobTabViewState {
  if (loading) return 'loading'
  if (error) return 'error'
  return 'success'
}

/** True when an initial load failed and there is nothing useful to show yet. */
export function jobTabShouldShowLoadError(
  loading: boolean,
  error: string | null,
  hasRows: boolean
): boolean {
  return jobTabViewState(loading, error) === 'error' && !hasRows
}

export function JobTabLoading({ label }: { label: string }): ReactNode {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>
      {label}
    </div>
  )
}

export function JobTabLoadError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}): ReactNode {
  return (
    <div
      style={{
        padding: 24,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div style={{ color: '#b91c1c', fontSize: 13 }}>{message}</div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          fontSize: 13,
          fontWeight: 600,
          padding: '8px 14px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          background: '#fff',
          color: '#111827',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}
