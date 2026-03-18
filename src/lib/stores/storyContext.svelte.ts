import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  Entry,
  Branch,
  StoryMode,
  EmbeddedImage,
  ActionInputType,
} from '$lib/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type { ActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
import type { RetrievalResult } from '$lib/services/generation/types'
import type { NarrativeResult } from '$lib/services/generation/phases/NarrativePhase'
import type { ClassificationPhaseResult } from '$lib/services/generation/phases/ClassificationPhase'
import type { TranslationResult2 } from '$lib/services/generation/phases/TranslationPhase'
import type { ImageResult } from '$lib/services/generation/phases/ImagePhase'
import type {
  PostGenerationResult,
  PromptContext,
} from '$lib/services/generation/phases/PostGenerationPhase'
import type { BackgroundImageResult } from '$lib/services/generation/phases/BackgroundImagePhase'
import type { PreGenerationResult } from '$lib/services/generation/phases/PreGenerationPhase'
import { SvelteSet } from 'svelte/reactivity'

export interface StoryContextHydrateData {
  story: Story
  entries: StoryEntry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  chapters: Chapter[]
  lorebookEntries: Entry[]
  branches: Branch[]
}

class StoryContextSingleton {
  // Category 1 — World state ($state, mutated in place)
  currentStory = $state<Story | null>(null)
  entries = $state<StoryEntry[]>([])
  characters = $state<Character[]>([])
  locations = $state<Location[]>([])
  items = $state<Item[]>([])
  storyBeats = $state<StoryBeat[]>([])
  chapters = $state<Chapter[]>([])
  lorebookEntries = $state<Entry[]>([])

  // Category 2 — Generation inputs ($state.raw, replaced wholesale)
  userAction = $state.raw<{ entryId: string; content: string; rawInput: string } | null>(null)
  narrationEntryId = $state.raw<string | null>(null)
  abortSignal = $state.raw<AbortSignal | null>(null)
  embeddedImages = $state.raw<EmbeddedImage[]>([])
  rawInput = $state.raw<string>('')
  actionType = $state.raw<ActionInputType>('do')
  wasRawActionChoice = $state.raw<boolean>(false)
  styleReview = $state.raw<StyleReviewResult | null>(null)
  activationTracker = $state.raw<ActivationTracker | null>(null)

  // Category 3 — Generation intermediates ($state.raw, replaced wholesale)
  retrievalResult = $state.raw<RetrievalResult | null>(null)
  narrativeResult = $state.raw<NarrativeResult | null>(null)
  classificationResult = $state.raw<ClassificationPhaseResult | null>(null)
  translationResult = $state.raw<TranslationResult2 | null>(null)
  imageResult = $state.raw<ImageResult | null>(null)
  postGenerationResult = $state.raw<PostGenerationResult | null>(null)
  backgroundResult = $state.raw<BackgroundImageResult | null>(null)
  preGenerationResult = $state.raw<PreGenerationResult | null>(null)

  // Private fields — NOT reactive, plain class fields
  private _branches: Branch[] = []
  private _cachedLastChapterEndIndex: number = 0
  private _lastChapterEndIndexDirty: boolean = true
  private _lastChaptersLength: number = 0
  private _lastEntriesLength: number = 0
  private _entryIdToIndex: Map<string, number> = new Map()

  // Derived getters

  get currentLocation(): Location | undefined {
    return this.locations.find((l) => l.current)
  }

  get protagonist(): Character | undefined {
    return this.characters.find((c) => c.relationship === 'self')
  }

  get pov(): 'first' | 'second' | 'third' {
    const mode = this.currentStory?.mode ?? 'adventure'
    const stored = this.currentStory?.settings?.pov ?? null
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
    const mode = this.currentStory?.mode ?? 'adventure'
    const stored = this.currentStory?.settings?.tense ?? null
    if (mode === 'creative-writing') {
      return 'past'
    }
    return stored ?? 'present'
  }

  get pendingQuests(): StoryBeat[] {
    return this.storyBeats.filter((b) => b.status === 'pending' || b.status === 'active')
  }

  get storyMode(): StoryMode {
    return this.currentStory?.mode || 'adventure'
  }

  get promptContext(): PromptContext {
    return {
      mode: this.storyMode,
      pov: this.pov,
      tense: this.tense,
      protagonistName: this.protagonist?.name ?? 'the protagonist',
      genre: this.currentStory?.genre ?? undefined,
    }
  }

  /**
   * Get chapters filtered by current branch and its lineage.
   * Includes main branch chapters plus any ancestor/current branch chapters.
   */
  get currentBranchChapters(): Chapter[] {
    const currentBranchId = this.currentStory?.currentBranchId ?? null

    // If on main branch, only return chapters with null branchId
    if (currentBranchId === null) {
      return this.chapters.filter((ch) => ch.branchId === null)
    }

    const lineage = this._buildBranchLineage(currentBranchId)
    if (lineage.length === 0) {
      return this.chapters.filter((ch) => ch.branchId === null)
    }

    const lineageIds = new Set(lineage.map((branch) => branch.id))
    return this.chapters.filter((ch) => ch.branchId === null || lineageIds.has(ch.branchId))
  }

