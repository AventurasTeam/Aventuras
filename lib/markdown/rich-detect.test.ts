import { describe, expect, it } from 'vitest'

import { parseMarkdownToHtml } from './parse'
import { detectRichEntryHtml } from './rich-detect'

describe('detectRichEntryHtml', () => {
  it('keeps plain narrative markup on the plain path', () => {
    expect(detectRichEntryHtml('<p>Hello <em>world</em> <strong>b</strong></p>')).toBe(false)
  })

  it('keeps translatable inline styles plain (background: red)', () => {
    expect(detectRichEntryHtml('<p style="background: red; color: blue">x</p>')).toBe(false)
  })

  it('flags value-level misses a property list cannot catch (linear-gradient)', () => {
    expect(detectRichEntryHtml('<div style="background: linear-gradient(red, blue)">x</div>')).toBe(
      true,
    )
  })

  it('flags web-compat-bucket-only props (position)', () => {
    expect(detectRichEntryHtml('<div style="position: absolute">x</div>')).toBe(true)
  })

  it('keeps invalid values of supported properties plain (oracle passes them through)', () => {
    expect(detectRichEntryHtml('<p style="color: notacolor">x</p>')).toBe(false)
  })

  it('flags <style> with @media / @keyframes / @import', () => {
    expect(
      detectRichEntryHtml('<style>@media (max-width: 600px) { p { color: red } }</style>'),
    ).toBe(true)
    expect(
      detectRichEntryHtml('<style>@keyframes spin { to { transform: rotate(1turn) } }</style>'),
    ).toBe(true)
    expect(detectRichEntryHtml('<style>@import url("x.css");</style>')).toBe(true)
  })

  it('flags pseudo-selectors in <style>', () => {
    expect(detectRichEntryHtml('<style>p:hover { color: red }</style>')).toBe(true)
    expect(detectRichEntryHtml('<style>p::before { content: "x" }</style>')).toBe(true)
  })

  it('keeps a fully translatable <style> rule plain (juice inlines it downstream)', () => {
    expect(detectRichEntryHtml('<style>p { color: red }</style>')).toBe(false)
  })

  it('flags untranslatable declarations inside <style> rules', () => {
    expect(detectRichEntryHtml('<style>div { display: grid }</style>')).toBe(true)
  })

  it('flags tables, including GFM pipe tables through marked', () => {
    expect(detectRichEntryHtml('<table><tr><td>x</td></tr></table>')).toBe(true)
    expect(detectRichEntryHtml(parseMarkdownToHtml('| a | b |\n| - | - |\n| 1 | 2 |'))).toBe(true)
  })

  it('flags tags without an RNRH element model', () => {
    expect(detectRichEntryHtml('<marquee>x</marquee>')).toBe(true)
  })

  it('ignores document-structure wrapper tags', () => {
    expect(detectRichEntryHtml('<body><p>x</p></body>')).toBe(false)
  })

  it('errs toward rich on unparseable CSS instead of throwing', () => {
    expect(() => detectRichEntryHtml('<style>@}{ garbage')).not.toThrow()
    expect(detectRichEntryHtml('<p style=";;;">x</p>')).toBe(false)
  })
})
