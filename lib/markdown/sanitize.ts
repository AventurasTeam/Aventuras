import juice from 'juice'

import { declarationHasBannedValue } from './css-policy'
import { createDomPurify, NAVIGATION_FORBID_ATTRS } from './purify-instance'

const purifyInstance = createDomPurify()

// Allow any CSS property, but strip declarations that fetch an external
// resource or execute legacy CSS (see css-policy: url()/image-set()/
// expression()/behavior, including escape-obfuscated forms).
function sanitizeStyleValue(value: string): string {
  return value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (decl.length === 0) return false
      const colon = decl.indexOf(':')
      const prop = colon >= 0 ? decl.slice(0, colon) : ''
      const val = colon >= 0 ? decl.slice(colon + 1) : decl
      return !declarationHasBannedValue(prop, val)
    })
    .join('; ')
}

purifyInstance.addHook('uponSanitizeAttribute', (_node, data) => {
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
  // We do not restrict ALLOWED_TAGS or ALLOWED_ATTR to let DOMPurify's default safe allowlist
  // handle the elements (allowing divs, tables, spans, custom margins/padding via style, etc.).
  return purifyInstance.sanitize(inlined, { FORBID_ATTR: NAVIGATION_FORBID_ATTRS })
}
