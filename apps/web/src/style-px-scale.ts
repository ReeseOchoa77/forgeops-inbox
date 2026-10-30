import { uiPx } from './ui-scale'

const LENGTH_PROPS = new Set([
  'fontSize',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingInline',
  'paddingBlock',
  'paddingInlineStart',
  'paddingInlineEnd',
  'paddingBlockStart',
  'paddingBlockEnd',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginInline',
  'marginBlock',
  'marginInlineStart',
  'marginInlineEnd',
  'gap',
  'rowGap',
  'columnGap',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'outlineWidth',
  'outlineOffset',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'flexBasis',
  'scrollMargin',
  'scrollPadding',
  'boxShadow',
  'textShadow',
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'outline',
  'inset',
])

const LENGTH_PROP_RE = new RegExp(
  `(?<![\\w-])(${[...LENGTH_PROPS].sort((a, b) => b.length - a.length).join('|')})\\s*:`,
  'g'
)

function consumeBalancedValue(source: string, start: number): number {
  let i = start
  let depth = 0
  let quote: string | null = null
  while (i < source.length) {
    const c = source[i]!
    if (quote) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      i += 1
      continue
    }
    if (c === '(' || c === '{' || c === '[') {
      depth += 1
      i += 1
      continue
    }
    if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) return i
      depth -= 1
      i += 1
      continue
    }
    if (c === ',' && depth === 0) return i
    i += 1
  }
  return i
}

function scalePxInQuotedStrings(value: string): string {
  return value.replace(
    /(['"`])((?:\\.|(?!\1).)*?)\1/g,
    (full, quote: string, body: string) => {
      if (!body.includes('px') || body.includes('var(--fo-ui-scale')) return full
      const scaled = body.replace(
        /(-?\d*\.?\d+)px(?!\s*\*\s*var\(--fo-ui-scale)/g,
        (pxFull, n: string) => (n === '0' || n === '-0' ? pxFull : uiPx(Number(n)))
      )
      return `${quote}${scaled}${quote}`
    }
  )
}

function isInsideQuotes(source: string, index: number): boolean {
  let quote: string | null = null
  for (let i = 0; i < index; i += 1) {
    const c = source[i]!
    if (quote) {
      if (c === '\\') {
        i += 1
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
  }
  return quote !== null
}

function scaleBarePixelNumbers(value: string): string {
  return value.replace(/(?<![\w.$])(-?\d+(?:\.\d+)?)(?![\w.])/g, (full, n: string, offset: number) => {
    if (n === '0' || n === '-0') return full
    if (isInsideQuotes(value, offset)) return full
    const num = Number(n)
    if (!Number.isFinite(num)) return full
    return `'${uiPx(num)}'`
  })
}

/**
 * Rewrite CSS-length literals in TS/TSX style objects so they follow --fo-ui-scale.
 * Leaves percentages, vw/vh, identifiers, fontWeight, zIndex, lineHeight, flex, etc.
 */
function scaleCssTextInQuotedStrings(source: string): string {
  return source.replace(
    /(['"`])((?:\\.|(?!\1).)*?;(?:\\.|(?!\1).)*?px(?:\\.|(?!\1).)*?)\1/g,
    (full, quote: string, body: string) => {
      if (body.includes('var(--fo-ui-scale')) return full
      const scaled = body.replace(
        /(-?\d*\.?\d+)px(?!\s*\*\s*var\(--fo-ui-scale)/g,
        (pxFull, n: string) => (n === '0' || n === '-0' ? pxFull : uiPx(Number(n)))
      )
      return `${quote}${scaled}${quote}`
    }
  )
}

export function scaleTsxStyleLengths(source: string): string {
  source = scaleCssTextInQuotedStrings(source)
  LENGTH_PROP_RE.lastIndex = 0
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = LENGTH_PROP_RE.exec(source))) {
    if (isInsideQuotes(source, match.index)) {
      LENGTH_PROP_RE.lastIndex = match.index + match[0].length
      continue
    }
    const valueStart = match.index + match[0].length
    const valueEnd = consumeBalancedValue(source, valueStart)
    const rawValue = source.slice(valueStart, valueEnd)
    const scaledStrings = scalePxInQuotedStrings(rawValue)
    const scaled = scaleBarePixelNumbers(scaledStrings)
    out += source.slice(last, valueStart) + scaled
    last = valueEnd
    LENGTH_PROP_RE.lastIndex = valueEnd
  }
  return out + source.slice(last)
}

export function scaleCssFilePixels(css: string): string {
  const lines = css.split('\n')
  return lines
    .map((line) => {
      if (/@(media|supports|container|import)\b/i.test(line)) return line
      if (/100vw|100vh|--fo-ui-scale\s*:/.test(line)) return line
      return line.replace(
        /(-?\d*\.?\d+)px(?!\s*\*\s*var\(--fo-ui-scale)/g,
        (full, n: string) => (n === '0' || n === '-0' ? full : uiPx(Number(n)))
      )
    })
    .join('\n')
}
