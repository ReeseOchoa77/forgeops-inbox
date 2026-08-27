import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type CalendarFeedItem } from '../api'

interface Props {
  workspaceId: string
  userRole: string
  onOpenTask?: (taskId: string) => void
  onOpenJob?: (jobId: string) => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function monthRange(month: Date): { from: string; to: string } {
  const from = new Date(month.getFullYear(), month.getMonth(), 1)
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayKey(iso: string): string {
  return localDayKey(new Date(iso))
}

function typeColor(type: string): string {
  switch (type) {
    case 'TASK': return '#4338ca'
    case 'MEETING': return '#0f766e'
    case 'DEADLINE': return '#b91c1c'
    case 'NOTE': return '#a16207'
    default: return '#334155'
  }
}

export function CalendarView({ workspaceId, userRole, onOpenJob }: Props) {
  const isViewer = userRole === 'VIEWER'
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [items, setItems] = useState<CalendarFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<CalendarFeedItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'MEETING' | 'EVENT' | 'NOTE' | 'DEADLINE'>('EVENT')
  const [allDay, setAllDay] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const range = monthRange(cursor)
      const r = await api.getCalendar(workspaceId, range.from, range.to)
      const merged: CalendarFeedItem[] = [
        ...r.events.map((e) => ({ ...e, kind: 'event' as const })),
        ...r.taskDueItems.map((t) => ({ ...t, kind: 'task' as const })),
      ]
      merged.sort((a, b) => a.startAt.localeCompare(b.startAt))
      setItems(merged)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calendar')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, cursor])

  useEffect(() => { void load() }, [load])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarFeedItem[]>()
    for (const item of items) {
      const k = dayKey(item.startAt)
      const list = map.get(k) ?? []
      list.push(item)
      map.set(k, list)
    }
    return map
  }, [items])

