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
    expect(plain('A<script>alert(1)</script>B')).toBe('AB')
  })

  it('hides everything after an unclosed style or script', () => {
    expect(plain('It hums.\n<style>.x { color: red; anim')).toBe('It hums.')
    expect(plain('It hums.\n<style>\n.x { color: red; }\n.y { anim')).toBe('It hums.')
    expect(plain('A <script>x = 1')).toBe('A')
  })

  it('keeps element text and leaves a lone angle bracket in prose alone', () => {
    expect(plain('<div style="padding: 4px">Case after case</div>')).toBe('Case after case')
    expect(plain('if a < b then')).toBe('if a < b then')
  })

  it('leaves an incomplete tag as the literal text the reader shows', () => {
    expect(plain('She typed <grin and walked off into the night.')).toBe(
      'She typed <grin and walked off into the night.',
    )
    expect(plain('a <span title="open> c')).toBe('a <span title="open> c')
    expect(plain('a </span x> c')).toBe('a </span x> c')
  })

  it('reads a tag by its attribute grammar, so a quoted `>` stays inside it', () => {
    expect(plain('a <span title="x > y">z</span> w')).toBe('a z w')
    expect(plain('x <p\nclass="a">in</p> y')).toBe('x in y')
    expect(plain('a <foo-bar x=1>b</foo-bar> c')).toBe('a b c')
  })

  it('shows a tag inside a code span as text, as the reader does', () => {
    expect(plain('Use `<b>` for bold.')).toBe('Use <b> for bold.')
    // The tag opens first, so it owns the backtick in its attribute.
    expect(plain('<span title="`">y</span> and `z`')).toBe('y and z')
  })

  it('joins inline elements to their neighbours and breaks at block ones', () => {
    expect(plain('hel<em>lo</em> w<strong>or</strong>ld')).toBe('hello world')
    expect(plain('The <SPAN>room</SPAN>s')).toBe('The rooms')
    expect(plain('a<wbr>b')).toBe('ab')
    expect(plain('<p>one</p><p>two</p>')).toBe('one two')
    expect(plain('a<br>b')).toBe('a b')
  })

  it('hides a closed comment, and an unclosed one only where it opens a line', () => {
    expect(plain('a <!-- aside --> b')).toBe('a b')
    expect(plain('<!-- <style> --> after')).toBe('after')
    expect(plain('Before\n<!-- never closed\nprose')).toBe('Before')
    expect(plain('Before <!-- never closed and prose')).toBe('Before <!-- never closed and prose')
  })

  it('keeps ordered-list numbers, which the reader shows, and drops bullet markers', () => {
    expect(plain('1984. It was cold.')).toBe('1984. It was cold.')
    expect(plain('1. item\n2. two')).toBe('1. item 2. two')
    expect(plain('- item\n* other\n+ third')).toBe('item other third')
  })

  it('reduces markdown to its text', () => {
    expect(plain('## The Long Gallery')).toBe('The Long Gallery')
    expect(plain('She **ran**, then *stopped* at `door`.')).toBe('She ran, then stopped at door.')
    expect(plain('a __bold__ and _quiet_ word')).toBe('a bold and quiet word')
    expect(plain('see [the map](https://x.test) and ![a sigil](s.png)')).toBe(
      'see the map and a sigil',
    )
    expect(plain('> a quote\n- a list item\n1. a step')).toBe('a quote a list item 1. a step')
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

  it('leaves an unknown name alone, including one on Object.prototype', () => {
    expect(plain('a &constructor; b &bogus; c')).toBe('a &constructor; b &bogus; c')
  })
})
