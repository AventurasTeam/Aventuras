import juice from 'juice'

import { createDomPurify, NAVIGATION_FORBID_ATTRS } from './purify-instance'

const purifyInstance = createDomPurify()

// Allow any CSS property, but strip any declaration containing url() to prevent external data exfiltration/tracking,
// or other browser-specific executable expressions.
function sanitizeStyleValue(value: string): string {
  return value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      const lowerDecl = decl.toLowerCase()
      return (
        lowerDecl.length > 0 &&
        !lowerDecl.includes('url(') &&
        !lowerDecl.includes('expression(') &&
        !lowerDecl.includes('behavior')
      )
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
