import { describe, it, expect, vi, beforeEach } from 'vitest'

const createEmbeddedImage = vi.fn().mockResolvedValue(undefined)
const updateEmbeddedImage = vi.fn().mockResolvedValue(undefined)

vi.mock('$lib/services/database', () => ({
  database: {
    createEmbeddedImage: (...args: unknown[]) => createEmbeddedImage(...args),
    updateEmbeddedImage: (...args: unknown[]) => updateEmbeddedImage(...args),
    // The style lookup the tracker awaits before it registers a tag.
    getPackTemplate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { content: 'style' }
    },
  },
}))

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    systemServicesSettings: {
      imageGeneration: { profileId: 'p1', styleId: 'st', size: 'square', referenceProfileId: 'p1' },
    },
    getImageProfile: () => ({ id: 'p1', model: 'm', providerType: 'openai' }),
  },
}))

vi.mock('./providers/registry', () => ({
  supportsImageGeneration: () => true,
  generateImage: async () => ({ base64: null, error: 'no backend in test' }),
}))

vi.mock('$lib/services/events', () => ({
  emitImageQueued: vi.fn(),
  emitImageReady: vi.fn(),
  emitImageAnalysisFailed: vi.fn(),
}))

const { InlineImageTracker } = await import('./InlineImageTracker')

const TAG = '<pic prompt="a long enough prompt to pass the floor"></pic>'

describe('InlineImageTracker', () => {
  beforeEach(() => {
    createEmbeddedImage.mockClear()
    updateEmbeddedImage.mockClear()
  })

  it('records a tag seen in the final chunk, flushed before its style lookup resolves', async () => {
    const tracker = new InlineImageTracker('story', 'entry', () => [])

    tracker.processChunk(`The room fell silent. ${TAG}`, false)
    // No await in between: this is the ordering the streaming pipeline produces, where
    // the entry is saved the moment the last chunk lands.
    await tracker.flushToDatabase()

    expect(createEmbeddedImage).toHaveBeenCalledTimes(1)
    expect(createEmbeddedImage.mock.calls[0][0]).toMatchObject({
      entryId: 'entry',
      sourceText: TAG,
      generationMode: 'inline',
    })
  })

  it('reports work in flight before the tag reaches the pending list', () => {
    const tracker = new InlineImageTracker('story', 'entry', () => [])

    tracker.processChunk(TAG, false)

    expect(tracker.hasPendingImages).toBe(true)
  })
})
