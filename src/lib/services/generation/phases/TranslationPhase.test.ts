import { describe, it, expect, vi } from 'vitest'

// TranslationPhase imports TranslationService for its `shouldTranslateNarration` gate.
// That class extends BaseAIService, so loading it reaches the debug and settings stores --
// rune-based modules the test runner cannot evaluate. Both are stubbed so the *real* gate
// runs: reimplementing the predicate here would leave the thing under test untested.
vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))
vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    getServicePresetId: () => 'translation',
    getPresetConfig: () => ({ model: 'test-model', temperature: 0 }),
    systemServicesSettings: {},
    advancedRequestSettings: { manualMode: false },
  },
}))

import { TranslationPhase, type TranslationInput } from './TranslationPhase'
import type { GenerationEvent } from '../types'
import type { TranslationSettings } from '$lib/types'

async function drain<R>(gen: AsyncGenerator<GenerationEvent, R>) {
  const events: GenerationEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const enabled = {
  enabled: true,
  targetLanguage: 'it',
  translateNarration: true,
} as unknown as TranslationSettings

const disabled = { enabled: false } as unknown as TranslationSettings

function makeInput(overrides: Partial<TranslationInput> = {}): TranslationInput {
  return {
    storyId: 'story-1',
    narrativeContent: 'The dragon fell.',
    narrativeEntryId: 'n1',
    isVisualProse: false,
    translationSettings: enabled,
    ...overrides,
  }
}

describe('TranslationPhase', () => {
  it('translates and reports the target language', async () => {
    const translateNarration = vi.fn().mockResolvedValue({ translatedContent: 'Il drago cadde.' })

    const { events, result } = await drain(
      new TranslationPhase({ translateNarration }).execute(makeInput()),
    )

    expect(result).toEqual({
      translated: true,
      translatedContent: 'Il drago cadde.',
      targetLanguage: 'it',
    })
    expect(events.map((e) => e.type)).toEqual(['phase_start', 'phase_complete'])
  })

  it('passes the visual prose flag through, since it changes the markup to preserve', async () => {
    const translateNarration = vi.fn().mockResolvedValue({ translatedContent: 'x' })

    await drain(
      new TranslationPhase({ translateNarration }).execute(makeInput({ isVisualProse: true })),
    )

    expect(translateNarration).toHaveBeenCalledWith('The dragon fell.', 'it', true, 'story-1')
  })

  it('skips without calling the translator when translation is off', async () => {
    const translateNarration = vi.fn()

    const { events, result } = await drain(
      new TranslationPhase({ translateNarration }).execute(
        makeInput({ translationSettings: disabled }),
      ),
    )

    expect(translateNarration).not.toHaveBeenCalled()
    expect(result.translated).toBe(false)
    // A skip is a normal completion, not an abort: the turn carries on untranslated.
    expect(events.map((e) => e.type)).toEqual(['phase_start', 'phase_complete'])
  })

  it('keeps the original content when translation fails', async () => {
    // Non-fatal by design: a failed translation must not cost the user the narration.
    const phase = new TranslationPhase({
      translateNarration: async () => {
        throw new Error('provider down')
      },
    })

    const { events, result } = await drain(phase.execute(makeInput()))

    expect(result).toEqual({ translated: false, translatedContent: null, targetLanguage: null })
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: false })
  })

  describe('abort', () => {
    it('does not call the translator when already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const translateNarration = vi.fn()

      const { events, result } = await drain(
        new TranslationPhase({ translateNarration }).execute(
          makeInput({ abortSignal: controller.signal }),
        ),
      )

      expect(translateNarration).not.toHaveBeenCalled()
      expect(result.translated).toBe(false)
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })

    it('discards a translation that arrived after the abort', async () => {
      const controller = new AbortController()
      const phase = new TranslationPhase({
        translateNarration: async () => {
          controller.abort()
          return { translatedContent: 'Il drago cadde.' } as never
        },
      })

      const { result } = await drain(phase.execute(makeInput({ abortSignal: controller.signal })))

      expect(result.translatedContent).toBeNull()
    })

    it('reports an AbortError as an abort, not an error', async () => {
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      const phase = new TranslationPhase({
        translateNarration: async () => {
          throw abortError
        },
      })

      const { events } = await drain(phase.execute(makeInput()))

      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })
  })
})
