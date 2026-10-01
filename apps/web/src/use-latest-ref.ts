import { useRef } from 'react'

/**
 * Hold the latest value in a ref without putting it in effect/callback deps.
 * Use for parent callbacks (onSummaryChange, etc.) so tab load effects do not
 * re-fire when the parent re-renders with a new function identity.
 */
export function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}
