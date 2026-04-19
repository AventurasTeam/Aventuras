/**
 * AI Service - Main Orchestrator
 *
 * Coordinates AI services for narrative generation, classification, memory, and more.
 *
 * STATUS: Tier 0, 1, 3 Complete
 * WORKING (SDK-migrated):
 * - streamNarrative(), generateNarrative() - NarrativeService
 * - classifyResponse() - ClassifierService
 * - analyzeForChapter(), summarizeChapter() - MemoryService
 * - generateSuggestions() - SuggestionsService
 * - generateActionChoices() - ActionChoicesService
 * - runTimelineFill(), answerChapterQuestion(), answerChapterRangeQuestion() - TimelineFillService
 * - getRelevantLorebookEntries() - EntryInjector/EntryRetrievalService
 * - analyzeStyle() - StyleReviewerService
 * - runLoreManagement() - LoreManagementService
 * - generateImagesForNarrative() (both inline and analyzed modes) - ImageAnalysisService
 * - runAgenticRetrieval() - AgenticRetrievalService
 *
 * STUBBED (awaiting migration):
 * - translate*() - TranslationService
 */

import { createLogger } from '$lib/log'
import { database } from '$lib/services/database'
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
import { story } from '$lib/stores/story/index.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { ui } from '$lib/stores/ui.svelte'
import type {
  Chapter,
  Character,
  EmbeddedImage,
  Entry,
  ImageProfile,
  Location,
  LoreChange,
  LoreManagementResult,
  ReasoningEffort,
  StoryEntry,
  StorySettings,
} from '$lib/types'
import { normalizeImageDataUrl, parseImageSize } from '$lib/utils/image'
import type { StreamChunk } from './core'
import { serviceFactory } from './core/factory'
import {
  DEFAULT_FALLBACK_STYLE_PROMPT,
  inlineImageService,
  isImageGenerationEnabled as isImageGenerationEnabledUtil,
} from './image'
import { generateImage as registryGenerateImage } from './image/providers/registry'
import { NarrativeService } from './generation'
import type { StyleReviewResult } from './generation'
import { EntryRetrievalService, getEntryRetrievalConfigFromSettings } from './retrieval'
import type { AgenticRetrievalResult, TimelineFillResult, EntryRetrievalResult } from './retrieval'
import type {
  ActionChoice,
  ActionChoicesResult,
  ChapterSummaryResult,
  ClassificationResult,
  ImageableScene,
  Suggestion,
  SuggestionsResult,
} from './sdk'
import type { TranslationResult, UITranslationItem } from './utils'

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
  size: string // Regular image size

  // Reference model settings (for image-to-image with portrait references)
  referenceProfileId: string | null // API profile for image-to-image with portrait references
  referenceSize: string // Reference image size

  // General story image settings
  styleId: string // Selected image style template
  maxImagesPerMessage: number // Max images per narrative (0 = unlimited, default: 3)

  // Portrait model settings (character reference images)
  portraitProfileId: string | null // API profile for generating character portraits
  portraitStyleId: string // Selected character portrait style template
  portraitSize: string // Portrait image size

  // Scene analysis model settings (for identifying imageable scenes)
  promptProfileId: string | null // API profile for scene analysis
  promptModel: string // Model for scene analysis (empty = use profile default)
  promptTemperature: number
  promptMaxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string

  // Background image settings
  backgroundProfileId: string | null // API profile for background image generation
  backgroundSize: string // Background image size (default: '1280x720')
  backgroundBlur: number // Background blur amount in pixels (default: 0)
}

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
  /** Story-level image generation mode — supplied by caller to avoid store access */
  imageGenerationMode?: string | null
  /** All story characters — supplied by caller for portrait/reference lookups */
  allCharacters?: Character[]
  /** System image generation service settings — supplied by caller */
  imageSettings?: ImageGenerationServiceSettings
  /** Image profile lookup — supplied by caller */
  getImageProfile?: (id: string) => ImageProfile | undefined
}

const log = createLogger('AIService')

class AIService {
  private narrativeService: NarrativeService

  constructor() {
    this.narrativeService = serviceFactory.createNarrativeService()
  }

  /**
   * Stream a narrative response (zero-arg).
   * Reads all story data from the storyContext singleton.
   * This is the primary method for real-time story generation.
   */
  async *streamNarrative(): AsyncIterable<StreamChunk> {
    log('streamNarrative called (zero-arg delegate)')
    yield* this.narrativeService.stream()
  }

  /**
   * Classify a narrative response to extract world state changes (zero-arg).
   * Reads all context from the storyContext singleton.
   */
  async classifyResponse(): Promise<ClassificationResult> {
    log('classifyResponse called (zero-arg delegate)')
    const classifierService = serviceFactory.createClassifierService()
    return classifierService.classify()
  }

