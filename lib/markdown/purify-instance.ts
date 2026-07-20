import DOMPurify from 'dompurify'

// Anchor policy: entry HTML never carries a navigation vector — links render
// as plain text on every path. Stripping at sanitize is the single
// enforcement point; the document click interceptor and both nav locks stay
// as regression backstops. xlink:href covers SVG anchors; action/formaction
// cover form submits; target and ping die with href.
export const NAVIGATION_FORBID_ATTRS = [
  'href',
  'xlink:href',
  'target',
  'action',
  'formaction',
  'ping',
]

// DOMPurify needs a DOM window. During Expo Router's static pre-rendering
// (Node), `window` is undefined — fall back to JSDOM, or a pass-through mock
// where jsdom isn't installed. Each caller gets its own instance: hooks are
// per-instance, and the plain and rich sanitize paths install different ones.
export function createDomPurify(): typeof DOMPurify {
  if (typeof window !== 'undefined') return DOMPurify(window)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JSDOM } = require('jsdom')
    return DOMPurify(new JSDOM('').window)
  } catch {
    // Fail closed: with no real sanitizer available, never emit untrusted markup
    // unmodified. Only reachable during Node prerender without jsdom, never at
    // device/Electron runtime where `window` exists.
    const mock = (() => {}) as any
    mock.addHook = () => {}
    mock.sanitize = () => ''
    return mock
  }
}
