import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ImageProviderType } from '#lib/types/index.ts'
import type { ImageProfileSlot } from './imageUtils'

const state = {
  imageGeneration: {
    profileId: null as string | null,
    backgroundProfileId: null as string | null,
    portraitProfileId: null as string | null,
    referenceProfileId: null as string | null,
  },
  profiles: {} as Record<
    string,
    {
      id: string
      providerType: ImageProviderType
      apiKey: string
      baseUrl?: string
      model?: string
    }
  >,
}

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    get imageGeneration() {
      return state.imageGeneration
    },
    systemServicesSettings: {
      get imageGeneration() {
        return state.imageGeneration
      },
    },
    getImageProfile: (id: string) => state.profiles[id],
  },
}))

const updateEmbeddedImage = vi.fn(async (_id: string, _updates: unknown) => {})
const cancelEmbeddedImage = vi.fn(async (_id: string) => true)
const emitImageQueued = vi.fn()
const emitImageReady = vi.fn()
const emitImageAnalysisFailed = vi.fn()

vi.mock('#lib/services/database.ts', () => ({
  database: {
    updateEmbeddedImage: (id: string, updates: unknown) => updateEmbeddedImage(id, updates),
    cancelEmbeddedImage: (id: string) => cancelEmbeddedImage(id),
  },
}))

vi.mock('#lib/services/events.ts', () => ({
  emitImageQueued: (...args: unknown[]) => emitImageQueued(...args),
  emitImageReady: (...args: unknown[]) => emitImageReady(...args),
  emitImageAnalysisFailed: (...args: unknown[]) => emitImageAnalysisFailed(...args),
}))

const warmImageCapabilities = vi.fn(async (_profiles: unknown[]) => {})
const generateImage = vi.fn(async (_options: unknown) => ({ base64: 'PORTRAIT' }))

vi.mock('./providers/registry', () => ({
  IMAGE_PROVIDER_LABELS: { openai: 'OpenAI' },
  warmImageCapabilities: (profiles: unknown[]) => warmImageCapabilities(profiles),
  generateImage: (options: unknown) => generateImage(options),
}))

const {
  isImageGenerationEnabled,
  hasRequiredCredentials,
  missingCredential,
  warmSlotCapabilities,
  generatePortrait,
  runImageGeneration,
  beginImageAttempt,
  cancelImageGeneration,
} = await import('./imageUtils')

const SLOTS: ImageProfileSlot[] = ['standard', 'background', 'portrait', 'reference']

const setSlotIds = (
  standard: string | null,
  background: string | null,
  portrait: string | null,
  reference: string | null,
) => {
  state.imageGeneration.profileId = standard
  state.imageGeneration.backgroundProfileId = background
  state.imageGeneration.portraitProfileId = portrait
  state.imageGeneration.referenceProfileId = reference
}

beforeEach(() => {
  setSlotIds('p-std', null, null, null)
  state.profiles = {
    'p-std': { id: 'p-std', providerType: 'openai', apiKey: '' },
    'p-bg': { id: 'p-bg', providerType: 'a1111', apiKey: '' },
    'p-port': { id: 'p-port', providerType: 'a1111', apiKey: '' },
    'p-ref': { id: 'p-ref', providerType: 'a1111', apiKey: '' },
    'p-local': { id: 'p-local', providerType: 'a1111', apiKey: '' },
  }
})

describe('hasRequiredCredentials', () => {
  it('is true when the background profile supports generation and needs no api key', () => {
    setSlotIds('p-std', 'p-bg', null, null)

    expect(hasRequiredCredentials('background')).toBe(true)
  })

  it.each(['background', 'portrait', 'reference'] satisfies ImageProfileSlot[])(
    'does not fall back to the standard profile for %s',
    (slot) => {
      setSlotIds('p-std', null, null, null)

      expect(hasRequiredCredentials(slot)).toBe(false)
    },
  )

  it('requires the api key when the provider needs one', () => {
    setSlotIds('p-std', null, null, null)

    expect(hasRequiredCredentials('standard')).toBe(false)

    state.profiles['p-std'].apiKey = 'sk-test'

    expect(hasRequiredCredentials('standard')).toBe(true)
  })

  it('requires a base URL when the provider has no endpoint of its own', () => {
    setSlotIds('p-proxy', null, null, null)
    state.profiles['p-proxy'] = { id: 'p-proxy', providerType: 'openai-compatible', apiKey: '' }

    expect(hasRequiredCredentials('standard')).toBe(false)

    state.profiles['p-proxy'].baseUrl = '   '
    expect(hasRequiredCredentials('standard')).toBe(false)

    state.profiles['p-proxy'].baseUrl = 'http://localhost:4000/v1'
    expect(hasRequiredCredentials('standard')).toBe(true)
  })
})

