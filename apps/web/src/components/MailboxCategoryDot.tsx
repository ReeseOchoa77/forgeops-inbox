import type { CSSProperties } from 'react'

/** Existing BUSINESS / PERSONAL color language from Inbox reclassify pills. */
export const MAILBOX_CATEGORY_DOT_COLORS = {
  BUSINESS: '#1565c0',
  PERSONAL: '#6a1b9a',
} as const

type Category = keyof typeof MAILBOX_CATEGORY_DOT_COLORS

export function mailboxCategoryDotTitle(category: Category): string {
  return category === 'BUSINESS' ? 'Business' : 'Personal'
}

export function mailboxCategoryDotAriaLabel(category: Category): string {
  return category === 'BUSINESS' ? 'Business email' : 'Personal email'
}

type Props = {
  /** Target category applied when the control is activated (same as former Biz/Pers). */
  category: Category
  onClick: () => void
  disabled?: boolean
  /** Slightly larger hit target on phone cards. */
  hitSize?: number
}

/**
 * Compact BUSINESS/PERSONAL reclassify control — colored dot instead of Pers/Biz text pill.
 * Preserves click-to-reclassify; meaning via title + aria-label (not color alone).
 */
export function MailboxCategoryDot({
  category,
  onClick,
  disabled,
  hitSize = 28,
}: Props) {
  const title = mailboxCategoryDotTitle(category)
  const ariaLabel = mailboxCategoryDotAriaLabel(category)
  const color = MAILBOX_CATEGORY_DOT_COLORS[category]

  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: hitSize,
        height: hitSize,
        minWidth: hitSize,
        minHeight: hitSize,
        padding: 0,
        margin: 0,
        border: 'none',
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        verticalAlign: 'middle',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: color,
          display: 'block',
          boxSizing: 'border-box',
        }}
      />
    </button>
  )
}

/** Actions-column width after reclaiming Pers/Biz pill space (dot + trash). */
export const INBOX_ACTIONS_COLUMN_WIDTH_PX = 40

export const inboxDateCellStyle: CSSProperties = {
  padding: '7px 14px 7px 12px',
  fontSize: 12,
  whiteSpace: 'nowrap',
  color: '#999',
}
