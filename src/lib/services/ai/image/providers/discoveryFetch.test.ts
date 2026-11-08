import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))

import { IMAGE_DISCOVERY_TIMEOUT } from '#lib/constants/timeout.ts'
import { imageGetFetch } from './fetchAdapter'
import { imageDiscoveryFetch, imageGetFetchOptional } from './discoveryFetch'

const timeoutSent = () => vi.mocked(imageGetFetch).mock.calls[0][2]?.timeoutMs

describe('imageDiscoveryFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(imageGetFetch).mockResolvedValue({ ok: true } as Response)
  })

  it('gives up after the discovery timeout by default', async () => {
    await imageDiscoveryFetch('https://host.test/models', undefined, { serviceId: 'x' })
    expect(timeoutSent()).toBe(IMAGE_DISCOVERY_TIMEOUT)
  })

  it('uses the timeout the caller names', async () => {
    await imageDiscoveryFetch('https://host.test/models', undefined, { timeoutMs: 5_000 })
    expect(timeoutSent()).toBe(5_000)
  })

  it('treats an undefined timeout as unset', async () => {
    await imageDiscoveryFetch('https://host.test/models', undefined, { timeoutMs: undefined })
    expect(timeoutSent()).toBe(IMAGE_DISCOVERY_TIMEOUT)
  })

  it('applies the same default to an optional route', async () => {
    await imageGetFetchOptional('https://host.test/models', undefined, { absentStatuses: [404] })
    expect(timeoutSent()).toBe(IMAGE_DISCOVERY_TIMEOUT)
  })
})