  const cells = useMemo(() => {
    const first = startOfMonth(cursor)
    const startPad = first.getDay()
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const out: Array<{ key: string; date: Date | null; inMonth: boolean }> = []
    for (let i = 0; i < startPad; i++) out.push({ key: `pad-${i}`, date: null, inMonth: false })
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), d)
      out.push({ key: localDayKey(date), date, inMonth: true })
    }
    while (out.length % 7 !== 0) out.push({ key: `end-${out.length}`, date: null, inMonth: false })
    return out
  }, [cursor])

  const selectedItems = selectedDay ? (byDay.get(selectedDay) ?? []) : []

  const openCreateForDay = (key: string) => {
    if (isViewer) return
    setSelectedDay(key)
    setCreating(true)
    setEditing(null)
    setTitle('')
    setDescription('')
    setType('EVENT')
    setAllDay(true)
  }

  const openEdit = (item: CalendarFeedItem) => {
    if (item.kind === 'task') return
    if (isViewer) return
    setCreating(false)
    setEditing(item)
    setTitle(item.title)
    setDescription(item.description ?? '')
    setType((item.type as typeof type) || 'EVENT')
    setAllDay(item.allDay)
  }

  const save = async () => {
    if (!title.trim() || !selectedDay) return
    setSaving(true)
    setError('')
    try {
      const startAt = new Date(`${selectedDay}T12:00:00.000Z`).toISOString()
      if (editing && editing.kind === 'event') {
        await api.updateCalendarEvent(workspaceId, editing.id, {
          title: title.trim(),
          description: description.trim() || null,
          startAt,
          allDay,
          type,
        })
      } else {
        await api.createCalendarEvent(workspaceId, {
          title: title.trim(),
          description: description.trim() || null,
          startAt,
          allDay,
          type,
        })
      }
      setCreating(false)
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!editing || editing.kind !== 'event') return
    if (!confirm('Delete this event?')) return
    setSaving(true)
    try {
      await api.deleteCalendarEvent(workspaceId, editing.id)
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Calendar</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>
            Task due dates and ForgeOps events. Google/Microsoft calendar sync is not connected yet.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setCursor(addMonths(cursor, -1))}>Prev</button>
          <span style={{ fontSize: 14, fontWeight: 600, minWidth: 140, textAlign: 'center' }}>{monthLabel}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setCursor(addMonths(cursor, 1))}>Next</button>
          <button type="button" className="btn btn-sm" onClick={() => setCursor(startOfMonth(new Date()))}>Today</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fce4ec', border: '1px solid #e8a09a', borderRadius: 4, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12, minHeight: 0, flex: 1 }}>
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, background: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #eee', background: '#fafafa' }}>
            {WEEKDAYS.map((d) => (
              <div key={d} style={{ padding: '8px 6px', fontSize: 11, fontWeight: 600, color: '#666', textAlign: 'center' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', flex: 1, minHeight: 420 }}>
            {cells.map((cell) => {
              const key = cell.date ? localDayKey(cell.date) : cell.key
              const dayItems = cell.date ? (byDay.get(key) ?? []) : []
              const selected = selectedDay === key
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={!cell.date}
                  onClick={() => cell.date && setSelectedDay(key)}
                  onDoubleClick={() => cell.date && openCreateForDay(key)}
                  style={{
                    border: '1px solid #f0f0f0',
                    background: selected ? '#eef2ff' : cell.inMonth ? '#fff' : '#fafafa',
                    textAlign: 'left',
                    padding: 6,
                    minHeight: 84,
                    cursor: cell.date ? 'pointer' : 'default',
                    verticalAlign: 'top',
                  }}
                >
                  {cell.date && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 4 }}>{cell.date.getDate()}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {dayItems.slice(0, 3).map((item) => (
                          <div
                            key={`${item.kind}-${item.id}`}
                            style={{
                              fontSize: 10,
                              lineHeight: 1.2,
                              color: '#fff',
                              background: typeColor(item.type),
                              borderRadius: 3,
                              padding: '1px 4px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={item.title}
                          >
                            {item.type === 'TASK' ? 'Task: ' : ''}{item.title}
                          </div>
                        ))}
                        {dayItems.length > 3 && (
                          <div style={{ fontSize: 10, color: '#888' }}>+{dayItems.length - 3} more</div>
                        )}
                      </div>
                    </>
                  )}
                </button>
              )
            })}
          </div>
          {loading && (
            <div style={{ padding: 8, fontSize: 12, color: '#888', borderTop: '1px solid #eee' }}>Loading…</div>
          )}
        </div>

        <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, background: '#fff', padding: 12, overflow: 'auto', minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>{selectedDay ?? 'Select a day'}</h3>
            {!isViewer && selectedDay && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => openCreateForDay(selectedDay)}>
                Add
              </button>
            )}
          </div>

          {(creating || editing) && !isViewer && (
            <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #eee' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{editing ? 'Edit event' : 'New event'}</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                style={{ width: '100%', marginBottom: 8, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes"
                rows={3}
                style={{ width: '100%', marginBottom: 8, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, resize: 'vertical' }}
              />
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                style={{ width: '100%', marginBottom: 8, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
              >
                <option value="EVENT">Event</option>
                <option value="MEETING">Meeting</option>
                <option value="NOTE">Note</option>
                <option value="DEADLINE">Deadline</option>
              </select>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 10 }}>
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                All day
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={saving || !title.trim()} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => { setCreating(false); setEditing(null) }}>
                  Cancel
                </button>
                {editing && (
                  <button type="button" className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => void remove()}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedDay && selectedItems.length === 0 && !creating && !editing && (
            <p style={{ fontSize: 12, color: '#aaa', margin: 0 }}>No items. Double-click a day or press Add.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedItems.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 6,
                  padding: 8,
                  borderLeft: `3px solid ${typeColor(item.type)}`,
                }}
              >
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{item.type}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                {item.description && (
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{item.description}</div>
                )}
                {item.linkedJob && (
                  <button
                    type="button"
                    onClick={() => onOpenJob?.(item.linkedJob!.id)}
                    style={{
                      marginTop: 6,
                      border: '1px solid #ddd',
                      background: '#f8fafc',
                      borderRadius: 4,
                      fontSize: 11,
                      padding: '2px 6px',
                      cursor: onOpenJob ? 'pointer' : 'default',
                    }}
                  >
                    Job {item.linkedJob.jobNumber ?? item.linkedJob.name}
                  </button>
                )}
                {item.kind === 'event' && !isViewer && (
                  <div style={{ marginTop: 6 }}>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => openEdit(item)}>
                      Edit
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
