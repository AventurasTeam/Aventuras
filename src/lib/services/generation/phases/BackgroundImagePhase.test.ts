import { describe, it, expect, vi } from 'vitest'
import {
  BackgroundImagePhase,
  type BackgroundImageDependencies,
  type BackgroundImageInput,
} from './BackgroundImagePhase'
import type { GenerationEvent } from '../types'

async function drain<R>(gen: AsyncGenerator<GenerationEvent, R>) {
  const events: GenerationEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

function makeDeps(
  overrides: Partial<BackgroundImageDependencies> = {},
): BackgroundImageDependencies {
  return {
    analyzeBackgroundChangeAndGenerateImage: async () => {},
    isImageGenerationEnabled: () => true,
    ...overrides,
  }
}

function makeInput(overrides: Partial<BackgroundImageInput> = {}): BackgroundImageInput {
  return {
    storyId: 's1',
    storyEntries: [],
    imageSettings: { backgroundImagesEnabled: true, imageGenerationMode: 'agentic' },
    ...overrides,
  }
}

describe('BackgroundImagePhase', () => {
  it('runs the background analyser when everything is configured', async () => {
    const analyze = vi.fn().mockResolvedValue(undefined)

    const { events, result } = await drain(
      new BackgroundImagePhase(
        makeDeps({ analyzeBackgroundChangeAndGenerateImage: analyze }),
      ).execute(makeInput()),
    )

    expect(analyze).toHaveBeenCalledWith('s1', [])
    expect(result).toEqual({ started: true })
    expect(events.map((e) => e.type)).toEqual(['phase_start', 'phase_complete'])
  })

  describe('skips, each with its own reason', () => {
    // The reason is the only way to tell "the user turned this off" from "no image profile
    // is set up" when a background never appears.

    it('reports disabled when background images are off', async () => {
      const analyze = vi.fn()

      const { result } = await drain(
        new BackgroundImagePhase(
          makeDeps({ analyzeBackgroundChangeAndGenerateImage: analyze }),
        ).execute(makeInput({ imageSettings: { backgroundImagesEnabled: false } })),
      )

      expect(result).toEqual({ started: false, skippedReason: 'disabled' })
      expect(analyze).not.toHaveBeenCalled()
    })

    it('reports inline_mode, where images come from <pic> tags instead', async () => {
      const { result } = await drain(
        new BackgroundImagePhase(makeDeps()).execute(
          makeInput({
            imageSettings: { backgroundImagesEnabled: true, imageGenerationMode: 'inline' },
          }),
        ),
      )

      expect(result).toEqual({ started: false, skippedReason: 'inline_mode' })
    })

    it('reports not_configured when no profile can serve backgrounds', async () => {
      const { result } = await drain(
        new BackgroundImagePhase(makeDeps({ isImageGenerationEnabled: () => false })).execute(
          makeInput(),
        ),
      )

      expect(result).toEqual({ started: false, skippedReason: 'not_configured' })
    })

    it('asks specifically about the background profile, not standard images', async () => {
      const isImageGenerationEnabled = vi.fn().mockReturnValue(true)

      await drain(
        new BackgroundImagePhase(makeDeps({ isImageGenerationEnabled })).execute(makeInput()),
      )

      expect(isImageGenerationEnabled.mock.calls[0][1]).toBe('background')
    })
  })

  it('treats a generation failure as non-fatal', async () => {
    const deps = makeDeps({
      analyzeBackgroundChangeAndGenerateImage: async () => {
        throw new Error('image provider down')
      },
    })

    const { events, result } = await drain(new BackgroundImagePhase(deps).execute(makeInput()))

    expect(result.started).toBe(false)
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: false })
  })

  describe('abort', () => {
    it('does not start when already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const analyze = vi.fn()

      const { events, result } = await drain(
        new BackgroundImagePhase(
          makeDeps({ analyzeBackgroundChangeAndGenerateImage: analyze }),
        ).execute(makeInput({ abortSignal: controller.signal })),
      )

      expect(analyze).not.toHaveBeenCalled()
      expect(result).toEqual({ started: false, skippedReason: 'aborted' })
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })

    it('reports an AbortError as an abort, not an error', async () => {
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      const deps = makeDeps({
        analyzeBackgroundChangeAndGenerateImage: async () => {
          throw abortError
        },
      })

      const { events, result } = await drain(new BackgroundImagePhase(deps).execute(makeInput()))

      expect(result.skippedReason).toBe('aborted')
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })
  })
})
