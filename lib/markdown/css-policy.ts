import valueParser from 'postcss-value-parser'

// Any CSS function that can pull in an external resource (or execute legacy
// CSS). Default-deny by function name rather than blocklisting the `url(`
// token — image-set()/cross-fade()/element() reference resources without a
// `url(` substring, and expression() is legacy IE script execution.
const RESOURCE_FUNCTIONS = new Set([
  'url',
  'image',
  'image-set',
  'cross-fade',
  'element',
  'paint',
  'expression',
])

// Properties whose value is fetched/executed regardless of function shape.
const BANNED_PROPERTIES = new Set(['behavior', 'binding'])

// CSS escapes survive postcss serialization raw, and the browser decodes them
// at parse time — so `\75rl(…)` and `u\72 l(…)` both resolve to `url(`. Decode
// before inspecting so an escape-obfuscated name can't dodge detection. The
// browser normalizes CRLF to LF before tokenizing, so a hex escape's single
// optional trailing whitespace swallows a whole `\r\n`; match it as one unit or
// the stray `\n` splits the name and lets the reference through.
function cssUnescape(input: string): string {
  return input.replace(
    /\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|\\([^\n\r\f0-9a-fA-F])/g,
    (_match, hex: string | undefined, char: string | undefined) => {
      if (hex !== undefined) {
        try {
          return String.fromCodePoint(parseInt(hex, 16))
        } catch {
          return ''
        }
      }
      return char ?? ''
    },
  )
}

function normalizeIdent(name: string): string {
  return cssUnescape(name)
    .trim()
    .toLowerCase()
    .replace(/^-\w+-/, '')
}

export function declarationHasBannedValue(prop: string, value: string): boolean {
  if (BANNED_PROPERTIES.has(normalizeIdent(prop))) return true
  let banned = false
  valueParser(cssUnescape(value)).walk((node) => {
    if (node.type !== 'function') return undefined
    if (
      RESOURCE_FUNCTIONS.has(
        node.value
          .trim()
          .toLowerCase()
          .replace(/^-\w+-/, ''),
      )
    ) {
      banned = true
      return false
    }
    return undefined
  })
  return banned
}
