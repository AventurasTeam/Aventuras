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
 * - runTimelineFill(), answerChapterQuestion() - TimelineFillService
 * - buildWorldStateContext(), getRelevantLorebookEntries() - WorldStateInjector/EntryRetrievalService
 * - analyzeStyle() - StyleReviewerService
 * - runLoreManagement() - LoreManagementService
 * - generateImagesForNarrative() (both inline and analyzed modes) - ImageAnalysisService
 * - runAgenticRetrieval() - AgenticRetrievalService
 * - translate*() - TranslationService
 */

import { createLogger } from '$lib/log'
import { database } from '$lib/services/database'
import {
  emitImageAnalysisStarted,
  emitImageAnalysisComplete,
  emitImageAnalysisFailed,
  emitImageQueued,
  emitBackgroundImageAnalysisStarted,
  emitBackgroundImageAnalysisComplete,
  emitBackgroundImageAnalysisFailed,
  emitBackgroundImageQueued,
  emitBackgroundImageReady,
} from '$lib/services/events'
import type {
  PromptContext,
  LoreManagementCallbacks,
  LoreRunOptions,
} from '$lib/services/generation'
import type {
  Chapter,
  Character,
  EmbeddedImage,
  Entry,
  ImageGenerationMode,
  ImageProfile,
  LoreChange,
  LoreManagementResult,
  MemoryConfig,
  POV,
  ReasoningEffort,
  Story,
  StoryBeat,
  StoryEntry,
  StoryMode,
  StorySettings,
  SummaryDetail,
  Tense,
  TimeTracker,
} from '$lib/types'
import { findLiveCharacter, type BranchScope } from '$lib/utils/branchScope'
import { expectedPixels, type ImageSpec } from '$lib/utils/image'
import type { StreamChunk } from './core/types'
import { serviceFactory } from './core/factory'
import {
  inlineImageService,
  isImageGenerationEnabled as isImageGenerationEnabledUtil,
  PendingPortraits,
  referencePortraitSources,
  refreshCharacter,
  resolveReferenceUrls,
  resolveScenes,
  resolveStylePrompt,
  runImageGeneration,
} from './image'
import type {
  InlineImageContext,
  ImageAnalysisContext,
  PortraitSource,
  ResolvedScene,
} from './image'
import {
  MemoryService,
  NarrativeService,
  getWorldStateInjectorConfigFromSettings,
} from './generation'
import type {
  ClassificationContext,
  WorldStateInjectorConfig,
  WorldStateInjectorOptions,
  WorldStateInjectionResult,
  RetrievalContext,
  StyleReviewResult,
  WorldStateContext,
} from './generation'
import { EntryRetrievalService, getEntryRetrievalConfigFromSettings } from './retrieval'
export { clearTier3SelectionCache } from './retrieval'
import type { TimelineFillResult, EntryRetrievalResult, EntryRetrievalOptions } from './retrieval'
import type {
  RetrievalResult as AgenticRetrievalResult,
  RetrievalContext as AgenticRetrievalContext,
} from './retrieval/AgenticRetrievalService'
import type {
  ActionChoicesResult,
  BackgroundImageAnalysisResult,
  ChapterAnalysis,
  ChapterSummaryResult,
  ChapterTimelineEstimate,
  ClassificationResult,
  RetrievalDecision,
  SuggestionsResult,
} from './sdk'
import type { Translated, TranslationResult, UITranslationItem } from './utils'
import { recentContent, AS_HAYSTACK, AS_PROSE } from '$lib/utils/recentContent'
import { joinPromptBlocks } from '$lib/utils/promptBlocks'
import { activity } from '$lib/stores/activity.svelte'
import { describeActivityError, failStep } from '$lib/services/activity'

// Timeline Fill service settings (per design doc section 3.1.4: Static Retrieval)
export interface TimelineFillSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  enabled: boolean
  mode: 'static' | 'agentic' // 'static' is default, 'agentic' for tool-calling retrieval
  model: string
  temperature: number
  maxQueries: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

// Image Generation settings (automatic image generation for narrative)
export interface ImageGenerationServiceSettings {
  // Profile-based image generation (profiles must have supportsImageGeneration capability)
  profileId: string | null // API profile for standard image generation
  size: ImageSpec // Regular image size

  // Reference model settings (for image-to-image with portrait references)
  referenceProfileId: string | null // API profile for image-to-image with portrait references
  referenceSize: ImageSpec // Reference image size

  // General story image settings
  styleId: string // Selected image style template
  maxImagesPerMessage: number // Max images per narrative (0 = unlimited, default: 3)

  // Portrait model settings (character reference images)
  portraitProfileId: string | null // API profile for generating character portraits
  portraitStyleId: string // Selected character portrait style template
  portraitSize: ImageSpec // Portrait image size

