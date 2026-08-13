import { describe, it, expect, vi } from 'vitest'

// PostGenerationPhase imports TranslationService for its `shouldTranslate` gate, and that
// class extends BaseAIService. Stubbing the two rune-based stores it reaches lets the real
// gate run rather than a reimplementation of it.
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

import {
  PostGenerationPhase,
  type PostGenerationDependencies,
  type PostGenerationInput,
} from './PostGenerationPhase'
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

const suggestions = [{ text: 'Run' }] as any[]
const choices = [{ text: 'Fight' }] as any[]

const noTranslation = { enabled: false, targetLanguage: 'en' } as unknown as TranslationSettings
const italian = { enabled: true, targetLanguage: 'it' } as unknown as TranslationSettings

function makeDeps(overrides: Partial<PostGenerationDependencies> = {}): PostGenerationDependencies {
  return {
    generateSuggestions: async () => ({ suggestions }),
    translateSuggestions: async () => [{ text: 'Scappa' }] as any[],
    generateActionChoices: async () => ({ choices }),
    translateActionChoices: async () => [{ text: 'Combatti' }] as any[],
    ...overrides,
  }
}

function makeInput(overrides: Partial<PostGenerationInput> = {}): PostGenerationInput {
  return {
    isCreativeMode: false,
    disableSuggestions: false,
    storyId: 'story-1',
    entries: [],
    activeThreads: [],
    lorebookEntries: [],
    promptContext: {
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: 'Aria',
    },
    worldState: { characters: [], locations: [], items: [], storyBeats: [] },
    narrativeResponse: 'The dragon fell.',
    pov: 'second',
    translationSettings: noTranslation,
    ...overrides,
  }
}

describe('PostGenerationPhase', () => {
  describe('mode picks exactly one generator', () => {
    it('generates action choices in adventure mode', async () => {
      const generateSuggestions = vi.fn()
      const deps = makeDeps({ generateSuggestions })

      const { result } = await drain(new PostGenerationPhase(deps).execute(makeInput()))

      expect(result.actionChoices).toEqual(choices)
      expect(result.suggestions).toBeNull()
      expect(generateSuggestions).not.toHaveBeenCalled()
    })

    it('generates suggestions in creative mode', async () => {
      const generateActionChoices = vi.fn()
      const deps = makeDeps({ generateActionChoices })

      const { result } = await drain(
        new PostGenerationPhase(deps).execute(makeInput({ isCreativeMode: true })),
      )

      expect(result.suggestions).toEqual(suggestions)
      expect(result.actionChoices).toBeNull()
      expect(generateActionChoices).not.toHaveBeenCalled()
    })
  })

  it('generates nothing when suggestions are switched off', async () => {
    const generateSuggestions = vi.fn()
    const generateActionChoices = vi.fn()

    const { events, result } = await drain(
      new PostGenerationPhase(makeDeps({ generateSuggestions, generateActionChoices })).execute(
        makeInput({ disableSuggestions: true }),
      ),
    )

    expect(generateSuggestions).not.toHaveBeenCalled()
    expect(generateActionChoices).not.toHaveBeenCalled()
    expect(result).toEqual({ suggestions: null, actionChoices: null })
    expect(events.map((e) => e.type)).toEqual(['phase_start', 'phase_complete'])
  })

  describe('translation', () => {
    it('translates action choices when a non-English target is set', async () => {
      const { result } = await drain(
        new PostGenerationPhase(makeDeps()).execute(makeInput({ translationSettings: italian })),
      )

      expect(result.actionChoices).toEqual([{ text: 'Combatti' }])
    })

    it('leaves them alone when the target language is English', async () => {
      const translateActionChoices = vi.fn()

      const { result } = await drain(
        new PostGenerationPhase(makeDeps({ translateActionChoices })).execute(makeInput()),
      )

      expect(translateActionChoices).not.toHaveBeenCalled()
      expect(result.actionChoices).toEqual(choices)
    })

    it('falls back to the untranslated choices when translation fails', async () => {
      // Losing the choices entirely would be a worse outcome than showing them in English.
      const deps = makeDeps({
        translateActionChoices: async () => {
          throw new Error('provider down')
        },
      })

      const { events, result } = await drain(
        new PostGenerationPhase(deps).execute(makeInput({ translationSettings: italian })),
      )

      expect(result.actionChoices).toEqual(choices)
      // Swallowed inside, so the phase still reports a clean completion.
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'phase_complete'])
    })

    it('falls back to the untranslated suggestions when translation fails', async () => {
      const deps = makeDeps({
        translateSuggestions: async () => {
          throw new Error('provider down')
        },
      })

      const { result } = await drain(
        new PostGenerationPhase(deps).execute(
          makeInput({ isCreativeMode: true, translationSettings: italian }),
        ),
      )

      expect(result.suggestions).toEqual(suggestions)
    })
  })

  describe('storyId forwarding', () => {
    // Every one of these renders a template from the story's pack. Asserted by position,
    // not just by presence: the argument is what points them at the right pack, and a
    // dropped or reordered one is otherwise invisible until a user opens the output.
    it('hands the story to the action-choice generator and its translation', async () => {
      const generateActionChoices = vi.fn(async () => ({ choices }))
      const translateActionChoices = vi.fn(async () => choices)

      await drain(
        new PostGenerationPhase(
          makeDeps({ generateActionChoices, translateActionChoices }),
        ).execute(makeInput({ translationSettings: italian })),
      )

      expect(generateActionChoices).toHaveBeenCalledWith(
        [],
        { characters: [], locations: [], items: [], storyBeats: [] },
        'The dragon fell.',
        [],
        expect.objectContaining({ mode: 'adventure' }),
        'second',
        'story-1',
      )
      expect(translateActionChoices).toHaveBeenCalledWith(choices, 'it', 'story-1')
    })

    it('hands the story to the suggestions generator and its translation', async () => {
      const generateSuggestions = vi.fn(async () => ({ suggestions }))
      const translateSuggestions = vi.fn(async () => suggestions)

      await drain(
        new PostGenerationPhase(makeDeps({ generateSuggestions, translateSuggestions })).execute(
          makeInput({ isCreativeMode: true, translationSettings: italian }),
        ),
      )

      expect(generateSuggestions).toHaveBeenCalledWith([], [], [], 'The dragon fell.', 'story-1')
      expect(translateSuggestions).toHaveBeenCalledWith(suggestions, 'it', 'story-1')
    })
  })

  it('treats a generation failure as non-fatal', async () => {
    const deps = makeDeps({
      generateActionChoices: async () => {
        throw new Error('provider down')
      },
    })

    const { events, result } = await drain(new PostGenerationPhase(deps).execute(makeInput()))

    expect(result.actionChoices).toBeNull()
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: false, phase: 'post' })
    // Still completes: the narration is already on screen either way.
    expect(events.at(-1)?.type).toBe('phase_complete')
  })

  it('does nothing when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const generateActionChoices = vi.fn()

    const { events, result } = await drain(
      new PostGenerationPhase(makeDeps({ generateActionChoices })).execute(
        makeInput({ abortSignal: controller.signal }),
      ),
    )

    expect(generateActionChoices).not.toHaveBeenCalled()
    expect(result).toEqual({ suggestions: null, actionChoices: null })
    expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
  })
})
