import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  StoryMode,
  Entry,
  WorldStateSnapshot,
} from '$lib/types'
import { database } from '$lib/services/database'
import { ui } from '../ui.svelte'
import { settings } from '../settings.svelte'
import { DEFAULT_MEMORY_CONFIG } from '$lib/services/ai/generation/MemoryService'
import { convertToEntries, type ImportedEntry } from '$lib/services/lorebookImporter'
import { countTokens } from '$lib/services/tokenizer'
import {
  eventBus,
  emitStoryLoaded,
  emitModeChanged,
  type StoryCreatedEvent,
} from '$lib/services/events'
import { aiService } from '$lib/services/ai'
import { StoryCharacterStore } from './character.svelte'
import { StoryEntryStore } from './entry.svelte'
import { StoryBranchStore } from './branch.svelte'
import { StoryChapterStore } from './chapter.svelte'
import { StoryCheckpointStore } from './checkpoint.svelte'
import { StoryClassification } from './classification.svelte'
import { StoryItemStore } from './item.svelte'
import { StoryLocationStore } from './location.svelte'
import { StoryLorebookStore } from './lorebook.svelte'
import { StoryRetryStore } from './retry.svelte'
import { StoryStoryBeatStore } from './storyBeat.svelte'
import { StoryTimeStore } from './time.svelte'
import { StoryGenerationContextStore } from './generationContext.svelte'
import { StorySettingsStore } from './settings.svelte'
import { StoryImageStore } from './image.svelte'

const DEBUG = true

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryStore]', ...args)
  }
}

// Story Store using Svelte 5 runes
class StoryStore {
  // Root identity fields (formerly on currentStory)
  id = $state<string | null>(null)
  title = $state<string | null>(null)
  description = $state<string | null>(null)
  genre = $state<string | null>(null)
  templateId = $state<string | null>(null)
  mode = $state<StoryMode>('adventure')
  createdAt = $state<number>(0)
  updatedAt = $state<number>(0)

  get isLoaded(): boolean {
    return this.id !== null
  }

  // Story library
  allStories = $state<Story[]>([])

  // Sub-stores
  settings = new StorySettingsStore(this)
  image = new StoryImageStore(this)
  branch = new StoryBranchStore(this)
  chapter = new StoryChapterStore(this)
  character = new StoryCharacterStore(this)
  checkpoint = new StoryCheckpointStore(this)
  classification = new StoryClassification(this)
  generationContext = new StoryGenerationContextStore(this)
  entry = new StoryEntryStore(this)
  item = new StoryItemStore(this)
  location = new StoryLocationStore(this)
  lorebook = new StoryLorebookStore(this)
  retry = new StoryRetryStore(this)
  storyBeat = new StoryStoryBeatStore(this)
  time = new StoryTimeStore(this)

  /** Build a Story snapshot from the current store state (for services that need a Story object). */
  getStorySnapshot(): Story {
    if (!this.id) throw new Error('No story loaded')
    return {
      id: this.id,
      title: this.title ?? '',
      description: this.description ?? null,
      genre: this.genre ?? null,
      templateId: this.templateId ?? null,
      mode: this.mode,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      settings: this.settings.toSnapshot(),
      memoryConfig: this.settings.memoryConfig,
      retryState: null,
      styleReviewState: null,
      timeTracker: this.time.timeTracker,
      currentBranchId: this.branch.currentBranchId,
      currentBgImage: this.image.currentBgImage,
    }
  }

  closeStory(): void {
    this.id = null
    this.title = null
    this.description = null
    this.genre = null
    this.templateId = null
    this.mode = 'adventure'
    this.createdAt = 0
    this.updatedAt = 0
    this.image.clear()
    this.settings.clear()
    this.time.clear()
    this.branch.currentBranchId = null
    this.checkpoint.checkpoints = []
    this.branch.branches = []
    this.generationContext.clear()
    log('Story closed')
  }

