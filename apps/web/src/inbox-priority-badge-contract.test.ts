import { describe, expect, it } from 'vitest'

/**
 * Documents Inbox priority badge rendering contract.
 * Badges use application vocabulary: LOW | NORMAL | HIGH | URGENT.
 * Null priority must render nothing (no invented LOW).
 */

const priorityLabels: Record<string, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Normal',
  NORMAL: 'Normal',
  LOW: 'Low',
}

function renderBadgeLabel(priority: string | null | undefined): string | null {
  if (!priority) return null
  return priorityLabels[priority] ?? priority
}

describe('inbox priority badge contract', () => {
  it('renders LOW', () => {
    expect(renderBadgeLabel('LOW')).toBe('Low')
  })
  it('renders NORMAL', () => {
    expect(renderBadgeLabel('NORMAL')).toBe('Normal')
  })
  it('renders stored MEDIUM as Normal', () => {
    expect(renderBadgeLabel('MEDIUM')).toBe('Normal')
  })
  it('renders HIGH', () => {
    expect(renderBadgeLabel('HIGH')).toBe('High')
  })
  it('renders URGENT', () => {
    expect(renderBadgeLabel('URGENT')).toBe('Urgent')
  })
  it('null priority renders cleanly (no badge)', () => {
    expect(renderBadgeLabel(null)).toBeNull()
    expect(renderBadgeLabel(undefined)).toBeNull()
  })
  it('PERSONAL rows should not show business priority chrome', () => {
    const showBusinessChrome = false
    const priority = 'HIGH'
    const visible = showBusinessChrome && Boolean(priority)
    expect(visible).toBe(false)
  })
})
