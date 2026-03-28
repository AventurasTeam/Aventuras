import type {
  ActionInputType,
  Chapter,
  Character,
  Entry,
  Item,
  StoryBeat,
  StoryEntry,
  Location,
  TimeTracker,
  MemoryConfig,
} from '$lib/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type { ActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
import type { RetrievalResult } from '$lib/services/generation/types'
import type { NarrativeResult } from '$lib/services/generation/phases/NarrativePhase'
import type { ClassificationPhaseResult } from '$lib/services/generation/phases/ClassificationPhase'
import type { TranslationResult2 } from '$lib/services/generation/phases/TranslationPhase'
import type { ImageResult } from '$lib/services/generation/phases/ImagePhase'
import type { PostGenerationResult } from '$lib/services/generation/phases/PostGenerationPhase'
import type { BackgroundImageResult } from '$lib/services/generation/phases/BackgroundImagePhase'
import type { Suggestion } from '$lib/services/ai/sdk/schemas/suggestions'
import type { ActionChoice } from '$lib/services/ai/sdk/schemas/actionchoices'
import type { UITranslationItem } from '$lib/services/ai/utils/TranslationService'
import { countTokens } from '$lib/services/tokenizer'
import type { StoryStore } from './index.svelte'
import type { Tier3Candidate } from '$lib/services/ai/generation/EntryInjector'
import type { WorldStateArrays } from '$lib/services/context/worldStateMapper'
import { database } from '$lib/services/database'
import { ContextBuilder, type EntityRuntimeVars } from '$lib/services/context/context-builder'
import { DEFAULT_FALLBACK_STYLE_PROMPT } from '$lib/services/ai/image'
import { settings, type LorebookLimitsSettings } from '../settings.svelte'
import { TranslationService } from '$lib/services/ai/utils'
import type { ContextStoryEntry } from '$lib/services/context/context-types'
import type { ChapterAnalysis } from '$lib/services/ai/sdk'
import { getLorebookConfig } from '$lib/services/ai/core/config'

/** Prompt context for macro expansion */
interface StoryPromptContext {
  mode: 'adventure' | 'creative-writing'
  pov: 'first' | 'second' | 'third'
  tense: 'past' | 'present'
  protagonistName: string
  protagonistDescription?: string
  genre?: string
  settingDescription?: string
  tone?: string
  themes?: string[]
  storyEntries: ContextStoryEntry[]
  storyEntriesRaw: StoryEntry[]
  storyEntriesVisible: ContextStoryEntry[]
  storyEntriesVisibleRaw: StoryEntry[]
  userInput: string
  loreEntriesForTier3: Entry[]
  worldStateForTier3: Tier3Candidate[]
  userSettings: {
    retieval: {
      maxStoryEntries: number
    }
    agenticRetrieval: {
      recentEntriesCount: number
      maxChapters: number
      summaryCharLimit: number
      maxLorebookEntries: number
    }
    classifier: {
      maxEntries: number
    }
    lorebookConfig: LorebookLimitsSettings
    memoryConfig: MemoryConfig
    visualProseMode: boolean
    imageGeneration: {
      inlineImageMode: boolean
      referenceMode: boolean
      maxImages: number
      stylePrompt: string
    }
    translationSettings: {
      targetLanguage: {
        code: string
        name: string
      }
      sourceLanguage: {
        code: string
        name: string
      }
    }
  }
  chapters: Chapter[]
  lorebookEntries: Entry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  timeTracker: TimeTracker
  styleReview?: StyleReviewResult
  retrievalResult?: RetrievalResult
  relevantWorldState: WorldStateArrays
  packVariables?: {
    runtimeVariables: Record<string, EntityRuntimeVars[]>
    [key: string]: string | Record<string, EntityRuntimeVars[]>
  }
  suggestionsToTranslate?: Suggestion[]
  actionChoicesToTranslate?: ActionChoice[]
  uiElementsToTranslate?: UITranslationItem[]
  storyBeats: StoryBeat[]
  translationResult?: TranslationResult2
  classificationResult?: ClassificationPhaseResult['classificationResult']
  lastNarrativeEntry?: StoryEntry
  lastChapterEndIndex?: number
  chapterAnalysis: {
    result?: ChapterAnalysis
    protectedEntryCount?: number
    analysisEntries?: StoryEntry[]
    chapterEntries?: StoryEntry[]
  }
}

export class StoryGenerationContextStore {
  constructor(private story: StoryStore) {}

