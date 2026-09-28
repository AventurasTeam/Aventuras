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
  vi.stubGlobal('navigator', { userAgent: DESKTOP_UA })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supportsHover', () => {
  it.each([
    ['a mouse or trackpad with no touch screen', { hover: true, coarse: false }, true],
    ['a phone or tablet', { hover: false, coarse: true }, false],
    ['a touchscreen laptop, trackpad primary', { hover: true, coarse: true }, false],
    ['an input that neither hovers nor touches', { hover: false, coarse: false }, false],
  ])('on %s is %s', (_, inputs, expected) => {
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
