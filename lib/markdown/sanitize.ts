import DOMPurify from 'dompurify'
import juice from 'juice'

// DOMPurify requires a DOM window to initialize its hooks and sanitization methods.
// During Expo Router's static pre-rendering (which runs on Node.js), `window` is undefined,
// causing DOMPurify to return an empty unsupported instance lacking these methods.
// We dynamically initialize it using JSDOM on the server, or a non-crashing fallback.
let purifyInstance: typeof DOMPurify

if (typeof window !== 'undefined') {
  purifyInstance = DOMPurify
} else {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JSDOM } = require('jsdom')
    purifyInstance = DOMPurify(new JSDOM('').window)
  } catch {
    const mock = (() => {}) as any
    mock.addHook = () => {}
    mock.sanitize = (html: string) => html
    purifyInstance = mock
  }
}

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
  return purifyInstance.sanitize(inlined)
}
