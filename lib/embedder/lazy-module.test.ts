import { describe, expect, it, vi } from 'vitest'

import { lazyModule } from './lazy-module'

describe('lazyModule', () => {
  it('loads once and reuses the resolved module', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true })
    const get = lazyModule(load)

    await expect(get()).resolves.toEqual({ ok: true })
    await expect(get()).resolves.toEqual({ ok: true })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight promise across concurrent callers', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true })
    const get = lazyModule(load)

    await Promise.all([get(), get(), get()])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries after a rejection instead of pinning the failure forever', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('native module not linked yet'))
      .mockResolvedValue({ ok: true })
    const get = lazyModule(load)

    await expect(get()).rejects.toThrow('native module not linked yet')
    await expect(get()).resolves.toEqual({ ok: true })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
