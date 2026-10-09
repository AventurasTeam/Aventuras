import { describe, it, expect, vi, afterEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const { initPlatform, isIos } = await import('./platform')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('initPlatform', () => {
  it('lets the native answer override a user agent that looks like iOS', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
    invoke.mockResolvedValue(false)
    await initPlatform()
    expect(invoke).toHaveBeenCalledWith('is_ios')
    expect(isIos()).toBe(false)
  })

  it('reports iOS when the native side says so, whatever the user agent', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux)', maxTouchPoints: 0 })
    invoke.mockResolvedValue(true)
    await initPlatform()
    expect(isIos()).toBe(true)
  })

  it('falls back to the user agent when the command is unavailable', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 })
    invoke.mockRejectedValue(new Error('no tauri'))
    await initPlatform()
    expect(isIos()).toBe(true)
  })
})