  // Load all stories for library view
  async loadAllStories(): Promise<void> {
    this.allStories = await database.getAllStories()
  }

  async loadStory(storyId: string): Promise<void> {
    const storyData = await database.getStory(storyId)
    if (!storyData) {
      throw new Error(`Story not found: ${storyId}`)
    }

    await database.cleanupOrphanedEmbeddedImages()

    // Root identity
    this.id = storyData.id
    this.title = storyData.title
    this.description = storyData.description
    this.genre = storyData.genre
    this.templateId = storyData.templateId
    this.mode = storyData.mode
    this.createdAt = storyData.createdAt
    this.updatedAt = storyData.updatedAt

    // Sub-stores
    this.settings.load(storyData.settings, storyData.memoryConfig)
    this.time.load(storyData.timeTracker)
    this.branch.currentBranchId = storyData.currentBranchId
    await this.image.load(storyData.id, storyData.currentBranchId)

    // Load branch-independent data first
    const [checkpoints, branches] = await Promise.all([
      database.getCheckpoints(storyId),
      database.getBranches(storyId),
    ])

    this.checkpoint.checkpoints = checkpoints
    this.branch.branches = branches

    // Load entries and chapters based on current branch (also hydrates storyContext)
    await this.branch.reloadEntriesForCurrentBranch()

    // Reset all caches after loading
    this.generationContext.invalidateWordCountCache()
    this.chapter.invalidateChapterCache()

    log('Story loaded', {
      id: storyId,
      mode: storyData.mode,
      entries: this.entry.rawEntries.length,
      lorebookEntries: this.lorebook.lorebookEntries.length,
      chapters: this.chapter.chapters.length,
      checkpoints: checkpoints.length,
      branches: branches.length,
      currentBranchId: storyData.currentBranchId,
    })

    // Load persisted activation data for this story (stickiness tracking)
    await ui.loadActivationData(storyId)

    // Clear stale lorebook retrieval from previous story to prevent cross-story contamination
    ui.setLastLorebookRetrieval(null)

    // Set current story ID for retry backup tracking
    ui.setCurrentRetryStoryId(storyId)

    // Load retry state from DB if we don't have an in-memory backup for this story
    if (storyData.retryState) {
      ui.loadRetryBackupFromPersistent(storyId, storyData.retryState)
    }

    // Load style review state from DB
    ui.loadStyleReviewState(storyId, storyData.styleReviewState)

    // Validate and repair chapter integrity (handles orphaned references)
    await this.chapter.validateChapterIntegrity()

    // Load persisted action choices for adventure mode
    if (storyData.mode === 'adventure') {
      await ui.loadActionChoices(storyId)
    }

    // Load persisted suggestions for creative-writing mode
    if (storyData.mode === 'creative-writing') {
      await ui.loadSuggestions(storyId)
    }

    // Set mobile-friendly defaults (close sidebar, etc.)
    ui.setMobileDefaults()

    // Emit event
    emitStoryLoaded(storyId, storyData.mode)
  }

  async createStory(
    title: string,
    templateId?: string,
    genre?: string,
    mode: StoryMode = 'adventure',
  ): Promise<Story> {
    const storyData = await database.createStory({
      id: crypto.randomUUID(),
      title,
      description: null,
      genre: genre ?? null,
      templateId: templateId ?? null,
      mode,
      settings: null,
      memoryConfig: DEFAULT_MEMORY_CONFIG,
      retryState: null,
      styleReviewState: null,
      timeTracker: null,
      currentBranchId: null,
      currentBgImage: null,
    })

    this.allStories = [storyData, ...this.allStories]

    // Set root fields
    this.id = storyData.id
    this.title = storyData.title
    this.description = storyData.description
    this.genre = storyData.genre
    this.templateId = storyData.templateId
    this.mode = storyData.mode
    this.createdAt = storyData.createdAt
    this.updatedAt = storyData.updatedAt

    // Emit event
    eventBus.emit<StoryCreatedEvent>({ type: 'StoryCreated', storyId: storyData.id, mode })

    return storyData
  }

