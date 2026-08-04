import { describe, it, expect } from 'vitest'
import { scopeCssSelectors } from './cssScope'

/**
 * Scoping is the only thing standing between one story entry's `<style>` block and the rest
 * of the app. Visual Prose HTML is model-generated, so the CSS here is not authored by anyone
 * who knows what the app's own class names are: a bare `p { }` or `:root { }` reaching the
 * document is a broken UI, not a broken entry.
 *
 * Every test below is therefore about the same question -- did the selector come out reachable
 * only from inside `.scope`? -- rather than about exact whitespace, which the implementation is
 * free to change.
 */

const SCOPE = 'vp-abc123'

/** Whitespace between tokens is an implementation detail; what is scoped is not. */
function normalize(css: string): string {
  return css.replace(/\s+/g, ' ').trim()
}

function scope(css: string): string {
  return normalize(scopeCssSelectors(css, SCOPE))
}

describe('scopeCssSelectors', () => {
  it('prefixes a bare element selector', () => {
    expect(scope('p { color: red; }')).toBe(`.${SCOPE} p{ color: red; }`)
  })

  it('prefixes every selector in a comma-separated list, not just the first', () => {
    expect(scope('p, span { color: red; }')).toBe(`.${SCOPE} p, .${SCOPE} span{ color: red; }`)
  })

  it('keeps descendant and child combinators intact', () => {
    expect(scope('.a .b, .c > .d { color: red; }')).toBe(
      `.${SCOPE} .a .b, .${SCOPE} .c > .d{ color: red; }`,
    )
  })

  it('rewrites :root to the scope itself rather than nesting under it', () => {
    // `.scope :root` would match nothing -- :root is the document element, which is always
    // an ancestor of the scope, never a descendant. Custom properties declared there would
    // silently never apply.
    expect(scope(':root { --x: 1px; }')).toBe(`.${SCOPE}{ --x: 1px; }`)
  })

  it('scopes selectors inside a @media query without scoping the query itself', () => {
    const result = scope('@media (max-width: 600px) { p { color: blue; } }')
    expect(result).toContain('@media (max-width: 600px)')
    expect(result).toContain(`.${SCOPE} p{`)
    expect(result).not.toContain(`.${SCOPE} @media`)
  })

  it('leaves @keyframes step selectors alone', () => {
    // `.scope 0%` is not a valid keyframe step: scoping these breaks the animation outright.
    const css = '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }'
    expect(scope(css)).toBe(normalize(css))
  })

  it('leaves percentage keyframe steps alone', () => {
    const css = '@keyframes fade { 0% { opacity: 0; } 100% { opacity: 1; } }'
    expect(scope(css)).toBe(normalize(css))
  })

  it('scopes a rule that follows a @keyframes block', () => {
    // Regression: @keyframes is swapped out for a `__KEYFRAMES_n__` placeholder before the
    // selectors are processed, and that placeholder lands in the *same* regex match as the
    // next selector -- `__KEYFRAMES_0__ .a` is one chunk. Skipping the whole chunk because it
    // started with a placeholder left every rule after an animation unscoped and leaking into
    // the app. Rules *before* the animation were scoped normally, which is why it looked fine.
    const result = scope('@keyframes k { from { opacity: 0; } } .a { color: red; }')
    expect(result).toContain(`.${SCOPE} .a{`)
    expect(result).toContain('@keyframes k')
    expect(result).not.toContain('__KEYFRAMES_')
  })

  it('scopes a rule that follows several consecutive @keyframes blocks', () => {
    const result = scope(
      '@keyframes a { from { opacity: 0; } }@keyframes b { from { opacity: 1; } }.x { color: red; }',
    )
    expect(result).toContain(`.${SCOPE} .x{`)
    expect(result).not.toContain('__KEYFRAMES_')
  })

  it('never leaves a placeholder in the output', () => {
    // A leaked `__KEYFRAMES_0__` is worse than an unscoped rule: it is invalid CSS that takes
    // the rule it is attached to down with it.
    const css = '.a { color: red; } @keyframes k { from { opacity: 0; } } .b { color: blue; }'
    expect(scope(css)).not.toContain('__KEYFRAMES_')
  })

  it('scopes rules on both sides of a @keyframes block', () => {
    const result = scope('.a { color: red; } @keyframes k { from { opacity: 0; } } .b { top: 0; }')
    expect(result).toContain(`.${SCOPE} .a{`)
    expect(result).toContain(`.${SCOPE} .b{`)
  })

  it('returns empty input unchanged', () => {
    expect(scopeCssSelectors('', SCOPE)).toBe('')
  })

  it('leaves CSS with no rules unchanged', () => {
    expect(scope('/* just a comment */')).toBe('/* just a comment */')
  })
})
