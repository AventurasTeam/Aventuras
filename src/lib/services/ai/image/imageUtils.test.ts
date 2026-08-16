import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ImageProfileSlot } from './imageUtils'

const state = {
  imageGeneration: {
    profileId: null as string | null,
    backgroundProfileId: null as string | null,
    portraitProfileId: null as string | null,
    referenceProfileId: null as string | null,
  },
  profiles: {} as Record<string, { id: string; providerType: string; apiKey: string }>,
}

vi.mock('$lib/stores/settings.svelte', () => ({
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

vi.mock('./providers/registry', () => ({
  supportsImageGeneration: (providerType: string) => providerType !== 'no-backend',
  requiresApiKey: (providerType: string) => providerType === 'openai',
}))

const { isImageGenerationEnabled, hasRequiredCredentials } = await import('./imageUtils')

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
    'p-bg': { id: 'p-bg', providerType: 'local', apiKey: '' },
    'p-port': { id: 'p-port', providerType: 'local', apiKey: '' },
    'p-ref': { id: 'p-ref', providerType: 'local', apiKey: '' },
    'p-local': { id: 'p-local', providerType: 'local', apiKey: '' },
  }
})

describe('hasRequiredCredentials', () => {
  it('does not fall back to the standard profile for background', () => {
    setSlotIds('p-std', null, null, null)

    expect(hasRequiredCredentials('background')).toBe(false)
  })

  it('is true when the background profile supports generation and needs no api key', () => {
    setSlotIds('p-std', 'p-bg', null, null)

    expect(hasRequiredCredentials('background')).toBe(true)
  })

  it('does not fall back to the standard profile for portrait', () => {
    setSlotIds('p-std', null, null, null)

    expect(hasRequiredCredentials('portrait')).toBe(false)
  })

  it('does not fall back to the standard profile for reference', () => {
    setSlotIds('p-std', null, null, null)

    expect(hasRequiredCredentials('reference')).toBe(false)
  })

  it('requires the api key when the provider needs one', () => {
    setSlotIds('p-std', null, null, null)

    expect(hasRequiredCredentials('standard')).toBe(false)

    state.profiles['p-std'].apiKey = 'sk-test'

    expect(hasRequiredCredentials('standard')).toBe(true)
  })
})

describe('isImageGenerationEnabled', () => {
  it('is false for background when backgroundProfileId is unset, even with a standard profile', () => {
    setSlotIds('p-std', null, null, null)

    expect(isImageGenerationEnabled(undefined, 'background')).toBe(false)
  })

  it('is true for standard when the profile supports generation', () => {
    setSlotIds('p-std', null, null, null)

    expect(isImageGenerationEnabled(undefined, 'standard')).toBe(true)
  })

  it('is false for non-background slots when generation mode is none', () => {
    setSlotIds('p-std', 'p-bg', null, null)

    expect(isImageGenerationEnabled({ imageGenerationMode: 'none' }, 'standard')).toBe(false)
    // background is exempt from the story-level mode.
    expect(isImageGenerationEnabled({ imageGenerationMode: 'none' }, 'background')).toBe(true)
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

        expect(isImageGenerationEnabled({}, slot)).toBe(hasRequiredCredentials(slot))
      })
    }
  }
})
