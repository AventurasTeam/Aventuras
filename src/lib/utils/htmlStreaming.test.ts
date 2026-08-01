import { describe, it, expect } from 'vitest'
import { StreamingHtmlRenderer } from './htmlStreaming'

/**
 * Visual Prose arrives one token at a time, so at every chunk boundary the renderer holds
 * something that is not valid HTML yet: half a tag, half a `<style>` block, half a `<pic>`.
 * Handing that to the DOM is what produces the flicker of a half-written attribute appearing
 * as text, or a `<style>` block applying while its selectors are still being typed.
 *
 * These tests are about the buffering contract: what `append` is willing to emit, and what it
 * holds back until the next chunk makes it safe.
 */

const ENTRY_ID = 'abcdef1234567890'
const SCOPE = 'vp-abcdef12'

/** The renderer always returns its output wrapped; the wrapper is not what is under test. */
function inner(wrapped: string): string {
  const open = `<div class="${SCOPE} visual-prose-entry">`
  expect(wrapped.startsWith(open)).toBe(true)
  expect(wrapped.endsWith('</div>')).toBe(true)
  return wrapped.slice(open.length, -'</div>'.length)
}

/** Feed chunks in order, returning the rendered inner HTML after each one. */
function stream(...chunks: string[]) {
  const renderer = new StreamingHtmlRenderer(ENTRY_ID)
  const steps = chunks.map((chunk) => inner(renderer.append(chunk)))
  return { steps, at: (i: number) => steps[i], last: steps[steps.length - 1], renderer }
}

describe('StreamingHtmlRenderer — scope class', () => {
  it('derives the scope from the first 8 characters of the entry id', () => {
    // Entries are styled independently, so two entries must never land on the same class.
    // Truncating means the derivation has to stay put: change the length and every stored
    // entry's CSS stops matching its own markup.
    const output = new StreamingHtmlRenderer(ENTRY_ID).append('')
    expect(output).toContain(`class="${SCOPE} visual-prose-entry"`)
  })
})

describe('StreamingHtmlRenderer — incomplete tags', () => {
  it('emits a complete tag as soon as it closes', () => {
    expect(stream('<p>hi</p>').last).toBe('<p>hi</p>')
  })

  it('holds back a tag that is still being written', () => {
    expect(stream('<p>hi</p><di').last).toBe('<p>hi</p>')
  })

  it('releases the held tag once the next chunk closes it', () => {
    const { at } = stream('<p>hi</p><di', 'v>x</div>')
    expect(at(0)).toBe('<p>hi</p>')
    expect(at(1)).toBe('<p>hi</p><div>x</div>')
  })

  it('accumulates across chunks rather than re-emitting only the newest', () => {
    const { at } = stream('<p>a</p>', '<p>b</p>')
    expect(at(0)).toBe('<p>a</p>')
    expect(at(1)).toBe('<p>a</p><p>b</p>')
  })

  it('does not mistake a > inside an attribute value for the end of the tag', () => {
    expect(stream('<p title="a>b">x</p>').last).toBe('<p title="a>b">x</p>')
  })

  it('holds back an unterminated comment', () => {
    expect(stream('<p>a</p><!-- c').last).toBe('<p>a</p>')
  })

  it('emits a comment once it closes', () => {
    expect(stream('<p>a</p><!-- c -->').last).toBe('<p>a</p><!-- c -->')
  })
})

describe('StreamingHtmlRenderer — style blocks', () => {
  it('emits nothing of a style block until it closes', () => {
    // A half-written `<style>` is not merely invisible: the browser applies the selectors it
    // has, so `.a { color` mid-stream can style the wrong thing for one frame.
    expect(stream('<style>p{color:red}').last).toBe('')
  })

  it('holds the style block back but keeps prose written before it', () => {
    expect(stream('<p>a</p><style>p{color:red}').last).toBe('<p>a</p>')
  })

  it('scopes the CSS once the block closes', () => {
    const { at } = stream('<style>p{color:red}', '</style><p>x</p>')
    expect(at(0)).toBe('')
    expect(at(1)).toBe(`<style>.${SCOPE} p{color:red}</style><p>x</p>`)
  })

  it('scopes a rule that follows a @keyframes block inside the stream', () => {
    // Guards the same leak as cssScope.test.ts, but through the path that actually runs
    // during generation -- the two have drifted apart before.
    const output = stream('<style>@keyframes k{from{opacity:0}}.a{color:red}</style>').last
    expect(output).toContain(`.${SCOPE} .a{color:red}`)
    expect(output).toContain('@keyframes k')
    expect(output).not.toContain('__KEYFRAMES_')
  })
})

describe('StreamingHtmlRenderer — pic tags', () => {
  it('emits a complete self-closing pic tag', () => {
    const tag = '<pic prompt="a long enough prompt" />'
    expect(stream(tag).last).toBe(tag)
  })

  it('holds back a pic tag whose attributes are still arriving', () => {
    // Emitting it early would render the placeholder against a truncated prompt, and the
    // image request downstream is keyed on the tag text.
    expect(stream('<p>a</p><pic prompt="something long here"').last).toBe('<p>a</p>')
  })

  it('releases the pic tag once it closes', () => {
    const { at } = stream('<p>a</p><pic prompt="something long here"', ' />')
    expect(at(0)).toBe('<p>a</p>')
    expect(at(1)).toBe('<p>a</p><pic prompt="something long here" />')
  })
})

describe('StreamingHtmlRenderer — flush and raw content', () => {
  it('emits whatever is still buffered, including a broken tag', () => {
    // Deliberate: flush runs when generation is over, so a tag that never closed is never
    // going to. Losing the text is worse than emitting markup the sanitizer will drop.
    const renderer = new StreamingHtmlRenderer(ENTRY_ID)
    renderer.append('<p>hi</p><di')
    expect(inner(renderer.flush())).toBe('<p>hi</p><di')
  })

  it('scopes a style block that only closes at flush time', () => {
    const renderer = new StreamingHtmlRenderer(ENTRY_ID)
    renderer.append('<style>p{color:red}</style>')
    expect(inner(renderer.flush())).toBe(`<style>.${SCOPE} p{color:red}</style>`)
  })

  it('leaves nothing buffered after a flush', () => {
    const renderer = new StreamingHtmlRenderer(ENTRY_ID)
    renderer.append('<p>hi</p><di')
    renderer.flush()
    expect(inner(renderer.flush())).toBe('<p>hi</p><di')
  })

  it('returns content without the wrapper but WITH the scope already applied', () => {
    // Pinning current behaviour, not endorsing it. `getRawContent()` is what `ui.endStreaming`
    // persists as the entry's content, and it hands back `safeHtml`, which has already been
    // through `scopeCssSelectors`. On the next render `sanitizeVisualProse` scopes it a second
    // time, producing `.vp-x .vp-x p` -- a selector that matches nothing, because the wrapper
    // has no `.vp-x` descendant. Visual Prose CSS therefore applies while it streams and stops
    // applying once the entry is re-rendered from storage.
    //
    // Fixing it means accumulating the unscoped text separately and returning that; changing
    // it also leaves already-stored entries carrying a scope prefix, so it needs a decision
    // about those rather than a one-line change. This test is here to fail loudly when someone
    // makes that decision.
    const renderer = new StreamingHtmlRenderer(ENTRY_ID)
    renderer.append('<style>p{color:red}</style><p>hi</p><di')
    expect(renderer.getRawContent()).toBe(
      `<style>.${SCOPE} p{color:red}</style><p>hi</p><di`, // <- should be the unscoped source
    )
  })
})
