import { useState, useEffect, useRef, useCallback } from 'react'

export type Breakpoint = 'phone' | 'tablet' | 'desktop'

function getBreakpoint(): Breakpoint {
  const w = window.innerWidth
  if (w <= 768) return 'phone'
  if (w <= 1024) return 'tablet'
  return 'desktop'
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint)
  const rafRef = useRef(0)

  const handleResize = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setBp(getBreakpoint())
    })
  }, [])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [handleResize])

  return bp
}
