import { describe, it, expect, vi, beforeEach } from 'vitest'

// Each service here absorbs a failed request into a fallback. These tests hold that it still
// closes the step it serves as failed, with the reason, and returns the same fallback as before.

const activity = vi.hoisted(() => ({
  startStep: vi.fn(() => ''),
  updateStep: vi.fn(),
  endStep: vi.fn(),
  recordStep: vi.fn(() => ''),
}))
vi.mock('#lib/stores/activity.svelte.ts', () => ({ activity }))
vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    getServicePresetId: vi.fn(() => 'preset'),
    systemServicesSettings: { timelineFill: { maxQueries: 3 } },
  },
}))
vi.mock('./core/config', () => ({
  getContextConfig: () => ({ recentEntriesForSuggestions: 5, recentEntriesForChoices: 5 }),
  getLorebookConfig: () => ({ maxForSuggestions: 5 }),
  AI_CONFIG: { memory: { defaultTokenThreshold: 1000, defaultChapterBuffer: 2 } },
}))
vi.mock('#lib/services/context/index.ts', () => ({
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
import { StyleReviewerService } from './generation/StyleReviewerService'
import { MemoryService } from './generation/MemoryService'

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

describe('style review', () => {
  const entries = [{ id: 'n1', type: 'narration', content: 'She ran.' }] as any

  it('returns its fallback with the reason', async () => {
    const service = new StyleReviewerService('styleReviewer' as any, false)
    const result = await service.analyzeStyle('s', entries)
    expect(result).toMatchObject({
      phrases: [],
      overallAssessment: 'Analysis failed.',
      failure: 'provider down',
    })
  })
})

describe('request parents', () => {
  const parentOf = (call: unknown[]) => (call[0] as { activityParentId?: string }).activityParentId
  const entries = [{ id: 'n1', type: 'narration', content: 'She ran.' }] as any

  it('reach the chapter analysis and summary requests', async () => {
    generateStructured.mockResolvedValue({ keywords: [], shouldCreateChapter: false })
    const service = new MemoryService('memory' as any)

    await service.analyzeForChapter('s', entries, 0, 100, 'adventure', 'second', 'present', 'check')
    await service.summarizeChapter(
      's',
      entries,
      [],
      'adventure',
      'second',
      'present',
      'auto',
      'sum',
    )

    expect(generateStructured.mock.calls.map(parentOf)).toEqual(['check', 'sum'])
  })

  it('reaches the style review request', async () => {
    const service = new StyleReviewerService('styleReviewer' as any, false)
    await service.analyzeStyle('s', entries, 'adventure', 'second', 'present', 32, 'review')
    expect(parentOf(generateStructured.mock.calls[0])).toBe('review')
  })

  it('reaches a chapter question', async () => {
    generatePlainText.mockResolvedValue('Ilsa left.')
    const service = new TimelineFillService('timelineFill' as any, 3)
    const chapter = { number: 1, summary: 'The start.' } as any

    await service.answerQuestion('s', 'Who left?', [chapter], [1], undefined, 1000, 'read')

    expect(parentOf(generatePlainText.mock.calls[0])).toBe('read')
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
