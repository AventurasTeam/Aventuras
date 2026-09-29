import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { supportsHover } from './platform'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

/** A window whose media queries report the given input capabilities. */
function withInputs({ hover, coarse }: { hover: boolean; coarse: boolean }) {
  const matches: Record<string, boolean> = {
    '(hover: hover)': hover,
    '(any-pointer: coarse)': coarse,
  }
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: matches[query] ?? false }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supportsHover', () => {
  it.each([
    ['a mouse or trackpad with no touch screen', true, { hover: true, coarse: false }],
    ['a phone or tablet', false, { hover: false, coarse: true }],
    ['a touchscreen laptop, trackpad primary', false, { hover: true, coarse: true }],
    ['an input that neither hovers nor touches', false, { hover: false, coarse: false }],
  ])('on %s is %s', (_, expected, inputs) => {
    withInputs(inputs)
    expect(supportsHover()).toBe(expected)
  })

  it.each([
    ['Android', ANDROID_UA, false],
    ['desktop', DESKTOP_UA, true],
  ])('without matchMedia, follows the user agent on %s', (_, userAgent, expected) => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { userAgent })
    expect(supportsHover()).toBe(expected)
  })
})

describe('the can-hover variant in app.css', () => {
  it('tests the same condition as supportsHover', () => {
    const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8')
    expect(css).toContain('(hover: hover)')
    expect(css).toContain('not all and (any-pointer: coarse)')
  })
})
