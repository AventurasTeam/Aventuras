import { describe, it, expect, vi, afterEach } from 'vitest'
import { isIos } from './platform'
import { isMobileDevice } from './swipe'
import { openFilters } from './dialogFilters'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
// What an iPad's WKWebView reports by default.
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

function withNavigator(userAgent: string, maxTouchPoints: number) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints })
  vi.stubGlobal('window', {})
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
