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

describe('ImagePhase activity reporting', () => {
  function reporter() {
    const updates: [string, string][] = []
    const activity = {
      startStep: () => '',
      endStep: () => {},
      recordStep: () => '',
      updateStep: (id: string, detail: string) => updates.push([id, detail]),
    }
    return { activity, updates }
  }

  it('notes how many images it handed off', async () => {
    const { activity, updates } = reporter()
    const generate = vi.fn().mockResolvedValue({ queued: 3 })

    const { events } = await drain(
      new ImagePhase(makeDeps({ generateImagesForNarrative: generate })).execute(
        makeInput({ activity, activityParentId: 'images' }),
      ),
    )

    expect(generate.mock.calls[0][0].activityParentId).toBe('images')
    expect(updates).toEqual([['images', '3 images queued']])
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('notes none queued when the analysis found no scenes', async () => {
    const { activity, updates } = reporter()

    await drain(
      new ImagePhase(
        makeDeps({ generateImagesForNarrative: vi.fn().mockResolvedValue({ queued: 0 }) }),
      ).execute(makeInput({ activity, activityParentId: 'images' })),
    )

    expect(updates).toEqual([['images', '0 images queued']])
  })

  it('reports a failed analysis as a non-fatal error with its reason', async () => {
    const { activity, updates } = reporter()
    const generate = vi.fn().mockResolvedValue({ queued: 0, failure: '401 · invalid API key' })

    const { events, result } = await drain(
      new ImagePhase(makeDeps({ generateImagesForNarrative: generate })).execute(
        makeInput({ activity, activityParentId: 'images' }),
      ),
    )

    const error = events.find((e) => e.type === 'error') as any
    expect(error).toMatchObject({ fatal: false })
    expect(error.error.message).toBe('401 · invalid API key')
    expect(updates).toEqual([])
    expect(result).toEqual({ started: true })
  })
})
