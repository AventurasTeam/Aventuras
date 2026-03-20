import type { StoryMode, EmbeddedImage, ActionInputType, MemoryConfig } from '$lib/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type { ActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
import type { RetrievalResult } from '$lib/services/generation/types'
import type { NarrativeResult } from '$lib/services/generation/phases/NarrativePhase'
import type { ClassificationPhaseResult } from '$lib/services/generation/phases/ClassificationPhase'
import type { TranslationResult2 } from '$lib/services/generation/phases/TranslationPhase'
import type { ImageResult } from '$lib/services/generation/phases/ImagePhase'
import type { PostGenerationResult } from '$lib/services/generation/phases/PostGenerationPhase'
import type { BackgroundImageResult } from '$lib/services/generation/phases/BackgroundImagePhase'
import { DEFAULT_MEMORY_CONFIG } from '$lib/services/ai/generation/MemoryService'
import { countTokens } from '$lib/services/tokenizer'
import type { StoryStore } from './index.svelte'

/** Prompt context for macro expansion */
interface StoryPromptContext {
  mode: 'adventure' | 'creative-writing'
  pov: 'first' | 'second' | 'third'
  tense: 'past' | 'present'
  protagonistName: string
  genre?: string
  settingDescription?: string
  tone?: string
  themes?: string[]
}

export class StoryGenerationContextStore {
  constructor(private ctx: StoryStore) {}

  // Generation inputs
  userAction = $state.raw<{ entryId: string; content: string; rawInput: string } | null>(null)
  narrationEntryId = $state.raw<string | null>(null)
  abortSignal = $state.raw<AbortSignal | null>(null)
  embeddedImages = $state.raw<EmbeddedImage[]>([])
  rawInput = $state.raw<string>('')
  actionType = $state.raw<ActionInputType>('do')
  wasRawActionChoice = $state.raw<boolean>(false)
  styleReview = $state.raw<StyleReviewResult | null>(null)
  activationTracker = $state.raw<ActivationTracker | null>(null)

  // Generation intermediates
  retrievalResult = $state.raw<RetrievalResult | null>(null)
  narrativeResult = $state.raw<NarrativeResult | null>(null)
  classificationResult = $state.raw<ClassificationPhaseResult | null>(null)
  translationResult = $state.raw<TranslationResult2 | null>(null)
  imageResult = $state.raw<ImageResult | null>(null)
  postGenerationResult = $state.raw<PostGenerationResult | null>(null)
  backgroundResult = $state.raw<BackgroundImageResult | null>(null)

  _isRetryInProgress = $state.raw<boolean>(false)

  // wordCount dirty-flag cache (plain booleans — not reactive, only read inside getter)
  private _cachedWordCount: number = 0
  private _wordCountDirty: boolean = true

  // Derived getters

  get pov(): 'first' | 'second' | 'third' {
    const mode = this.ctx.currentStory?.mode ?? 'adventure'
    const stored = this.ctx.currentStory?.settings?.pov ?? null
    // For creative-writing mode, respect the user's stored POV choice
    // (wizard allows selecting first, second, or third person)
    if (stored) {
      return stored
    }
    // Default based on mode
    if (mode === 'creative-writing') {
      return 'third'
    }
    return 'first'
  }

  get tense(): 'past' | 'present' {
    const mode = this.ctx.currentStory?.mode ?? 'adventure'
    const stored = this.ctx.currentStory?.settings?.tense ?? null
    if (mode === 'creative-writing') {
      return 'past'
    }
    return stored ?? 'present'
  }

  get storyMode(): StoryMode {
    return this.ctx.currentStory?.mode || 'adventure'
  }

  get promptContext(): StoryPromptContext {
    return {
      mode: this.storyMode,
      pov: this.pov,
      tense: this.tense,
      protagonistName: this.ctx.character.protagonist?.name ?? 'the protagonist',
      genre: this.ctx.currentStory?.genre ?? undefined,
    }
  }

  get wordCount(): number {
    if (this._wordCountDirty) {
      this._cachedWordCount = this.ctx.entry.entries.reduce((count, entry) => {
        return count + entry.content.split(/\s+/).filter(Boolean).length
      }, 0)
      this._wordCountDirty = false
    }
    return this._cachedWordCount
  }

  get memoryConfig(): MemoryConfig {
    return this.ctx.currentStory?.memoryConfig || DEFAULT_MEMORY_CONFIG
  }

  /**
   * Calculate token count since last chapter.
   * Uses stored token count (accurate) or calculates via tokenizer for legacy entries.
   */
  get tokensSinceLastChapter(): number {
    const visibleEntries = this.ctx.entry.entries.slice(this.ctx.chapter.lastChapterEndIndex)
    return visibleEntries.reduce((total, entry) => {
      if (entry.metadata?.tokenCount) {
        return total + entry.metadata.tokenCount
      }
      return total + countTokens(entry.content)
    }, 0)
  }

  /**
   * Get token count for entries outside the buffer (eligible for summarization).
   * Returns 0 if no entries exist outside the buffer.
   */
  get tokensOutsideBuffer(): number {
    const bufferSize = this.memoryConfig.chapterBuffer
    const visibleEntries = this.ctx.entry.entries.slice(this.ctx.chapter.lastChapterEndIndex)
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

  get isCreativeWritingMode(): boolean {
    return this.storyMode === 'creative-writing'
  }

  // Private helpers

  /**
   * Invalidate wordCount cache - call when entries are added/removed/modified
   */
  invalidateWordCountCache(): void {
    this._wordCountDirty = true
  }

  // Lifecycle methods

  /**
   * Clear all generation intermediates and inputs. Call before starting a new generation run.
   */
  clearIntermediates(): void {
    this.userAction = null
    this.narrationEntryId = null
    this.abortSignal = null
    this.embeddedImages = []
    this.rawInput = ''
    this.actionType = 'do'
    this.wasRawActionChoice = false
    this.styleReview = null
    this.activationTracker = null
    this.retrievalResult = null
    this.narrativeResult = null
    this.classificationResult = null
    this.translationResult = null
    this.imageResult = null
    this.postGenerationResult = null
    this.backgroundResult = null
  }

  /**
   * Reset all fields to empty state. Call when closing/switching stories.
   */
  clear(): void {
    this._cachedWordCount = 0
    this._wordCountDirty = true
    this.clearIntermediates()
    this.ctx.chapter.invalidateChapterCache()
  }
}
