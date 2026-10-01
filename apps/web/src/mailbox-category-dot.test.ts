import { describe, expect, it } from 'vitest'
import {
  INBOX_ACTIONS_COLUMN_WIDTH_PX,
  MAILBOX_CATEGORY_DOT_COLORS,
  MailboxCategoryDot,
  mailboxCategoryDotAriaLabel,
  mailboxCategoryDotTitle,
} from './components/MailboxCategoryDot'

describe('MailboxCategoryDot', () => {
  it('uses existing BUSINESS blue and PERSONAL purple colors', () => {
    expect(MAILBOX_CATEGORY_DOT_COLORS.BUSINESS).toBe('#1565c0')
    expect(MAILBOX_CATEGORY_DOT_COLORS.PERSONAL).toBe('#6a1b9a')
  })

  it('exposes discoverable title and accessible labels without Biz/Pers text', () => {
    expect(mailboxCategoryDotTitle('BUSINESS')).toBe('Business')
    expect(mailboxCategoryDotTitle('PERSONAL')).toBe('Personal')
    expect(mailboxCategoryDotAriaLabel('BUSINESS')).toBe('Business email')
    expect(mailboxCategoryDotAriaLabel('PERSONAL')).toBe('Personal email')
    expect(mailboxCategoryDotTitle('BUSINESS')).not.toBe('Biz')
    expect(mailboxCategoryDotTitle('PERSONAL')).not.toBe('Pers')
  })

  it('exports interactive control and compact actions column width', () => {
    expect(typeof MailboxCategoryDot).toBe('function')
    expect(INBOX_ACTIONS_COLUMN_WIDTH_PX).toBe(40)
    expect(INBOX_ACTIONS_COLUMN_WIDTH_PX).toBeLessThan(64)
  })
})