  // Generation inputs
  userAction = $state.raw<{
    entryId: string
    content: string
    rawInput: string
  } | null>(null)
  userActionOriginal = $state.raw<string | undefined>(undefined)
  narrationEntryId = $state.raw<string | null>(null)
  abortSignal = $state.raw<AbortSignal | undefined>(undefined)
  rawInput = $state.raw<string>('')
  actionType = $state.raw<ActionInputType>('do')
  wasRawActionChoice = $state.raw<boolean>(false)
  styleReview = $state.raw<StyleReviewResult | null>(null)
  activationTracker = $state.raw<ActivationTracker | null>(null)
  packVariables = $state.raw<
    | {
        runtimeVariables: Record<string, EntityRuntimeVars[]>
        [key: string]: string | Record<string, EntityRuntimeVars[]>
      }
    | undefined
  >()

  // Loaded context
  stylePrompt = $state.raw<string>('')

  // Generation intermediates
  loreEntriesForTier3 = $state.raw<Entry[]>([])
  worldStateForTier3 = $state.raw<Tier3Candidate[]>([])
  retrievalResult = $state.raw<RetrievalResult | null>(null)
  narrativeResult = $state.raw<NarrativeResult | null>(null)
  classificationResult = $state.raw<ClassificationPhaseResult | null>(null)
  translationResult = $state.raw<TranslationResult2 | null>(null)
  imageResult = $state.raw<ImageResult | null>(null)
  postGenerationResult = $state.raw<PostGenerationResult | null>(null)
  backgroundResult = $state.raw<BackgroundImageResult | null>(null)
  suggestionsToTranslate = $state.raw<Suggestion[] | null>(null)
  actionChoicesToTranslate = $state.raw<ActionChoice[] | null>(null)
  uiElementsToTranslate = $state.raw<UITranslationItem[] | null>(null)
  relevantWorldState = $state.raw<WorldStateArrays>({
    characters: [],
    inventory: [],
    relevantItems: [],
    storyBeats: [],
    locations: [],
    relatedStoryBeats: [],
  })
  chapterAnalysis = $state.raw<StoryPromptContext['chapterAnalysis']>({})

  // wordCount dirty-flag cache (plain booleans — not reactive, only read inside getter)
  private _cachedWordCount: number = 0
  private _wordCountDirty: boolean = true

  // Derived getters

  get promptContext(): StoryPromptContext {
    if (!this.story || !this.story.id || !this.userAction) {
      throw new Error('Cannot compute promptContext, invalid data.')
    }
    return {
      userSettings: {
        retieval: { maxStoryEntries: 10 },
        agenticRetrieval: {
          recentEntriesCount: 5,
          maxChapters: 20,
          summaryCharLimit: 100,
          maxLorebookEntries: 50,
        },
        classifier: {
          maxEntries: settings.systemServicesSettings.classifier.chatHistoryTruncation ?? 100,
        },
        memoryConfig: this.story.settings.memoryConfig,
        visualProseMode: this.story.settings.visualProseMode ?? false,
        lorebookConfig: getLorebookConfig(),
        imageGeneration: {
          inlineImageMode: this.story.settings.imageGenerationMode === 'inline',
          referenceMode: this.story.settings.referenceMode ?? false,
          maxImages: settings.systemServicesSettings.imageGeneration.maxImagesPerMessage,
          stylePrompt: this.stylePrompt,
        },
        translationSettings: {
          targetLanguage: {
            code: settings.translationSettings.targetLanguage ?? 'en',
            name: TranslationService.getLanguageName(
              settings.translationSettings.targetLanguage ?? 'en',
            ),
          },
          sourceLanguage: {
            code: settings.translationSettings.sourceLanguage ?? 'en',
            name: TranslationService.getLanguageName(
              settings.translationSettings.sourceLanguage ?? 'en',
            ),
          },
        },
      },
      mode: this.story.mode,
      pov: this.story.settings.pov,
      tense: this.story.settings.tense,
      genre: this.story.genre ?? undefined,
      tone: this.story.settings.tone ?? undefined,
      themes: this.story.settings.themes ?? [],
      settingDescription: this.story.description ?? '',
      protagonistName: this.story.character.protagonist?.name ?? 'the protagonist',
      protagonistDescription: this.story.character.protagonist?.description ?? '',
      storyEntries: this.story.entry.entries,
      storyEntriesRaw: this.story.entry.rawEntries,
      storyEntriesVisible: this.story.entry.visibleStoryEntries,
      storyEntriesVisibleRaw: this.story.entry.visibleEntries,
      userInput: this.userAction?.content,
      lastNarrativeEntry: this.story.entry.rawEntries.find((e) => e.id === this.narrationEntryId),
      loreEntriesForTier3: this.loreEntriesForTier3,
      worldStateForTier3: this.worldStateForTier3,
      chapters: this.story.chapter.currentBranchChapters,
      lorebookEntries: this.story.lorebook.lorebookEntries,
      characters: this.story.character.characters,
      locations: this.story.location.locations,
      items: this.story.item.items,
      timeTracker: this.story.time.timeTracker,
      styleReview: this.styleReview ?? undefined,
      retrievalResult: this.retrievalResult ?? undefined,
      relevantWorldState: this.relevantWorldState,
      packVariables: this.packVariables ?? undefined,
      suggestionsToTranslate: this.suggestionsToTranslate ?? undefined,
      actionChoicesToTranslate: this.actionChoicesToTranslate ?? undefined,
      uiElementsToTranslate: this.uiElementsToTranslate ?? undefined,
      storyBeats: this.story.storyBeat.storyBeats,
      translationResult: this.translationResult ?? undefined,
      classificationResult: this.classificationResult?.classificationResult ?? undefined,
      lastChapterEndIndex: this.story.chapter.lastChapterEndIndex,
      chapterAnalysis: this.chapterAnalysis,
    }
  }

