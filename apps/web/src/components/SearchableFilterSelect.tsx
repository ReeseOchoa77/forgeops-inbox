import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

export type SearchableFilterOption = {
  value: string
  label: string
  /** Extra text matched by search (e.g. job number). */
  searchText?: string
}

type Props = {
  ariaLabel: string
  value: string
  onChange: (value: string) => void
  options: SearchableFilterOption[]
  /** Shown when value is empty. */
  emptyLabel?: string
  searchPlaceholder?: string
  /** Max width of the trigger button. */
  maxWidth?: number
  /** Highlight when a non-empty filter is active. */
  active?: boolean
  testId?: string
}

/**
 * Compact filter dropdown with an in-menu search field.
 * Filters options client-side (case-insensitive). Single-select.
 */
export function SearchableFilterSelect({
  ariaLabel,
  value,
  onChange,
  options,
  emptyLabel = 'All',
  searchPlaceholder = 'Search…',
  maxWidth = 200,
  active: activeProp,
  testId,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      const hay = `${o.label} ${o.searchText ?? ''} ${o.value}`.toLowerCase()
      return hay.includes(q)
    })
  }, [options, query])

  const selectedLabel =
    value === ''
      ? emptyLabel
      : options.find((o) => o.value === value)?.label ?? value

  const isActive = activeProp ?? Boolean(value)
  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }} data-testid={testId}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        title={selectedLabel}
        style={{
          ...triggerStyle,
          maxWidth,
          border: isActive ? '1px solid #1a1a2e' : '1px solid #ddd',
          background: isActive ? '#f3f4f6' : '#fff',
          fontWeight: isActive ? 600 : 500,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            textAlign: 'left',
          }}
        >
          {selectedLabel}
        </span>
        <span style={{ opacity: 0.55, marginLeft: 4, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={`${ariaLabel} search`}
              style={searchInputStyle}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false)
                  setQuery('')
                }
              }}
            />
          </div>
          <div style={{ overflow: 'auto', maxHeight: 240 }}>
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              onClick={() => pick('')}
              style={optionStyle(value === '')}
            >
              {emptyLabel}
            </button>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: '12px 10px',
                  fontSize: 12,
                  color: '#6b7280',
                  textAlign: 'center',
                }}
              >
                No matches
              </div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={value === o.value}
                  onClick={() => pick(o.value)}
                  style={optionStyle(value === o.value)}
                  title={o.label}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: '6px 10px',
  fontSize: 12,
  borderRadius: 6,
  color: '#374151',
  cursor: 'pointer',
  height: 32,
  boxSizing: 'border-box',
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 50,
  marginTop: 4,
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  width: 280,
  maxHeight: 320,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const searchInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid #ddd',
  borderRadius: 4,
  height: 30,
}

function optionStyle(selected: boolean): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: 12,
    border: 'none',
    borderBottom: '1px solid #f5f5f5',
    background: selected ? '#eef2ff' : '#fff',
    color: '#111827',
    cursor: 'pointer',
    fontWeight: selected ? 600 : 400,
  }
}
