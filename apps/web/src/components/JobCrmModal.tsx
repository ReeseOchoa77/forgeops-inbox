import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

type Props = {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

/** Shared Job CRM modal shell — focus trap light, Escape closes, labeled title. */
export function JobCrmModal({ title, open, onClose, children, footer, wide }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('input,select,textarea,button')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '10vh 16px 24px',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: wide ? 640 : 480,
          background: '#fff',
          borderRadius: 10,
          border: '1px solid #e5e7eb',
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 650, color: '#1a1a2e', flex: 1 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              color: '#6b7280',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #f0f0f0',
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function JobCrmField({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
        {label}
        {required ? <span style={{ color: '#b91c1c' }}> *</span> : null}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  )
}

export const jobCrmInputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
}

export function JobCrmPrimaryButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 14px',
        background: danger ? '#b91c1c' : '#1a1a2e',
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  )
}

export function JobCrmSecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 14px',
        background: '#fff',
        color: '#374151',
        border: '1px solid #d0d5dd',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

type ConfirmProps = {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  /** When set, user must type this exact phrase before Confirm enables. */
  confirmPhrase?: string
  confirmPhraseHint?: string
  onConfirm: () => void
  onCancel: () => void
}

export function JobConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  confirmPhrase,
  confirmPhraseHint,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const [phrase, setPhrase] = useState('')
  useEffect(() => {
    if (!open) setPhrase('')
  }, [open])

  const phraseOk = !confirmPhrase || phrase.trim() === confirmPhrase
  const canConfirm = phraseOk && !busy

  return (
    <JobCrmModal
      title={title}
      open={open}
      onClose={onCancel}
      footer={
        <>
          <JobCrmSecondaryButton onClick={onCancel} disabled={busy}>
            Cancel
          </JobCrmSecondaryButton>
          <JobCrmPrimaryButton onClick={onConfirm} disabled={!canConfirm} danger={danger}>
            {busy ? 'Working…' : confirmLabel}
          </JobCrmPrimaryButton>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {message}
      </p>
      {confirmPhrase ? (
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
            {confirmPhraseHint ?? `Type ${confirmPhrase} to confirm`}
          </label>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            style={jobCrmInputStyle}
            placeholder={confirmPhrase}
          />
        </div>
      ) : null}
    </JobCrmModal>
  )
}
