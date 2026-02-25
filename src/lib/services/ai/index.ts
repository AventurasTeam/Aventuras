/**
 * AI Service - Main Orchestrator
 *
 * Coordinates AI services for narrative generation, classification, memory, and more.
 *
 * STATUS: Tier 0, 1, 3 Complete
 * WORKING (SDK-migrated):
 * - streamNarrative(), generateNarrative() - NarrativeService
 * - classifyResponse() - ClassifierService
 * - analyzeForChapter(), summarizeChapter(), decideRetrieval() - MemoryService
 * - generateSuggestions() - SuggestionsService
 * - generateActionChoices() - ActionChoicesService
 * - runTimelineFill(), answerChapterQuestion(), answerChapterRangeQuestion() - TimelineFillService
 * - buildTieredContext(), getRelevantLorebookEntries() - EntryInjector/EntryRetrievalService
 * - analyzeStyle() - StyleReviewerService
 * - runLoreManagement() - LoreManagementService
 * - generateImagesForNarrative() (both inline and analyzed modes) - ImageAnalysisService
 * - runAgenticRetrieval() - AgenticRetrievalService
 *
 * STUBBED (awaiting migration):
 * - translate*() - TranslationService
 */

import { settings } from '$lib/stores/settings.svelte'
import { story } from '$lib/stores/story.svelte'
import { database } from '$lib/services/database'
import type { StoryMode, POV, Tense } from '$lib/types'
import type { PromptContext } from '../generation/phases/PostGenerationPhase'
import { DEFAULT_FALLBACK_STYLE_PROMPT } from './image/constants'
import { type ClassificationContext } from './generation/ClassifierService'
import type { ClassificationResult } from './sdk/schemas/classifier'
import { MemoryService, type RetrievalContext } from './generation/MemoryService'
import type { ChapterAnalysis, ChapterSummaryResult, RetrievalDecision } from './sdk/schemas/memory'
import type { SuggestionsResult } from './sdk/schemas/suggestions'
import type { ActionChoicesResult } from './sdk/schemas/actionchoices'
import type { StyleReviewResult } from './generation/StyleReviewerService'
import {
  type AgenticRetrievalResult,
  type RetrievalContext as AgenticRetrievalContext,
} from './retrieval/AgenticRetrievalService'
import type { TimelineFillResult } from './retrieval/TimelineFillService'
import { EntryInjector, type ContextResult, type ContextConfig } from './generation/EntryInjector'
import {
  EntryRetrievalService,
  type EntryRetrievalResult,
  type ActivationTracker,
  getEntryRetrievalConfigFromSettings,
} from './retrieval/EntryRetrievalService'
import {
  inlineImageService,
  type InlineImageContext,
  isImageGenerationEnabled as isImageGenerationEnabledUtil,
  type ImageAnalysisContext,
} from './image'
import {
  emitImageAnalysisStarted,
  emitImageAnalysisComplete,
  emitImageAnalysisFailed,
  emitImageQueued,
  emitImageReady,
  emitBackgroundImageAnalysisStarted,
  emitBackgroundImageAnalysisComplete,
  emitBackgroundImageAnalysisFailed,
  emitBackgroundImageQueued,
  emitBackgroundImageReady,
} from '$lib/services/events'
import { generateImage as registryGenerateImage } from './image/providers/registry'
import { normalizeImageDataUrl } from '$lib/utils/image'
import type { ImageableScene } from './sdk/schemas/imageanalysis'
import type { EmbeddedImage } from '$lib/types'

// Re-export ImageGenerationContext type for backwards compatibility
export interface ImageGenerationContext {
  storyId: string
  entryId: string
  narrativeResponse: string
  userAction: string
  presentCharacters: Character[]
  currentLocation?: string
  chatHistory?: string
  lorebookContext?: string
  translatedNarrative?: string
  translationLanguage?: string
  referenceMode: boolean
}
import type { TranslationResult, UITranslationItem } from './utils/TranslationService'
import type { StreamChunk } from './core/types'
import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  MemoryConfig,
  Entry,
  LoreManagementResult,
  LoreChange,
  TimeTracker,
  StorySettings,
} from '$lib/types'
import { createLogger } from './core/config'
import { serviceFactory } from './core/factory'
import { NarrativeService } from './generation/NarrativeService'
import type { WorldStateContext } from './generation/NarrativeService'
import { parseImageSize } from './image/imageUtils'

const log = createLogger('AIService')

interface WorldState extends WorldStateContext {
  memoryConfig?: MemoryConfig
  lorebookEntries?: Entry[]
}

class AIService {
  private narrativeService: NarrativeService

