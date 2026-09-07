import { describe, it, expect, vi, afterEach } from 'vitest'
import { supportsDirectoryTransfer } from './support'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

function withUserAgent(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supportsDirectoryTransfer', () => {
  it('is unavailable on Android, which has no folder picker', () => {
    withUserAgent(ANDROID_UA)
    expect(supportsDirectoryTransfer()).toBe(false)
  })

  it('is available on desktop', () => {
    withUserAgent(DESKTOP_UA)
    expect(supportsDirectoryTransfer()).toBe(true)
  })
})