  /**
   * Generate story direction suggestions for creative writing mode (zero-arg).
   * Reads all context from the storyContext singleton.
   */
  async generateSuggestions(): Promise<SuggestionsResult> {
    log('generateSuggestions called (zero-arg delegate)')
    const suggestionsService = serviceFactory.createSuggestionsService()
    return suggestionsService.generateSuggestions()
  }

  /**
   * Generate RPG-style action choices for adventure mode (zero-arg).
   * Reads all context from the storyContext singleton.
   */
  async generateActionChoices(): Promise<ActionChoicesResult> {
    log('generateActionChoices called (zero-arg delegate)')
    const actionChoicesService = serviceFactory.createActionChoicesService()
    const choices = await actionChoicesService.generateChoices()
    return { choices }
  }

  /**
   * Analyze narration entries for style issues.
   */
  async analyzeStyle(): Promise<StyleReviewResult> {
    const service = serviceFactory.createStyleReviewerService()
    return service.analyzeStyle()
  }

  /**
   * Analyze if a new chapter should be created.
   */
  async analyzeForChapter(): Promise<boolean> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.analyzeForChapter()
  }

  /**
   * Generate a summary and metadata for a chapter.
   */
  async summarizeChapter(): Promise<ChapterSummaryResult> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.summarizeChapter()
  }

  /**
   * Resummarize an existing chapter.
   */
  async resummarizeChapter(): Promise<ChapterSummaryResult> {
    const memoryService = serviceFactory.createMemoryService()
    return memoryService.summarizeChapter()
  }

  /**
   * Get relevant lorebook entries using tiered injection.
   * NOTE: Tier 1 & 2 work. Tier 3 (LLM selection) is stubbed.
   */
  async getRelevantLorebookEntries(): Promise<EntryRetrievalResult> {
    const config = getEntryRetrievalConfigFromSettings()
    const entryService = new EntryRetrievalService(config, 'entryRetrieval')
    const result = await entryService.getRelevantEntries()

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
  async runLoreManagement(bumpChanges: () => number): Promise<LoreManagementResult> {
    // Build chapters info for lore management
    // Deep clone to avoid Svelte proxy issues with AI SDK structured cloning
    const chapterInfos = JSON.parse(
      JSON.stringify(
        story.chapter.chapters.map((c) => ({
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
      storyId: story.id!,
      existingEntries: story.lorebook.lorebookEntries,
      chapters: chapterInfos,
      queryChapter: aiService.answerChapterQuestion,
    })

    // Build changes array for the result
    const changes: LoreChange[] = []

    // Apply changes via callbacks and build changes array
    for (const entry of sessionResult.createdEntries) {
      // Assign proper ID before creating
      const newEntry: Entry = {
        ...entry,
        id: crypto.randomUUID(),
        branchId: story.branch.currentBranchId,
      }
      await story.lorebook.addLorebookEntry(entry)
      ui.updateLoreManagementProgress('Creating entries...', bumpChanges())
      changes.push({ type: 'create', entry: newEntry })
    }

    for (const entry of sessionResult.updatedEntries) {
      await story.lorebook.updateLorebookEntry(entry.id, entry)
      ui.updateLoreManagementProgress('Updating entries...', bumpChanges())
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
  async runAgenticRetrieval(): Promise<AgenticRetrievalResult> {
    const service = serviceFactory.createAgenticRetrievalService()
    const result = await service.runRetrieval()

    log('runAgenticRetrieval complete', {
      entriesFound: result.entries.length,
      hasReasoning: !!result.agenticReasoning,
    })

    return result
  }

  /**
   * Determine if agentic retrieval should be used.
   */
  shouldUseAgenticRetrieval(): boolean {
    const timelineFillSettings = settings.systemServicesSettings.timelineFill
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
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
  ): Promise<TimelineFillResult> {
    log('runTimelineFill called', {
      visibleEntriesCount: visibleEntries.length,
      chaptersCount: chapters.length,
    })

    const timelineFillService = serviceFactory.createTimelineFillService()
    return timelineFillService.runTimelineFill()
  }

  /**
   * Answer a specific chapter question.
   */
  async answerChapterQuestion(chapterNumber: number, question: string): Promise<string> {
    log('answerChapterQuestion called', {
      chapterNumber,
      question,
      chaptersCount: story.generationContext.promptContext.chapters.length,
    })

    const chapterQueryService = serviceFactory.createChapterQueryService()
    const answer = await chapterQueryService.answerQuestion(question, [chapterNumber])
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
    const answer = await chapterQueryService.answerQuestion(question, chapterNumbers)
    return answer.answer
  }

  /**
   * Determine if timeline fill should be used.
   */
  shouldUseTimelineFill(
    _chapters: Chapter[],
    timelineFillSettings: Pick<TimelineFillSettings, 'enabled' | 'mode'>,
  ): boolean {
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
  async generateImagesForNarrative(): Promise<void> {
    log('generateImagesForNarrative called')

    if (!this.isImageGenerationEnabled(undefined, 'standard')) {
      log('Image generation not enabled or not configured')
      return
    }

    // Check if inline image mode is enabled for this story
    const inlineImageMode = story.settings.imageGenerationMode === 'inline'
    try {
      if (inlineImageMode) {
        // Use inline image generation (process <pic> tags from AI response)
        log('Using inline image mode')
        await inlineImageService.processNarrativeForInlineImages()
      } else {
        // Analyzed mode: Use LLM to identify imageable scenes
        log('Using analyzed image mode')
        await this.runAnalyzedImageGeneration()
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
  private async runAnalyzedImageGeneration(): Promise<void> {
    const imageSettings = settings.systemServicesSettings.imageGeneration
    const entryId =
      story.generationContext.narrationEntryId ?? story.generationContext.userAction?.entryId ?? ''

    const presentCharacterNames =
      story.generationContext.classificationResult?.classificationResult?.scene
        ?.presentCharacterNames ?? []
    const presentCharacters: Character[] = story.character.characters.filter((c) =>
      presentCharacterNames.includes(c.name),
    )
    // Emit analysis started
    emitImageAnalysisStarted(entryId)

    try {
      // Create service and identify scenes
      const analysisService = serviceFactory.createImageAnalysisService()
      const scenes = await analysisService.identifyScenes()

      if (scenes.length === 0) {
        log('No imageable scenes identified')
        emitImageAnalysisComplete(entryId, 0, 0)
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
      emitImageAnalysisComplete(entryId, sceneCount, portraitCount)

      // Queue image generation for each scene
      const referenceMode = story.settings.referenceMode ?? false
      const getImageProfile = (id: string) => settings.getImageProfile(id)
      const maxImages = imageSettings.maxImagesPerMessage ?? 3
      const scenesToProcess = maxImages > 0 ? scenes.slice(0, maxImages) : scenes
      for (const scene of scenesToProcess) {
        await this.queueAnalyzedImageGeneration(
          story.id ?? '',
          entryId,
          scene,
          imageSettings,
          presentCharacters,
          referenceMode,
          getImageProfile,
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log('Scene analysis failed', error)
      emitImageAnalysisFailed(entryId, errorMessage)
    }
  }

  /**
   * Queue image generation for an analyzed scene.
   */
  private async queueAnalyzedImageGeneration(
    storyId: string,
    entryId: string,
    scene: ImageableScene,
    imageSettings: ImageGenerationServiceSettings,
    presentCharacters: Character[],
    referenceMode: boolean,
    getImageProfile: (id: string) => ImageProfile | undefined,
  ): Promise<void> {
    const imageId = crypto.randomUUID()

    // Determine profile and model
    let profileId = imageSettings.profileId
    let modelToUse = getImageProfile(profileId ?? '')?.model ?? ''
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
        modelToUse = getImageProfile(profileId ?? '')?.model ?? ''
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
      modelToUse = getImageProfile(profileId ?? '')?.model ?? ''
      sizeToUse = imageSettings.portraitSize
      styleId = imageSettings.portraitStyleId
    }

    if (!profileId) {
      log('No image profile configured, skipping scene')
      return
    }

    // Build full prompt with style
    const stylePrompt = await AIService.getStylePrompt(styleId)
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
  async analyzeBackgroundChangeAndGenerateImage(): Promise<void> {
    try {
      const service = serviceFactory.createBackgroundImageService()
      emitBackgroundImageAnalysisStarted()
      const result = await service.analyzeResponsesForBackgroundImage()
      emitBackgroundImageAnalysisComplete()
      // Ai returns empty string or short response if no change, otherwise the image prompt
      if (result.changeNecessary) {
        log('Background change detected, prompt:', result.prompt)
        emitBackgroundImageQueued()
        const image = await service.generateBackgroundImage(result.prompt)

        if (image) {
          emitBackgroundImageReady()
          log('Background image generated successfully', { image })
          await story.image.updateBackgroundImage(image)
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
  static async getStylePrompt(styleId: string): Promise<string> {
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
  async translateNarration(): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('narration')
    return service.translateNarration()
  }

  /**
   * Translate user input to English.
   */
  async translateInput(): Promise<TranslationResult> {
    const service = serviceFactory.createTranslationService('input')
    return service.translateInput()
  }

  /**
   * Batch translate UI elements.
   */
  async translateUIElements(): Promise<UITranslationItem[]> {
    const service = serviceFactory.createTranslationService('ui')
    return service.translateUIElements()
  }

  /**
   * Translate suggestions.
   */
  async translateSuggestions(): Promise<Suggestion[]> {
    const service = serviceFactory.createTranslationService('suggestions')
    return service.translateSuggestions()
  }

  /**
   * Translate action choices.
   */
  async translateActionChoices(): Promise<ActionChoice[]> {
    const service = serviceFactory.createTranslationService('actionChoices')
    return service.translateActionChoices()
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
