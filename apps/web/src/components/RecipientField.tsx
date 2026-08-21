import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type EmailContactSuggestion } from '../api'
import { isValidEmail, normalizeRecipientEmail } from '../recipient-utils'

function normalizeEmail(value: string): string {
  return normalizeRecipientEmail(value)
}

interface Props {
  label: string
  workspaceId: string
  emails: string[]
  onChange: (emails: string[]) => void
  disabled?: boolean
  placeholder?: string
}

export function RecipientField({
  label,
  workspaceId,
  emails,
  onChange,
  disabled,
  placeholder,
}: Props) {
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<EmailContactSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = new Set(emails.map(normalizeEmail))

  const commitEmail = useCallback(
    (raw: string) => {
      const email = normalizeEmail(raw)
      if (!email) return
      if (!isValidEmail(email)) {
        setError('Enter a valid email address')
        return
      }
      if (selected.has(email)) {
        setDraft('')
        setError('')
        setSuggestions([])
        setOpen(false)
        return
      }
      onChange([...emails, email])
      setDraft('')
      setError('')
      setSuggestions([])
      setOpen(false)
    },
    [emails, onChange, selected]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = draft.trim()
    if (q.length < 1 || disabled) {
      setSuggestions([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      api
        .searchEmailContacts(workspaceId, q, 10)
        .then((r) => {
          const filtered = r.contacts.filter((c) => !selected.has(normalizeEmail(c.email)))
          setSuggestions(filtered)
          setOpen(filtered.length > 0)
          setActiveIndex(0)
        })
        .catch(() => {
          setSuggestions([])
          setOpen(false)
        })
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [draft, workspaceId, disabled, emails])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const removeAt = (index: number) => {
    onChange(emails.filter((_, i) => i !== index))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !draft && emails.length > 0) {
      onChange(emails.slice(0, -1))
      return
    }
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
      return
    }
    if (e.key === 'ArrowUp' && open) {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && open && suggestions[activeIndex]) {
      e.preventDefault()
      commitEmail(suggestions[activeIndex]!.email)
      return
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (draft.trim()) {
        e.preventDefault()
        commitEmail(draft)
      }
    }
  }

  return (
    <div style={{ marginBottom: 10 }} ref={wrapRef}>
      <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>{label}</label>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px', background: disabled ? '#f7f7f7' : '#fff',
        position: 'relative', minHeight: 38,
      }}>
        {emails.map((email, i) => (
          <span key={`${email}-${i}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: '#eef2ff', color: '#334', borderRadius: 999,
            padding: '3px 8px', fontSize: 12, fontWeight: 500,
          }}>
            {email}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeAt(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#889', padding: 0, lineHeight: 1, fontSize: 14 }}
                aria-label={`Remove ${email}`}
              >&times;</button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={emails.length === 0 ? (placeholder ?? 'name@company.com') : ''}
          onChange={(e) => { setDraft(e.target.value); setError('') }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) commitEmail(draft)
          }}
          style={{
            flex: 1, minWidth: 140, border: 'none', outline: 'none',
            fontSize: 13, background: 'transparent', padding: '2px 0',
          }}
        />
        {open && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 20,
            background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto',
          }}>
            {suggestions.map((s, i) => (
              <button
                key={s.email}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commitEmail(s.email) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 'none', cursor: 'pointer',
                  background: i === activeIndex ? '#f3f6ff' : '#fff', fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600, color: '#222' }}>{s.name || s.email}</div>
                <div style={{ fontSize: 12, color: '#777' }}>
                  {s.email}{s.organization ? ` · ${s.organization}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <div style={{ color: '#c62828', fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  )
}

export { isValidEmail, normalizeRecipientEmail, parseRecipientList } from '../recipient-utils'
