import { describe, expect, it } from 'vitest'
import {
  mailboxAuthorizationLabel,
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
})
