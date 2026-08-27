import type { AuthorizationStatus } from './api'

/** User-facing authorization line for monitored mailboxes. */
export function mailboxAuthorizationLabel(input: {
  authorizationStatus: AuthorizationStatus
  emailSending: boolean
}): string {
  switch (input.authorizationStatus) {
    case 'REQUIRED':
      return 'Additional authorization required'
    case 'REAUTHORIZATION_REQUIRED':
      return 'Reauthorization required'
    case 'CONNECTED':
      return input.emailSending ? 'Fully connected' : 'Connected'
  }
}

export function mailboxAuthorizationTone(input: {
  authorizationStatus: AuthorizationStatus
  emailSending: boolean
}): { bg: string; color: string } {
  switch (input.authorizationStatus) {
    case 'REQUIRED':
      return { bg: '#fff8e1', color: '#f57f17' }
    case 'REAUTHORIZATION_REQUIRED':
      return { bg: '#fce4ec', color: '#c62828' }
    case 'CONNECTED':
      return input.emailSending
        ? { bg: '#e6f4ea', color: '#2e7d32' }
        : { bg: '#e3f2fd', color: '#1565c0' }
  }
}

/** Prefer reconnect OAuth for broken auth; authorize for tokenless / DISCONNECTED / scope upgrade. */
export function mailboxUsesReconnectFlow(input: {
  status: string
  authorizationStatus: AuthorizationStatus
}): boolean {
  return (
    input.status === 'REQUIRES_REAUTH' ||
    input.authorizationStatus === 'REAUTHORIZATION_REQUIRED'
  )
}

/** CONNECTED Outlook mailbox that can read but not send — needs incremental Mail.Send consent. */
export function needsSendingAuthorization(input: {
  provider: string
  authorizationStatus: AuthorizationStatus
  emailSending: boolean
}): boolean {
  return (
    input.provider.toLowerCase() === 'outlook' &&
    input.authorizationStatus === 'CONNECTED' &&
    !input.emailSending
  )
}
