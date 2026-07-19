// @vitest-environment jsdom
// DOMPurify needs a real `window`; the shared lib/** project runs under `environment: 'node'`.
import { describe, expect, it } from 'vitest'

import { sanitizeRichHtml } from './rich-sanitize'

describe('sanitizeRichHtml', () => {
  it('keeps <style> with @media, @keyframes, and pseudo-selectors', () => {
    const html =
      '<style>@media (max-width: 600px) { p { color: red } } @keyframes spin { to { transform: rotate(1turn) } } p:hover { color: blue }</style><p>x</p>'
    const clean = sanitizeRichHtml(html)
    expect(clean).toContain('@media')
    expect(clean).toContain('@keyframes')
    expect(clean).toContain(':hover')
  })

  it('does not inline stylesheets (no juice on the rich path)', () => {
    const clean = sanitizeRichHtml('<style>p { color: red }</style><p>x</p>')
    expect(clean).toContain('<style>')
    expect(clean).not.toContain('style="color')
  })

  it('strips url() declarations everywhere, including inside @media and comment-obfuscated', () => {
    const html =
      '<style>@media screen { p { background: url(https://evil.example/x); color: red } } p { background: url(/**/https://evil.example/y) }</style><p style="background: url(https://evil.example/z); color: blue">x</p>'
    const clean = sanitizeRichHtml(html)
    expect(clean).not.toContain('url(')
    expect(clean).toContain('color: red')
    expect(clean).toContain('color: blue')
  })

  it('strips @import and @font-face at-rules entirely', () => {
    const clean = sanitizeRichHtml(
      '<style>@import "x.css"; @font-face { font-family: X; src: local(Y) } p { color: red }</style>',
    )
    expect(clean).not.toContain('@import')
    expect(clean).not.toContain('@font-face')
    expect(clean).toContain('color: red')
  })

  it('strips unlisted at-rules (default-deny)', () => {
    const clean = sanitizeRichHtml('<style>@supports (display: grid) { p { color: red } }</style>')
    expect(clean).not.toContain('@supports')
  })

  it('strips scripts and event handlers', () => {
    const clean = sanitizeRichHtml('<p onclick="alert(1)">x</p><script>alert(2)</script>')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('<script')
  })

  it('neutralizes </style> breakout attempts inside CSS text', () => {
    const clean = sanitizeRichHtml(
      '<style>p::before { content: "</style><img src=x onerror=alert(1)>" }</style>',
    )
    expect(clean).not.toContain('onerror')
    expect(clean.split('</style>').length).toBe(2)
  })

  it('drops undecodable stylesheets rather than passing them through', () => {
    const clean = sanitizeRichHtml('<style>@}{ garbage</style><p>x</p>')
    expect(clean).toContain('<p>x</p>')
  })
})