  get wordCount(): number {
    if (this._wordCountDirty) {
      this._cachedWordCount = this.story.entry.rawEntries.reduce((count, entry) => {
        return count + entry.content.split(/\s+/).filter(Boolean).length
      }, 0)
      this._wordCountDirty = false
    }
    return this._cachedWordCount
  }

  get tokensSinceLastChapter(): number {
    const visibleEntries = this.story.entry.rawEntries.slice(this.story.chapter.lastChapterEndIndex)
    return visibleEntries.reduce((total, entry) => {
      if (entry.metadata?.tokenCount) {
        return total + entry.metadata.tokenCount
      }
      return total + countTokens(entry.content)
    }, 0)
  }

  get tokensOutsideBuffer(): number {
    const bufferSize = this.story.settings.memoryConfig.chapterBuffer
    const visibleEntries = this.story.entry.rawEntries.slice(this.story.chapter.lastChapterEndIndex)
    if (visibleEntries.length <= bufferSize) {
      return 0
    }
    const entriesOutsideBuffer =
      bufferSize === 0 ? visibleEntries : visibleEntries.slice(0, -bufferSize)
    return entriesOutsideBuffer.reduce((total, entry) => {
      if (entry.metadata?.tokenCount) {
        return total + entry.metadata.tokenCount
      }
      return total + countTokens(entry.content)
    }, 0)
  }

  // Private helpers

  /**
   * Invalidate wordCount cache - call when entries are added/removed/modified
   */
  invalidateWordCountCache(): void {
    this._wordCountDirty = true
  }

  // Lifecycle methods

  async loadStylePrompt(): Promise<void> {
    this.stylePrompt = DEFAULT_FALLBACK_STYLE_PROMPT
    const styleId = settings.systemServicesSettings.imageGeneration.styleId
    try {
      if (!this.story.id) return
      const packId = (await database.getStoryPackId(this.story.id)) || 'default-pack'
      const template = await database.getPackTemplate(packId, styleId)
      if (template?.content) {
        this.stylePrompt = template.content
        return
      }
    } catch {
      // Template not found, use fallback
    }
  }

  async loadPackVariables(): Promise<void> {
    if (!this.story.id) return
    const packId = (await database.getStoryPackId(this.story.id)) || 'default-pack'

    if (!packId) return
    const vars = await database.getPackVariables(packId)
    const defaults: Record<string, string> = {}

    for (const v of vars) {
      if (v.defaultValue != null) defaults[v.variableName] = v.defaultValue
    }

    const runtimeVariables = await ContextBuilder.getRuntimeVariableContext(packId)

    this.packVariables = {
      ...defaults,
      ...(await database.getStoryCustomVariables(this.story.id)),
      runtimeVariables,
    }
  }

  /**
   * Clear all generation intermediates and inputs. Call before starting a new generation run.
   */
  clearIntermediates(): void {
    this.userAction = null
    this.narrationEntryId = null
    this.abortSignal = undefined
    this.rawInput = ''
    this.actionType = 'do'
    this.wasRawActionChoice = false
    this.styleReview = null
    this.activationTracker = null
    this.stylePrompt = ''
    this.packVariables = undefined
    this.retrievalResult = null
    this.narrativeResult = null
    this.classificationResult = null
    this.translationResult = null
    this.imageResult = null
    this.postGenerationResult = null
    this.backgroundResult = null
    this.suggestionsToTranslate = null
    this.actionChoicesToTranslate = null
    this.uiElementsToTranslate = null
  }

  /**
   * Reset all fields to empty state. Call when closing/switching stories.
   */
  clear(): void {
    this._cachedWordCount = 0
    this._wordCountDirty = true
    this.clearIntermediates()
    this.story.chapter.invalidateChapterCache()
  }
}
