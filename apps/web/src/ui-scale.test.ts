import { describe, expect, it } from 'vitest'
import { computeUiScale, uiPx } from './ui-scale'
import { scaleCssFilePixels, scaleTsxStyleLengths } from './style-px-scale'

describe('computeUiScale', () => {
  it('keeps laptop / MacBook CSS viewports at the current baseline', () => {
    expect(computeUiScale(1366, 768)).toBe(1)
    expect(computeUiScale(1440, 900)).toBe(1)
    expect(computeUiScale(1512, 982)).toBe(1)
    expect(computeUiScale(1728, 1117)).toBe(1)
  })

  it('grows modestly at 1920×1080 and caps larger desktops', () => {
    expect(computeUiScale(1920, 1080)).toBeCloseTo(1.045, 3)
    expect(computeUiScale(2560, 1440)).toBe(1.12)
    expect(computeUiScale(3440, 1440)).toBe(1.12)
    expect(computeUiScale(3840, 2160)).toBe(1.12)
  })

  it('does not enlarge a short ultrawide window', () => {
    expect(computeUiScale(3440, 800)).toBe(1)
    expect(computeUiScale(1920, 700)).toBe(1)
  })
})

describe('scaleTsxStyleLengths', () => {
  it('scales numeric fontSize/padding and quoted px shorthands', () => {
    const src = `style={{ fontSize: 13, padding: '8px 10px', zIndex: 20, fontWeight: 600, flex: 1, lineHeight: 1.5, width: '100%' }}`
    const out = scaleTsxStyleLengths(src)
    expect(out).toContain("fontSize: 'calc(13px * var(--fo-ui-scale, 1))'")
    expect(out).toContain("padding: 'calc(8px * var(--fo-ui-scale, 1)) calc(10px * var(--fo-ui-scale, 1))'")
    expect(out).toContain('zIndex: 20')
    expect(out).toContain('fontWeight: 600')
    expect(out).toContain('flex: 1')
    expect(out).toContain('lineHeight: 1.5')
    expect(out).toContain("width: '100%'")
  })

  it('scales both sides of a layout ternary', () => {
    const src = `style={{ fontSize: isPhone ? 16 : 17, width: isPhone ? '100%' : 400 }}`
    const out = scaleTsxStyleLengths(src)
    expect(out).toContain("fontSize: isPhone ? 'calc(16px * var(--fo-ui-scale, 1))' : 'calc(17px * var(--fo-ui-scale, 1))'")
    expect(out).toContain("width: isPhone ? '100%' : 'calc(400px * var(--fo-ui-scale, 1))'")
  })

  it('does not double-scale and leaves identifier widths alone', () => {
    const src = `style={{ width: sidebarWidth, fontSize: 13 }}`
    const once = scaleTsxStyleLengths(src)
    const twice = scaleTsxStyleLengths(once)
    expect(once).toBe(twice)
    expect(once).toContain('width: sidebarWidth')
    expect(once.match(/fontSize/g)?.length).toBe(1)
  })

  it('scales CSS text in quoted style attributes without breaking line-height', () => {
    const src =
      "style: 'min-height: min(300px, 42vh); outline: none; padding: 12px; font-size: 14px; line-height: 1.6;'"
    const out = scaleTsxStyleLengths(src)
    expect(out).toContain('min(calc(300px * var(--fo-ui-scale, 1)), 42vh)')
    expect(out).toContain('padding: calc(12px * var(--fo-ui-scale, 1))')
    expect(out).toContain('font-size: calc(14px * var(--fo-ui-scale, 1))')
    expect(out).toContain('line-height: 1.6')
    expect(out).not.toContain("line-height: 'calc")
  })

  it('does not rewrite zoom or transform', () => {
    const src = `style={{ zoom: 1.2, transform: 'scale(1.1)', scale: 1.05 }}`
    expect(scaleTsxStyleLengths(src)).toBe(src)
  })
})

describe('scaleCssFilePixels', () => {
  it('scales stylesheet px except breakpoints and the scale formula', () => {
    const css = `
:root {
  --fo-ui-scale: clamp(1, min(calc(1 + (100vw - 1760px) / 3200px), calc(1 + (100vh - 980px) / 2200px)), 1.12);
}
@media (max-width: 768px) {
  .page-content { padding: 12px; }
}
.sidebar { width: 200px; }
.btn { font-size: 13px; }
`
    const out = scaleCssFilePixels(css)
    expect(out).toContain('100vw - 1760px')
    expect(out).toContain('@media (max-width: 768px)')
    expect(out).toContain('padding: calc(12px * var(--fo-ui-scale, 1));')
    expect(out).toContain('width: calc(200px * var(--fo-ui-scale, 1));')
    expect(out).toContain('font-size: calc(13px * var(--fo-ui-scale, 1));')
    expect(out).not.toMatch(/zoom\s*:/)
  })
})

describe('uiPx', () => {
  it('returns 0 unchanged and wraps other lengths', () => {
    expect(uiPx(0)).toBe('0')
    expect(uiPx(200)).toBe('calc(200px * var(--fo-ui-scale, 1))')
  })
})
