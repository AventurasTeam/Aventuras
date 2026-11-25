import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ImageModelCapabilities } from '#lib/types/index.ts'
import {
  cachedCapabilities,
  evictCapabilities,
  primeCapabilities,
  type CapabilityLookup,
} from './capabilityCache'
import { imageConnectionFor, modelListKey } from './connection'

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

// Cached answers outlive a test, so each case gets its own connection.
let counter = 0
const connect = () => imageConnectionFor('openrouter', `sk-cache-${counter++}`, undefined)

const lookupOf = (found?: ImageModelCapabilities) => vi.fn<CapabilityLookup>(async () => found)

const failingLookup = () =>
  vi.fn<CapabilityLookup>(async () => {
    throw new Error('503')
  })

describe('cachedCapabilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('looks a model up once within the cache lifetime', async () => {
    const connection = connect()
    const lookup = lookupOf({ maxReferenceImages: 2 })

    expect(await cachedCapabilities(connection, 'm', lookup)).toMatchObject({
      maxReferenceImages: 2,
    })
    await vi.advanceTimersByTimeAsync(11 * HOUR)
    expect(await cachedCapabilities(connection, 'm', lookup)).toMatchObject({
      maxReferenceImages: 2,
    })

    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('looks up again after twelve hours, and returns what changed', async () => {
    const connection = connect()
    const lookup = vi
      .fn<CapabilityLookup>()
      .mockResolvedValueOnce({ supportedResolutions: ['1k'] })
      .mockResolvedValueOnce({ supportedResolutions: ['4k'] })

    await cachedCapabilities(connection, 'm-latest', lookup)
    await vi.advanceTimersByTimeAsync(12 * HOUR)

    expect(await cachedCapabilities(connection, 'm-latest', lookup)).toMatchObject({
      supportedResolutions: ['4k'],
    })
  })

  it('caches a model the provider does not know', async () => {
    const connection = connect()
    const lookup = lookupOf()

    expect(await cachedCapabilities(connection, 'm', lookup)).toBeUndefined()
    expect(await cachedCapabilities(connection, 'm', lookup)).toBeUndefined()

    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('keeps no reference to what the lookup returned', async () => {
    const connection = connect()
    const found: ImageModelCapabilities = { supportedResolutions: ['1k'] }

    await cachedCapabilities(connection, 'm', lookupOf(found))
    found.supportedResolutions?.push('4k')

    expect(await cachedCapabilities(connection, 'm', lookupOf())).toMatchObject({
      supportedResolutions: ['1k'],
    })
  })

  it('shares one lookup between concurrent calls', async () => {
    const connection = connect()
    const lookup = lookupOf()

    await Promise.all([
      cachedCapabilities(connection, 'm', lookup),
      cachedCapabilities(connection, 'm', lookup),
      cachedCapabilities(connection, 'm', lookup),
    ])

    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('keeps each model and connection apart', async () => {
    const connection = connect()
    const lookup = lookupOf()

    await cachedCapabilities(connection, 'a', lookup)
    await cachedCapabilities(connection, 'b', lookup)
    await cachedCapabilities(connect(), 'a', lookup)

    expect(lookup).toHaveBeenCalledTimes(3)
  })

  it('resolves to nothing and waits five minutes before trying again after a failure', async () => {
    const connection = connect()
    const lookup = failingLookup()

    expect(await cachedCapabilities(connection, 'm', lookup)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(await cachedCapabilities(connection, 'm', lookup)).toBeUndefined()
    expect(lookup).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(MINUTE)
    await cachedCapabilities(connection, 'm', lookup)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('recovers when a retry after a failure succeeds', async () => {
    const connection = connect()
    const lookup = vi
      .fn<CapabilityLookup>()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ maxReferenceImages: 1 })

    await cachedCapabilities(connection, 'm', lookup)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)

    expect(await cachedCapabilities(connection, 'm', lookup)).toMatchObject({
      maxReferenceImages: 1,
    })
  })

  it('does not wait past the lookup bound, and aborts the lookup', async () => {
    const connection = connect()
    let signal: AbortSignal | undefined
    const lookup = vi.fn<CapabilityLookup>((_connection, _model, s) => {
      signal = s
      return new Promise(() => {})
    })

    const done = cachedCapabilities(connection, 'm', lookup)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await done).toBeUndefined()
    expect(signal?.aborted).toBe(true)
  })

  it('looks up again after the connection is evicted, leaving others alone', async () => {
    const connection = connect()
    const other = connect()
    const lookup = lookupOf()
    await cachedCapabilities(connection, 'm', lookup)
    await cachedCapabilities(other, 'm', lookup)

    evictCapabilities(modelListKey(connection))
    await cachedCapabilities(connection, 'm', lookup)
    await cachedCapabilities(other, 'm', lookup)

    expect(lookup).toHaveBeenCalledTimes(3)
  })

  describe('a lookup running when its connection is evicted', () => {
    const startSlow = (connection: ReturnType<typeof connect>) => {
      let finish: (value: ImageModelCapabilities) => void = () => {}
      const slow = vi.fn<CapabilityLookup>(
        () => new Promise<ImageModelCapabilities>((resolve) => (finish = resolve)),
      )
      return {
        running: cachedCapabilities(connection, 'm', slow),
        finish: (v: ImageModelCapabilities) => finish(v),
      }
    }

    it('answers its caller but stores nothing', async () => {
      const connection = connect()
      const { running, finish } = startSlow(connection)
      evictCapabilities(modelListKey(connection))
      finish({ maxReferenceImages: 4 })
      expect(await running).toMatchObject({ maxReferenceImages: 4 })

      const lookup = lookupOf({ maxReferenceImages: 1 })
      expect(await cachedCapabilities(connection, 'm', lookup)).toMatchObject({
        maxReferenceImages: 1,
      })
      expect(lookup).toHaveBeenCalledTimes(1)
    })

    it('is not joined by a caller that arrives after the eviction', async () => {
      const connection = connect()
      const { running, finish } = startSlow(connection)
      evictCapabilities(modelListKey(connection))

      const fresh = lookupOf({ maxReferenceImages: 2 })
      expect(await cachedCapabilities(connection, 'm', fresh)).toMatchObject({
        maxReferenceImages: 2,
      })
      finish({ maxReferenceImages: 9 })
      await running

      expect(await cachedCapabilities(connection, 'm', lookupOf())).toMatchObject({
        maxReferenceImages: 2,
      })
    })

    it('stores its answer when the eviction leaves running lookups alone', async () => {
      const connection = connect()
      const { running, finish } = startSlow(connection)
      evictCapabilities(modelListKey(connection), false)
      finish({ maxReferenceImages: 4 })
      await running

      const lookup = lookupOf()
      expect(await cachedCapabilities(connection, 'm', lookup)).toMatchObject({
        maxReferenceImages: 4,
      })
      expect(lookup).not.toHaveBeenCalled()
    })
  })
})

describe('primeCapabilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores the answer, so the first caller does not look up', async () => {
    const connection = connect()
    await primeCapabilities(connection, 'm', lookupOf({ maxReferenceImages: 3 }))

    const lookup = lookupOf()
    expect(await cachedCapabilities(connection, 'm', lookup)).toMatchObject({
      maxReferenceImages: 3,
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('resolves after a failure and stores nothing, so the first caller looks up at once', async () => {
    const connection = connect()
    await expect(primeCapabilities(connection, 'm', failingLookup())).resolves.toBeUndefined()

    const lookup = lookupOf({ maxReferenceImages: 1 })
    expect(await cachedCapabilities(connection, 'm', lookup)).toMatchObject({
      maxReferenceImages: 1,
    })
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('shares one lookup with a caller that arrives while it runs', async () => {
    const connection = connect()
    const lookup = lookupOf({ maxReferenceImages: 2 })

    await Promise.all([
      primeCapabilities(connection, 'm', lookup),
      cachedCapabilities(connection, 'm', lookup),
    ])

    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('leaves a fresh entry alone', async () => {
    const connection = connect()
    const lookup = lookupOf()
    await cachedCapabilities(connection, 'm', lookup)

    await primeCapabilities(connection, 'm', lookup)

    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
