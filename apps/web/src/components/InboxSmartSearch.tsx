import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { type InboxParticipant } from '@forgeops/shared/inbox-participant-match'
import { api } from '../api'
import {
  applyParticipantToken,
  removeParticipantToken,
  resolveInboxSearchEnter,
  handleEmptyBackspace,
  type InboxParticipantRole,
} from '../inbox-smart-search'

type Props = {
  workspaceId: string
  role: InboxParticipantRole
  text: string
  tokens: InboxParticipant[]
  onTextChange: (value: string, opts?: { immediate?: boolean }) => void
  onTokensChange: (tokens: InboxParticipant[]) => void
}

export function InboxSmartSearch({
  workspaceId,
  role,
  text,
  tokens,
  onTextChange,
  onTokensChange,
}: Props) {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const [suggestions, setSuggestions] = useState<InboxParticipant[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [highlightedEmail, setHighlightedEmail] = useState<string | null>(null)

  const selected = new Set(tokens.map((t) => t.email.toLowerCase()))

  const commitToken = (participant: InboxParticipant) => {
    const next = applyParticipantToken(tokens, participant)
    if (next === tokens && selected.has(participant.email.trim().toLowerCase())) {
      onTextChange('', { immediate: true })
      setSuggestions([])
      setOpen(false)
      setHighlightedEmail(null)
      inputRef.current?.focus()
      return
    }
    if (next === tokens) return
    onTokensChange(next)
    onTextChange('', { immediate: true })
    setSuggestions([])
    setOpen(false)
    setHighlightedEmail(null)
    inputRef.current?.focus()
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = text.trim()
    if (q.length < 1) {
      abortRef.current?.abort()
      setSuggestions([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      const seq = ++seqRef.current
      api
        .searchEmailParticipants(workspaceId, q, {
          role,
          limit: 8,
          signal: ac.signal,
        })
        .then((r) => {
          if (seq !== seqRef.current) return
          const next = r.participants.filter((p) => !selected.has(p.email.toLowerCase()))
          setSuggestions(next)
          setOpen(next.length > 0)
          setActiveIndex(-1)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          if (seq !== seqRef.current) return
          setSuggestions([])
          setOpen(false)
        })
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [text, workspaceId, role, tokens])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
      }
      setHighlightedEmail(null)
      return
    }
    if (e.key === 'ArrowDown' && open && suggestions.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i < 0 ? 0 : i + 1, suggestions.length - 1))
      return
    }
    if (e.key === 'ArrowUp' && open && suggestions.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? -1 : i - 1))
      return
    }
    if (e.key === 'Backspace' && !text) {
      const next = handleEmptyBackspace(tokens, highlightedEmail)
      if (next.tokens !== tokens) onTokensChange(next.tokens)
      setHighlightedEmail(next.highlightedEmail)
      return
    }
    if (e.key === 'Enter' || e.key === ',') {
      const result = resolveInboxSearchEnter({
        draft: text,
        suggestions,
        suggestionsOpen: open && e.key === 'Enter',
        activeIndex,
      })
      if (result.action === 'commit-token') {
        e.preventDefault()
        commitToken(result.participant)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        onTextChange(text, { immediate: true })
        setOpen(false)
      }
      return
    }
    if (text) setHighlightedEmail(null)
  }

  return (
    <div ref={wrapRef} className="inbox-smart-search">
      <div
        className="inbox-smart-search-box"
        onClick={() => inputRef.current?.focus()}
      >
        {tokens.map((token) => {
          const highlighted =
            highlightedEmail?.toLowerCase() === token.email.toLowerCase()
          return (
            <span
              key={token.email.toLowerCase()}
              data-testid="inbox-participant-token"
              title={token.email}
              className={`inbox-smart-search-token${highlighted ? ' is-highlighted' : ''}`}
            >
              <span className="inbox-smart-search-token-label">{token.email}</span>
              <button
                type="button"
                aria-label={`Remove ${token.email}`}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onTokensChange(removeParticipantToken(tokens, token.email))
                  setHighlightedEmail(null)
                  inputRef.current?.focus()
                }}
              >
                ×
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          type="text"
          data-testid="inbox-unified-search"
          role="combobox"
          aria-label="Search emails"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && suggestions[activeIndex]
              ? `${listboxId}-opt-${activeIndex}`
              : undefined
          }
          placeholder={tokens.length === 0 ? 'Search emails…' : ''}
          value={text}
          onChange={(e) => {
            setHighlightedEmail(null)
            onTextChange(e.target.value)
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Email participants"
          className="inbox-smart-search-menu"
        >
          {suggestions.map((s, i) => (
            <li key={s.email.toLowerCase()} role="presentation">
              <button
                type="button"
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                data-testid="inbox-participant-suggestion"
                className={`inbox-smart-search-option${i === activeIndex ? ' is-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  commitToken(s)
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="inbox-smart-search-option-name">
                  {s.name || s.email}
                </span>
                {s.name ? (
                  <span className="inbox-smart-search-option-email">{s.email}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