  /**
   * Reset mutable world state after a SillyTavern chat import.
   * Clears locations, items, story beats, and the time tracker.
   * Characters and lorebook entries are intentionally preserved.
   */
  async resetWorldStateAfterImport(): Promise<void> {
    if (!this.id) throw new Error('No story loaded')
    await database.resetWorldStateForImport(this.id)
    this.location.locations = []
    this.item.items = []
    this.storyBeat.storyBeats = []
    this.time.load(null)
  }

  /**
   * Restore suggested actions from the new last narration entry after time-travel (delete).
   * Returns true if saved actions were found and restored, false if regeneration is needed.
   */
  restoreSuggestedActionsAfterDelete(): boolean {
    if (!this.id) return false

    // Find the new last narration entry (actions attach to narration entries)
    const lastNarration = [...this.entry.rawEntries].reverse().find((e) => e.type === 'narration')

    const storyMode = this.mode
    const storyId = this.id

    if (lastNarration) {
      const restored = ui.restoreSuggestedActionsFromEntry(
        storyMode,
        lastNarration.suggestedActions,
        storyId,
      )
      if (restored) {
        log('Restored suggested actions from entry at position', lastNarration.position)
        return true
      }
    }

    // No saved actions found — clear current ones so stale actions don't persist
    if (storyMode === 'adventure') {
      ui.clearActionChoices(storyId)
    } else {
      ui.clearSuggestions(storyId)
    }
    // Request auto-regeneration from the UI component
    ui.suggestionsRegenerationNeeded = true
    log('No saved suggested actions found after delete — requesting regeneration')
    return false
  }

  /**
   * Refresh world state (characters, locations, items, story beats) from the database.
   * Used when background processes update translations.
   */
  async refreshWorldState(): Promise<void> {
    if (!this.id) return

    const storyId = this.id
    const branchId = this.branch.currentBranchId

    let characters: Character[]
    let locations: Location[]
    let items: Item[]
    let storyBeats: StoryBeat[]

    if (branchId && settings.experimentalFeatures.lightweightBranches) {
      const currentBranch = this.branch.branches.find((b) => b.id === branchId)
      if (currentBranch?.snapshotComplete) {
        // Snapshot isolation: branch has its own complete entity set
        ;[characters, locations, items, storyBeats] = await Promise.all([
          database.getCharactersForBranch(storyId, branchId),
          database.getLocationsForBranch(storyId, branchId),
          database.getItemsForBranch(storyId, branchId),
          database.getStoryBeatsForBranch(storyId, branchId),
        ])
      } else {
        // Legacy COW: resolve through lineage (pre-snapshot branches)
        const lineage = this.branch.buildBranchLineage(branchId)
        ;[characters, locations, items, storyBeats] = await Promise.all([
          database.getCharactersResolved(storyId, lineage),
          database.getLocationsResolved(storyId, lineage),
          database.getItemsResolved(storyId, lineage),
          database.getStoryBeatsResolved(storyId, lineage),
        ])
      }
    } else if (branchId) {
      // Legacy branch: direct loading
      ;[characters, locations, items, storyBeats] = await Promise.all([
        database.getCharactersForBranch(storyId, branchId),
        database.getLocationsForBranch(storyId, branchId),
        database.getItemsForBranch(storyId, branchId),
        database.getStoryBeatsForBranch(storyId, branchId),
      ])
    } else {
      // Main branch — only load entities with null branch_id
      ;[characters, locations, items, storyBeats] = await Promise.all([
        database.getCharactersForBranch(storyId, null),
        database.getLocationsForBranch(storyId, null),
        database.getItemsForBranch(storyId, null),
        database.getStoryBeatsForBranch(storyId, null),
      ])
    }

    this.character.characters = characters
    this.location.locations = locations
    this.item.items = items
    this.storyBeat.storyBeats = storyBeats

    // Filter out tombstoned entities when COW is enabled
    // (COW resolution already handles this for branch paths, but main branch loads raw data)
    if (settings.experimentalFeatures.lightweightBranches) {
      this.character.characters = this.character.characters.filter((c) => !c.deleted)
      this.location.locations = this.location.locations.filter((l) => !l.deleted)
      this.item.items = this.item.items.filter((i) => !i.deleted)
      this.storyBeat.storyBeats = this.storyBeat.storyBeats.filter((b) => !b.deleted)
    }

    log('World state refreshed', {
      characters: characters.length,
      locations: locations.length,
      items: items.length,
      storyBeats: storyBeats.length,
    })
  }