  constructor() {
    this.narrativeService = serviceFactory.createNarrativeService()
  }

  /**
   * Generate a complete narrative response (non-streaming).
   */
  async generateNarrative(
    entries: StoryEntry[],
    worldState: WorldState,
    story?: Story | null,
  ): Promise<string> {
    return this.narrativeService.generate(entries, worldState, story)
  }

  /**
   * Stream a narrative response.
   * This is the primary method for real-time story generation.
   */
  async *streamNarrative(
    entries: StoryEntry[],
    worldState: WorldState,
    currentStory?: Story | null,
    useTieredContext = true,
    styleReview?: StyleReviewResult | null,
    retrievedChapterContext?: string | null,
    signal?: AbortSignal,
    timelineFillResult?: TimelineFillResult | null,
  ): AsyncIterable<StreamChunk> {
    log('streamNarrative called', {
      entriesCount: entries.length,
      useTieredContext,
      hasStyleReview: !!styleReview,
      hasRetrievedContext: !!retrievedChapterContext,
      hasTimelineFill: !!timelineFillResult,
    })

    // Build tiered context if requested
    let tieredContextBlock: string | undefined
    if (useTieredContext) {
      const lastEntry = entries[entries.length - 1]
      const userInput = lastEntry?.content ?? ''
      const contextResult = await this.buildTieredContext(
        worldState,
        userInput,
        entries,
        retrievedChapterContext ?? undefined,
      )
      tieredContextBlock = contextResult.contextBlock
    }

    // Delegate to NarrativeService
    yield* this.narrativeService.stream(entries, worldState, currentStory, {
      tieredContextBlock,
      styleReview,
      retrievedChapterContext,
      signal,
      timelineFillResult,
    })
  }

  /**
   * Classify a narrative response to extract world state changes.
   */
  async classifyResponse(
    narrativeResponse: string,
    userAction: string,
    worldState: WorldState,
    story?: Story | null,
    visibleEntries?: StoryEntry[],
    currentStoryTime?: TimeTracker | null,
  ): Promise<ClassificationResult> {
    log('classifyResponse called', {
      narrativeLength: narrativeResponse.length,
      userActionLength: userAction.length,
      hasStory: !!story,
      hasVisibleEntries: !!visibleEntries,
    })

    if (!story) {
      log('classifyResponse: No story provided, returning empty result')
      return {
        entryUpdates: {
          characterUpdates: [],
          locationUpdates: [],
          itemUpdates: [],
          storyBeatUpdates: [],
          newCharacters: [],
          newLocations: [],
          newItems: [],
          newStoryBeats: [],
        },
        scene: {
          currentLocationName: null,
          presentCharacterNames: [],
          timeProgression: 'none',
        },
      }
    }

    const classifierService = serviceFactory.createClassifierService()
    const context: ClassificationContext = {
      storyId: story.id,
      story,
      narrativeResponse,
      userAction,
      existingCharacters: worldState.characters,
      existingLocations: worldState.locations,
      existingItems: worldState.items,
      existingStoryBeats: worldState.storyBeats ?? [],
    }

    return classifierService.classify(context, visibleEntries, currentStoryTime)
  }

  /**
   * Generate story direction suggestions for creative writing mode.
   */
  async generateSuggestions(
    entries: StoryEntry[],
    activeThreads: StoryBeat[],
    lorebookEntries?: Entry[],
    promptContext?: PromptContext,
    latestNarrativeResponse?: string,
  ): Promise<SuggestionsResult> {
    log('generateSuggestions called', {
      entriesCount: entries.length,
      threadsCount: activeThreads.length,
      hasPromptContext: !!promptContext,
      lorebookEntriesCount: lorebookEntries?.length ?? 0,
      latestNarrativeLength: latestNarrativeResponse?.length ?? 0,
    })

    const suggestionsService = serviceFactory.createSuggestionsService()
    return await suggestionsService.generateSuggestions(
      entries,
      activeThreads,
      lorebookEntries,
      story.currentStory?.id,
      latestNarrativeResponse,
    )
  }

