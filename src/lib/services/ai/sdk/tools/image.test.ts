import { describe, it, expect, vi, beforeEach } from 'vitest'

const { imageSettings, profiles } = vi.hoisted(() => ({
  imageSettings: {
    profileId: 'std' as string | null,
    referenceProfileId: 'ref' as string | null,
    styleId: 'style',
    portraitStyleId: 'portrait-style',
    size: { orientation: 'square', size: 'small' },
    referenceSize: { orientation: 'square', size: 'small' },
  },
  profiles: {} as Record<string, { model: string }>,
}))

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    systemServicesSettings: { imageGeneration: imageSettings },
    getImageProfile: (id: string) => profiles[id],
  },
}))

vi.mock('#lib/services/ai/image/index.ts', () => ({
  generateImage: vi.fn(),
  generatePortrait: vi.fn(),
  supportsReferenceImages: vi.fn(),
  toRawBase64: vi.fn(),
  isImageGenerationEnabled: vi.fn(),
  missingCredential: vi.fn(),
}))

vi.mock('#lib/services/database.ts', () => ({
  database: { getPackTemplate: vi.fn() },
}))

vi.mock('#lib/services/context/index.ts', () => ({ ContextBuilder: vi.fn() }))

import {
  generateImage,
  generatePortrait,
  supportsReferenceImages,
  toRawBase64,
  isImageGenerationEnabled,
  missingCredential,
} from '#lib/services/ai/image/index.ts'
import { database } from '#lib/services/database.ts'
import type { VaultCharacter } from '#lib/types/index.ts'
import { createImageTools, type ImageToolContext } from './image'

function makeTools(characters: Partial<VaultCharacter>[] = []) {
  const generatedImages = new Map<string, string>()
  const context: ImageToolContext = {
    characters: () => characters as VaultCharacter[],
    generatedImages,
    generatedPortraitIds: new Map(),
    onPendingChange: vi.fn(),
    generateId: () => 'change-1',
  }
  const tools = createImageTools(context) as Record<string, any>
  return {
    generatedImages,
    context,
    edit: (args: Record<string, unknown>) => tools.edit_image.execute(args, {}),
    standard: (args: Record<string, unknown>) => tools.generate_standard_image.execute(args, {}),
    portrait: (args: Record<string, unknown>) => tools.generate_portrait.execute(args, {}),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(database.getPackTemplate).mockResolvedValue({ content: 'STYLE' } as never)
  imageSettings.profileId = 'std'
  imageSettings.referenceProfileId = 'ref'
  for (const key of Object.keys(profiles)) delete profiles[key]
  profiles.std = { model: 'std-model' }
  profiles.ref = { model: 'ref-model' }
  vi.mocked(isImageGenerationEnabled).mockReturnValue(true)
  vi.mocked(missingCredential).mockReturnValue(undefined)
  vi.mocked(supportsReferenceImages).mockResolvedValue(true)
  vi.mocked(generateImage).mockResolvedValue({ base64: 'RESULT' })
})