describe('missingCredential', () => {
  it("names the slot's profile when none is set", () => {
    setSlotIds('p-std', null, null, null)
    expect(missingCredential('background')).toBe('profile')
  })

  it('names the api key or the base URL, whichever is missing', () => {
    state.profiles['p-proxy'] = { id: 'p-proxy', providerType: 'openai-compatible', apiKey: '' }
    setSlotIds('p-proxy', null, null, null)
    expect(missingCredential()).toBe('baseUrl')

    state.profiles['p-std'].apiKey = ''
    setSlotIds('p-std', null, null, null)
    expect(missingCredential()).toBe('apiKey')
  })

  it.each(['a1111', 'comfyui'] as const)(
    'does not ask a %s profile for an api key',
    (providerType) => {
      state.profiles['p-local'] = { id: 'p-local', providerType, apiKey: '' }
      setSlotIds('p-local', null, null, null)
      expect(missingCredential()).toBeUndefined()
    },
  )

  it('is undefined once the slot is usable', () => {
    state.profiles['p-std'].apiKey = 'sk-test'
    expect(missingCredential()).toBeUndefined()
  })
})

describe('isImageGenerationEnabled', () => {
  it('is false for non-background slots when generation mode is none', () => {
    setSlotIds('p-std', 'p-bg', null, null)

    expect(isImageGenerationEnabled({ imageGenerationMode: 'none' }, 'standard')).toBe(false)
    // background is exempt from the story-level mode.
    expect(isImageGenerationEnabled({ imageGenerationMode: 'none' }, 'background')).toBe(true)
  })

  it('treats a story with no mode as none', () => {
    setSlotIds('p-std', 'p-bg', null, null)

    expect(isImageGenerationEnabled({}, 'standard')).toBe(false)
    expect(isImageGenerationEnabled({}, 'background')).toBe(true)
  })
})

describe('agreement between isImageGenerationEnabled and hasRequiredCredentials', () => {
  const scenarios: Array<{ name: string; apply: () => void }> = [
    {
      name: 'no profile ids at all',
      apply: () => setSlotIds(null, null, null, null),
    },
    {
      name: 'every slot on a keyless provider',
      apply: () => setSlotIds('p-local', 'p-bg', 'p-port', 'p-ref'),
    },
    {
      name: 'every slot on a key provider with the key set',
      apply: () => {
        setSlotIds('p-std', 'p-std', 'p-std', 'p-std')
        state.profiles['p-std'].apiKey = 'sk-test'
      },
    },
    {
      name: 'only standard set',
      apply: () => {
        setSlotIds('p-std', null, null, null)
        state.profiles['p-std'].apiKey = 'sk-test'
      },
    },
    {
      name: 'ids pointing at missing profiles',
      apply: () => setSlotIds('ghost', 'ghost', 'ghost', 'ghost'),
    },
  ]

  for (const scenario of scenarios) {
    for (const slot of SLOTS) {
      it(`agree for ${slot} — ${scenario.name}`, () => {
        scenario.apply()

        expect(isImageGenerationEnabled({ imageGenerationMode: 'agentic' }, slot)).toBe(
          hasRequiredCredentials(slot),
        )
      })
    }
  }
})

describe('warmSlotCapabilities', () => {
  beforeEach(() => {
    warmImageCapabilities.mockClear()
  })

  it('passes the profile of every slot that is ready, in slot order', async () => {
    state.profiles['p-std'].apiKey = 'sk-test'
    setSlotIds('p-std', 'p-bg', 'p-port', 'p-ref')

    await warmSlotCapabilities()

    expect(warmImageCapabilities).toHaveBeenCalledWith([
      state.profiles['p-std'],
      state.profiles['p-bg'],
      state.profiles['p-port'],
      state.profiles['p-ref'],
    ])
  })

  it('leaves out a slot with no profile, a missing profile, or missing credentials', async () => {
    setSlotIds('p-std', 'p-gone', null, 'p-ref')

    await warmSlotCapabilities()

    expect(warmImageCapabilities).toHaveBeenCalledWith([state.profiles['p-ref']])
  })
})