  // Scene analysis model settings (for identifying imageable scenes)
  promptProfileId: string | null // API profile for scene analysis
  promptModel: string // Model for scene analysis (empty = use profile default)
  promptTemperature: number
  promptMaxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string

  // Background image settings
  backgroundProfileId: string | null // API profile for background image generation
  backgroundSize: ImageSpec // Background image size
  backgroundBlur: number // Background blur amount in pixels (default: 0)
}

// Re-export ImageGenerationContext type for backwards compatibility
export interface ImageGenerationContext {
  /** Step the image work nests under in the activity record. */
  activityParentId?: string
  storyId: string
  /** Branch the turn runs on; `null` is the main branch. */
  branchId: string | null
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
  /** Story-level image generation mode — supplied by caller to avoid store access */
  imageGenerationMode: ImageGenerationMode
  /** Live story characters, read at the moment of use — supplied by caller for portrait/reference lookups */
  getCharacters: () => Character[]
  /** System image generation service settings — supplied by caller */
  imageSettings?: ImageGenerationServiceSettings
  /** Image profile lookup — supplied by caller */
  getImageProfile?: (id: string) => ImageProfile | undefined
  /** Saves a generated portrait onto its character — supplied by caller to avoid store access */
  onPortraitGenerated: (character: Character, portrait: string) => Promise<void>
}

const log = createLogger('AIService')

interface WorldState extends WorldStateContext {
  memoryConfig?: MemoryConfig
  lorebookEntries?: Entry[]
}

/**
 * Everything `runAgenticRetrieval` needs.
 *
 * One object rather than a parameter list: this had grown to eleven positional
 * parameters, seven of them optional, several of them same-shaped callbacks. `RetrievalPhase`
 * declares its own dependency signature in a different order, so the two were bridged by a
 * hand-written adapter whose only job was to shuffle arguments -- and whose only defence
 * against shuffling them wrong was that two of the types happened to differ.
 */
export interface AgenticRetrievalOptions {
  /** Story whose pack supplies the template; undefined only outside a story. */
  storyId: string | undefined
  userInput: string
  recentEntries: StoryEntry[]
  chapters: Chapter[]
  entries: Entry[]
  /** Live world state, so the agent can be told what the narrator already has. */
  worldState?: WorldState
  /** Where the story stands now, the anchor for reading excerpt timestamps. */
  currentStoryTime?: TimeTracker | null
  /** Summary of what world state and lorebook selection already put in the prompt. */
  alreadyInContext?: string
  onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>
  getChapterEntries?: (chapter: Chapter) => StoryEntry[]
  getUnchapterizedEntries?: () => StoryEntry[]
  signal?: AbortSignal
  /** Step the agent's own steps nest under in the activity record. */
  activityParentId?: string
}

/** What a scene that wants reference portraits needs to start, and to fall back on. */
interface AnalyzedImageReferences {
  sources: PortraitSource[]
  withoutReferences: { profileId: string; model: string; size: ImageSpec }
}