  get lastChapterEndIndex(): number {
    // Use branch-filtered chapters for this computation
    const branchChapters = this.currentBranchChapters
    if (branchChapters.length === 0) return 0

    // Check if cache is valid - invalidate if chapters or entries changed
    const chaptersChanged = this.chapters.length !== this._lastChaptersLength
    const entriesChanged = this.entries.length !== this._lastEntriesLength

    if (chaptersChanged || entriesChanged || this._lastChapterEndIndexDirty) {
      this._lastChaptersLength = this.chapters.length
      this._lastEntriesLength = this.entries.length
      this._cachedLastChapterEndIndex = this._computeLastChapterEndIndex()
      this._lastChapterEndIndexDirty = false
    }

    return this._cachedLastChapterEndIndex
  }

  /**
   * Get entries that are NOT part of any chapter (visible in context).
   * These are entries after the last chapter's endEntryId.
   * Per design doc section 3.1.2: summarized entries should be excluded from context.
   */
  get visibleEntries(): StoryEntry[] {
    if (this.chapters.length === 0) {
      // No chapters yet, all entries are visible
      return this.entries
    }
    // Return only entries after the last chapter
    return this.entries.slice(this.lastChapterEndIndex)
  }

  // Private helpers

  /**
   * Rebuild the entry ID to index map for O(1) lookups.
   * Called when entries array changes significantly.
   */
  private rebuildEntryIdIndex(): void {
    this._entryIdToIndex.clear()
    for (let i = 0; i < this.entries.length; i++) {
      this._entryIdToIndex.set(this.entries[i].id, i)
    }
  }

  /**
   * Compute lastChapterEndIndex - internal implementation.
   * Uses branch-filtered chapters for correct branch awareness.
   */
  private _computeLastChapterEndIndex(): number {
    // Use branch-filtered chapters
    const branchChapters = this.currentBranchChapters
    if (branchChapters.length === 0) return 0

    // Rebuild index map if needed
    if (this._entryIdToIndex.size !== this.entries.length) {
      this.rebuildEntryIdIndex()
    }

    // Sort chapters by number to ensure we get the actual last chapter for this branch
    const sortedChapters = [...branchChapters].sort((a, b) => a.number - b.number)
    const lastChapter = sortedChapters[sortedChapters.length - 1]

    // Use O(1) map lookup instead of O(n) find + indexOf
    const endIndex = this._entryIdToIndex.get(lastChapter.endEntryId)
    if (endIndex !== undefined) {
      return endIndex + 1
    }

    // Fallback: if endEntryId references a deleted entry, estimate based on entry counts
    console.warn('Warning: Chapter endEntryId not found, using fallback calculation', {
      chapterId: lastChapter.id,
      chapterNumber: lastChapter.number,
      endEntryId: lastChapter.endEntryId,
    })

    // Sum up all branch chapter entry counts as a fallback estimate
    const totalChapterEntries = sortedChapters.reduce((sum, ch) => sum + ch.entryCount, 0)
    return Math.min(totalChapterEntries, this.entries.length)
  }

  /**
   * Invalidate lastChapterEndIndex cache - call when chapters change
   */
  private invalidateChapterCache(): void {
    this._lastChapterEndIndexDirty = true
    this._entryIdToIndex.clear() // Force rebuild on next access
  }

  private _buildBranchLineage(branchId: string): Branch[] {
    const lineage: Branch[] = []
    let current: Branch | null = this._branches.find((b) => b.id === branchId) ?? null
    const visited = new SvelteSet<string>()

    while (current) {
      if (visited.has(current.id)) break
      visited.add(current.id)
      lineage.unshift(current)
      const parentId = current.parentBranchId
      if (!parentId) break
      current = this._branches.find((b) => b.id === parentId) ?? null
    }

    return lineage
  }

  // Lifecycle methods

  /**
   * Clear all generation intermediates and inputs. Call before starting a new generation run.
   */
  init(): void {
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
    this.preGenerationResult = null
  }

  /**
   * Alias for init() — clears intermediates on abort/error.
   */
  reset(): void {
    this.init()
  }

  /**
   * Hydrate the singleton with a complete world state snapshot from the database.
   */
  hydrate(data: StoryContextHydrateData): void {
    this.currentStory = data.story
    this.entries = data.entries
    this.characters = data.characters
    this.locations = data.locations
    this.items = data.items
    this.storyBeats = data.storyBeats
    this.chapters = data.chapters
    this.lorebookEntries = data.lorebookEntries
    this._branches = data.branches
    this.invalidateChapterCache()
  }

  /**
   * Reset all fields to empty state. Call when closing/switching stories.
   */
  clear(): void {
    this.currentStory = null
    this.entries = []
    this.characters = []
    this.locations = []
    this.items = []
    this.storyBeats = []
    this.chapters = []
    this.lorebookEntries = []
    this._branches = []
    this.init()
    this.invalidateChapterCache()
  }
}

export const storyContext = new StoryContextSingleton()
