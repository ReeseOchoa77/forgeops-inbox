import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, type CustomerSummary } from '../api'
import {
  canOfferCreateCustomer,
  filterCustomersByQuery,
  findExactCustomerNameMatch,
  findNormalizedCustomerNameMatch,
} from '../customer-select'

export type CustomerSelectValue = {
  customerId: string | null
  customerName: string | null
}

type Props = {
  workspaceId: string
  value: CustomerSelectValue
  customers: CustomerSummary[]
  onChange: (next: CustomerSelectValue) => void
  onCustomersUpdated?: (customers: CustomerSummary[]) => void
  allowClear?: boolean
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  autoFocus?: boolean
  /** Notify parent when focus moves into nested controls (dropdown / create). */
  onFocusWithinChange?: (focused: boolean) => void
}

/**
 * Canonical select-or-create Customer control.
 * Typing never creates; Create is an explicit action that awaits the server.
 */
export function CustomerSelectOrCreate({
  workspaceId,
  value,
  customers,
  onChange,
  onCustomersUpdated,
  allowClear = true,
  disabled = false,
  placeholder = 'Start typing a customer…',
  ariaLabel = 'Customer',
  autoFocus = false,
  onFocusWithinChange,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value.customerName ?? '')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery(value.customerName ?? '')
    }
  }, [value.customerId, value.customerName, open])

  const filtered = useMemo(
    () => filterCustomersByQuery(customers, query).slice(0, 40),
    [customers, query]
  )
  const exact = findExactCustomerNameMatch(customers, query)
  const normalizedHit = findNormalizedCustomerNameMatch(customers, query)
  const offerCreate = canOfferCreateCustomer(customers, query)
  const preferredExisting = exact ?? normalizedHit

  const setFocused = (focused: boolean) => {
    onFocusWithinChange?.(focused)
  }

  const selectExisting = (c: CustomerSummary) => {
    setError(null)
    setQuery(c.name)
    setOpen(false)
    onChange({ customerId: c.id, customerName: c.name })
  }

  const clear = () => {
    setError(null)
    setQuery('')
    setOpen(false)
    onChange({ customerId: null, customerName: null })
  }

  const createCustomer = async () => {
    const name = query.trim()
    if (!name || creating || !offerCreate) return
    setCreating(true)
    setError(null)
    try {
      const res = await api.createCustomer(workspaceId, { name })
      const nextList = customers.some((c) => c.id === res.customer.id)
        ? customers
        : [...customers, res.customer].sort((a, b) => a.name.localeCompare(b.name))
      onCustomersUpdated?.(nextList)
      setQuery(res.customer.name)
      setOpen(false)
      onChange({ customerId: res.customer.id, customerName: res.customer.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create customer')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: '100%' }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (rootRef.current?.contains(e.relatedTarget as Node)) return
        setFocused(false)
        setOpen(false)
        if (!value.customerId) {
          setQuery(value.customerName ?? '')
        } else {
          setQuery(value.customerName ?? '')
        }
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          disabled={disabled || creating}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            const next = e.target.value
            setQuery(next)
            setOpen(true)
            setError(null)
            // Typing clears selection until user picks / creates — no auto-create.
            if (value.customerId) {
              onChange({ customerId: null, customerName: next.trim() || null })
            } else {
              onChange({ customerId: null, customerName: next.trim() || null })
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setOpen(false)
              setQuery(value.customerName ?? '')
            }
            if (e.key === 'Enter' && preferredExisting) {
              e.preventDefault()
              const row = customers.find((c) => c.id === preferredExisting.id)
              if (row) selectExisting(row)
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            border: '1px solid #d0d5dd',
            borderRadius: 6,
            fontSize: 13,
            boxSizing: 'border-box',
            background: disabled ? '#f9fafb' : '#fff',
          }}
        />
        {allowClear && (value.customerId || query) && !disabled && (
          <button
            type="button"
            onClick={clear}
            disabled={creating}
            aria-label="Clear customer"
            style={{
              border: '1px solid #d0d5dd',
              background: '#fff',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              cursor: 'pointer',
              color: '#6b7280',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {open && !disabled && (
        <div
          id={listId}
          role="listbox"
          aria-label="Customer matches"
          style={{
            position: 'absolute',
            zIndex: 30,
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 4,
            maxHeight: 240,
            overflow: 'auto',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 10px 24px rgba(15,23,42,0.12)',
          }}
        >
          {preferredExisting && query.trim() && (
            <button
              type="button"
              role="option"
              aria-selected={value.customerId === preferredExisting.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const row = customers.find((c) => c.id === preferredExisting.id)
                if (row) selectExisting(row)
              }}
              style={optionStyle}
            >
              {preferredExisting.name}
              <span style={{ color: '#6b7280', marginLeft: 8, fontSize: 11 }}>existing</span>
            </button>
          )}
          {filtered
            .filter((c) => !preferredExisting || c.id !== preferredExisting.id)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={value.customerId === c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const row = customers.find((row) => row.id === c.id)
                  if (row) selectExisting(row)
                }}
                style={optionStyle}
              >
                {c.name}
              </button>
            ))}
          {offerCreate && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              disabled={creating}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { void createCustomer() }}
              style={{
                ...optionStyle,
                fontWeight: 600,
                color: '#1a1a2e',
                borderTop: filtered.length || preferredExisting ? '1px solid #f3f4f6' : undefined,
              }}
            >
              {creating ? 'Creating…' : `+ Create “${query.trim()}”`}
            </button>
          )}
          {!filtered.length && !offerCreate && !preferredExisting && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>
              {query.trim() ? 'No matching customers' : 'Type to search customers'}
            </div>
          )}
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: '#b42318', fontSize: 12, marginTop: 4 }}>
          {error}
        </div>
      )}
      {value.customerId && (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          Selected · {value.customerName}
        </div>
      )}
    </div>
  )
}

const optionStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 12px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 13,
  color: '#111827',
}