describe('generatePortrait', () => {
  beforeEach(() => {
    generateImage.mockClear()
  })

  it('generates with a profile that names no model', async () => {
    setSlotIds('p-std', null, 'p-port', null)

    await expect(generatePortrait('a face')).resolves.toBe('PORTRAIT')

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'p-port', model: '', prompt: 'a face' }),
    )
  })

  it('refuses when no portrait profile is set', async () => {
    await expect(generatePortrait('a face')).rejects.toThrow('No image generation profile')
    expect(generateImage).not.toHaveBeenCalled()
  })
})

const deferred = () => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('image attempts', () => {
  const request = (attempt: AbortController, notifyFailure = false) => ({
    imageId: 'img',
    entryId: 'entry',
    attempt,
    prompt: 'a scene',
    profileId: 'p-std',
    model: 'm',
    size: { orientation: 'square' as const, size: 'medium' as const },
    notifyFailure,
  })

  beforeEach(() => {
    generateImage.mockReset()
    generateImage.mockResolvedValue({ base64: 'PIXELS' })
    updateEmbeddedImage.mockClear()
    cancelEmbeddedImage.mockClear()
    emitImageQueued.mockClear()
    emitImageReady.mockClear()
    emitImageAnalysisFailed.mockClear()
  })

  it('writes a finished generation and hands its signal to the request', async () => {
    const attempt = beginImageAttempt('img')

    await expect(runImageGeneration(request(attempt))).resolves.toBe('PIXELS')

    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ signal: attempt.signal }))
    expect(updateEmbeddedImage).toHaveBeenLastCalledWith('img', {
      imageData: 'PIXELS',
      status: 'complete',
    })
    expect(emitImageReady).toHaveBeenCalledWith('img', 'entry', true)
  })

  it('does not start, flip the record or write when cancelled before it began', async () => {
    const attempt = beginImageAttempt('img')
    await cancelImageGeneration('img')

    await expect(runImageGeneration(request(attempt, true))).resolves.toBeNull()

    expect(generateImage).not.toHaveBeenCalled()
    expect(updateEmbeddedImage).not.toHaveBeenCalled()
    expect(emitImageAnalysisFailed).not.toHaveBeenCalled()
    // The queued event still needs its pair.
    expect(emitImageReady).toHaveBeenCalledWith('img', 'entry', false)
  })

  it('leaves the record alone, and raises nothing, when cancelled mid-request', async () => {
    const attempt = beginImageAttempt('img')
    generateImage.mockImplementation(async (options) => {
      await cancelImageGeneration('img')
      ;(options as { signal: AbortSignal }).signal.throwIfAborted()
      return { base64: 'LATE' }
    })

    await expect(runImageGeneration(request(attempt, true))).resolves.toBeNull()

    expect(updateEmbeddedImage).toHaveBeenCalledTimes(1)
    expect(updateEmbeddedImage).toHaveBeenCalledWith('img', { status: 'generating' })
    expect(cancelEmbeddedImage).toHaveBeenCalledTimes(1)
    expect(emitImageAnalysisFailed).not.toHaveBeenCalled()
    expect(emitImageReady).toHaveBeenCalledTimes(1)
  })

  it('settles the row through the database when cancelled', async () => {
    const attempt = beginImageAttempt('img')

    await cancelImageGeneration('img')

    expect(attempt.signal.aborted).toBe(true)
    expect(cancelEmbeddedImage).toHaveBeenCalledWith('img')
  })

  it('sends a cancel only after the generating flip already in flight has finished', async () => {
    const attempt = beginImageAttempt('img')
    const flip = deferred()
    updateEmbeddedImage.mockImplementationOnce(() => flip.promise)
    cancelEmbeddedImage.mockClear()

    const run = runImageGeneration(request(attempt))
    await vi.waitFor(() => expect(updateEmbeddedImage).toHaveBeenCalledTimes(1))
    const cancel = cancelImageGeneration('img')
    await tick()
    expect(cancelEmbeddedImage).not.toHaveBeenCalled()

    flip.resolve()
    await Promise.all([run, cancel])

    expect(cancelEmbeddedImage).toHaveBeenCalledTimes(1)
    expect(generateImage).not.toHaveBeenCalled()
    await expect(run).resolves.toBeNull()
  })

  it('lets the result write already sent finish, so a cancel during it is too late', async () => {
    const attempt = beginImageAttempt('img')
    const write = deferred()
    updateEmbeddedImage.mockImplementationOnce(async () => {})
    updateEmbeddedImage.mockImplementationOnce(() => write.promise)
    cancelEmbeddedImage.mockClear()

    const run = runImageGeneration(request(attempt))
    await vi.waitFor(() => expect(updateEmbeddedImage).toHaveBeenCalledTimes(2))
    const cancel = cancelImageGeneration('img')
    await tick()
    expect(cancelEmbeddedImage).not.toHaveBeenCalled()

    write.resolve()

    await expect(run).resolves.toBe('PIXELS')
    await cancel
    expect(updateEmbeddedImage).toHaveBeenLastCalledWith('img', {
      imageData: 'PIXELS',
      status: 'complete',
    })
  })

  it('keeps an older attempt from settling over the retry that replaced it', async () => {
    const first = beginImageAttempt('img')
    let finishFirst: (value: { base64: string }) => void = () => {}
    generateImage.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve as typeof finishFirst)),
    )
    const firstRun = runImageGeneration(request(first))
    await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))

    const flip = deferred()
    updateEmbeddedImage.mockImplementationOnce(() => flip.promise)
    const second = beginImageAttempt('img')
    const secondRun = runImageGeneration(request(second))
    await vi.waitFor(() => expect(updateEmbeddedImage).toHaveBeenCalledTimes(2))

    // The older attempt's result reaches its turn in the write order after the retry's flip.
    finishFirst({ base64: 'OLD' })
    flip.resolve()
    await Promise.all([firstRun, secondRun])

    expect(
      updateEmbeddedImage.mock.calls.map(([, updates]) => (updates as { status: string }).status),
    ).toEqual(['generating', 'generating', 'complete'])
  })

  it('reports an aborted attempt as failed even when the provider still returned pixels', async () => {
    const attempt = beginImageAttempt('img')
    generateImage.mockImplementation(async () => {
      attempt.abort()
      return { base64: 'LATE' }
    })

    await expect(runImageGeneration(request(attempt))).resolves.toBeNull()

    expect(emitImageReady).toHaveBeenCalledWith('img', 'entry', false)
  })

  it('announces a reset row after it reads generating, and before it is ready', async () => {
    const attempt = beginImageAttempt('img')
    const order: string[] = []
    updateEmbeddedImage.mockImplementation(async (_id, updates) => {
      order.push(`update:${(updates as { status: string }).status}`)
    })
    emitImageQueued.mockImplementation(() => order.push('queued'))
    emitImageReady.mockImplementation(() => order.push('ready'))

    await runImageGeneration({ ...request(attempt), announce: true })

    expect(order).toEqual(['update:generating', 'queued', 'update:complete', 'ready'])
    updateEmbeddedImage.mockImplementation(async () => {})
    emitImageQueued.mockReset()
    emitImageReady.mockReset()
  })

  it('keeps a superseded request from writing over the one that replaced it', async () => {
    const first = beginImageAttempt('img')
    let finishFirst: (value: { base64: string }) => void = () => {}
    generateImage.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve as typeof finishFirst)),
    )
    const firstRun = runImageGeneration(request(first))
    await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))

    const second = beginImageAttempt('img')
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)

    finishFirst({ base64: 'OLD' })
    await firstRun

    expect(updateEmbeddedImage).not.toHaveBeenCalledWith(
      'img',
      expect.objectContaining({ imageData: 'OLD' }),
    )
  })

  it('adopts a controller made earlier instead of making its own', () => {
    const controller = new AbortController()

    expect(beginImageAttempt('adopted', controller)).toBe(controller)
  })
})
