import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { isIos, supportsHover } from './platform'
import { isMobileDevice } from './swipe'
import { openFilters } from './dialogFilters'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
// What an iPad's WKWebView reports by default.
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

function withNavigator(userAgent: string, maxTouchPoints: number) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints })
  vi.stubGlobal('window', {})
}

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

describe('isIos', () => {
  it('recognises an iPhone', () => {
    withNavigator(IPHONE_UA, 5)
    expect(isIos()).toBe(true)
  })

  it('recognises an iPad reporting a Mac user agent', () => {
    withNavigator(IPAD_UA, 5)
    expect(isIos()).toBe(true)
  })

  it('does not treat a Mac user agent without touch as iOS', () => {
    withNavigator(IPAD_UA, 0)
    expect(isIos()).toBe(false)
  })
})

describe('iPad file dialogs', () => {
  it('counts as a mobile device', () => {
    withNavigator(IPAD_UA, 5)
    expect(isMobileDevice()).toBe(true)
  })

  it('drops open-dialog filters iOS cannot map', () => {
    withNavigator(IPAD_UA, 5)
    expect(openFilters([{ name: 'Aventura', extensions: ['avt', '*'] }])).toBeUndefined()
  })
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
    expect(css).toMatch(
      /@custom-variant can-hover \{\s*@media \(hover: hover\) \{\s*@media not all and \(any-pointer: coarse\) \{\s*@slot;/,
    )
  })
})