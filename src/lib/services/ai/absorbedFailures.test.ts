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

const failedWith = (id: string) =>
  expect(activity.endStep).toHaveBeenCalledWith(id, 'failed', undefined, 'provider down')

describe('absorbed failures', () => {
  it('narration translation returns the original and fails its step', async () => {
    const service = new TranslationService('translation' as any)
    const result = await service.translateNarration('Hi.', 'it', false, 's', 'step')
    expect(result.translatedContent).toBe('Hi.')
    failedWith('step')
  })

  it('input translation returns the original with the reason', async () => {
    const service = new TranslationService('translation' as any)
    const result = await service.translateInput('Ciao.', 'it', 's')
    expect(result).toEqual({ translatedContent: 'Ciao.', failure: 'provider down' })
  })

  it('suggestion and action-choice translation return the originals and fail their steps', async () => {
    const service = new TranslationService('translation' as any)
    const items = [{ text: 'Go north' }]
    expect(await service.translateSuggestions(items, 'it', 's', 'sugg')).toBe(items)
    expect(await service.translateActionChoices(items, 'it', 's', 'choice')).toBe(items)
    failedWith('sugg')
    failedWith('choice')
  })

  it('suggestions return an empty list and fail their step', async () => {
    const service = new SuggestionsService('suggestions' as any)
    const result = await service.generateSuggestions([], [], [], 's', 'Hi.', 'step')
    expect(result).toEqual({ suggestions: [] })
    failedWith('step')
  })

  it('action choices return an empty list and fail their step', async () => {
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
    expect(result).toEqual([])
    failedWith('step')
  })

  it('timeline fill planning returns no questions and fails its step', async () => {
    const service = new TimelineFillService('timelineFill' as any, 3)
    const chapter = { number: 1, summary: 'The start.' } as any
    expect(await service.generateQueries('s', [], [chapter], undefined, 'plan')).toEqual([])
    failedWith('plan')
  })

  it('a timeline fill chapter read marks its answer unanswered and fails its step', async () => {
    const service = new TimelineFillService('timelineFill' as any, 3) as any
    const answer = await service.answerQuestionWithContent(
      's',
      'Who left?',
      'Chapter text.',
      'read',
    )
    expect(answer.confidence).toBe(0)
    failedWith('read')
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
