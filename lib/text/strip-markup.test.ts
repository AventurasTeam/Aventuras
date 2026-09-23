import { describe, expect, it } from 'vitest'

import { stripMarkup } from './strip-markup'

// Previews collapse whitespace anyway (excerpt()), so compare what a reader would see.
const plain = (source: string) => stripMarkup(source).replace(/\s+/g, ' ').trim()

describe('stripMarkup', () => {
  it('drops style and script bodies, not just their tags', () => {
    expect(
      plain(
        'Something pulses.\n\n<style>@keyframes p { 50% { opacity: 0.35 } }</style><p>Glow</p>',
      ),
    ).toBe('Something pulses. Glow')
    expect(plain('A<script>alert(1)</script>B')).toBe('A B')
  })

  it('treats a style block or tag cut off at the window edge as running to the end', () => {
    expect(plain('It hums.\n<style>.x { color: red; anim')).toBe('It hums.')
    expect(plain('Two alcoves.\n<div style="display: grid; gap: 8p')).toBe('Two alcoves.')
  })

  it('keeps element text and leaves a lone angle bracket in prose alone', () => {
    expect(plain('<div style="padding: 4px">Case after case</div>')).toBe('Case after case')
    expect(plain('if a < b then')).toBe('if a < b then')
  })

  it('reduces markdown to its text', () => {
    expect(plain('## The Long Gallery')).toBe('The Long Gallery')
    expect(plain('She **ran**, then *stopped* at `door`.')).toBe('She ran, then stopped at door.')
    expect(plain('a __bold__ and _quiet_ word')).toBe('a bold and quiet word')
    expect(plain('see [the map](https://x.test) and ![a sigil](s.png)')).toBe(
      'see the map and a sigil',
    )
    expect(plain('> a quote\n- a list item\n1. a step')).toBe('a quote a list item a step')
  })

  it('keeps underscores inside words', () => {
    expect(plain('snake_case_name stays')).toBe('snake_case_name stays')
  })

  it('flattens a pipe table to its cells', () => {
    expect(plain('| Room | Style |\n| ---- | ----- |\n| I | Gradient |')).toBe(
      'Room Style I Gradient',
    )
  })

  it('decodes the common entities after tags are gone', () => {
    expect(plain('Tom &amp; Jerry &lt;3 &#8212; &quot;hi&quot;')).toBe('Tom & Jerry <3 — "hi"')
  })
})