  /**
   * Generate RPG-style action choices for adventure mode.
   */
  async generateActionChoices(
    entries: StoryEntry[],
    worldState: WorldState,
    narrativeResponse: string,
    lorebookEntries?: Entry[],
    promptContext?: PromptContext,
    pov?: 'first' | 'second' | 'third',
  ): Promise<ActionChoicesResult> {
    log('generateActionChoices called', {
      entriesCount: entries.length,
      narrativeLength: narrativeResponse.length,
      hasPromptContext: !!promptContext,
      lorebookEntriesCount: lorebookEntries?.length ?? 0,
    })

    const actionChoicesService = serviceFactory.createActionChoicesService()

    // Find protagonist
    const protagonist = worldState.characters?.find((c) => c.relationship === 'self')

    // Find last user action
    const lastUserAction = entries.filter((e) => e.type === 'user_action').pop()

    // Get present characters (NPCs, excluding the protagonist)
    const presentCharacters = worldState.characters?.filter(
      (c) => c.relationship !== 'self' && c.status === 'active',
    )

    // Get inventory items (those that are equipped)
    const inventory = worldState.items?.filter((i) => i.equipped)

    // Build context for the service
    const context = {
      storyId: story.currentStory?.id,
      narrativeResponse,
      userAction: lastUserAction?.content ?? '',
      recentEntries: entries.slice(-10),
      protagonistName: protagonist?.name ?? promptContext?.protagonistName ?? 'the protagonist',
      protagonistDescription: protagonist?.description,
      mode: promptContext?.mode ?? 'adventure',
      pov: pov ?? promptContext?.pov ?? 'second',
      tense: promptContext?.tense ?? 'present',
      currentLocation: worldState.currentLocation,
      presentCharacters,
      inventory,
      activeQuests: worldState.storyBeats?.filter(
        (b) => b.status === 'pending' || b.status === 'active',
      ),
      lorebookEntries,
    }

    const choices = await actionChoicesService.generateChoices(context)
    return { choices }
  }

  /**
   * Analyze narration entries for style issues.
   */
  async analyzeStyle(
    entries: StoryEntry[],
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
  ): Promise<StyleReviewResult> {
    const service = serviceFactory.createStyleReviewerService()
    return service.analyzeStyle(entries, mode, pov, tense)
  }