describe('edit_image', () => {
  it('needs exactly one source', async () => {
    const { edit } = makeTools()

    expect(await edit({ instruction: 'x' })).toMatchObject({ success: false })
    expect(await edit({ instruction: 'x', imageId: 'a', characterId: 'b' })).toMatchObject({
      success: false,
    })
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('rejects an unknown imageId and lists the available ones', async () => {
    const { edit, generatedImages } = makeTools()
    generatedImages.set('known', 'data:image/png;base64,AAAA')

    const result = await edit({ instruction: 'x', imageId: 'nope' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('known')
  })

  it('rejects an unknown character and a character without a portrait', async () => {
    const { edit } = makeTools([{ id: 'c1', name: 'Ann', portrait: null }])

    expect(await edit({ instruction: 'x', characterId: 'zz' })).toMatchObject({ success: false })
    const result = await edit({ instruction: 'x', characterId: 'c1' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no portrait')
  })

  it('tells apart an unset standard profile and an unset reference profile', async () => {
    const { edit, generatedImages } = makeTools()
    generatedImages.set('a', 'data:image/png;base64,AAAA')

    imageSettings.profileId = null
    const disabled = await edit({ instruction: 'x', imageId: 'a' })
    imageSettings.profileId = 'std'
    imageSettings.referenceProfileId = null
    const noReference = await edit({ instruction: 'x', imageId: 'a' })

    expect(disabled.error).toContain('disabled')
    expect(noReference.error).toContain('Reference (Img2Img)')
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('reports missing credentials and a profile with no model', async () => {
    const { edit, generatedImages } = makeTools()
    generatedImages.set('a', 'data:image/png;base64,AAAA')

    vi.mocked(missingCredential).mockReturnValue('apiKey')
    expect((await edit({ instruction: 'x', imageId: 'a' })).error).toContain('API key')

    vi.mocked(missingCredential).mockReturnValue('baseUrl')
    expect((await edit({ instruction: 'x', imageId: 'a' })).error).toContain('base URL')

    vi.mocked(missingCredential).mockReturnValue(undefined)
    profiles.ref = { model: '' }
    expect((await edit({ instruction: 'x', imageId: 'a' })).error).toContain('no model')
  })

  it('refuses a provider or model that cannot take a reference', async () => {
    const { edit, generatedImages } = makeTools()
    generatedImages.set('a', 'data:image/png;base64,AAAA')
    vi.mocked(supportsReferenceImages).mockResolvedValue(false)

    const result = await edit({ instruction: 'x', imageId: 'a' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('reference image')
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('fails when an http portrait cannot be fetched', async () => {
    const { edit } = makeTools([{ id: 'c1', name: 'Ann', portrait: 'https://img.test/a.png' }])
    vi.mocked(toRawBase64).mockRejectedValue(new Error('refused'))

    const result = await edit({ instruction: 'x', characterId: 'c1' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('refused')
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('edits a generated image as a reference and registers a new imageId', async () => {
    const { edit, generatedImages } = makeTools()
    generatedImages.set('a', 'data:image/png;base64,AAAA')

    const result = await edit({ instruction: 'shorter hair', imageId: 'a' })

    expect(generateImage).toHaveBeenCalledWith({
      profileId: 'ref',
      model: 'ref-model',
      prompt: 'shorter hair',
      size: imageSettings.referenceSize,
      referenceImages: ['data:image/png;base64,AAAA'],
    })
    expect(result.success).toBe(true)
    expect(result.imageId).not.toBe('a')
    expect(generatedImages.get(result.imageId)).toBe('data:image/png;base64,RESULT')
    expect(generatedImages.get('a')).toBe('data:image/png;base64,AAAA')
  })

  it('fetches an http portrait into raw base64 before editing it', async () => {
    const { edit } = makeTools([{ id: 'c1', name: 'Ann', portrait: 'https://img.test/a.png' }])
    vi.mocked(toRawBase64).mockResolvedValue('FETCHED')

    const result = await edit({ instruction: 'x', characterId: 'c1' })

    expect(result.success).toBe(true)
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: ['FETCHED'] }),
    )
  })

  it('reports a provider failure and an empty result', async () => {
    const { edit, generatedImages } = makeTools()
    generatedImages.set('a', 'data:image/png;base64,AAAA')

    vi.mocked(generateImage).mockRejectedValueOnce(new Error('boom'))
    expect(await edit({ instruction: 'x', imageId: 'a' })).toMatchObject({ success: false })

    vi.mocked(generateImage).mockResolvedValueOnce({ base64: '' })
    expect(await edit({ instruction: 'x', imageId: 'a' })).toMatchObject({ success: false })
  })
})

describe('generate_standard_image', () => {
  it.each([
    ['generation is disabled', () => (imageSettings.profileId = null)],
    ['the profile is unusable', () => vi.mocked(isImageGenerationEnabled).mockReturnValue(false)],
    ['credentials are missing', () => vi.mocked(missingCredential).mockReturnValue('apiKey')],
    ['the profile has no model', () => (profiles.std = { model: '' })],
  ])('fails when %s', async (_name, arrange) => {
    arrange()
    const { standard } = makeTools()

    const result = await standard({ prompt: 'a cat' })

    expect(result.success).toBe(false)
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('fails when the call throws or returns no image', async () => {
    const { standard } = makeTools()

    vi.mocked(generateImage).mockRejectedValueOnce(new Error('boom'))
    const thrown = await standard({ prompt: 'a cat' })
    vi.mocked(generateImage).mockResolvedValueOnce({ base64: '' })
    const empty = await standard({ prompt: 'a cat' })

    expect(thrown).toMatchObject({ success: false })
    expect(thrown.error).toContain('boom')
    expect(empty).toMatchObject({ success: false })
  })

  it('registers the image on success', async () => {
    const { standard, generatedImages } = makeTools()

    const result = await standard({ prompt: 'a cat' })

    expect(result.success).toBe(true)
    expect(generatedImages.get(result.imageId)).toBe('data:image/png;base64,RESULT')
  })
})

describe('generate_portrait', () => {
  it('fails when the portrait profile has no credentials', async () => {
    const { portrait } = makeTools([{ id: 'c1', name: 'Ann' }])
    vi.mocked(missingCredential).mockImplementation((slot) =>
      slot === 'portrait' ? 'apiKey' : undefined,
    )

    const result = await portrait({ characterId: 'c1' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('API key')
    expect(generatePortrait).not.toHaveBeenCalled()
  })
})
