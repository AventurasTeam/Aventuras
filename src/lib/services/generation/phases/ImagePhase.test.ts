import { describe, it, expect, vi } from 'vitest'
import { ImagePhase, type ImageDependencies, type ImageInput } from './ImagePhase'
import type { GenerationEvent } from '../types'
import type { Character } from '$lib/types'

async function drain<R>(gen: AsyncGenerator<GenerationEvent, R>) {
  const events: GenerationEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

function makeDeps(overrides: Partial<ImageDependencies> = {}): ImageDependencies {
  return {
    generateImagesForNarrative: async () => {},
    isImageGenerationEnabled: () => true,
    ...overrides,
  }
}

function makeInput(overrides: Partial<ImageInput> = {}): ImageInput {
  return {
    storyId: 's1',
    entryId: 'n1',
    narrativeContent: 'The dragon fell.',
    userAction: 'Attack the dragon',
    presentCharacters: [{ id: 'c1', name: 'Aria' } as Character],
    currentLocation: 'Oakvale',
    imageSettings: { imageGenerationMode: 'agentic' },
    ...overrides,
  }
}

describe('ImagePhase', () => {
  it('builds the generation context from the turn', async () => {
    const generateImagesForNarrative = vi.fn().mockResolvedValue(undefined)

    const { result } = await drain(
      new ImagePhase(makeDeps({ generateImagesForNarrative })).execute(
        makeInput({ translatedNarrative: 'Il drago cadde.', translationLanguage: 'it' }),
      ),
    )

    expect(result).toEqual({ started: true })
    expect(generateImagesForNarrative).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId: 's1',
        entryId: 'n1',
        narrativeResponse: 'The dragon fell.',
        userAction: 'Attack the dragon',
        currentLocation: 'Oakvale',
        translatedNarrative: 'Il drago cadde.',
        translationLanguage: 'it',
      }),
    )
  })

  it('defaults referenceMode to false rather than leaving it undefined', async () => {
    const generateImagesForNarrative = vi.fn().mockResolvedValue(undefined)

    await drain(new ImagePhase(makeDeps({ generateImagesForNarrative })).execute(makeInput()))

    expect(generateImagesForNarrative.mock.calls[0][0].referenceMode).toBe(false)
  })

  describe('skips, each with its own reason', () => {
    const skipped = async (imageSettings: ImageInput['imageSettings'], deps = makeDeps()) =>
      (await drain(new ImagePhase(deps).execute(makeInput({ imageSettings })))).result

    it('reports inline_mode, where images are parsed from the stream instead', async () => {
      expect(await skipped({ imageGenerationMode: 'inline' })).toEqual({
        started: false,
        skippedReason: 'inline_mode',
      })
    })

    it('reports disabled when the story asks for no images', async () => {
      expect(await skipped({ imageGenerationMode: 'none' })).toEqual({
        started: false,
        skippedReason: 'disabled',
      })
    })

    it('reports agentic_generate_off for any other mode', async () => {
      expect(await skipped({} as ImageInput['imageSettings'])).toEqual({
        started: false,
        skippedReason: 'agentic_generate_off',
      })
    })

    it('reports not_configured when no profile can serve standard images', async () => {
      const deps = makeDeps({ isImageGenerationEnabled: () => false })

      expect(await skipped({ imageGenerationMode: 'agentic' }, deps)).toEqual({
        started: false,
        skippedReason: 'not_configured',
      })
    })

    it('also requires a reference profile when reference mode is on', async () => {
      // Reference mode feeds character portraits into generation; without a profile that
      // can produce them it would silently fall back to unreferenced images.
      const deps = makeDeps({
        isImageGenerationEnabled: (_settings, type) => type !== 'reference',
      })

      expect(await skipped({ imageGenerationMode: 'agentic', referenceMode: true }, deps)).toEqual({
        started: false,
        skippedReason: 'not_configured',
      })
    })

    it('does not require one when reference mode is off', async () => {
      const deps = makeDeps({
        isImageGenerationEnabled: (_settings, type) => type !== 'reference',
      })

      expect(await skipped({ imageGenerationMode: 'agentic', referenceMode: false }, deps)).toEqual(
        { started: true },
      )
    })
  })

  it('treats a generation failure as non-fatal', async () => {
    const deps = makeDeps({
      generateImagesForNarrative: async () => {
        throw new Error('image provider down')
      },
    })

    const { events, result } = await drain(new ImagePhase(deps).execute(makeInput()))

    expect(result.started).toBe(false)
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: false, phase: 'image' })
  })

  describe('abort', () => {
    it('does not start when already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const generateImagesForNarrative = vi.fn()

      const { events, result } = await drain(
        new ImagePhase(makeDeps({ generateImagesForNarrative })).execute(
          makeInput({ abortSignal: controller.signal }),
        ),
      )

      expect(generateImagesForNarrative).not.toHaveBeenCalled()
      expect(result).toEqual({ started: false, skippedReason: 'aborted' })
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })

    it('reports an AbortError as an abort, not an error', async () => {
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      const deps = makeDeps({
        generateImagesForNarrative: async () => {
          throw abortError
        },
      })

      const { events, result } = await drain(new ImagePhase(deps).execute(makeInput()))

      expect(result.skippedReason).toBe('aborted')
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })
  })
})
