import DOMPurify from 'dompurify'

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
    const mock = (() => {}) as any
    mock.addHook = () => {}
    mock.sanitize = (html: string) => html
    return mock
  }
}