  clearCurrentStory(): void {
    this.id = null
    this.title = null
    this.description = null
    this.genre = null
    this.templateId = null
    this.mode = 'adventure'
    this.createdAt = 0
    this.updatedAt = 0
    this.image.clear()
    this.settings.clear()
    this.time.clear()
    this.branch.currentBranchId = null
    this.checkpoint.checkpoints = []
    this.branch.branches = []
    this.generationContext.clear()

    // Clear current retry story ID (backups are kept per-story)
    ui.setCurrentRetryStoryId(null)

    // Clear style review state (will be loaded fresh for next story)
    ui.clearStyleReviewState()
  }

  async setStoryMode(mode: StoryMode): Promise<void> {
    if (!this.id) throw new Error('No story loaded')

    await database.updateStory(this.id, { mode })
    this.mode = mode
    log('Story mode updated:', mode)

    // Emit event
    emitModeChanged(mode)
  }

  /**
   * Phase 1: Maybe create an automatic world state snapshot.
   * Called after saving a delta. Creates a snapshot every N entries (configured interval).
   */
  async maybeCreateAutoSnapshot(entryId: string): Promise<void> {
    if (!this.id) return
    if (!settings.experimentalFeatures.stateTracking) return

    const entry = this.entry.rawEntries.find((e) => e.id === entryId)
    if (!entry) return

    const interval = settings.experimentalFeatures.autoSnapshotInterval
    if (interval <= 0) return

    // Only snapshot at interval boundaries
    if (entry.position % interval !== 0) return

    const branchId = this.branch.currentBranchId

    try {
      const snapshot: WorldStateSnapshot = {
        id: crypto.randomUUID(),
        storyId: this.id,
        branchId,
        entryId,
        entryPosition: entry.position,
        charactersSnapshot: this.character.characters.map((c) => ({ ...c })),
        locationsSnapshot: this.location.locations.map((l) => ({ ...l })),
        itemsSnapshot: this.item.items.map((i) => ({ ...i })),
        storyBeatsSnapshot: this.storyBeat.storyBeats.map((b) => ({ ...b })),
        lorebookEntriesSnapshot: this.lorebook.lorebookEntries.map((e) => ({ ...e })),
        timeTrackerSnapshot: { ...this.time.timeTracker },
        createdAt: Date.now(),
      }

      await database.createWorldStateSnapshot(snapshot)
      log('Auto-snapshot created at position', entry.position)
    } catch (error) {
      console.error('[StoryStore] Failed to create auto-snapshot:', error)
      // Non-fatal
    }
  }

  async deleteStory(storyId: string): Promise<void> {
    await database.deleteStory(storyId)
    this.allStories = this.allStories.filter((s) => s.id !== storyId)

    if (this.id === storyId) {
      this.clearCurrentStory()
    }
  }

