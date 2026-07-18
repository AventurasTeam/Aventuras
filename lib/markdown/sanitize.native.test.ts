import { describe, expect, it } from 'vitest'

import { sanitizeHtml } from './sanitize.native'

describe('sanitizeHtml (native)', () => {
  it('inlines <style> rules into style attributes and drops the style tag', () => {
    const out = sanitizeHtml('<style>p { color: red; }</style><p>The keep looms.</p>')
    expect(out).toContain('<p style="color: red;">The keep looms.</p>')
    expect(out).not.toContain('<style>')
  })

  it('merges stylesheet rules with existing inline styles', () => {
    const out = sanitizeHtml(
      '<style>span { color: red; }</style><span style="font-weight: bold;">x</span>',
    )
    expect(out).toContain('font-weight: bold')
    expect(out).toContain('color: red')
  })

  it('leaves plain markdown-derived HTML untouched', () => {
    const html = '<p>Once <strong>upon</strong> a time.</p>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('degrades to the raw html instead of throwing on malformed input', () => {
    expect(() => sanitizeHtml('<style>p { color: </style><p>x</p>')).not.toThrow()
    expect(sanitizeHtml('<style>p { color: </style><p>x</p>')).toContain('<p')
  })
})
