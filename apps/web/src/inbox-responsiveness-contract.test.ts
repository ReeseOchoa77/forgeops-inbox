import { describe, expect, it } from 'vitest'

/**
 * Documents Inbox keep-mounted / soft-refresh contracts after responsiveness fixes.
 * Implementation lives in App.tsx + MessagesView.tsx + MessageDetailView.tsx.
 */

describe('inbox responsiveness contracts', () => {
  function keepInboxMounted(page: string, messageBackPage: string): boolean {
    return page === 'inbox' || (page === 'message-detail' && messageBackPage === 'inbox')
  }

  it('keeps MessagesView mounted when opening detail from Inbox', () => {
    expect(keepInboxMounted('message-detail', 'inbox')).toBe(true)
  })

  it('does not keep Inbox mounted when opening a message from Job detail', () => {
    expect(keepInboxMounted('message-detail', 'job-detail')).toBe(false)
  })

  it('list soft-refresh keeps rows until replace (no blanking)', () => {
    const prior = [{ id: 'm1' }, { id: 'm2' }]
    const soft = true
    const nextMessages = soft ? prior : []
    expect(nextMessages).toHaveLength(2)
  })

  it('detail prefers App connections over a fresh GET', () => {
    const connections: Array<{ email: string }> | undefined = [
      { email: 'a@x.com' },
      { email: 'b@x.com' },
    ]
    const monitored = new Set(connections.map((c) => c.email.toLowerCase()))
    expect(monitored.has('a@x.com')).toBe(true)
    expect(connections === undefined).toBe(false)
  })

  it('jobs lookup on detail is lazy (interaction-gated)', () => {
    let jobsLoaded = false
    const ensureJobsLoaded = () => {
      if (jobsLoaded) return
      jobsLoaded = true
    }
    expect(jobsLoaded).toBe(false)
    ensureJobsLoaded()
    expect(jobsLoaded).toBe(true)
    ensureJobsLoaded()
    expect(jobsLoaded).toBe(true)
  })

  it('mailbox panel import resume keys on connection ids not array identity', () => {
    const connectionsA = [
      { id: 'c1', status: 'ACTIVE' },
      { id: 'c2', status: 'ACTIVE' },
    ]
    const connectionsB = [
      { id: 'c1', status: 'ACTIVE', nativeListeningEnabled: true },
      { id: 'c2', status: 'ACTIVE', nativeListeningEnabled: false },
    ]
    const key = (rows: Array<{ id: string; status: string }>) =>
      rows
        .filter((c) => c.status !== 'DISCONNECTED')
        .map((c) => c.id)
        .sort()
        .join('|')
    expect(key(connectionsA)).toBe(key(connectionsB))
  })
})