class AIService {
  private narrativeService: NarrativeService
  // Outlives a turn: a portrait started at the end of one can still be running in the next.
  private pendingPortraits = new PendingPortraits()

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
    styleReview?: StyleReviewResult | null,
    retrievedChapterContext?: string | null,
    signal?: AbortSignal,
    timelineFillResult?: TimelineFillResult | null,
    worldStateBlock?: string | null,
    activityParentId?: string,
  ): AsyncIterable<StreamChunk> {
    log('streamNarrative called', {
      entriesCount: entries.length,
      hasWorldStateBlock: !!worldStateBlock,
      hasStyleReview: !!styleReview,
      hasRetrievedContext: !!retrievedChapterContext,
      hasTimelineFill: !!timelineFillResult,
    })

    // Both blocks are built in RetrievalPhase now; this only joins them.
    //
    // The narrative template renders one variable and must keep seeing one string: adding a
    // second would leave every pack predating the change without the retrieval block.
    // Always a string, '' when both are empty -- which is what the injector returned before,
    // and what NarrativeService's `if (tieredContextBlock)` guard already expects. Coalescing
    // with `??` here would be wrong: '' is not nullish, so an empty world state would have
    // swallowed the retrieval text instead of concatenating it.
    //
    // Joined with a blank line rather than concatenated raw. Every block in this prompt
    // opens with "\n\n" except the agentic retrieval one, so raw concatenation -- which is
    // what `EntryInjector` did before the split, and what was faithfully preserved here --
    // produced this in a real turn:
    //
    //     ...She is now his devoted pet.[Retrieved Context - I searched for all mentions...
    //
    // `joinPromptBlocks` adds only what is missing, so the static path, where the lorebook
    // block already starts with "\n\n", stays byte-identical.
    const tieredContextBlock = joinPromptBlocks(worldStateBlock, retrievedChapterContext)

    // Delegate to NarrativeService
    yield* this.narrativeService.stream(entries, worldState, currentStory, {
      tieredContextBlock,
      styleReview,
      retrievedChapterContext,
      signal,
      timelineFillResult,
      activityParentId,
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
    activityParentId?: string,
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

    return classifierService.classify(context, visibleEntries, currentStoryTime, activityParentId)
  }

  /**
   * Generate story direction suggestions for creative writing mode.
   */
  async generateSuggestions(
    entries: StoryEntry[],
    activeThreads: StoryBeat[],
    lorebookEntries: Entry[] | undefined,
    latestNarrativeResponse: string | undefined,
    storyId: string | undefined,
    activityParentId?: string,
  ): Promise<SuggestionsResult & { failure?: string | null }> {
    log('generateSuggestions called', {
      entriesCount: entries.length,
      threadsCount: activeThreads.length,
      lorebookEntriesCount: lorebookEntries?.length ?? 0,
      latestNarrativeLength: latestNarrativeResponse?.length ?? 0,
    })

    const suggestionsService = serviceFactory.createSuggestionsService()
    return await suggestionsService.generateSuggestions(
      entries,
      activeThreads,
      lorebookEntries,
      storyId,
      latestNarrativeResponse,
      activityParentId,
    )
  }

  /**
   * Generate RPG-style action choices for adventure mode.
   */
  async generateActionChoices(
    entries: StoryEntry[],
    worldState: WorldState,
    narrativeResponse: string,
    lorebookEntries: Entry[] | undefined,
    promptContext: PromptContext | undefined,
    pov: 'first' | 'second' | 'third' | undefined,
    storyId: string | undefined,
    activityParentId?: string,
  ): Promise<ActionChoicesResult & { failure?: string | null }> {
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
      activityParentId,
      storyId,
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

    return actionChoicesService.generateChoices(context)
  }

  /**
   * Analyze narration entries for style issues.
   */
  async analyzeStyle(
    storyId: string | undefined,
    entries: StoryEntry[],
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
    recentEntriesCount?: number,
  ): Promise<StyleReviewResult> {
    const service = serviceFactory.createStyleReviewerService()
    return service.analyzeStyle(storyId, entries, mode, pov, tense, recentEntriesCount)
  }

  /**
   * Analyze if a new chapter should be created.
   */
  async analyzeForChapter(
    storyId: string | undefined,
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
      storyId,
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
    storyId: string | undefined,
    entries: StoryEntry[],
    previousChapters?: Chapter[],
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
    summaryDetail: SummaryDetail = 'auto',
  ): Promise<ChapterSummaryResult> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.summarizeChapter(
      storyId,
      entries,
      previousChapters,
      mode,
      pov,
      tense,
      summaryDetail,
    )
  }

  /**
   * Resummarize an existing chapter.
   */
  async resummarizeChapter(
    storyId: string | undefined,
    chapter: Chapter,
    entries: StoryEntry[],
    allChapters: Chapter[],
    mode: StoryMode = 'adventure',
    pov?: POV,
    tense?: Tense,
    summaryDetail: SummaryDetail = 'auto',
  ): Promise<ChapterSummaryResult> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.summarizeChapter(
      storyId,
      entries,
      allChapters,
      mode,
      pov,
      tense,
      summaryDetail,
    )
  }

  /**
   * Estimate in-story time elapsed during a chapter, from its summary alone.
   */
  async estimateChapterTimeline(
    storyId: string | undefined,
    summary: string,
  ): Promise<ChapterTimelineEstimate> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.estimateChapterTimeline(storyId, summary)
  }

  /**
   * Decide which chapters are relevant for the current context.
   */
  async decideRetrieval(
    storyId: string | undefined,
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
      recentNarrative: recentContent(recentEntries, recentEntries.length, AS_HAYSTACK),
      availableChapters: chapters,
    }
    return memoryService.decideRetrieval(storyId, context, mode, pov, tense)
  }

  /**
   * Build context block from retrieved chapters.
   * NOTE: This method works - it's just string building.
   */
  buildRetrievedContextBlock(
    chapters: Chapter[],
    decision: RetrievalDecision,
    getChapterEntries: (chapter: Chapter) => StoryEntry[],
  ): string {
    const memory = new MemoryService('memory')
    return memory.buildRetrievedContextBlock(chapters, decision, getChapterEntries)
  }

  /**
   * Build live-WorldState context using the WorldStateInjector.
   */
  async buildWorldStateContext(
    worldState: WorldState,
    userInput: string,
    recentEntries: StoryEntry[],
    config: Partial<WorldStateInjectorConfig> | undefined,
    options: WorldStateInjectorOptions,
  ): Promise<WorldStateInjectionResult> {
    log('buildWorldStateContext called', {
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
      hasActivationTracker: !!options.activationTracker,
    })

    // Read from settings when the caller does not override, same as
    // getRelevantLorebookEntries does with getEntryRetrievalConfigFromSettings(). Keeps the
    // settings lookup in the service layer so RetrievalPhase can stay injected with a
    // config-free signature.
    const injector = serviceFactory.createWorldStateInjector(
      config ?? getWorldStateInjectorConfigFromSettings(),
    )
    const result = await injector.buildContext(worldState, userInput, recentEntries, options)

    log('buildWorldStateContext complete', {
      tier1: result.tier1.length,
      tier2: result.tier2.length,
      tier3: result.tier3.length,
      total: result.all.length,
    })

    return result
  }

  /**
   * Get relevant lorebook entries using tiered injection.
   */
  async getRelevantLorebookEntries(
    entries: Entry[],
    userInput: string,
    recentStoryEntries: StoryEntry[],
    options: EntryRetrievalOptions,
  ): Promise<EntryRetrievalResult> {
    log('getRelevantLorebookEntries called', {
      totalEntries: entries.length,
      userInputLength: userInput.length,
      hasActivationTracker: !!options.activationTracker,
    })

    const config = getEntryRetrievalConfigFromSettings()
    const entryService = new EntryRetrievalService(config, 'entryRetrieval')
    const result = await entryService.getRelevantEntries(
      entries,
      userInput,
      recentStoryEntries,
      options,
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
    callbacks: LoreManagementCallbacks,
    options: LoreRunOptions,
  ): Promise<LoreManagementResult> {
    const { mode, pov, tense, tokenThreshold, chapterBuffer, newChapter } = options

    // Create service and run session
    const service = serviceFactory.createLoreManagementService()
    const sessionResult = await service.runSession({
      storyId,
      recentEntries: recentMessages,
      tokenThreshold,
      chapterBuffer,
      existingEntries: entries,
      chapters,
      mode,
      pov,
      tense,
      newChapter,
      queryChapter: callbacks.onQueryChapter,
      keptSeparate: await callbacks.getKeptSeparate?.(),
      onKeepSeparate: callbacks.onKeepSeparate,
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

    // Consolidation is what keeps a lorebook from growing without bound, and it used to
    // stop here: merges and deletes were approved, logged, then dropped, so every run
    // re-proposed the same duplicates it had "already" merged.
    for (const { sources, merged } of sessionResult.merges) {
      const mergedEntry = { ...merged, id: crypto.randomUUID(), branchId }
      await callbacks.onMergeEntries(
        sources.map((e) => e.id),
        mergedEntry,
      )
      changes.push({ type: 'merge', entry: mergedEntry, mergedFrom: sources.map((e) => e.id) })
    }

    const mergedAway = new Set(sessionResult.merges.flatMap((m) => m.sources.map((e) => e.id)))
    for (const entry of sessionResult.deletedEntries) {
      if (mergedAway.has(entry.id)) continue
      await callbacks.onDeleteEntry(entry.id)
      changes.push({ type: 'delete', previous: entry })
    }

    log('runLoreManagement complete', {
      created: sessionResult.createdEntries.length,
      updated: sessionResult.updatedEntries.length,
      deleted: sessionResult.deletedEntries.length,
      merged: sessionResult.merges.length,
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
  // See AgenticRetrievalOptions for why this takes one object.
  async runAgenticRetrieval(options: AgenticRetrievalOptions): Promise<AgenticRetrievalResult> {
    const { userInput, recentEntries, chapters, entries, worldState, signal } = options

    log('runAgenticRetrieval called', {
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
      chaptersCount: chapters.length,
      entriesCount: entries.length,
      hasWorldState: !!worldState,
    })

    const service = serviceFactory.createAgenticRetrievalService()

    // Build context for the service
    const context: AgenticRetrievalContext = {
      storyId: options.storyId,
      userInput,
      // Build recent narrative from entries
      recentNarrative: recentContent(recentEntries, recentEntries.length, AS_PROSE),
      availableEntries: entries,
      chapters,
      worldState,
      currentStoryTime: options.currentStoryTime,
      alreadyInContext: options.alreadyInContext,
      // Pass through the chapter query callback directly
      queryChapter: options.onQueryChapter,
      getChapterEntries: options.getChapterEntries,
      getUnchapterizedEntries: options.getUnchapterizedEntries,
      activityParentId: options.activityParentId,
    }

    const result = await service.runRetrieval(context, signal)

    log('runAgenticRetrieval complete', { contextLength: result.context.length })

    return result
  }

  /**
   * Determine if agentic retrieval should be used.
   */
  shouldUseAgenticRetrieval(
    timelineFillSettings: Pick<TimelineFillSettings, 'enabled' | 'mode'>,
  ): boolean {
    if (!timelineFillSettings?.enabled) {
      return false
    }
    const mode = timelineFillSettings.mode ?? 'static'
    return mode === 'agentic'
  }

  /**
   * Run timeline fill to gather context from past chapters.
   */
  async runTimelineFill(
    storyId: string | undefined,
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
    getChapterEntries: (chapter: Chapter) => StoryEntry[],
    alreadyInContext?: string,
    /** Budget for each answer prompt's chapter text; see `chapterReadBudget`. */
    maxChapterTokens?: number,
    /** Step the fill's own work nests under in the activity record. */
    activityParentId?: string,
  ): Promise<TimelineFillResult> {
    log('runTimelineFill called', {
      visibleEntriesCount: visibleEntries.length,
      chaptersCount: chapters.length,
      hasAlreadyInContext: !!alreadyInContext,
      maxChapterTokens,
    })

    const timelineFillService = serviceFactory.createTimelineFillService()
    return timelineFillService.runTimelineFill(
      storyId,
      visibleEntries,
      chapters,
      getChapterEntries,
      alreadyInContext,
      maxChapterTokens,
      activityParentId,
    )
  }

  /**
   * Answer a specific chapter question.
   */
  async answerChapterQuestion(
    storyId: string | undefined,
    chapterNumber: number,
    question: string,
    chapters: Chapter[],
    getChapterEntries: (chapter: Chapter) => StoryEntry[],
    /** Budget for the chapter text; see `chapterReadBudget`. */
    maxChapterTokens?: number,
  ): Promise<string> {
    log('answerChapterQuestion called', {
      chapterNumber,
      question,
      chaptersCount: chapters.length,
      maxChapterTokens,
    })

    const chapterQueryService = serviceFactory.createChapterQueryService()
    const answer = await chapterQueryService.answerQuestion(
      storyId,
      question,
      chapters,
      [chapterNumber],
      getChapterEntries,
      maxChapterTokens,
    )
    return answer.answer
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
  /** How many images were handed off to generate, or why none could be. */
  async generateImagesForNarrative(
    context: ImageGenerationContext,
  ): Promise<{ queued: number; failure?: string }> {
    log('generateImagesForNarrative called', {
      storyId: context.storyId,
      entryId: context.entryId,
      narrativeLength: context.narrativeResponse.length,
      hasTranslation: !!context.translatedNarrative,
      translationLanguage: context.translationLanguage,
    })

    if (context.imageGenerationMode === 'none') {
      log('Image generation off for this story')
      return { queued: 0 }
    }

    if (!this.isImageGenerationEnabled(undefined, 'standard')) {
      log('Image generation not enabled or not configured')
      return { queued: 0 }
    }

    // Check if inline image mode is enabled for this story
    const inlineImageMode = context.imageGenerationMode === 'inline'
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
        return { queued: 0 }
      }
      // Analyzed mode: Use LLM to identify imageable scenes
      log('Using analyzed image mode')
      return await this.runAnalyzedImageGeneration(context)
    } catch (error) {
      log('Image generation failed (non-fatal)', error)
      // Don't throw - image generation failure shouldn't break the main flow. No step of its own
      // met this failure, so it closes the phase's.
      failStep(activity, context.activityParentId, error)
      return { queued: 0, failure: describeActivityError(error) ?? undefined }
    }
  }

  /**
   * Run analyzed image generation mode.
   * Uses LLM to identify visually striking moments in narrative text.
   */
  private async runAnalyzedImageGeneration(
    context: ImageGenerationContext,
  ): Promise<{ queued: number; failure?: string }> {
    const imageSettings = context.imageSettings
    if (!imageSettings) {
      log('No image settings in context, skipping analyzed image generation')
      return { queued: 0 }
    }
    const referenceMode = context.referenceMode ?? false
    const scope: BranchScope = { storyId: context.storyId, branchId: context.branchId }

    const live = context.getCharacters()
    const present = context.presentCharacters.map((c) => refreshCharacter(c, live))
    const charactersWithPortraits = present
      .filter((c) => this.hasPortrait(scope, c))
      .map((c) => c.name)
    const charactersWithoutPortraits = present
      .filter((c) => !this.hasPortrait(scope, c))
      .map((c) => c.name)

    // Build style prompt
    const stylePrompt = await resolveStylePrompt(context.storyId, imageSettings.styleId)

    // Build analysis context
    const analysisContext: ImageAnalysisContext = {
      storyId: context.storyId,
      narrativeResponse: context.narrativeResponse,
      userAction: context.userAction,
      presentCharacters: present.map((c) => ({
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

    // The analysis phase and the queueing that follows it get their own try/catch: they
    // are one `Started` and one `Complete`, and the progress counter reads that pair. A
    // single catch spanning both emitted `Failed` after `Complete` had already fired for
    // a throw while queueing, closing an analysis phase twice. `Failed` stays a
    // notification only (`StoryEntry` toasts on it) — it never ends the phase.
    const analysisId = context.activityParentId
      ? activity.startStep('Scene analysis', { parentId: context.activityParentId, isLLM: true })
      : ''
    let scenes: ResolvedScene[]
    try {
      // Create service and identify scenes
      const analysisService = serviceFactory.createImageAnalysisService()
      const analysis = await analysisService.identifyScenes(analysisContext, analysisId)
      if (analysis.failure) {
        // Absorbed: no scenes and no toast, but the step records the failure.
        activity.endStep(analysisId, 'failed', undefined, analysis.failure)
        emitImageAnalysisComplete(context.entryId, 0, 0)
        return { queued: 0, failure: analysis.failure }
      }
      scenes = resolveScenes(analysis.scenes, present)
      if (scenes.length < analysis.scenes.length) {
        log('Dropped scenes', { before: analysis.scenes.length, after: scenes.length })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log('Scene analysis failed', error)
      failStep(activity, analysisId, error)
      emitImageAnalysisComplete(context.entryId, 0, 0)
      emitImageAnalysisFailed(context.entryId, errorMessage)
      return { queued: 0, failure: describeActivityError(error) ?? undefined }
    }
    activity.endStep(analysisId, 'done', `${scenes.length} scenes`)

    // Count portrait generations
    const portraitCount = scenes.filter((s) => s.generatePortrait).length
    const sceneCount = scenes.length - portraitCount

    if (scenes.length === 0) {
      log('No imageable scenes identified')
    } else {
      log('Scenes identified', {
        total: scenes.length,
        scenes: sceneCount,
        portraits: portraitCount,
      })
    }
    emitImageAnalysisComplete(context.entryId, sceneCount, portraitCount)

    let queued = 0
    try {
      // Queue image generation for each scene
      const getImageProfile = context.getImageProfile ?? (() => undefined)
      // Portraits go first so a scene of the same character finds its portrait pending.
      const portraitsFirst = [
        ...scenes.filter((s) => s.generatePortrait),
        ...scenes.filter((s) => !s.generatePortrait),
      ]
      for (const scene of portraitsFirst) {
        const didQueue = await this.queueAnalyzedImageGeneration(
          scope,
          context.entryId,
          scene,
          imageSettings,
          context.getCharacters,
          referenceMode,
          getImageProfile,
          context.onPortraitGenerated,
        )
        if (didQueue) queued++
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log('Queueing analyzed image generation failed', error)
      emitImageAnalysisFailed(context.entryId, errorMessage)
      return { queued, failure: describeActivityError(error) ?? undefined }
    }
    return { queued }
  }

  // A portrait still generating counts. The model is told who has one but may still ask, and a
  // second would be wasted.
  private hasPortrait(scope: BranchScope, c: Character): boolean {
    return !!c.portrait || !!this.pendingPortraits.get(scope, c)
  }

  /**
   * Queue image generation for an analyzed scene.
   */
  private async queueAnalyzedImageGeneration(
    scope: BranchScope,
    entryId: string,
    scene: ResolvedScene,
    imageSettings: ImageGenerationServiceSettings,
    getLiveCharacters: () => Character[],
    referenceMode: boolean,
    getImageProfile: (id: string) => ImageProfile | undefined,
    onPortraitGenerated: ImageGenerationContext['onPortraitGenerated'],
  ): Promise<boolean> {
    const { storyId } = scope
    const imageId = crypto.randomUUID()
    const live = getLiveCharacters()

    let portraitCharacter: Character | undefined
    if (scene.portraitOf) {
      portraitCharacter = findLiveCharacter(scene.portraitOf, live)
      if (!portraitCharacter) {
        log('Portrait skipped: character gone', { characterId: scene.portraitOf.id })
        return false
      }
      if (this.hasPortrait(scope, portraitCharacter)) {
        log('Portrait skipped: character already has one', { characterId: portraitCharacter.id })
        return false
      }
    }

    // Determine profile and model
    let profileId = imageSettings.profileId
    let modelToUse = getImageProfile(profileId ?? '')?.model ?? ''
    let sizeToUse = imageSettings.size
    let references: AnalyzedImageReferences | undefined
    let styleId: string | undefined = imageSettings.styleId

    // If reference mode and scene has characters, look for reference images
    if (referenceMode && scene.depicted.length > 0 && !scene.generatePortrait) {
      const sources = referencePortraitSources(
        scene.depicted.map((c) => refreshCharacter(c, live)),
        (c) => this.pendingPortraits.get(scope, c),
      )

      if (sources.length > 0) {
        if (!this.isImageGenerationEnabled(undefined, 'reference')) {
          log('Reference image generation not configured')
          return false
        }
        references = {
          sources,
          withoutReferences: { profileId: profileId ?? '', model: modelToUse, size: sizeToUse },
        }
        // Use reference profile and model for img2img
        profileId = imageSettings.referenceProfileId
        modelToUse = getImageProfile(profileId ?? '')?.model ?? ''
        sizeToUse = imageSettings.referenceSize
        styleId = imageSettings.styleId
      }
    }

    // For portrait generation, use portrait-specific settings
    if (scene.generatePortrait) {
      if (!this.isImageGenerationEnabled(undefined, 'portrait')) {
        log('Portrait image generation not configured')
        return false
      }
      profileId = imageSettings.portraitProfileId
      modelToUse = getImageProfile(profileId ?? '')?.model ?? ''
      sizeToUse = imageSettings.portraitSize
      styleId = imageSettings.portraitStyleId
    }

    if (!profileId) {
      log('No image profile configured, skipping scene')
      return false
    }

    // Build full prompt with style
    const stylePrompt = await resolveStylePrompt(storyId, styleId)
    const fullPrompt = `${scene.prompt}. ${stylePrompt}`

    const { width, height } = expectedPixels(sizeToUse)
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
    const run = this.generateAnalyzedImage(
      imageId,
      fullPrompt,
      profileId!,
      modelToUse!,
      sizeToUse,
      entryId,
      scene,
      portraitCharacter,
      onPortraitGenerated,
      references,
    ).catch((error) => {
      log('Async analyzed image generation failed', { imageId, error })
      return null
    })
    if (portraitCharacter) this.pendingPortraits.track(scope, portraitCharacter, run)
    return true
  }

  /**
   * Generate a single analyzed image using the SDK (runs asynchronously).
   * Resolves to the image once any portrait has been handed to the store, or null on failure.
   */
  private async generateAnalyzedImage(
    imageId: string,
    prompt: string,
    profileId: string,
    model: string,
    size: ImageSpec,
    entryId: string,
    scene: ResolvedScene,
    portraitCharacter: Character | undefined,
    onPortraitGenerated: ImageGenerationContext['onPortraitGenerated'],
    references?: AnalyzedImageReferences,
  ): Promise<string | null> {
    let referenceImages: string[] | undefined
    let recordUpdates: Partial<EmbeddedImage> | undefined
    if (references) {
      referenceImages = await resolveReferenceUrls(references.sources)
      if (referenceImages.length > 0) {
        log('Using character portraits as reference', {
          characters: scene.characters,
          count: referenceImages.length,
        })
      } else {
        // Every portrait it was waiting on failed, so the record falls back to what a
        // scene without references would have been.
        ;({ profileId, model, size } = references.withoutReferences)
        referenceImages = undefined
        const { width, height } = expectedPixels(size)
        recordUpdates = { model, width, height }
        log('Reference portraits unavailable, generating without', { imageId })
      }
    }

    log('Generating analyzed image', {
      imageId,
      profileId,
      model,
      sceneType: scene.sceneType,
      hasReference: !!referenceImages?.length,
    })

    const base64 = await runImageGeneration({
      imageId,
      entryId,
      prompt,
      profileId,
      model,
      size,
      referenceImages,
      recordUpdates,
    })

    if (!base64) return null

    if (portraitCharacter) {
      try {
        await onPortraitGenerated(portraitCharacter, base64)
        log('Handed portrait to store', { characterId: portraitCharacter.id })
      } catch (error) {
        log('Saving the generated portrait failed', { imageId, error })
      }
    }

    log('Analyzed image generated successfully', { imageId })
    return base64
  }

  /**
   * Analyze the difference between two story responses and generate a new background image if needed.
   * This is used to detect when the scene has changed enough to warrant a new background image and generate it.
   */
  async analyzeBackgroundChangeAndGenerateImage(
    storyId: string,
    visibleEntries: StoryEntry[],
    onBackgroundImageUpdate: (image: string) => void,
    activityParentId?: string,
  ): Promise<{ failure?: string }> {
    // Two phases, two separate pairs, each closed in a `finally`: the progress counters
    // read `Started`/`Complete` and `Queued`/`Ready`, and a single try/catch around both
    // left them open. A throw while generating reported an analysis failure for a phase
    // that had already completed, and a generation that simply returned nothing never
    // balanced its `Queued` at all — the header then showed "1 image" until restart.
    // `createBackgroundImageService` throws when no background profile is configured, so it
    // stays inside the try: this is called fire-and-forget from `story.svelte.ts`, where a
    // rejected promise is an unhandled rejection rather than a logged failure.
    // Each request is a step of its own under the caller's, when the caller reports one.
    const step = (label: string) =>
      activityParentId ? activity.startStep(label, { parentId: activityParentId, isLLM: true }) : ''
    emitBackgroundImageAnalysisStarted()
    const detectId = step('Change detection')
    let service: ReturnType<typeof serviceFactory.createBackgroundImageService> | null = null
    let result: (BackgroundImageAnalysisResult & { failure?: string }) | null = null
    let failure: string | undefined
    try {
      service = serviceFactory.createBackgroundImageService()
      result = await service.analyzeResponsesForBackgroundImage(storyId, visibleEntries, detectId)
      failure = result.failure
    } catch (error) {
      emitBackgroundImageAnalysisFailed()
      log('Background image analysis failed', error)
      failure = describeActivityError(error) ?? undefined
    } finally {
      emitBackgroundImageAnalysisComplete()
    }
    if (failure) activity.endStep(detectId, 'failed', undefined, failure)
    else activity.endStep(detectId, 'done', result?.changeNecessary ? 'scene changed' : 'no change')

    // Ai returns empty string or short response if no change, otherwise the image prompt
    if (!service || !result?.changeNecessary) return { failure }

    log('Background change detected, prompt:', result.prompt)
    emitBackgroundImageQueued()
    const imageId = step('Image request')
    try {
      const { image, failure: imageFailure } = await service.generateBackgroundImage(result.prompt)

      if (image) {
        log('Background image generated successfully', { image })
        onBackgroundImageUpdate(image)
        activity.endStep(imageId)
      } else {
        log('Background image generation failed')
        emitBackgroundImageAnalysisFailed()
        failure = imageFailure ?? 'No image was returned'
        activity.endStep(imageId, 'failed', undefined, failure)
      }
    } catch (error) {
      emitBackgroundImageAnalysisFailed()
      log('Background image generation failed', error)
      failure = describeActivityError(error) ?? undefined
      failStep(activity, imageId, error)
    } finally {
      emitBackgroundImageReady()
    }
    return { failure }
  }

  // ===== Translation Methods =====

  /**
   * Translate narrative content.
   */
  async translateNarration(
    content: string,
    targetLanguage: string,
    isVisualProse: boolean,
    storyId: string | undefined,
    activityParentId?: string,
  ): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('narration')
    return service.translateNarration(
      content,
      targetLanguage,
      isVisualProse,
      storyId,
      activityParentId,
    )
  }

  /**
   * Translate user input to English.
   */
  async translateInput(
    content: string,
    sourceLanguage: string,
    storyId: string | undefined,
  ): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('input')
    return service.translateInput(content, sourceLanguage, storyId)
  }

  /**
   * Batch translate UI elements.
   */
  async translateUIElements(
    items: UITranslationItem[],
    targetLanguage: string,
    storyId: string | undefined,
  ): Promise<UITranslationItem[]> {
    const service = serviceFactory.createTranslationService('ui')
    return service.translateUIElements(items, targetLanguage, storyId)
  }

  /**
   * Translate suggestions.
   */
  async translateSuggestions<T extends { text: string; type?: string }>(
    suggestions: T[],
    targetLanguage: string,
    storyId: string | undefined,
    activityParentId?: string,
  ): Promise<Translated<T>> {
    const service = serviceFactory.createTranslationService('suggestions')
    return service.translateSuggestions(suggestions, targetLanguage, storyId, activityParentId)
  }

  /**
   * Translate action choices.
   */
  async translateActionChoices<T extends { text: string; type?: string }>(
    choices: T[],
    targetLanguage: string,
    storyId: string | undefined,
    activityParentId?: string,
  ): Promise<Translated<T>> {
    const service = serviceFactory.createTranslationService('actionChoices')
    return service.translateActionChoices(choices, targetLanguage, storyId, activityParentId)
  }

  /**
   * Translate wizard content.
   */
  async translateWizardContent(
    content: string,
    targetLanguage: string,
    packId: string | undefined,
  ): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('wizard')
    return service.translateWizardContent(content, targetLanguage, packId)
  }

  /**
   * Batch translate wizard content.
   */
  async translateWizardBatch(
    fields: Record<string, string>,
    targetLanguage: string,
    packId: string | undefined,
  ): Promise<Record<string, string>> {
    const service = serviceFactory.createTranslationService('wizard')
    return service.translateWizardBatch(fields, targetLanguage, packId)
  }
}

export const aiService = new AIService()