  /**
   * Create a new story from wizard data.
   * This handles the full initialization from the setup wizard including
   * dynamically generated settings, protagonist, characters, and opening scene.
   */
  async createStoryFromWizard(data: {
    title: string
    genre: string
    description?: string
    mode: StoryMode
    settings: {
      pov: 'first' | 'second' | 'third'
      tense: 'past' | 'present'
      tone?: string
      themes?: string[]
      visualProseMode?: boolean
      imageGenerationMode?: 'none' | 'agentic' | 'inline'
      backgroundImagesEnabled?: boolean
      referenceMode?: boolean
    }
    protagonist: Partial<Character>
    startingLocation: Partial<Location>
    initialItems: Partial<Item>[]
    openingScene: string
    characters: Partial<Character>[]
    importedEntries?: ImportedEntry[]
    // Translation data (optional)
    translations?: {
      language: string
      openingScene?: string
      protagonist?: {
        name?: string
        description?: string
        traits?: string[]
        visualDescriptors?: string[]
      }
      startingLocation?: { name?: string; description?: string }
      characters?: {
        [originalName: string]: {
          name?: string
          description?: string
          relationship?: string
          traits?: string[]
          visualDescriptors?: string[]
        }
      }
    }
  }): Promise<Story> {
    log('createStoryFromWizard called', {
      title: data.title,
      genre: data.genre,
      mode: data.mode,
      pov: data.settings.pov,
      visualProseMode: data.settings.visualProseMode,
      imageGenerationMode: data.settings.imageGenerationMode,
      backgroundImagesEnabled: data.settings.backgroundImagesEnabled,
      referenceMode: data.settings.referenceMode,
    })

    // Create the base story with custom system prompt stored in settings
    const storyData = await database.createStory({
      id: crypto.randomUUID(),
      title: data.title,
      description: data.description ?? null,
      genre: data.genre,
      templateId: 'wizard-generated',
      mode: data.mode,
      settings: {
        pov: data.settings.pov,
        tense: data.settings.tense,
        tone: data.settings.tone,
        themes: data.settings.themes,
        visualProseMode: data.settings.visualProseMode,
        imageGenerationMode: data.settings.imageGenerationMode,
        backgroundImagesEnabled: data.settings.backgroundImagesEnabled,
        referenceMode: data.settings.referenceMode,
      },
      memoryConfig: DEFAULT_MEMORY_CONFIG,
      retryState: null,
      styleReviewState: null,
      timeTracker: null,
      currentBranchId: null,
      currentBgImage: null,
    })

    this.allStories = [storyData, ...this.allStories]
    const storyId = storyData.id

    // Set root fields
    this.id = storyData.id
    this.title = storyData.title
    this.description = storyData.description
    this.genre = storyData.genre
    this.templateId = storyData.templateId
    this.mode = storyData.mode
    this.createdAt = storyData.createdAt
    this.updatedAt = storyData.updatedAt
    this.settings.load(storyData.settings, storyData.memoryConfig)
    this.branch.currentBranchId = storyData.currentBranchId
    this.time.load(storyData.timeTracker)

    // Add protagonist
    if (data.protagonist.name) {
      const protagonistTranslation = data.translations?.protagonist
      const protagonist: Character = {
        id: crypto.randomUUID(),
        storyId,
        name: data.protagonist.name,
        description: data.protagonist.description ?? null,
        relationship: 'self',
        traits: data.protagonist.traits ?? [],
        status: 'active',
        metadata: { source: 'wizard' },
        visualDescriptors: data.protagonist.visualDescriptors ?? {},
        portrait: data.protagonist.portrait ?? null,
        branchId: null, // New stories start on main branch
        translatedName: protagonistTranslation?.name ?? null,
        translatedDescription: protagonistTranslation?.description ?? null,
        translatedTraits: protagonistTranslation?.traits ?? null,
        translatedVisualDescriptors: undefined, // Translations not supported for structured visual descriptors yet
        translationLanguage: protagonistTranslation ? (data.translations?.language ?? null) : null,
      }
      await database.addCharacter(protagonist)
      log('Added protagonist:', protagonist.name)
    }

    // Add starting location
    if (data.startingLocation.name) {
      const locationTranslation = data.translations?.startingLocation
      log('Starting location translation data:', {
        hasTranslations: !!data.translations,
        hasStartingLocation: !!locationTranslation,
        translatedName: locationTranslation?.name,
        translatedDesc: locationTranslation?.description?.substring(0, 50),
      })
      const location: Location = {
        id: crypto.randomUUID(),
        storyId,
        name: data.startingLocation.name,
        description: data.startingLocation.description ?? null,
        visited: true,
        current: true,
        connections: [],
        metadata: { source: 'wizard' },
        branchId: null, // New stories start on main branch
        translatedName: locationTranslation?.name ?? null,
        translatedDescription: locationTranslation?.description ?? null,
        translationLanguage: locationTranslation ? (data.translations?.language ?? null) : null,
      }
      log('Location object being stored:', {
        name: location.name,
        translatedName: location.translatedName,
        translatedDesc: location.translatedDescription?.substring(0, 50),
        translationLanguage: location.translationLanguage,
      })
      await database.addLocation(location)
      log(
        'Added starting location:',
        location.name,
        'with translation:',
        !!location.translatedDescription,
      )
    }

    // Add initial items
    for (const itemData of data.initialItems) {
      if (!itemData.name) continue
      const item: Item = {
        id: crypto.randomUUID(),
        storyId,
        name: itemData.name,
        description: itemData.description ?? null,
        quantity: itemData.quantity ?? 1,
        equipped: itemData.equipped ?? false,
        location: itemData.location ?? 'inventory',
        metadata: { source: 'wizard' },
        branchId: null, // New stories start on main branch
      }
      await database.addItem(item)
    }

    // Add supporting characters
    for (const charData of data.characters) {
      if (!charData.name) continue
      const charTranslation = data.translations?.characters?.[charData.name]
      const character: Character = {
        id: crypto.randomUUID(),
        storyId,
        name: charData.name,
        description: charData.description ?? null,
        relationship: charData.relationship ?? null,
        traits: charData.traits ?? [],
        status: 'active',
        metadata: { source: 'wizard' },
        visualDescriptors: charData.visualDescriptors ?? {},
        portrait: charData.portrait ?? null,
        branchId: null, // New stories start on main branch
        translatedName: charTranslation?.name ?? null,
        translatedDescription: charTranslation?.description ?? null,
        translatedRelationship: charTranslation?.relationship ?? null,
        translatedTraits: charTranslation?.traits ?? null,
        translatedVisualDescriptors: undefined, // Translations not supported for structured visual descriptors yet
        translationLanguage: charTranslation ? (data.translations?.language ?? null) : null,
      }
      await database.addCharacter(character)
      log('Added supporting character:', character.name)
    }

    // Add opening scene as first narration entry
    let openingEntry: StoryEntry | undefined = undefined
    if (data.openingScene) {
      const tokenCount = countTokens(data.openingScene)
      const baseTime = storyData.timeTracker ?? { years: 0, days: 0, hours: 0, minutes: 0 }
      openingEntry = await database.addStoryEntry({
        id: crypto.randomUUID(),
        storyId,
        type: 'narration',
        content: data.openingScene,
        parentId: null,
        position: 0,
        metadata: {
          source: 'wizard',
          tokenCount,
          timeStart: { ...baseTime },
          timeEnd: { ...baseTime },
        },
        branchId: null,
        translatedContent: data.translations?.openingScene ?? null,
        translationLanguage: data.translations?.openingScene
          ? (data.translations?.language ?? null)
          : null,
      })
      log('Added opening scene')
    }

    // Add imported lorebook entries
    if (data.importedEntries && data.importedEntries.length > 0) {
      const entries = convertToEntries(data.importedEntries, 'import')
      for (const entryData of entries) {
        const entry: Entry = {
          ...entryData,
          id: crypto.randomUUID(),
          storyId,
        }
        await database.addEntry(entry)
      }
      log('Added imported entries:', data.importedEntries.length)
    }

    // Emit event
    eventBus.emit<StoryCreatedEvent>({ type: 'StoryCreated', storyId, mode: data.mode })

    log('Story created from wizard:', storyId)
    return storyData
  }
}

export const story = new StoryStore()
export type { StoryStore }
