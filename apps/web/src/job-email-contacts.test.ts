import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('Job Email Contacts UI', () => {
  it('renders a distinct Email Contacts section on Job Overview', () => {
    const view = readFileSync(resolve(here, 'views/JobDetailView.tsx'), 'utf8')
    const parties = readFileSync(resolve(here, 'components/JobEmailContacts.tsx'), 'utf8')
    expect(view).toContain('JobEmailContacts')
    expect(view).toContain('job.emailContacts')
    expect(parties).toContain('Email Contacts')
    expect(parties).toContain('No email contacts saved yet.')
    expect(parties).toContain('Saved from email')
    expect(parties).not.toContain('JobProjectParties')
    expect(parties).not.toContain('Add participant')
  })
})
