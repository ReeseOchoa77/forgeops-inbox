import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('AI Control Center navigation', () => {
  it('adds admin-only System nav entry and restorable page', () => {
    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    const nav = readFileSync(join(here, 'workspace-state/nav-state.ts'), 'utf8')
    const view = readFileSync(join(here, 'views/AiControlCenterView.tsx'), 'utf8')
    const api = readFileSync(join(here, 'api.ts'), 'utf8')

    expect(app).toContain("page: 'ai-control'")
    expect(app).toContain("label: 'AI Control Center'")
    expect(app).toMatch(
      /\{\s*page:\s*'ai-control',\s*label:\s*'AI Control Center',\s*icon:\s*'\\u26A1',\s*section:\s*'System',\s*minRole:\s*'ADMIN'\s*\}/
    )
    expect((app.match(/page:\s*'ai-control'/g) ?? []).length).toBe(1)
    expect(app).toContain('AiControlCenterView')
    expect(app).toContain("restored.page === 'ai-control'")
    expect(nav).toContain("'ai-control'")
    expect(view).toContain('data-testid="ai-control-center"')
    expect(view).toContain('Confirm & save')
    expect(api).toContain('getAiControlCenter')
    expect(api).toContain('/workspaces/${workspaceId}/ai-control')
  })
})
