import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    getImageProfile: vi.fn(),
    updateImageProfile: vi.fn(),
  },
}))

import { settings } from '#lib/stores/settings.svelte.ts'
import type { ImageModelCapabilities, ImageProfile } from '#lib/types/index.ts'
import { IMAGE_MODEL_SNAPSHOT_VERSION } from './modelSnapshot'
import { snapshotCapabilities, type CapabilityLookup } from './snapshotBackfill'

// The failure set outlives a test, so each case gets its own profile id.
let counter = 0

function setup(over: Partial<ImageProfile> = {}) {
  const profile = {
    id: `backfill-${counter++}`,
    providerType: 'openrouter',
    apiKey: 'sk-backfill',
    model: 'm',
    providerOptions: {},
    ...over,
  } as ImageProfile
  vi.mocked(settings.getImageProfile).mockReturnValue(profile)
  return profile
}

const lookupOf = (found?: ImageModelCapabilities) => vi.fn<CapabilityLookup>(async () => found)

const failingLookup = () =>
  vi.fn<CapabilityLookup>(async () => {
    throw new Error('503')
  })

const snapshot = (
  capabilities: ImageModelCapabilities,
  over: { model?: string; version?: number } = {},
) => ({
  model: 'm',
  version: IMAGE_MODEL_SNAPSHOT_VERSION,
  capturedAt: 1,
  capabilities,
  ...over,
})

describe('snapshotCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(settings.updateImageProfile).mockResolvedValue(undefined)
  })

  it('returns a current snapshot without a lookup', async () => {
    const capabilities = { maxReferenceImages: 1, supportedResolutions: ['1k'] }
    const profile = setup({ modelSnapshot: snapshot(capabilities) })
    const lookup = lookupOf()

    expect(await snapshotCapabilities(profile, 'm', lookup)).toEqual(capabilities)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('returns nothing and saves nothing, looking up once, when the lookup fails', async () => {
    const profile = setup()
    const lookup = failingLookup()

    expect(await snapshotCapabilities(profile, 'm', lookup)).toBeUndefined()
    expect(await snapshotCapabilities(profile, 'm', lookup)).toBeUndefined()

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(settings.updateImageProfile).not.toHaveBeenCalled()
  })

  it('shares one lookup between concurrent calls', async () => {
    const profile = setup()
    const lookup = lookupOf()

    await Promise.all([
      snapshotCapabilities(profile, 'm', lookup),
      snapshotCapabilities(profile, 'm', lookup),
      snapshotCapabilities(profile, 'm', lookup),
    ])

    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('does not wait past the lookup bound', async () => {
    vi.useFakeTimers()
    try {
      const profile = setup()
      const lookup = vi.fn<CapabilityLookup>(() => new Promise(() => {}))

      const done = snapshotCapabilities(profile, 'm', lookup)
      await vi.advanceTimersByTimeAsync(10_000)

      expect(await done).toBeUndefined()
      expect(settings.updateImageProfile).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to a stale snapshot of the same model when the lookup fails', async () => {
    const stale = { supportedResolutions: ['2k'] }
    const profile = setup({
      modelSnapshot: snapshot(stale, { version: IMAGE_MODEL_SNAPSHOT_VERSION - 1 }),
    })

    expect(await snapshotCapabilities(profile, 'm', failingLookup())).toEqual(stale)
  })

  it('ignores a snapshot of another model', async () => {
    const profile = setup({
      modelSnapshot: snapshot({ supportedResolutions: ['2k'] }, { model: 'other' }),
    })
    const lookup = failingLookup()

    expect(await snapshotCapabilities(profile, 'm', lookup)).toBeUndefined()
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('saves what the lookup found', async () => {
    const profile = setup()

    const found = await snapshotCapabilities(profile, 'm', lookupOf({ maxReferenceImages: 2 }))

    expect(found).toMatchObject({ maxReferenceImages: 2 })
    expect(settings.updateImageProfile).toHaveBeenCalledWith(profile.id, {
      modelSnapshot: expect.objectContaining({
        model: 'm',
        version: IMAGE_MODEL_SNAPSHOT_VERSION,
        capabilities: expect.objectContaining({ maxReferenceImages: 2 }),
      }),
    })
  })

  it('saves no snapshot for a model other than the profile’s', async () => {
    const profile = setup({ model: 'current' })
    const lookup = lookupOf()

    await snapshotCapabilities(profile, 'queued', lookup)

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(settings.updateImageProfile).not.toHaveBeenCalled()
  })

  it.each([
    ['key', { apiKey: 'sk-edited' }],
    ['base URL', { baseUrl: 'https://edited.test/v1' }],
  ])('saves nothing when the %s changed during the lookup', async (_name, edit) => {
    const profile = setup()
    vi.mocked(settings.getImageProfile).mockReturnValue({ ...profile, ...edit })

    await snapshotCapabilities(profile, 'm', lookupOf({ maxReferenceImages: 2 }))

    expect(settings.updateImageProfile).not.toHaveBeenCalled()
  })
})
