import { describe, it, expect, vi, beforeEach } from 'vitest'

// Each service here absorbs a failed request into a fallback. These tests hold that it still
// closes the step it serves as failed, with the reason, and returns the same fallback as before.

const activity = vi.hoisted(() => ({
  startStep: vi.fn(() => ''),
  updateStep: vi.fn(),
  endStep: vi.fn(),
  recordStep: vi.fn(() => ''),
}))
vi.mock('$lib/stores/activity.svelte', () => ({ activity }))
vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))
vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    getServicePresetId: vi.fn(() => 'preset'),
    systemServicesSettings: { timelineFill: { maxQueries: 3 } },
  },
}))
vi.mock('./core/config', () => ({
  getContextConfig: () => ({ recentEntriesForSuggestions: 5, recentEntriesForChoices: 5 }),
  getLorebookConfig: () => ({ maxForSuggestions: 5 }),
}))
vi.mock('$lib/services/context', () => ({
  ContextBuilder: class {
    static async forPack() {
      return new this()
    }
    static async forStory() {
      return new this()
    }
    add() {}
    getContext() {
      return {}
    }
    async render() {
      return { system: 'system', user: 'user' }
    }
  },
}))

const failure = new Error('provider down')
const generateStructured = vi.fn()
const generatePlainText = vi.fn()
vi.mock('./sdk/generate', () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
  generatePlainText: (...args: unknown[]) => generatePlainText(...args),
}))

import { TranslationService } from './utils/TranslationService'
import { SuggestionsService } from './generation/SuggestionsService'
import { ActionChoicesService } from './generation/ActionChoicesService'
import { TimelineFillService } from './retrieval/TimelineFillService'
import { ImageAnalysisService } from './image/ImageAnalysisService'

beforeEach(() => {
  vi.clearAllMocks()
  generateStructured.mockRejectedValue(failure)
  generatePlainText.mockRejectedValue(failure)
})

describe('absorbed failures', () => {
  it('narration translation returns the original with the reason', async () => {
    const service = new TranslationService('translation' as any)
    const result = await service.translateNarration('Hi.', 'it', false, 's', 'step')
    expect(result).toEqual({ translatedContent: 'Hi.', failure: 'provider down' })
  })

  it('input translation returns the original with the reason', async () => {
    const service = new TranslationService('translation' as any)
    const result = await service.translateInput('Ciao.', 'it', 's')
    expect(result).toEqual({ translatedContent: 'Ciao.', failure: 'provider down' })
  })

  it('suggestion and action-choice translation return the originals with the reason', async () => {
    const service = new TranslationService('translation' as any)
    const items = [{ text: 'Go north' }]
    const failed = { items, failure: 'provider down' }
    expect(await service.translateSuggestions(items, 'it', 's', 'sugg')).toEqual(failed)
    expect(await service.translateActionChoices(items, 'it', 's', 'choice')).toEqual(failed)
  })

  it('suggestions return an empty list with the reason', async () => {
    const service = new SuggestionsService('suggestions' as any)
    const result = await service.generateSuggestions([], [], [], 's', 'Hi.', 'step')
    expect(result).toEqual({ suggestions: [], failure: 'provider down' })
  })

  it('action choices return an empty list with the reason', async () => {
    const service = new ActionChoicesService('actionChoices' as any)
    const result = await service.generateChoices({
      activityParentId: 'step',
      storyId: 's',
      narrativeResponse: 'Hi.',
      userAction: 'Wave',
      recentEntries: [],
      protagonistName: 'You',
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
    } as any)
    expect(result).toEqual({ choices: [], failure: 'provider down' })
  })

  it('timeline fill planning returns no questions, with the reason', async () => {
    const service = new TimelineFillService('timelineFill' as any, 3)
    const chapter = { number: 1, summary: 'The start.' } as any
    expect(await service.generateQueries('s', [], [chapter], undefined, 'plan')).toEqual({
      queries: [],
      failure: 'provider down',
    })
  })

  it('a timeline fill chapter read marks its answer unanswered, with the reason', async () => {
    const service = new TimelineFillService('timelineFill' as any, 3) as any
    const answer = await service.answerQuestionWithContent(
      's',
      'Who left?',
      'Chapter text.',
      'read',
    )
    expect(answer).toMatchObject({ confidence: 0, failure: 'provider down' })
  })

  it('scene analysis reports its failure apart from finding no scenes', async () => {
    const service = new ImageAnalysisService('imageAnalysis' as any)
    const context = {
      storyId: 's',
      narrativeResponse: 'Hi.',
      userAction: 'Wave',
      presentCharacters: [],
      stylePrompt: '',
      maxImages: 3,
      charactersWithPortraits: [],
      charactersWithoutPortraits: [],
      referenceMode: false,
    } as any
    expect(await service.identifyScenes(context, 'analysis')).toEqual({
      scenes: [],
      failure: 'provider down',
    })

    generateStructured.mockResolvedValueOnce({ scenes: [] })
    expect(await service.identifyScenes(context, 'analysis')).toEqual({ scenes: [] })
  })

  it('leaves no step touched when no parent was given', async () => {
    const service = new TranslationService('translation' as any)
    await service.translateNarration('Hi.', 'it', false, 's')
    expect(activity.endStep).not.toHaveBeenCalled()
  })
})

describe('cancellation', () => {
  it('is rethrown rather than absorbed into a fallback', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    generateStructured.mockRejectedValue(abort)
    const service = new SuggestionsService('suggestions' as any)
    await expect(service.generateSuggestions([], [], [], 's', 'Hi.', 'step')).rejects.toBe(abort)
  })
})
