import { useEffect, useRef, useState } from 'react'
import {
  INBOX_BUSINESS_TYPE_GROUP_LABELS,
  INBOX_BUSINESS_TYPE_GROUPS,
  type InboxBusinessTypeGroup,
} from '../inbox-message-list-filters'

type Props = {
  value: InboxBusinessTypeGroup[]
  onChange: (next: InboxBusinessTypeGroup[]) => void
}

/**
 * Compact multi-select for excluding Business type groups from the Inbox list.
 * Options match canonical Inbox tabs / API businessTypeGroup values.
 */
export function InboxExcludeFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<InboxBusinessTypeGroup>>(() => new Set(value))
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) setDraft(new Set(value))
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const activeCount = value.length
  const toggle = (key: InboxBusinessTypeGroup) => {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const apply = () => {
    onChange(INBOX_BUSINESS_TYPE_GROUPS.filter((g) => draft.has(g)))
    setOpen(false)
  }

  const clear = () => {
    setDraft(new Set())
    onChange([])
    setOpen(false)
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          padding: '3px 10px',
          fontSize: 11,
          fontWeight: 500,
          borderRadius: 12,
          border: activeCount > 0 ? '1px solid #1a1a2e' : '1px solid #ddd',
          background: activeCount > 0 ? '#1a1a2e' : '#fff',
          color: activeCount > 0 ? '#fff' : '#666',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {activeCount > 0 ? `Exclude (${activeCount})` : 'Exclude'} ▾
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Exclude from Inbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 40,
            minWidth: 240,
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 12,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
            Exclude from Inbox
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {INBOX_BUSINESS_TYPE_GROUPS.map((key) => {
              const checked = draft.has(key)
              return (
                <label
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: '#333',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(key)}
                  />
                  {INBOX_BUSINESS_TYPE_GROUP_LABELS[key]}
                </label>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button
              type="button"
              onClick={clear}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 500,
                borderRadius: 6,
                border: '1px solid #ddd',
                background: '#fff',
                color: '#555',
                cursor: 'pointer',
              }}
            >
              Clear exclusions
            </button>
            <button
              type="button"
              onClick={apply}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                border: 'none',
                background: '#1a1a2e',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
