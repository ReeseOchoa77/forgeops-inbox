import type { Plugin } from 'vite'
import { scaleCssFilePixels, scaleTsxStyleLengths } from './src/style-px-scale'

const SRC = '/src/'

export function forgeopsUiScalePlugin(): Plugin {
  return {
    name: 'forgeops-ui-scale',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0] ?? id
      if (!path.includes(SRC)) return null
      if (path.includes('.test.')) return null
      if (path.endsWith('ui-scale.ts') || path.endsWith('style-px-scale.ts')) return null
      if (path.endsWith('.css')) {
        return { code: scaleCssFilePixels(code), map: null }
      }
      if (path.endsWith('.tsx') || path.endsWith('.ts')) {
        const next = scaleTsxStyleLengths(code)
        if (next === code) return null
        return { code: next, map: null }
      }
      return null
    },
  }
}
