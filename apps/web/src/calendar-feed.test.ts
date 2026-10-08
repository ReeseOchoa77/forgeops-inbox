import { describe, expect, it } from 'vitest'
import type { CalendarBidDueItem, CalendarFeedItem, CalendarTaskDueItem } from './api'

describe('Calendar feed merge (web)', () => {
  it('merges events, task dues, and bidDueItems without client-side bid filtering', () => {
    const events = [
      {
        id: 'e1',
        title: 'Meeting',
        description: null,
        startAt: '2026-10-05T12:00:00.000Z',
        endAt: null,
        allDay: true,
        type: 'MEETING',
        source: 'FORGEOPS',
        linkedJobId: null,
        linkedTaskId: null,
        linkedEmailMessageId: null,
        linkedJob: null,
      },
    ]
    const taskDueItems: CalendarTaskDueItem[] = [
      {
        id: 't1',
        title: 'Call engineer',
        description: null,
        startAt: '2026-10-08T00:00:00.000Z',
        endAt: null,
        allDay: true,
        type: 'TASK',
        source: 'FORGEOPS',
        linkedJobId: null,
        linkedTaskId: 't1',
        linkedEmailMessageId: null,
        linkedJob: null,
      },
    ]
    const bidDueItems: CalendarBidDueItem[] = [
      {
        id: 'bid-due:j1',
        title: 'Bid Due — Prieto Battery',
        description: null,
        startAt: '2026-10-14T00:00:00.000Z',
        endAt: null,
        allDay: true,
        type: 'BID_DUE',
        source: 'JOB_BID_DUE',
        linkedJobId: 'j1',
        linkedTaskId: null,
        linkedEmailMessageId: null,
        linkedJob: { id: 'j1', name: 'Prieto Battery', jobNumber: 'B-1' },
      },
    ]

    const merged: CalendarFeedItem[] = [
      ...events.map((e) => ({ ...e, kind: 'event' as const })),
      ...taskDueItems.map((t) => ({ ...t, kind: 'task' as const })),
      ...bidDueItems.map((b) => ({ ...b, kind: 'bid_due' as const })),
    ]
    merged.sort((a, b) => a.startAt.localeCompare(b.startAt))

    expect(merged.map((i) => i.kind)).toEqual(['event', 'task', 'bid_due'])
    expect(merged.find((i) => i.kind === 'bid_due')?.title).toBe(
      'Bid Due — Prieto Battery'
    )
  })

  it('treats missing bidDueItems as empty (backward-compatible)', () => {
    const response: { bidDueItems?: CalendarBidDueItem[] } = {}
    const items = response.bidDueItems
    expect(items ?? []).toEqual([])
  })
})
