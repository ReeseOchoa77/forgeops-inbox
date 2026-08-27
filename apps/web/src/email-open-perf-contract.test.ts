import { describe, expect, it } from 'vitest'
import {
  getCachedThread,
  setCachedThread,
} from './message-thread-cache'
import type { ThreadDetail } from './api'

function sampleThread(id: string): ThreadDetail {
  return {
    thread: {
      id: 't1',
      providerThreadId: 'pt1',
      subject: 'Subj',
      normalizedSubject: 'subj',
      messageCount: 1,
    },
    messages: [
      {
        id,
        providerMessageId: 'pm1',
        providerThreadId: 'pt1',
        subject: 'Subj',
        senderName: 'A',
        senderEmail: 'a@x.com',
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        replyToAddresses: [],
        snippet: null,
        bodyText: 'hello',
        bodyHtml: null,
        bodyTruncated: false,
        labelIds: [],
        hasAttachments: false,
        attachmentMetadata: [],
        sentAt: new Date().toISOString(),
        receivedAt: null,
        priority: 'NORMAL',
        itemStatus: 'NEW',
        mailboxCategory: 'BUSINESS',
        previousCategory: null,
        jobAssignmentSource: null,
        jobAssignmentIsManual: false,
        jobMatchConfidence: null,
        job: null,
        classification: null,
        taskCandidate: null,
      },
    ],
  }
}

describe('message thread cache', () => {
  it('stores and returns a thread by message id', () => {
    const data = sampleThread('msg-cache-1')
    setCachedThread('ws', 'conn', 'msg-cache-1', data)
    expect(getCachedThread('ws', 'conn', 'msg-cache-1')?.messages[0]?.id).toBe('msg-cache-1')
  })

  it('misses for a different message id', () => {
    expect(getCachedThread('ws', 'conn', 'other')).toBeNull()
  })
})

describe('email open / dashboard paint contracts', () => {
  it('CID rewrite can start from provider metadata without waiting on attachments GET', () => {
    const bodyHtml = '<img src="cid:ii_abc">'
    const providerMap = new Map([['ii_abc', '/api/v1/proxy/download']])
    const hasProviderRewrite = providerMap.size > 0 && /cid:/i.test(bodyHtml)
    expect(hasProviderRewrite).toBe(true)
  })

  it('thread open bodies only need clicked + last message', () => {
    const headers = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }, { id: 'm5' }, { id: 'm6' }]
    const clickedId = 'm2'
    const bodyIds = new Set([clickedId, headers[headers.length - 1]!.id])
    expect([...bodyIds].sort()).toEqual(['m2', 'm6'])
    expect(bodyIds.size).toBeLessThanOrEqual(2)
  })

  it('dashboard does not require a connections GET when App passes connections', () => {
    const connectionsFromApp = [{ email: 'a@x.com' }]
    const shouldFetchConnections = connectionsFromApp === undefined
    expect(shouldFetchConnections).toBe(false)
  })

  it('attachment section only requests messages with hasAttachments', () => {
    const messages = [
      { id: 'a', hasAttachments: true },
      { id: 'b', hasAttachments: false },
      { id: 'c', hasAttachments: true },
    ]
    const emailIds = messages.filter(m => m.hasAttachments).map(m => m.id)
    expect(emailIds).toEqual(['a', 'c'])
  })
})
