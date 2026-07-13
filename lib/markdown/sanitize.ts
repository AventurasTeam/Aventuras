import DOMPurify from 'dompurify'
import juice from 'juice'

const ALLOWED_TAGS = [
  'p',
  'em',
  'strong',
  'blockquote',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'br',
  'hr',
  'a',
  'span',
  'font',
]
const ALLOWED_ATTR = ['href', 'class', 'style', 'color']

// `style` values are limited to this property allowlist rather than
// blacklisting patterns like `url(` — the allowed properties' value grammar
// has no URL/expression form, so there's no exfiltration surface to filter.
const ALLOWED_STYLE_PROPS = new Set(['color', 'font-weight', 'font-style', 'text-decoration'])

function sanitizeStyleValue(value: string): string {
  return value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      const prop = decl.split(':')[0]?.trim().toLowerCase()
      return prop != null && ALLOWED_STYLE_PROPS.has(prop)
    })
    .join('; ')
}

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName !== 'style') return
  const safe = sanitizeStyleValue(data.attrValue)
  if (safe.length === 0) {
    data.keepAttr = false
    return
  }
  data.attrValue = safe
})

export function sanitizeHtml(html: string): string {
  const inlined = juice(html)
  return DOMPurify.sanitize(inlined, { ALLOWED_TAGS, ALLOWED_ATTR })
}