  /**
   * Analyze if a new chapter should be created.
   */
  async analyzeForChapter(
    entries: StoryEntry[],
    lastChapterEndIndex: number,
    config: MemoryConfig,
    tokensOutsideBuffer: number,
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
  ): Promise<ChapterAnalysis> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.analyzeForChapter(
      entries,
      lastChapterEndIndex,
      tokensOutsideBuffer,
      mode,
      pov,
      tense,
    )
  }

  /**
   * Generate a summary and metadata for a chapter.
   */
  async summarizeChapter(
    entries: StoryEntry[],
    previousChapters?: Chapter[],
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
  ): Promise<ChapterSummaryResult> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.summarizeChapter(entries, previousChapters, mode, pov, tense)
  }

  /**
   * Resummarize an existing chapter.
   */
  async resummarizeChapter(
    chapter: Chapter,
    entries: StoryEntry[],
    allChapters: Chapter[],
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
  ): Promise<ChapterSummaryResult> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.summarizeChapter(entries, allChapters, mode, pov, tense)
  }

  /**
   * Decide which chapters are relevant for the current context.
   */
  async decideRetrieval(
    userInput: string,
    recentEntries: StoryEntry[],
    chapters: Chapter[],
    config: MemoryConfig,
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
  ): Promise<RetrievalDecision> {
    const memoryService = serviceFactory.createMemoryService()
    const context: RetrievalContext = {
      userInput,
      recentNarrative: recentEntries.map((e) => e.content).join(' '),
      availableChapters: chapters,
    }
    return memoryService.decideRetrieval(context, mode, pov, tense)
  }

  /**
   * Build context block from retrieved chapters.
   * NOTE: This method works - it's just string building.
   */
  buildRetrievedContextBlock(chapters: Chapter[], decision: RetrievalDecision): string {
    const memory = new MemoryService('memory')
    // Pass callback to fetch full chapter entries for richer context
    const getChapterEntries = (chapter: Chapter) => story.getChapterEntries(chapter)
    return memory.buildRetrievedContextBlock(chapters, decision, getChapterEntries)
  }

  /**
   * Build tiered context using the EntryInjector.
   * NOTE: Tier 1 & 2 work. Tier 3 (LLM selection) is stubbed.
   */
  async buildTieredContext(
    worldState: WorldState,
    userInput: string,
    recentEntries: StoryEntry[],
    retrievedChapterContext?: string,
    config?: Partial<ContextConfig>,
  ): Promise<ContextResult> {
    log('buildTieredContext called', {
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
      hasRetrievedContext: !!retrievedChapterContext,
    })

    const contextBuilder = new EntryInjector(config)
    const result = await contextBuilder.buildContext(
      worldState,
      userInput,
      recentEntries,
      retrievedChapterContext,
    )

    log('buildTieredContext complete', {
      tier1: result.tier1.length,
      tier2: result.tier2.length,
      tier3: result.tier3.length,
      total: result.all.length,
    })

    return result
  }

  /**
   * Get relevant lorebook entries using tiered injection.
   * NOTE: Tier 1 & 2 work. Tier 3 (LLM selection) is stubbed.
   */
  async getRelevantLorebookEntries(
    entries: Entry[],
    userInput: string,
    recentStoryEntries: StoryEntry[],
    liveState?: { characters: Character[]; locations: Location[]; items: Item[] },
    activationTracker?: ActivationTracker,
    signal?: AbortSignal,
  ): Promise<EntryRetrievalResult> {
    log('getRelevantLorebookEntries called', {
      totalEntries: entries.length,
      userInputLength: userInput.length,
      liveCharacters: liveState?.characters.length ?? 0,
      liveLocations: liveState?.locations.length ?? 0,
      liveItems: liveState?.items.length ?? 0,
      hasActivationTracker: !!activationTracker,
    })

    const config = getEntryRetrievalConfigFromSettings()
    const entryService = new EntryRetrievalService(
      config,
      settings.getServicePresetId('entryRetrieval'),
    )
    const result = await entryService.getRelevantEntries(
      entries,
      userInput,
      recentStoryEntries,
      liveState,
      activationTracker,
      signal,
    )

    log('getRelevantLorebookEntries complete', {
      tier1: result.tier1.length,
      tier2: result.tier2.length,
      tier3: result.tier3.length,
      total: result.all.length,
    })

    return result
  }

  /**
   * Run a lore management session.
   * Analyzes recent narrative and updates lorebook entries accordingly.
   */
  async runLoreManagement(
    storyId: string,
    branchId: string | null,
    entries: Entry[],
    recentMessages: StoryEntry[],
    chapters: Chapter[],
    callbacks: {
      onCreateEntry: (entry: Entry) => Promise<void>
      onUpdateEntry: (id: string, updates: Partial<Entry>) => Promise<void>
      onDeleteEntry: (id: string) => Promise<void>
      onMergeEntries: (entryIds: string[], mergedEntry: Entry) => Promise<void>
      onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>
    },
    _mode: StoryMode = 'adventure',
    _pov?: POV,
    _tense?: Tense,
  ): Promise<LoreManagementResult> {
    // Extract recent user action and narrative
    const recentNarration = recentMessages.filter((m) => m.type === 'narration')
    const recentActions = recentMessages.filter((m) => m.type === 'user_action')

    const narrativeResponse =
      recentNarration.length > 0 ? recentNarration[recentNarration.length - 1].content : ''
    const userAction =
      recentActions.length > 0 ? recentActions[recentActions.length - 1].content : ''

    // Build chapters info for lore management
    // Deep clone to avoid Svelte proxy issues with AI SDK structured cloning
    const chapterInfos = JSON.parse(
      JSON.stringify(
        chapters.map((c) => ({
          number: c.number,
          title: c.title,
          summary: c.summary,
          keywords: c.keywords,
          characters: c.characters,
        })),
      ),
    )

    // Create service and run session
    const service = serviceFactory.createLoreManagementService()
    const sessionResult = await service.runSession({
      storyId,
      narrativeResponse,
      userAction,
      existingEntries: entries,
      chapters: chapterInfos,
      queryChapter: callbacks.onQueryChapter,
    })

    // Build changes array for the result
    const changes: LoreChange[] = []

    // Apply changes via callbacks and build changes array
    for (const entry of sessionResult.createdEntries) {
      // Assign proper ID before creating
      const newEntry: Entry = {
        ...entry,
        id: crypto.randomUUID(),
        branchId,
      }
      await callbacks.onCreateEntry(newEntry)
      changes.push({ type: 'create', entry: newEntry })
    }

    for (const entry of sessionResult.updatedEntries) {
      await callbacks.onUpdateEntry(entry.id, entry)
      changes.push({ type: 'update', entry })
    }

    log('runLoreManagement complete', {
      created: sessionResult.createdEntries.length,
      updated: sessionResult.updatedEntries.length,
    })

    return {
      changes,
      summary: sessionResult.reasoning ?? 'Lore management session completed.',
      sessionId: crypto.randomUUID(),
    }
  }

  /**
   * Run agentic retrieval to find relevant lorebook entries and chapter context.
   * Uses an LLM agent with tools to intelligently search and select entries.
   */
  async runAgenticRetrieval(
    userInput: string,
    recentEntries: StoryEntry[],
    chapters: Chapter[],
    entries: Entry[],
    onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>,
    onQueryChapters?: (
      startChapter: number,
      endChapter: number,
      question: string,
    ) => Promise<string>,
    signal?: AbortSignal,
    _mode: StoryMode = 'adventure',
    _pov?: POV,
    _tense?: Tense,
  ): Promise<AgenticRetrievalResult> {
    log('runAgenticRetrieval called', {
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
      chaptersCount: chapters.length,
      entriesCount: entries.length,
    })

    const service = serviceFactory.createAgenticRetrievalService()

    // Build recent narrative from entries
    const recentNarrative = recentEntries.map((e) => e.content).join('\n\n')

    // Build context for the service
    const context: AgenticRetrievalContext = {
      userInput,
      recentNarrative,
      availableEntries: entries,
      chapters,
      // Pass through the chapter query callback directly
      queryChapter: onQueryChapter,
    }

    const result = await service.runRetrieval(context, signal)

    log('runAgenticRetrieval complete', {
      entriesFound: result.entries.length,
      hasReasoning: !!result.reasoning,
    })

    return result
  }

  /**
   * Determine if agentic retrieval should be used.
   */
  shouldUseAgenticRetrieval(_chapters: Chapter[]): boolean {
    const timelineFillSettings = settings.systemServicesSettings.timelineFill
    if (!timelineFillSettings?.enabled) {
      return false
    }
    const mode = timelineFillSettings.mode ?? 'static'
    return mode === 'agentic'
  }

  /**
   * Format agentic retrieval result for prompt injection.
   */
  formatAgenticRetrievalForPrompt(result: AgenticRetrievalResult): string {
    // The service now builds the context string internally
    return result.context || ''
  }

  /**
   * Run timeline fill to gather context from past chapters.
   */
  async runTimelineFill(
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
  ): Promise<TimelineFillResult> {
    log('runTimelineFill called', {
      visibleEntriesCount: visibleEntries.length,
      chaptersCount: chapters.length,
    })

    const timelineFillService = serviceFactory.createTimelineFillService()
    // Pass callback to fetch full chapter entries for richer context
    const getChapterEntries = (chapter: Chapter) => story.getChapterEntries(chapter)
    return timelineFillService.runTimelineFill(visibleEntries, chapters, getChapterEntries)
  }

  /**
   * Answer a specific chapter question.
   */
  async answerChapterQuestion(
    chapterNumber: number,
    question: string,
    chapters: Chapter[],
  ): Promise<string> {
    log('answerChapterQuestion called', {
      chapterNumber,
      question,
      chaptersCount: chapters.length,
    })

    const chapterQueryService = serviceFactory.createChapterQueryService()
    // Pass callback to fetch full chapter entries for richer context
    const getChapterEntries = (chapter: Chapter) => story.getChapterEntries(chapter)
    const answer = await chapterQueryService.answerQuestion(
      question,
      chapters,
      [chapterNumber],
      getChapterEntries,
    )
    return answer.answer
  }

  /**
   * Answer a range question across chapters.
   */
  async answerChapterRangeQuestion(
    startChapter: number,
    endChapter: number,
    question: string,
    chapters: Chapter[],
  ): Promise<string> {
    log('answerChapterRangeQuestion called', {
      startChapter,
      endChapter,
      question,
      chaptersCount: chapters.length,
    })

    // Build chapter numbers array for the range
    const chapterNumbers: number[] = []
    for (let i = startChapter; i <= endChapter; i++) {
      chapterNumbers.push(i)
    }

    const chapterQueryService = serviceFactory.createChapterQueryService()
    // Pass callback to fetch full chapter entries for richer context
    const getChapterEntries = (chapter: Chapter) => story.getChapterEntries(chapter)
    const answer = await chapterQueryService.answerQuestion(
      question,
      chapters,
      chapterNumbers,
      getChapterEntries,
    )
    return answer.answer
  }

  /**
   * Determine if timeline fill should be used.
   */
  shouldUseTimelineFill(_chapters: Chapter[]): boolean {
    const timelineFillSettings = settings.systemServicesSettings.timelineFill
    if (!timelineFillSettings?.enabled) {
      return false
    }
    const mode = timelineFillSettings.mode ?? 'static'
    return mode === 'static'
  }

  /**
   * Format timeline fill result for prompt injection.
   */
  formatTimelineFillForPrompt(
    _chapters: Chapter[],
    result: TimelineFillResult,
    _currentEntryPosition: number,
    _firstVisibleEntryPosition: number,
    _locations?: Location[],
  ): string {
    if (!result.responses || result.responses.length === 0) {
      return ''
    }

    const lines: string[] = ['## Retrieved Context from Past Chapters']

    for (const response of result.responses) {
      if (response.answer && response.answer !== 'Not mentioned in these chapters.') {
        lines.push(`\n**Q: ${response.query}**`)
        lines.push(response.answer)
        if (response.chapterNumbers.length > 0) {
          lines.push(
            `(From chapter${response.chapterNumbers.length > 1 ? 's' : ''} ${response.chapterNumbers.join(', ')})`,
          )
        }
      }
    }

    return lines.length > 1 ? lines.join('\n') : ''
  }

  /**
   * Check if image generation is enabled for a story.
   */
  isImageGenerationEnabled(
    storySettings?: StorySettings,
    type: 'standard' | 'background' | 'portrait' | 'reference' = 'standard',
  ): boolean {
    return isImageGenerationEnabledUtil(storySettings, type)
  }

  /**
   * Generate images for a narrative response.
   * Supports two modes:
   * - Inline mode: Process <pic> tags from AI response
   * - Analyzed mode: Use LLM to identify imageable scenes
   */
  async generateImagesForNarrative(context: ImageGenerationContext): Promise<void> {
    log('generateImagesForNarrative called', {
      storyId: context.storyId,
      entryId: context.entryId,
      narrativeLength: context.narrativeResponse.length,
      hasTranslation: !!context.translatedNarrative,
      translationLanguage: context.translationLanguage,
    })

    if (!this.isImageGenerationEnabled(undefined, 'standard')) {
      log('Image generation not enabled or not configured')
      return
    }

    // Check if inline image mode is enabled for this story
    const inlineImageMode = story.currentStory?.settings?.imageGenerationMode === 'inline'
    try {
      if (inlineImageMode) {
        // Use inline image generation (process <pic> tags from AI response)
        const narrativeToProcess = context.translatedNarrative || context.narrativeResponse
        log('Using inline image mode', {
          usingTranslated: !!context.translatedNarrative,
        })
        const inlineContext: InlineImageContext = {
          storyId: context.storyId,
          entryId: context.entryId,
          narrativeContent: narrativeToProcess,
          presentCharacters: context.presentCharacters,
          referenceMode: context.referenceMode,
        }
        await inlineImageService.processNarrativeForInlineImages(inlineContext)
      } else {
        // Analyzed mode: Use LLM to identify imageable scenes
        log('Using analyzed image mode')
        await this.runAnalyzedImageGeneration(context)
      }
    } catch (error) {
      log('Image generation failed (non-fatal)', error)
      // Don't throw - image generation failure shouldn't break the main flow
    }
  }

  /**
   * Run analyzed image generation mode.
   * Uses LLM to identify visually striking moments in narrative text.
   */
  private async runAnalyzedImageGeneration(context: ImageGenerationContext): Promise<void> {
    const imageSettings = settings.systemServicesSettings.imageGeneration
    const referenceMode = context.referenceMode ?? false

    // Get characters with/without portraits
    const presentCharacterNames = context.presentCharacters.map((c) => c.name.toLowerCase())
    const charactersWithPortraits = story.characters
      .filter((c) => presentCharacterNames.includes(c.name.toLowerCase()) && c.portrait)
      .map((c) => c.name)
    const charactersWithoutPortraits = story.characters
      .filter((c) => presentCharacterNames.includes(c.name.toLowerCase()) && !c.portrait)
      .map((c) => c.name)

    // Build style prompt
    const stylePrompt = await this.getStylePrompt(imageSettings.styleId)

    // Build analysis context
    const analysisContext: ImageAnalysisContext = {
      narrativeResponse: context.narrativeResponse,
      userAction: context.userAction,
      presentCharacters: context.presentCharacters.map((c) => ({
        name: c.name,
        visualDescriptors: c.visualDescriptors,
        isProtagonist: c.relationship === 'self',
      })),
      currentLocation: context.currentLocation,
      stylePrompt,
      maxImages: imageSettings.maxImagesPerMessage ?? 3,
      chatHistory: context.chatHistory,
      lorebookContext: context.lorebookContext,
      charactersWithPortraits,
      charactersWithoutPortraits,
      referenceMode,
      translatedNarrative: context.translatedNarrative,
      translationLanguage: context.translationLanguage,
    }

    // Emit analysis started
    emitImageAnalysisStarted(context.entryId)

    try {
      // Create service and identify scenes
      const analysisService = serviceFactory.createImageAnalysisService()
      const scenes = await analysisService.identifyScenes(analysisContext)

      if (scenes.length === 0) {
        log('No imageable scenes identified')
        emitImageAnalysisComplete(context.entryId, 0, 0)
        return
      }

      // Count portrait generations
      const portraitCount = scenes.filter((s) => s.generatePortrait).length
      const sceneCount = scenes.length - portraitCount

      log('Scenes identified', {
        total: scenes.length,
        scenes: sceneCount,
        portraits: portraitCount,
      })
      emitImageAnalysisComplete(context.entryId, sceneCount, portraitCount)

      // Queue image generation for each scene
      for (const scene of scenes) {
        await this.queueAnalyzedImageGeneration(
          context.storyId,
          context.entryId,
          scene,
          imageSettings,
          context.presentCharacters,
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log('Scene analysis failed', error)
      emitImageAnalysisFailed(context.entryId, errorMessage)
    }
  }

  /**
   * Queue image generation for an analyzed scene.
   */
  private async queueAnalyzedImageGeneration(
    storyId: string,
    entryId: string,
    scene: ImageableScene,
    imageSettings: typeof settings.systemServicesSettings.imageGeneration,
    presentCharacters: Character[],
  ): Promise<void> {
    const imageId = crypto.randomUUID()
    const referenceMode = story.currentStory?.settings?.referenceMode ?? false

    // Determine profile and model
    let profileId = imageSettings.profileId
    let modelToUse = settings.getImageProfile(profileId ?? '')?.model ?? ''
    let sizeToUse = imageSettings.size
    let referenceImageUrls: string[] | undefined
    let styleId: string | undefined = imageSettings.styleId

    // If reference mode and scene has characters, look for reference images
    if (referenceMode && scene.characters.length > 0 && !scene.generatePortrait) {
      const portraitUrls: string[] = []

      for (const charName of scene.characters.slice(0, 3)) {
        const character = presentCharacters.find(
          (c) => c.name.toLowerCase() === charName.toLowerCase(),
        )
        const portraitUrl = normalizeImageDataUrl(character?.portrait)
        if (portraitUrl) {
          portraitUrls.push(portraitUrl)
        }
      }

      if (portraitUrls.length > 0) {
        if (!this.isImageGenerationEnabled(undefined, 'reference')) {
          log('Reference image generation not configured')
          return
        }
        // Use reference profile and model for img2img
        profileId = imageSettings.referenceProfileId
        modelToUse = settings.getImageProfile(profileId ?? '')?.model ?? ''
        sizeToUse = imageSettings.referenceSize
        referenceImageUrls = portraitUrls
        styleId = imageSettings.styleId
        log('Using character portraits as reference', {
          characters: scene.characters,
          count: portraitUrls.length,
        })
      }
    }

    // For portrait generation, use portrait-specific settings
    if (scene.generatePortrait) {
      if (!this.isImageGenerationEnabled(undefined, 'portrait')) {
        log('Portrait image generation not configured')
        return
      }
      profileId = imageSettings.portraitProfileId
      modelToUse = settings.getImageProfile(profileId ?? '')?.model ?? ''
      sizeToUse = imageSettings.portraitSize
      styleId = imageSettings.portraitStyleId
    }

    if (!profileId) {
      log('No image profile configured, skipping scene')
      return
    }

    // Build full prompt with style
    const stylePrompt = await this.getStylePrompt(styleId)
    const fullPrompt = `${scene.prompt}. ${stylePrompt}`

    const { width, height } = parseImageSize(sizeToUse)
    // Create pending record in database
    const embeddedImage: Omit<EmbeddedImage, 'createdAt'> = {
      id: imageId,
      storyId,
      entryId,
      sourceText: scene.sourceText,
      prompt: fullPrompt,
      styleId: styleId,
      model: modelToUse,
      imageData: '',
      width,
      height,
      status: 'pending',
      generationMode: 'analyzed',
    }

    await database.createEmbeddedImage(embeddedImage)
    log('Created pending analyzed image record', {
      imageId,
      sceneType: scene.sceneType,
      priority: scene.priority,
      isPortrait: scene.generatePortrait,
    })

    // Emit queued event
    emitImageQueued(imageId, entryId)

    // Start async generation (fire-and-forget)
    this.generateAnalyzedImage(
      imageId,
      fullPrompt,
      profileId!,
      modelToUse!,
      sizeToUse,
      entryId,
      scene,
      presentCharacters,
      referenceImageUrls,
    ).catch((error) => {
      log('Async analyzed image generation failed', { imageId, error })
    })
  }

  /**
   * Generate a single analyzed image using the SDK (runs asynchronously).
   */
  private async generateAnalyzedImage(
    imageId: string,
    prompt: string,
    profileId: string,
    model: string,
    size: string,
    entryId: string,
    scene: ImageableScene,
    presentCharacters: Character[],
    referenceImageUrls?: string[],
  ): Promise<void> {
    try {
      // Update status to generating
      await database.updateEmbeddedImage(imageId, { status: 'generating' })

      log('Generating analyzed image via SDK', {
        imageId,
        profileId,
        model,
        sceneType: scene.sceneType,
        hasReference: !!referenceImageUrls?.length,
      })

      // Generate image using SDK
      const result = await registryGenerateImage({
        profileId,
        model,
        prompt,
        size,
        referenceImages: referenceImageUrls,
      })

      if (!result.base64) {
        throw new Error('No image data returned')
      }

      // Update record with image data
      await database.updateEmbeddedImage(imageId, {
        imageData: result.base64,
        status: 'complete',
      })

      // If this was a portrait generation, save to character
      if (scene.generatePortrait && scene.characters.length > 0) {
        const charName = scene.characters[0]
        const character = presentCharacters.find(
          (c) => c.name.toLowerCase() === charName.toLowerCase(),
        )
        if (character) {
          await database.updateCharacter(character.id, {
            portrait: result.base64,
          })
          log('Saved portrait to character', { characterId: character.id, name: charName })
        }
      }

      log('Analyzed image generated successfully', { imageId })
      emitImageReady(imageId, entryId, true)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log('Analyzed image generation failed', { imageId, error: errorMessage })

      await database.updateEmbeddedImage(imageId, {
        status: 'failed',
        errorMessage,
      })

      emitImageReady(imageId, entryId, false)
    }
  }

  /**
   * Analyze the difference between two story responses and generate a new background image if needed.
   * This is used to detect when the scene has changed enough to warrant a new background image and generate it.
   */
  async analyzeBackgroundChangeAndGenerateImage(
    storyId: string,
    visibleEntries: StoryEntry[],
  ): Promise<void> {
    try {
      const service = serviceFactory.createBackgroundImageService()
      emitBackgroundImageAnalysisStarted()
      const result = await service.analyzeReponsesForBackgroundImage(visibleEntries)
      emitBackgroundImageAnalysisComplete()
      // Ai returns empty string or short response if no change, otherwise the image prompt
      if (result.changeNecessary) {
        log('Background change detected, prompt:', result.prompt)
        emitBackgroundImageQueued()
        const image = await service.generateBackgroundImage(result.prompt)

        if (image) {
          emitBackgroundImageReady()
          log('Background image generated successfully', { image })
          story.updateCurrentBackgroundImage(image)
        } else {
          log('Background image generation failed')
        }
      }
    } catch (error) {
      emitBackgroundImageAnalysisFailed()
      log('Background image analysis failed', error)
    }
  }

  /**
   * Get the style prompt for the selected style ID.
   * Image style templates are external (raw text) -- fetched directly from the database.
   */
  private async getStylePrompt(styleId: string): Promise<string> {
    try {
      const template = await database.getPackTemplate('default-pack', styleId)
      if (template?.content) {
        return template.content
      }
    } catch {
      // Template not found, use fallback
    }

    return DEFAULT_FALLBACK_STYLE_PROMPT
  }

  // ===== Translation Methods =====

  /**
   * Translate narrative content.
   */
  async translateNarration(
    content: string,
    targetLanguage: string,
    isVisualProse: boolean = false,
  ): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('narration')
    return service.translateNarration(content, targetLanguage, isVisualProse)
  }

  /**
   * Translate user input to English.
   */
  async translateInput(content: string, sourceLanguage: string): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('input')
    return service.translateInput(content, sourceLanguage)
  }

  /**
   * Batch translate UI elements.
   */
  async translateUIElements(
    items: UITranslationItem[],
    targetLanguage: string,
  ): Promise<UITranslationItem[]> {
    const service = serviceFactory.createTranslationService('ui')
    return service.translateUIElements(items, targetLanguage)
  }

  /**
   * Translate suggestions.
   */
  async translateSuggestions<T extends { text: string; type?: string }>(
    suggestions: T[],
    targetLanguage: string,
  ): Promise<T[]> {
    const service = serviceFactory.createTranslationService('suggestions')
    return service.translateSuggestions(suggestions, targetLanguage)
  }

  /**
   * Translate action choices.
   */
  async translateActionChoices<T extends { text: string; type?: string }>(
    choices: T[],
    targetLanguage: string,
  ): Promise<T[]> {
    const service = serviceFactory.createTranslationService('actionChoices')
    return service.translateActionChoices(choices, targetLanguage)
  }

  /**
   * Translate wizard content.
   */
  async translateWizardContent(
    content: string,
    targetLanguage: string,
  ): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('wizard')
    return service.translateWizardContent(content, targetLanguage)
  }

  /**
   * Batch translate wizard content.
   */
  async translateWizardBatch(
    fields: Record<string, string>,
    targetLanguage: string,
  ): Promise<Record<string, string>> {
    const service = serviceFactory.createTranslationService('wizard')
    return service.translateWizardBatch(fields, targetLanguage)
  }
}

export const aiService = new AIService()
