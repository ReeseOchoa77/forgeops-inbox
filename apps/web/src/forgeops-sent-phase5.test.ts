import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { businessSubtypeComposeOptions } from '@forgeops/shared/business-subtypes'

const here = dirname(fileURLToPath(import.meta.url))

describe('Phase 5 — compose Email Type UX', () => {
  it('compose options include General and Quote labels', () => {
    const opts = businessSubtypeComposeOptions()
    expect(opts[0]).toEqual({ key: 'GENERAL', label: 'General' })
    expect(opts.some((o) => o.key === 'ESTIMATE_QUOTE' && o.label === 'Quote')).toBe(true)
  })

  it('ComposeEditor exposes Email Type selector', () => {
    const src = readFileSync(join(here, 'components/ComposeEditor.tsx'), 'utf8')
    expect(src).toContain('data-testid="compose-email-type"')
    expect(src).toContain('Email Type')
    expect(src).toContain('businessSubtypeComposeOptions')
    expect(src).toContain('businessTypeKey')
  })

  it('send API forwards businessTypeKey', () => {
    const src = readFileSync(join(here, 'api.ts'), 'utf8')
    expect(src).toContain('businessTypeKey: payload.businessTypeKey')
  })
})
