import { describe, expect, it } from 'vitest'
import {
  mailboxAuthorizationLabel,
  mailboxUsesReconnectFlow,
  needsSendingAuthorization,
} from './mailbox-authorization-display'

describe('mailbox authorization display', () => {
  it('CONNECTED without Mail.Send is Connected, not Fully connected', () => {
    expect(
      mailboxAuthorizationLabel({
        authorizationStatus: 'CONNECTED',
        emailSending: false,
      })
    ).toBe('Connected')
  })

  it('CONNECTED with emailSending is Fully connected', () => {
    expect(
      mailboxAuthorizationLabel({
        authorizationStatus: 'CONNECTED',
        emailSending: true,
      })
    ).toBe('Fully connected')
  })

  it('needsSendingAuthorization only for CONNECTED Outlook without send', () => {
    expect(
      needsSendingAuthorization({
        provider: 'outlook',
        authorizationStatus: 'CONNECTED',
        emailSending: false,
      })
    ).toBe(true)
    expect(
      needsSendingAuthorization({
        provider: 'outlook',
        authorizationStatus: 'CONNECTED',
        emailSending: true,
      })
    ).toBe(false)
    expect(
      needsSendingAuthorization({
        provider: 'outlook',
        authorizationStatus: 'REQUIRED',
        emailSending: false,
      })
    ).toBe(false)
  })

  it('DISCONNECTED uses authorize flow (not reconnect)', () => {
    expect(
      mailboxUsesReconnectFlow({
        status: 'DISCONNECTED',
        authorizationStatus: 'REQUIRED',
      })
    ).toBe(false)
  })

  it('REQUIRES_REAUTH uses reconnect flow', () => {
    expect(
      mailboxUsesReconnectFlow({
        status: 'REQUIRES_REAUTH',
        authorizationStatus: 'REAUTHORIZATION_REQUIRED',
      })
    ).toBe(true)
  })

  it('ACTIVE CONNECTED can reauthorize via reconnect', () => {
    expect(
      mailboxUsesReconnectFlow({
        status: 'ACTIVE',
        authorizationStatus: 'CONNECTED',
      })
    ).toBe(false)
  })
})
