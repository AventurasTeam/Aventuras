import { describe, it, expect, vi, beforeEach } from 'vitest'

const { imageSettings, profiles } = vi.hoisted(() => ({
  imageSettings: {
    profileId: 'std' as string | null,
    styleId: 'style',
    portraitStyleId: 'portrait-style',
    size: { orientation: 'square', size: 'small' },
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
  isImageGenerationEnabled: vi.fn(),
  hasRequiredCredentials: vi.fn(),
}))

vi.mock('#lib/services/database.ts', () => ({
  database: { getPackTemplate: vi.fn() },
}))

vi.mock('#lib/services/context/index.ts', () => ({ ContextBuilder: vi.fn() }))

import {
  generateImage,
  generatePortrait,
  isImageGenerationEnabled,
  hasRequiredCredentials,
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
    standard: (args: Record<string, unknown>) => tools.generate_standard_image.execute(args, {}),
    portrait: (args: Record<string, unknown>) => tools.generate_portrait.execute(args, {}),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(database.getPackTemplate).mockResolvedValue({ content: 'STYLE' } as never)
  imageSettings.profileId = 'std'
  for (const key of Object.keys(profiles)) delete profiles[key]
  profiles.std = { model: 'std-model' }
  vi.mocked(isImageGenerationEnabled).mockReturnValue(true)
  vi.mocked(hasRequiredCredentials).mockReturnValue(true)
  vi.mocked(generateImage).mockResolvedValue({ base64: 'RESULT' })
})

describe('generate_standard_image', () => {
  it.each([
    ['generation is disabled', () => (imageSettings.profileId = null)],
    ['the profile is unusable', () => vi.mocked(isImageGenerationEnabled).mockReturnValue(false)],
    ['credentials are missing', () => vi.mocked(hasRequiredCredentials).mockReturnValue(false)],
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
    vi.mocked(hasRequiredCredentials).mockImplementation((slot) => slot !== 'portrait')

    const result = await portrait({ characterId: 'c1' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('API key')
    expect(generatePortrait).not.toHaveBeenCalled()
  })
})
