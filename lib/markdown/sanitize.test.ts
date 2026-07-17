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

  it('strips inline style with a url() payload (CSS-exfiltration surface)', () => {
    const clean = sanitizeHtml('<p style="background: url(https://evil.example/x)">text</p>')
    expect(clean).not.toContain('style')
    expect(clean).not.toContain('url(')
    expect(clean).toContain('<p>text</p>')
  })

  it('keeps allowlisted style properties (color, font-weight)', () => {
    const clean = sanitizeHtml('<p style="color: red; font-weight: bold">text</p>')
    expect(clean).toContain('style="color: red; font-weight: bold"')
  })

  it('drops disallowed style properties while keeping allowlisted ones', () => {
    const clean = sanitizeHtml(
      '<p style="color: red; background: url(https://evil.example/x)">text</p>',
    )
    expect(clean).toContain('style="color: red"')
    expect(clean).not.toContain('url(')
  })

  it('keeps font/color for legacy AI output presets', () => {
    const clean = sanitizeHtml('<font color="red">text</font>')
    expect(clean).toBe('<font color="red">text</font>')
  })

  it('allows rich safe HTML tags (div, table, tr, td) and custom layout CSS styles (margin, padding, background-color)', () => {
    const dirty =
      '<div style="margin: 10px; padding: 20px; background-color: blue;"><table><tr><td>cell</td></tr></table></div>'
    const clean = sanitizeHtml(dirty)
    expect(clean).toContain('<div')
    expect(clean).toContain('style="margin: 10px; padding: 20px; background-color: blue"')
    expect(clean).toContain('<table><tbody><tr><td>cell</td></tr></tbody></table></div>')
  })
})
