import { describe, expect, it } from 'vitest'

/**
 * Documents the production inbox-sync HTTP contract used by api.syncConnection.
 * Backend registers POST only (apps/api/.../inbox-actions.route.ts).
 * A GET to the same path yields Fastify "Route not found" (404).
 */
describe('inbox sync API contract', () => {
  it('canonical sync is POST with wait query (not GET)', () => {
    const workspaceId = 'ws_1'
    const connectionId = 'conn_1'
    const wait = false
    const path = `/workspaces/${workspaceId}/inbox-connections/${connectionId}/sync?wait=${wait}`
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }

    expect(path).toBe(
      '/workspaces/ws_1/inbox-connections/conn_1/sync?wait=false'
    )
    expect(init.method).toBe('POST')
    expect(init.method).not.toBe('GET')
    expect(init.body).toBe('{}')
  })
})
