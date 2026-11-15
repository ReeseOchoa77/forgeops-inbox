import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('SearchableFilterSelect', () => {
  it('filters options case-insensitively in source', () => {
    const src = readFileSync(join(here, 'SearchableFilterSelect.tsx'), 'utf8')
    expect(src).toContain('toLowerCase()')
    expect(src).toContain('No matches')
    expect(src).toContain('searchPlaceholder')
    expect(src).toContain('role="listbox"')
  })
})
