// @vitest-environment jsdom
// DOMPurify needs a real `window`; the shared lib/** project runs under `environment: 'node'`.
import { describe, expect, it } from 'vitest'

import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('strips script tags and inline event handlers', () => {
    const dirty = '<p>hi</p><script>alert(1)</script><img src=x onerror=alert(2)>'
    const clean = sanitizeHtml(dirty)
    expect(clean).not.toContain('<script>')
    expect(clean).not.toContain('onerror')
    expect(clean).toContain('<p>hi</p>')
  })

  it('keeps the narrative allowlist (em, strong, blockquote, code)', () => {
    const html = '<p><em>a</em> <strong>b</strong></p><blockquote>c</blockquote><code>d</code>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('drops disallowed tags but keeps their text content', () => {
    expect(sanitizeHtml('<iframe src="evil">nope</iframe>')).not.toContain('<iframe')
  })
})
