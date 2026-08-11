import type {
  ActivePanel,
  SidebarTab,
  EntryType,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  ActionInputType,
  PersistentStyleReviewState,
  PersistentStyleReviewResult,
  TimeTracker,
  EmbeddedImageMeta,
  PersistentCharacterSnapshot,
} from '$lib/types'
import * as z from 'zod'
import type { ActionChoice } from '$lib/services/ai/sdk/schemas/actionchoices'
import type { Suggestion } from '$lib/services/ai/sdk/schemas/suggestions'
import { actionChoiceSchema, suggestionSchema } from '$lib/services/ai/sdk/schemas'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type {
  EntryRetrievalResult,
  ActivationTracker,
} from '$lib/services/ai/retrieval/EntryRetrievalService'
import type { RetrievalResult } from '$lib/services/generation/types'
import type { WorldStateInjectionResult } from '$lib/services/ai/generation/WorldStateInjector'

/** What a cached retrieval result was computed for. All four must match to reuse it. */
export interface RetrievalCacheKey {
  storyId: string
  branchId: string | null
  /** `story.entries.length` when retrieval ran, the user action included. */
  position: number
  actionContent: string
}
import type { SyncMode } from '$lib/types/sync'
import { SimpleActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
import { database } from '$lib/services/database'
import { eventBus, type EventType } from '$lib/services/events'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { StreamingHtmlRenderer } from '$lib/utils/htmlStreaming'
import { countTokens } from '$lib/services/tokenizer'
import { branchScopeKey } from '$lib/utils/branchScope'

export type VaultTab = 'characters' | 'lorebooks' | 'scenarios' | 'prompts'

// Backup for retry functionality - captures state before each user message
export interface RetryBackup {
  storyId: string
  timestamp: number
  // State snapshots (captured BEFORE user action is added)
  // These may be empty if loaded from persistent storage (entry-only restore)
  entries: StoryEntry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  // The user's input to re-trigger
  userActionContent: string
  rawInput: string
  actionType: ActionInputType
  wasRawActionChoice: boolean
  // Lorebook activation tracking data (for stickiness preservation)
  activationData: Record<string, number>
  storyPosition: number
  // Next entry position at time of backup - used for entry-only restore
  entryCountBeforeAction: number
  // Flag indicating if this has full state snapshots (in-memory) or just entry data (from DB)
  hasFullState: boolean
  // Flag indicating if entity ID snapshots are present for safe cleanup
  hasEntityIds: boolean
  // Entity IDs for persistent restore - delete any entities not in these lists
  characterIds: string[]
  locationIds: string[]
  itemIds: string[]
  storyBeatIds: string[]
  embeddedImageIds?: string[]
  characterSnapshots?: PersistentCharacterSnapshot[]
  // Time tracker snapshot (undefined means "don't restore", null means "clear it")
  timeTracker: TimeTracker | null | undefined
}

// Error state for retry functionality
export interface GenerationError {
  message: string
  errorEntryId: string
  userActionEntryId: string
  timestamp: number
}

// Persisted action choices structure
interface PersistedActionChoices {
  storyId: string
  choices: ActionChoice[]
}

// Persisted suggestions structure
interface PersistedSuggestions {
  storyId: string
  suggestions: Suggestion[]
}

// Persisted activation data structure (for lorebook stickiness)
interface PersistedActivationData {
  storyId: string
  activationData: Record<string, number>
  storyPosition: number
}

// UI State using Svelte 5 runes
class UIStore {
  activePanel = $state<ActivePanel>('story')
  sidebarTab = $state<SidebarTab>('characters')
  sidebarOpen = $state(typeof window !== 'undefined' ? window.innerWidth >= 640 : false)
  settingsModalOpen = $state(false)
  isGenerating = $state(false)
  isRetryingLastMessage = $state(false) // Hide stop button during completed-message retries
  vaultTab = $state<VaultTab>('characters')

  // Image generation state. Both are counts, because the narration analysis and the
  // background-image analysis run concurrently: as a boolean, whichever finished first
  // cleared the other one's indicator.
  private analysesRunning = $state(0) // LLM analyzing narrative for imageable scenes
  imagesGenerating = $state(0) // Count of images currently being generated

  get imageAnalysisInProgress(): boolean {
    return this.analysesRunning > 0
  }

  private imageTrackingCleanup: (() => void) | null = null

  // Gallery image cache - persists across component unmounts
  private galleryImageCache = new SvelteMap<string, EmbeddedImageMeta[]>()

  // Streaming state
  streamingContent = $state('')
  streamingReasoning = $state('')
  streamingReasoningTokens = $state(0)
  streamingContentTokens = $state(0)
  generationStatus = $state('') // Status message during generation steps (e.g. "Retrieving memories...")
  isStreaming = $state(false)
  private htmlRenderer: StreamingHtmlRenderer | null = null
  private visualProseEntryId: string | null = null
  private tokenCountInterval: ReturnType<typeof setInterval> | null = null

  // Scroll break state - persists until user sends a new message
  userScrolledUp = $state(false)

  // App visibility tracking (Android background generation)
  isAppBackgrounded = $state(false)
  wasBackgroundedDuringGeneration = $state(false)
  private visibilityCleanup: (() => void) | null = null

  // Error state for retry
  lastGenerationError = $state<GenerationError | null>(null)

  // Retry backups - per-story backups for "retry last message" feature
  // Stored by storyId so they persist across story switches within a session
  private retryBackups = new SvelteMap<string, RetryBackup>()
  private currentRetryStoryId = $state<string | null>(null)
  retryStateWrite = Promise.resolve()

  // Computed getter for current story's retry backup
  get retryBackup(): RetryBackup | null {
    if (!this.currentRetryStoryId) {
      return null
    }
    const backup = this.retryBackups.get(this.currentRetryStoryId) ?? null
    return backup
  }

  /**
   * Set the current story ID for retry backup tracking.
   * Called when switching stories to ensure the correct backup is returned.
   */
  setCurrentRetryStoryId(storyId: string | null) {
    this.currentRetryStoryId = storyId
  }

  // Gallery image cache methods
  getGalleryImages(storyId: string): EmbeddedImageMeta[] | undefined {
    return this.galleryImageCache.get(storyId)
  }

  setGalleryImages(storyId: string, images: EmbeddedImageMeta[]): void {
    this.galleryImageCache.set(storyId, images)
  }

  hasGalleryImages(storyId: string): boolean {
    return this.galleryImageCache.has(storyId)
  }

  clearGalleryImages(storyId: string): void {
    this.galleryImageCache.delete(storyId)
  }

  // RPG action choices (displayed after narration)
  actionChoices = $state<ActionChoice[]>([])
  actionChoicesLoading = $state(false)
  pendingActionChoice = $state<string | null>(null)

  // Creative writing suggestions (displayed after narration)
  suggestions = $state<Suggestion[]>([])
  suggestionsLoading = $state(false)

  // Flag to request auto-regeneration of suggestions/actions after time-travel delete
  // when no saved actions were found on the restored entry
  suggestionsRegenerationNeeded = $state(false)

  // Style reviewer state
  messagesSinceLastStyleReview = $state(0)
  lastStyleReview = $state<StyleReviewResult | null>(null)
  styleReviewLoading = $state(false)
  private currentStyleReviewStoryId = $state<string | null>(null)
  styleReviewStateWrite = Promise.resolve()

  // Cached retrieval result, reused by retry and regenerate to skip the whole phase.
  lastRetrievalResult = $state<RetrievalResult | null>(null)
  private lastRetrievalKey: RetrievalCacheKey | null = null

  // Lorebook debug state
  lastLorebookRetrieval = $state<EntryRetrievalResult | null>(null)
  lastWorldStateRetrieval = $state<WorldStateInjectionResult | null>(null)
  lorebookDebugOpen = $state(false)

  // Lorebook manager state
  selectedLorebookEntryId = $state<string | null>(null)
  lorebookEditMode = $state(false)
  lorebookBulkSelection = $state<Set<string>>(new Set())
  lorebookSearchQuery = $state('')
  lorebookTypeFilter = $state<EntryType | 'all'>('all')
  lorebookSortBy = $state<'name' | 'type' | 'updated'>('name')
  lorebookImportModalOpen = $state(false)
  lorebookExportModalOpen = $state(false)
  // Mobile: track if we're viewing detail (for stacked navigation)
  lorebookShowDetail = $state(false)

  // Memory panel state
  memoryEditingChapterId = $state<string | null>(null)
  memoryExpandedChapterId = $state<string | null>(null)
  memorySettingsOpen = $state(false)
  manualChapterModalOpen = $state(false)
  resummarizeModalOpen = $state(false)
  resummarizeChapterId = $state<string | null>(null)
  memoryLoading = $state(false)

  // Sync modal state
  syncModalOpen = $state(false)
  syncMode = $state<SyncMode>('select')

  // SillyTavern chat import modal state
  stChatImportModalOpen = $state(false)

  // Lore management mode state
  // When active, the AI is reviewing/updating the lorebook - user editing is locked
  /**
   * Branches whose background tasks — chapter threshold check, lore management, style
   * review — are still running, as `storyId:branchId`.
   *
   * They create chapters, so the Memory view must not offer to create one at the same time:
   * two chapters built from overlapping ranges of the same entries. Per branch rather than
   * global, because chapters belong to a branch and two branches never collide.
   *
   * A **count**, not a flag: the run is not awaited, so turns overlap and a flag would be
   * cleared by whichever finished first, marking the branch idle with work still in flight.
   */
  backgroundTaskBranches = $state<SvelteMap<string, number>>(new SvelteMap())
  loreManagementActive = $state(false)
  loreManagementProgress = $state('')
  loreManagementChanges = $state<number>(0)
  /**
   * What the last session reported it did, kept after the run ends.
   *
   * It is the only account of what changed in the lorebook, and it used to live in the
   * progress line and be wiped two seconds later — long enough to notice, not to read.
   */
  lastLoreManagementSummary = $state<string | null>(null)
  lastLoreManagementChanges = $state<number>(0)

  // Lorebook activation tracking for stickiness
  // Maps entry ID -> last activation position (story entry index)
  private activationData = $state<Record<string, number>>({})
  private currentStoryPosition = $state(0)

  // Retry callback - set by ActionInput
  private retryCallback: (() => Promise<void>) | null = null

  // Retry last message callback - set by ActionInput for edit-and-retry feature
  private retryLastMessageCallback: (() => Promise<void>) | null = null

  // Regenerate narration callback - set by ActionInput. Lighter-weight fallback used when
  // no full retry backup is available (e.g. the latest narration survived a manual delete
  // of the entries that came after it).
  private regenerateNarrationCallback: ((entryId: string) => Promise<void>) | null = null

  // Reasoning block state persistence
  streamingReasoningExpanded = $state(false)
  expandedReasoningIds = new SvelteSet<string>()

  // Sidebar widget collapsed state (session-only)
  // Maps entity ID -> true if expanded
  expandedEntities = new SvelteMap<string, boolean>()

  setStreamingReasoningExpanded(expanded: boolean) {
    this.streamingReasoningExpanded = expanded
  }

  isReasoningExpanded(entryId: string): boolean {
    return this.expandedReasoningIds.has(entryId)
  }

  toggleReasoningExpanded(entryId: string, expanded: boolean) {
    if (expanded) {
      this.expandedReasoningIds.add(entryId)
    } else {
      this.expandedReasoningIds.delete(entryId)
    }
  }

  // Sidebar widget collapse methods
  isEntityCollapsed(entityId: string): boolean {
    return !this.expandedEntities.has(entityId)
  }

  toggleEntityCollapsed(entityId: string, collapsed: boolean) {
    if (collapsed) {
      this.expandedEntities.delete(entityId)
    } else {
      this.expandedEntities.set(entityId, true)
    }
  }

  /**
   * Transfer streaming expansion state to a specific entry ID (called when generation finishes).
   * Only transfers if streaming was actually expanded.
   */
  transferStreamingReasoningState(entryId: string) {
    if (this.streamingReasoningExpanded) {
      this.expandedReasoningIds.add(entryId)
      this.streamingReasoningExpanded = false
    }
  }

  setActivePanel(panel: ActivePanel) {
    this.activePanel = panel
  }

  setSidebarTab(tab: SidebarTab) {
    this.sidebarTab = tab
  }

  setVaultTab(tab: VaultTab) {
    this.vaultTab = tab
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen
    database
      .setSetting('sidebar_open', this.sidebarOpen.toString())
      .catch((err) => console.warn('[UI] Failed to persist sidebar state:', err))
  }

  /**
   * Set mobile-friendly defaults when opening a story.
   * Closes sidebar and other expanded elements on mobile to reduce clutter.
   */
  setMobileDefaults() {
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      this.sidebarOpen = false
      // No DB persist — this is a layout constraint, not a user preference.
      // Persisting here would overwrite the desktop sidebar preference.
    }
  }

  openSettings() {
    this.settingsModalOpen = true
  }

  closeSettings() {
    this.settingsModalOpen = false
  }

  setGenerating(value: boolean) {
    this.isGenerating = value
    if (!value) {
      this.generationStatus = ''
    }
  }

  setGenerationStatus(status: string) {
    this.generationStatus = status
  }

  setRetryingLastMessage(value: boolean) {
    this.isRetryingLastMessage = value
  }

  /**
   * Track image analysis/generation progress off the event bus.
   *
   * This lived in `Header.svelte` — the only component that reads the counts — which made
   * app-wide bookkeeping depend on a component staying mounted, and made adding an event
   * three edits instead of one. That is how the `*Failed` events came to be missed.
   *
   * Every pair below is exact at the emitting end: a `Started` is always followed by one
   * `Complete` and a `Queued` by one `Ready`, on the failure paths too. `ImageAnalysisFailed`
   * is deliberately absent: it is emitted for a failed *generation* as well, where no
   * analysis is open, so counting it would close an analysis that never started.
   */
  initImageTracking() {
    if (this.imageTrackingCleanup) return

    const endAnalysis = () => {
      this.analysesRunning = Math.max(0, this.analysesRunning - 1)
    }
    const endImage = () => {
      this.imagesGenerating = Math.max(0, this.imagesGenerating - 1)
    }

    const handlers: [EventType, () => void][] = [
      ['ImageAnalysisStarted', () => this.analysesRunning++],
      ['ImageAnalysisComplete', endAnalysis],
      ['BackgroundImageAnalysisStarted', () => this.analysesRunning++],
      ['BackgroundImageAnalysisComplete', endAnalysis],
      ['ImageQueued', () => this.imagesGenerating++],
      ['ImageReady', endImage],
      ['BackgroundImageQueued', () => this.imagesGenerating++],
      ['BackgroundImageReady', endImage],
    ]

    const unsubscribes = handlers.map(([type, handler]) => eventBus.subscribe(type, handler))
    this.imageTrackingCleanup = () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }

  /** Clean up the image tracking listeners. */
  destroyImageTracking() {
    this.imageTrackingCleanup?.()
    this.imageTrackingCleanup = null
  }

  resetImageGenerationState() {
    this.analysesRunning = 0
    this.imagesGenerating = 0
  }

  // Streaming methods
  startStreaming(visualProseMode = false, entryId?: string) {
    // Ensure any existing interval is cleared to prevent leaks
    if (this.tokenCountInterval) {
      clearInterval(this.tokenCountInterval)
      this.tokenCountInterval = null
    }

    this.isStreaming = true
    this.streamingContent = ''
    this.streamingReasoning = ''
    this.streamingReasoningTokens = 0
    this.streamingContentTokens = 0
    if (visualProseMode && entryId) {
      this.htmlRenderer = new StreamingHtmlRenderer(entryId)
      this.visualProseEntryId = entryId
    } else {
      this.htmlRenderer = null
      this.visualProseEntryId = null
    }
    // Start periodic token counting (every 500ms to avoid performance issues)
    this.tokenCountInterval = setInterval(() => {
      this.updateStreamingTokenCount()
    }, 500)
  }

  private updateStreamingTokenCount() {
    const contentToCount = this.htmlRenderer
      ? this.htmlRenderer.getRawContent()
      : this.streamingContent
    this.streamingReasoningTokens = countTokens(this.streamingReasoning)
    this.streamingContentTokens = countTokens(contentToCount)
  }

  appendStreamContent(content: string) {
    if (this.htmlRenderer) {
      this.streamingContent = this.htmlRenderer.append(content)
    } else {
      this.streamingContent += content
    }
  }

  appendReasoningContent(content: string) {
    this.streamingReasoning += content
  }

  endStreaming(): string {
    // Clear token count interval
    if (this.tokenCountInterval) {
      clearInterval(this.tokenCountInterval)
      this.tokenCountInterval = null
    }
    // Final token count update
    this.updateStreamingTokenCount()

    let finalContent: string
    if (this.htmlRenderer) {
      finalContent = this.htmlRenderer.getRawContent()
      this.htmlRenderer = null
      this.visualProseEntryId = null
    } else {
      finalContent = this.streamingContent
    }
    this.isStreaming = false
    this.streamingContent = ''
    return finalContent
  }

  /**
   * Check if currently streaming in Visual Prose mode.
   */
  isVisualProseStreaming(): boolean {
    return this.htmlRenderer !== null
  }

  /**
   * Get the Visual Prose entry ID if currently streaming in Visual Prose mode.
   */
  getVisualProseEntryId(): string | null {
    return this.visualProseEntryId
  }

  // Scroll break methods - user scrolled away during generation
  setScrollBreak(value: boolean) {
    this.userScrolledUp = value
  }

  resetScrollBreak() {
    this.userScrolledUp = false
  }

  getStreamingContent(): string {
    return this.streamingContent
  }

  // Error handling methods
  setGenerationError(error: GenerationError) {
    this.lastGenerationError = error
  }

  clearGenerationError() {
    this.lastGenerationError = null
  }

  // Retry backup methods

  /**
   * Create a backup of the current story state before a user message.
   * This captures the state BEFORE the user action is added, so we can restore to this point.
   * Also captures lorebook activation data for stickiness preservation.
   * Persists a lightweight version to the database for cross-session retry.
   */
  createRetryBackup(
    storyId: string,
    entries: StoryEntry[],
    characters: Character[],
    locations: Location[],
    items: Item[],
    storyBeats: StoryBeat[],
    embeddedImageIds: string[],
    userActionContent: string,
    rawInput: string,
    actionType: ActionInputType,
    wasRawActionChoice: boolean,
    timeTracker: TimeTracker | null,
  ) {
    const timestamp = Date.now()
    const nextEntryPosition =
      entries.reduce((max, entry) => Math.max(max, entry.position ?? -1), -1) + 1

    // Extract entity IDs for persistent restore
    const characterIds = characters.map((c) => c.id)
    const locationIds = locations.map((l) => l.id)
    const itemIds = items.map((i) => i.id)
    const storyBeatIds = storyBeats.map((sb) => sb.id)
    const characterSnapshots: PersistentCharacterSnapshot[] = characters.map((c) => ({
      id: c.id,
      traits: [...(c.traits ?? [])],
      status: c.status,
      relationship: c.relationship ?? null,
      visualDescriptors: { ...(c.visualDescriptors ?? {}) },
      portrait: c.portrait,
    }))

    // Create new backup and store by story ID
    // PERFORMANCE OPTIMIZATION: Avoid expensive JSON.parse(JSON.stringify()) for large data
    //
    // Why this is safe:
    // - Svelte's reactivity pattern always creates NEW arrays on mutation
    //   (e.g., `this.entries = [...this.entries, newEntry]`)
    // - Individual objects are replaced, not mutated in place
    //   (e.g., `this.entries = this.entries.map(e => e.id === id ? {...e, content} : e)`)
    // - Therefore, storing a reference to the current array is safe - the array won't be mutated
    //
    // For entries and embeddedImages (large data), we store direct references
    // For smaller objects, we use shallow copies to break any Svelte proxy chains

    // Shallow copy helper - breaks proxy chains without expensive serialization
    const shallowCopyArray = <T extends object>(arr: T[]): T[] => arr.map((item) => ({ ...item }))

    // For characters, also copy nested arrays/objects (traits, visualDescriptors)
    const copyCharacters = (chars: Character[]): Character[] =>
      chars.map((c) => ({
        ...c,
        traits: [...(c.traits || [])],
        visualDescriptors: { ...(c.visualDescriptors || {}) },
      }))

    // For locations, copy connections array
    const copyLocations = (locs: Location[]): Location[] =>
      locs.map((l) => ({
        ...l,
        connections: [...(l.connections || [])],
      }))

    const backup: RetryBackup = {
      storyId,
      timestamp,
      // Large data - shallow copy to break potential proxy chains
      entries: [...entries],
      // Smaller data - shallow copy to break proxy chains
      characters: copyCharacters(characters),
      locations: copyLocations(locations),
      items: shallowCopyArray(items),
      storyBeats: shallowCopyArray(storyBeats),
      characterSnapshots,
      userActionContent,
      rawInput,
      actionType,
      wasRawActionChoice,
      // Capture activation data for lorebook stickiness preservation
      // Use Object.fromEntries/entries to ensure a plain object copy from $state proxy
      activationData: Object.fromEntries(Object.entries(this.activationData)),
      storyPosition: this.currentStoryPosition,
      // New fields for persistent retry
      entryCountBeforeAction: nextEntryPosition,
      hasFullState: true,
      hasEntityIds: true,
      // Entity IDs for persistent restore
      characterIds,
      locationIds,
      itemIds,
      storyBeatIds,
      embeddedImageIds,
      // Time tracker snapshot
      timeTracker: timeTracker ? { ...timeTracker } : null,
    }
    // Debug: Log character visual descriptors at backup time (before storing)
    const charDescriptorsAtBackup = characters.map((c) => ({
      name: c.name,
      visualDescriptors: c.visualDescriptors,
    }))
    const charDescriptorsInBackup = backup.characters.map((c) => ({
      name: c.name,
      visualDescriptors: c.visualDescriptors,
    }))
    console.log('[UI] BACKUP DEBUG - Character descriptors at creation:', {
      charDescriptorsAtBackup,
      charDescriptorsInBackup,
      areIdentical:
        JSON.stringify(charDescriptorsAtBackup) === JSON.stringify(charDescriptorsInBackup),
    })

    this.retryBackups.set(storyId, backup)
    this.currentRetryStoryId = storyId

    // Debug: Verify the stored backup is correct immediately after storing
    const storedBackup = this.retryBackups.get(storyId)
    if (storedBackup) {
      const storedCharDescriptors = storedBackup.characters.map((c) => ({
        name: c.name,
        visualDescriptors: c.visualDescriptors,
      }))
      console.log('[UI] BACKUP DEBUG - Verification after store:', {
        storedCharDescriptors,
        matchesOriginal:
          JSON.stringify(storedCharDescriptors) === JSON.stringify(charDescriptorsInBackup),
      })
    }

    // Persist lightweight version to database (includes entity IDs for full restore)
    this.queueRetryStateWrite(
      () =>
        database.saveRetryState(storyId, {
          timestamp,
          entryCountBeforeAction: nextEntryPosition,
          userActionContent,
          rawInput,
          actionType,
          wasRawActionChoice,
          characterIds,
          locationIds,
          itemIds,
          storyBeatIds,
          embeddedImageIds,
          characterSnapshots,
          timeTracker: timeTracker ? { ...timeTracker } : null,
          activationData: Object.fromEntries(Object.entries(this.activationData)),
          storyPosition: this.currentStoryPosition,
        }),
      'persist',
    )

    console.log('[UI] *** IN-MEMORY BACKUP CREATED (hasFullState: true) ***', {
      storyId,
      entriesCount: entries.length,
      charactersCount: characters.length,
      userAction: userActionContent.substring(0, 50),
      characterSnapshotsForPersist: characterSnapshots.map((s) => ({
        id: s.id,
        visualDescriptors: s.visualDescriptors,
      })),
    })
  }

  /**
   * Clear the retry backup for a story.
   * @param clearFromDb - If true, also clears from database (use for explicit dismissal/use).
   * @param storyId - Optional story ID. If not provided, clears the current story's backup.
   */
  clearRetryBackup(clearFromDb: boolean = false, storyId?: string) {
    const targetStoryId = storyId ?? this.currentRetryStoryId

    if (targetStoryId) {
      this.retryBackups.delete(targetStoryId)

      // Only clear from database if explicitly requested (user dismissed or used retry)
      if (clearFromDb) {
        this.queueRetryStateWrite(() => database.clearRetryState(targetStoryId), 'clear')
      }
    }

    console.log('[UI] Retry backup cleared', { clearFromDb, storyId: targetStoryId })
  }

  private queueRetryStateWrite(task: () => Promise<void>, label: string) {
    this.retryStateWrite = this.retryStateWrite
      .catch(() => {})
      .then(task)
      .catch((err) => {
        console.warn(`[UI] Failed to ${label} retry state:`, err)
      })
  }

  /**
   * Load retry backup from persistent state (called when a story is loaded).
   * Creates a partial RetryBackup with hasFullState=false for entity-aware restore.
   * Only loads if there isn't already an in-memory backup for this story.
   */
  loadRetryBackupFromPersistent(
    storyId: string,
    retryState: {
      timestamp: number
      entryCountBeforeAction: number
      userActionContent: string
      rawInput: string
      actionType: ActionInputType
      wasRawActionChoice: boolean
      characterIds?: string[]
      locationIds?: string[]
      itemIds?: string[]
      storyBeatIds?: string[]
      lorebookEntryIds?: string[]
      embeddedImageIds?: string[]
      characterSnapshots?: PersistentCharacterSnapshot[]
      timeTracker?: TimeTracker | null
      activationData?: Record<string, number>
      storyPosition?: number
    },
  ) {
    // Skip if we already have an in-memory backup for this story (it's more complete)
    if (this.retryBackups.has(storyId)) {
      const existing = this.retryBackups.get(storyId)
      console.log('[UI] Skipping persistent retry state load - in-memory backup exists', {
        storyId,
        existingHasFullState: existing?.hasFullState,
      })
      return
    }
    console.log('[UI] Loading persistent retry backup (no in-memory backup found)', { storyId })

    // Validate required fields exist
    if (
      typeof retryState.timestamp !== 'number' ||
      typeof retryState.entryCountBeforeAction !== 'number' ||
      typeof retryState.userActionContent !== 'string' ||
      typeof retryState.rawInput !== 'string' ||
      typeof retryState.actionType !== 'string' ||
      typeof retryState.wasRawActionChoice !== 'boolean'
    ) {
      console.warn('[UI] Invalid persistent retry state, skipping load', { storyId, retryState })
      return
    }

    const hasEntityIds =
      Array.isArray(retryState.characterIds) &&
      Array.isArray(retryState.locationIds) &&
      Array.isArray(retryState.itemIds) &&
      Array.isArray(retryState.storyBeatIds)

    const backup: RetryBackup = {
      storyId,
      timestamp: retryState.timestamp,
      // Empty state arrays - will use ID-based restore
      entries: [],
      characters: [],
      locations: [],
      items: [],
      storyBeats: [],
      // User input data
      userActionContent: retryState.userActionContent,
      rawInput: retryState.rawInput,
      actionType: retryState.actionType,
      wasRawActionChoice: retryState.wasRawActionChoice,
      // Restore activation data from persistent state if available
      activationData: retryState.activationData ?? {},
      storyPosition: retryState.storyPosition ?? 0,
      // Persistent retry fields
      entryCountBeforeAction: retryState.entryCountBeforeAction,
      hasFullState: false, // Indicates ID-based restore
      hasEntityIds,
      // Entity IDs for restore - delete any entities not in these lists
      characterIds: retryState.characterIds ?? [],
      locationIds: retryState.locationIds ?? [],
      itemIds: retryState.itemIds ?? [],
      storyBeatIds: retryState.storyBeatIds ?? [],
      embeddedImageIds: retryState.embeddedImageIds,
      characterSnapshots: retryState.characterSnapshots,
      // Time tracker snapshot (undefined means "skip restore", null means "clear")
      timeTracker: Object.prototype.hasOwnProperty.call(retryState, 'timeTracker')
        ? (retryState.timeTracker ?? null)
        : undefined,
    }
    this.retryBackups.set(storyId, backup)
    console.log('[UI] *** PERSISTENT BACKUP LOADED (hasFullState: false) ***', {
      storyId,
      entryCountBeforeAction: retryState.entryCountBeforeAction,
      userAction: retryState.userActionContent.substring(0, 50),
      characterSnapshotsCount: backup.characterSnapshots?.length ?? 0,
      characterSnapshots: backup.characterSnapshots?.map((s) => ({
        id: s.id,
        visualDescriptors: s.visualDescriptors,
      })),
    })
  }

  /**
   * Check if we have a valid retry backup for the current story.
   */
  hasRetryBackup(storyId: string): boolean {
    return this.retryBackup !== null && this.retryBackup.storyId === storyId
  }

  /**
   * Restore activation data from a backup.
   * Called during "retry last message" to preserve lorebook stickiness state.
   * This completely replaces the current activation data with the backup state.
   */
  restoreActivationData(activationData: Record<string, number>, storyPosition: number) {
    // Log what we're replacing (for debugging accumulation issues)
    const currentCount = Object.keys(this.activationData).length
    const backupCount = Object.keys(activationData).length

    // Completely replace activation data with a fresh copy from backup
    // This ensures any entries activated during the previous generation attempt are cleared
    this.activationData = Object.fromEntries(Object.entries(activationData))
    this.currentStoryPosition = storyPosition

    console.log('[UI] Activation data restored from backup', {
      previousEntriesCount: currentCount,
      restoredEntriesCount: backupCount,
      storyPosition,
      restoredEntryIds: Object.keys(this.activationData),
    })
  }

  /**
   * Update the user action content in the retry backup.
   * Used when editing the last user message to retry with new content.
   */
  updateRetryBackupContent(newContent: string) {
    const backup = this.retryBackup
    if (backup && this.currentRetryStoryId) {
      const updatedBackup: RetryBackup = {
        ...backup,
        userActionContent: newContent,
        rawInput: newContent,
      }
      this.retryBackups.set(this.currentRetryStoryId, updatedBackup)

      // Also persist the updated content to the database
      const storyId = this.currentRetryStoryId
      this.queueRetryStateWrite(
        () =>
          database.saveRetryState(storyId, {
            timestamp: backup.timestamp,
            entryCountBeforeAction: backup.entryCountBeforeAction,
            userActionContent: newContent,
            rawInput: newContent,
            actionType: backup.actionType,
            wasRawActionChoice: backup.wasRawActionChoice,
            characterIds: backup.characterIds,
            locationIds: backup.locationIds,
            itemIds: backup.itemIds,
            storyBeatIds: backup.storyBeatIds,
            embeddedImageIds: backup.embeddedImageIds,
            characterSnapshots: backup.characterSnapshots,
            timeTracker: backup.timeTracker,
          }),
        'update',
      )

      console.log('[UI] Retry backup content updated', {
        newContent: newContent.substring(0, 50),
      })
    }
  }

  // Action choices methods
  private getActionChoicesKey(storyId: string): string {
    return `action_choices:${storyId}`
  }

  setActionChoices(choices: ActionChoice[], storyId?: string) {
    this.actionChoices = choices
    // Persist to database if we have a story ID
    if (storyId && choices.length > 0) {
      const data: PersistedActionChoices = { storyId, choices }
      database.setSetting(this.getActionChoicesKey(storyId), JSON.stringify(data)).catch((err) => {
        console.warn('[UI] Failed to persist action choices:', err)
      })
    }
  }

  setActionChoicesLoading(loading: boolean) {
    this.actionChoicesLoading = loading
  }

  clearActionChoices(storyId?: string) {
    this.actionChoices = []
    // Clear persisted choices
    if (storyId) {
      database.setSetting(this.getActionChoicesKey(storyId), '').catch((err) => {
        console.warn('[UI] Failed to clear persisted action choices:', err)
      })
    } else {
      database.setSetting('action_choices', '').catch((err) => {
        console.warn('[UI] Failed to clear persisted action choices:', err)
      })
    }
  }

  /**
   * Load persisted action choices for a story.
   * Called when a story is loaded.
   */
  async loadActionChoices(storyId: string) {
    try {
      // Reset in-memory choices when switching stories
      this.actionChoices = []
      const data = await database.getSetting(this.getActionChoicesKey(storyId))
      if (data) {
        const parsed: PersistedActionChoices = JSON.parse(data)
        // Only restore if it's for the same story
        if (parsed.storyId === storyId && parsed.choices.length > 0) {
          this.actionChoices = parsed.choices
          console.log('[UI] Restored action choices for story:', storyId)
          return
        }
      }

      const legacyData = await database.getSetting('action_choices')
      if (legacyData) {
        const parsed: PersistedActionChoices = JSON.parse(legacyData)
        if (parsed.storyId === storyId && parsed.choices.length > 0) {
          this.actionChoices = parsed.choices
          database.setSetting(this.getActionChoicesKey(storyId), legacyData).catch((err) => {
            console.warn('[UI] Failed to migrate legacy action choices:', err)
          })
          console.log('[UI] Restored legacy action choices for story:', storyId)
        }
      }
    } catch (err) {
      console.warn('[UI] Failed to load persisted action choices:', err)
    }
  }

  setPendingActionChoice(text: string, _storyId?: string) {
    // Only set the pending choice text - don't clear action choices yet
    // They will be cleared when the message is actually sent (in handleSubmit)
    this.pendingActionChoice = text
  }

  clearPendingActionChoice() {
    this.pendingActionChoice = null
  }

  // Suggestions methods (creative writing mode)
  private getSuggestionsKey(storyId: string): string {
    return `story_suggestions:${storyId}`
  }

  setSuggestions(suggestions: Suggestion[], storyId?: string) {
    this.suggestions = suggestions
    // Persist to database if we have a story ID
    if (storyId && suggestions.length > 0) {
      const data: PersistedSuggestions = { storyId, suggestions }
      database.setSetting(this.getSuggestionsKey(storyId), JSON.stringify(data)).catch((err) => {
        console.warn('[UI] Failed to persist suggestions:', err)
      })
    }
  }

  setSuggestionsLoading(loading: boolean) {
    this.suggestionsLoading = loading
  }

  clearSuggestions(storyId?: string) {
    this.suggestions = []
    // Clear persisted suggestions
    if (storyId) {
      database.setSetting(this.getSuggestionsKey(storyId), '').catch((err) => {
        console.warn('[UI] Failed to clear persisted suggestions:', err)
      })
    } else {
      database.setSetting('story_suggestions', '').catch((err) => {
        console.warn('[UI] Failed to clear persisted suggestions:', err)
      })
    }
  }

  /**
   * Load persisted suggestions for a story.
   * Called when a story is loaded.
   */
  async loadSuggestions(storyId: string) {
    try {
      // Reset in-memory suggestions when switching stories
      this.suggestions = []
      const data = await database.getSetting(this.getSuggestionsKey(storyId))
      if (data) {
        const parsed: PersistedSuggestions = JSON.parse(data)
        // Only restore if it's for the same story
        if (parsed.storyId === storyId && parsed.suggestions.length > 0) {
          this.suggestions = parsed.suggestions
          console.log('[UI] Restored suggestions for story:', storyId)
          return
        }
      }

      const legacyData = await database.getSetting('story_suggestions')
      if (legacyData) {
        const parsed: PersistedSuggestions = JSON.parse(legacyData)
        if (parsed.storyId === storyId && parsed.suggestions.length > 0) {
          this.suggestions = parsed.suggestions
          database.setSetting(this.getSuggestionsKey(storyId), legacyData).catch((err) => {
            console.warn('[UI] Failed to migrate legacy suggestions:', err)
          })
          console.log('[UI] Restored legacy suggestions for story:', storyId)
        }
      }
    } catch (err) {
      console.warn('[UI] Failed to load persisted suggestions:', err)
    }
  }

  /**
   * Restore action choices or suggestions from a saved entry's suggestedActions field.
   * Used during time-travel (entry deletion) to restore the correct suggestions
   * for the new last position.
   * @param storyMode - 'adventure' or 'creative-writing'
   * @param savedActions - JSON string of ActionChoice[] or Suggestion[] from the entry
   * @param storyId - story ID for persistence
   * @returns true if actions were restored; false if none could be, in which case the mode's
   *          actions are left empty rather than holding whatever was on screen before
   */
  restoreSuggestedActionsFromEntry(
    storyMode: string,
    savedActions: string | null | undefined,
    storyId: string,
  ): boolean {
    // One contract for every failure path below: a false return leaves nothing set. Only the
    // absent-blob case used to clear, so a malformed or unparseable blob returned false with the
    // previous entry's choices still on screen, where they read as belonging to this entry.
    // Callers judge by the return value alone, so the two must not disagree.
    const clearForMode = () => {
      if (storyMode === 'adventure') {
        this.actionChoices = []
      } else {
        this.suggestions = []
      }
    }

    if (!savedActions) {
      clearForMode()
      return false
    }

    try {
      const parsed = JSON.parse(savedActions)
      if (!Array.isArray(parsed) || parsed.length === 0) {
        clearForMode()
        return false
      }

      // Validated, not cast. This blob is written by our own generator, but it also arrives from
      // an imported `.avt` or a synced device, and nothing between the file and here checks its
      // shape. `ActionChoices.svelte` looks up its icon by `choice.type` and renders the result
      // unconditionally, so a single entry missing that field takes down the whole view.
      if (storyMode === 'adventure') {
        const validated = z.array(actionChoiceSchema).safeParse(parsed)
        if (!validated.success) {
          console.warn('[UI] Discarding malformed saved action choices:', validated.error)
          clearForMode()
          return false
        }
        this.actionChoices = validated.data
        // Also persist to settings so they survive app restart
        const data: PersistedActionChoices = { storyId, choices: validated.data }
        database
          .setSetting(this.getActionChoicesKey(storyId), JSON.stringify(data))
          .catch((err) => {
            console.warn('[UI] Failed to persist restored action choices:', err)
          })
      } else {
        const validated = z.array(suggestionSchema).safeParse(parsed)
        if (!validated.success) {
          console.warn('[UI] Discarding malformed saved suggestions:', validated.error)
          clearForMode()
          return false
        }
        this.suggestions = validated.data
        const data: PersistedSuggestions = { storyId, suggestions: validated.data }
        database.setSetting(this.getSuggestionsKey(storyId), JSON.stringify(data)).catch((err) => {
          console.warn('[UI] Failed to persist restored suggestions:', err)
        })
      }

      console.log('[UI] Restored suggested actions from entry for story:', storyId)
      return true
    } catch (err) {
      console.warn('[UI] Failed to parse saved suggested actions:', err)
      clearForMode()
      return false
    }
  }

  // Retry callback management
  setRetryCallback(callback: (() => Promise<void>) | null) {
    this.retryCallback = callback
  }

  async triggerRetry() {
    console.log('[UI] triggerRetry called', { hasCallback: !!this.retryCallback })
    if (this.retryCallback) {
      await this.retryCallback()
      console.log('[UI] retryCallback completed')
    } else {
      console.log('[UI] No retry callback registered!')
    }
  }

  // Retry last message callback management (for edit-and-retry feature)
  setRetryLastMessageCallback(callback: (() => Promise<void>) | null) {
    this.retryLastMessageCallback = callback
  }

  async triggerRetryLastMessage() {
    console.log('[UI] triggerRetryLastMessage called', {
      hasCallback: !!this.retryLastMessageCallback,
    })
    if (this.retryLastMessageCallback) {
      await this.retryLastMessageCallback()
      console.log('[UI] retryLastMessageCallback completed')
    } else {
      console.log('[UI] No retry last message callback registered!')
    }
  }

  // Regenerate narration callback management (fallback when no retry backup exists)
  setRegenerateNarrationCallback(callback: ((entryId: string) => Promise<void>) | null) {
    this.regenerateNarrationCallback = callback
  }

  async triggerRegenerateNarration(entryId: string) {
    if (this.regenerateNarrationCallback) {
      await this.regenerateNarrationCallback(entryId)
    } else {
      console.log('[UI] No regenerate narration callback registered!')
    }
  }

  // Style reviewer methods

  /**
   * Set the current story ID for style review state tracking.
   * Called when switching stories.
   */
  setCurrentStyleReviewStoryId(storyId: string | null) {
    this.currentStyleReviewStoryId = storyId
  }

  /**
   * Load style review state from persistent storage.
   * Called when a story is loaded.
   */
  loadStyleReviewState(storyId: string, state: PersistentStyleReviewState | null) {
    this.currentStyleReviewStoryId = storyId
    this.styleReviewLoading = false
    if (state) {
      this.messagesSinceLastStyleReview = state.messagesSinceLastReview
      // Convert persistent format to StyleReviewResult (they're compatible)
      this.lastStyleReview = state.lastReview as StyleReviewResult | null
      console.log('[UI] Restored style review state', {
        storyId,
        messagesSinceLastReview: state.messagesSinceLastReview,
        hasLastReview: !!state.lastReview,
      })
    } else {
      // Reset to defaults for new stories or stories without style review data
      this.messagesSinceLastStyleReview = 0
      this.lastStyleReview = null
    }
  }

  /**
   * Clear style review state (when switching stories).
   * Only clears in-memory state, does not affect DB.
   */
  clearStyleReviewState() {
    this.messagesSinceLastStyleReview = 0
    this.lastStyleReview = null
    this.styleReviewLoading = false
    this.currentStyleReviewStoryId = null
  }

  /**
   * Clear all generation-related caches (when switching stories).
   * Includes style review state and retrieval cache.
   */
  clearGenerationCaches() {
    this.clearStyleReviewState()
    this.setLastRetrievalResult(null)
    this.setLastLorebookRetrieval(null, null)
  }

  /**
   * Persist current style review state to database.
   */
  private persistStyleReviewState() {
    const storyId = this.currentStyleReviewStoryId
    if (!storyId) return

    const state: PersistentStyleReviewState = {
      messagesSinceLastReview: this.messagesSinceLastStyleReview,
      lastReview: this.lastStyleReview as PersistentStyleReviewResult | null,
    }

    this.persistStyleReviewStateForStory(storyId, state)
  }

  /**
   * Persist style review state for a specific story without changing in-memory state.
   */
  private persistStyleReviewStateForStory(storyId: string, state: PersistentStyleReviewState) {
    this.styleReviewStateWrite = this.styleReviewStateWrite
      .catch(() => {})
      .then(() => database.saveStyleReviewState(storyId, state))
      .catch((err) => {
        console.warn('[UI] Failed to persist style review state:', err)
      })
  }

  incrementStyleReviewCounter() {
    this.messagesSinceLastStyleReview++
    this.persistStyleReviewState()
  }

  resetStyleReviewCounter() {
    this.messagesSinceLastStyleReview = 0
    this.persistStyleReviewState()
  }

  setStyleReview(result: StyleReviewResult, storyId?: string | null) {
    if (storyId && storyId !== this.currentStyleReviewStoryId) {
      const state: PersistentStyleReviewState = {
        messagesSinceLastReview: 0,
        lastReview: result as PersistentStyleReviewResult,
      }
      this.persistStyleReviewStateForStory(storyId, state)
      return
    }

    this.lastStyleReview = result
    this.messagesSinceLastStyleReview = 0
    this.persistStyleReviewState()
  }

  clearStyleReview() {
    this.lastStyleReview = null
    this.persistStyleReviewState()
  }

  setStyleReviewLoading(loading: boolean, storyId?: string | null) {
    if (storyId && storyId !== this.currentStyleReviewStoryId) return
    this.styleReviewLoading = loading
  }

  // Retrieval cache methods
  setLastRetrievalResult(result: RetrievalResult | null, key: RetrievalCacheKey | null = null) {
    this.lastRetrievalResult = result
    this.lastRetrievalKey = result ? key : null
  }

  /**
   * The cached retrieval, but only if it was built for exactly this situation.
   *
   * Branch is part of the key because `switchBranch` does not clear this cache and must
   * not reuse across branches: the same position on another branch is a different story.
   * Position and action text cover the rest — a retry or a regenerate rewinds to the state
   * the retrieval was computed in, so an unchanged key means unchanged inputs.
   */
  retrievalResultFor(key: RetrievalCacheKey): RetrievalResult | null {
    const cached = this.lastRetrievalKey
    if (!cached || !this.lastRetrievalResult) return null
    const matches =
      cached.storyId === key.storyId &&
      cached.branchId === key.branchId &&
      cached.position === key.position &&
      cached.actionContent === key.actionContent
    return matches ? this.lastRetrievalResult : null
  }

  // Lorebook debug methods
  setLastLorebookRetrieval(
    result: EntryRetrievalResult | null,
    worldState: WorldStateInjectionResult | null = null,
  ) {
    this.lastLorebookRetrieval = result
    this.lastWorldStateRetrieval = worldState
  }

  openLorebookDebug() {
    this.lorebookDebugOpen = true
  }

  closeLorebookDebug() {
    this.lorebookDebugOpen = false
  }

  toggleLorebookDebug() {
    this.lorebookDebugOpen = !this.lorebookDebugOpen
  }

  // Lorebook manager methods
  selectLorebookEntry(id: string | null) {
    this.selectedLorebookEntryId = id
    this.lorebookEditMode = false
    if (id) {
      this.lorebookShowDetail = true
    }
  }

  setLorebookEditMode(editing: boolean) {
    this.lorebookEditMode = editing
  }

  toggleBulkSelection(id: string) {
    const newSet = new SvelteSet(this.lorebookBulkSelection)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    this.lorebookBulkSelection = newSet
  }

  selectAllForBulk(ids: string[]) {
    this.lorebookBulkSelection = new Set(ids)
  }

  clearBulkSelection() {
    this.lorebookBulkSelection = new Set()
  }

  setLorebookSearchQuery(query: string) {
    this.lorebookSearchQuery = query
  }

  setLorebookTypeFilter(filter: EntryType | 'all') {
    this.lorebookTypeFilter = filter
  }

  setLorebookSortBy(sort: 'name' | 'type' | 'updated') {
    this.lorebookSortBy = sort
  }

  openLorebookImport() {
    this.lorebookImportModalOpen = true
  }

  closeLorebookImport() {
    this.lorebookImportModalOpen = false
  }

  openLorebookExport() {
    this.lorebookExportModalOpen = true
  }

  closeLorebookExport() {
    this.lorebookExportModalOpen = false
  }

  // Mobile navigation for lorebook
  showLorebookDetail() {
    this.lorebookShowDetail = true
  }

  hideLorebookDetail() {
    this.lorebookShowDetail = false
    this.selectedLorebookEntryId = null
    this.lorebookEditMode = false
  }

  // Lore management mode methods
  backgroundTasksActiveFor(storyId: string, branchId: string | null): boolean {
    return (this.backgroundTaskBranches.get(branchScopeKey(storyId, branchId)) ?? 0) > 0
  }

  setBackgroundTasksActive(storyId: string, branchId: string | null, active: boolean) {
    const key = branchScopeKey(storyId, branchId)
    const running = this.backgroundTaskBranches.get(key) ?? 0
    if (active) this.backgroundTaskBranches.set(key, running + 1)
    else if (running <= 1) this.backgroundTaskBranches.delete(key)
    else this.backgroundTaskBranches.set(key, running - 1)
  }

  startLoreManagement() {
    this.loreManagementActive = true
    this.loreManagementProgress = 'Analyzing story content...'
    this.loreManagementChanges = 0
    // The previous run's account stops being true the moment a new one starts writing.
    this.lastLoreManagementSummary = null
    // Close any open modals/edit modes since user can't edit during lore management
    this.lorebookEditMode = false
    this.lorebookImportModalOpen = false
    this.lorebookExportModalOpen = false
  }

  updateLoreManagementProgress(message: string, changesCount?: number) {
    this.loreManagementProgress = message
    if (changesCount !== undefined) {
      this.loreManagementChanges = changesCount
    }
  }

  /** Record what a finished session reported, for the panel to show once it is over. */
  setLoreManagementSummary(summary: string, changeCount: number) {
    this.lastLoreManagementSummary = summary
    this.lastLoreManagementChanges = changeCount
  }

  finishLoreManagement() {
    this.loreManagementActive = false
    this.loreManagementProgress = ''
  }

  // Reset lorebook manager state (when leaving panel or switching stories)
  resetLorebookManager() {
    this.selectedLorebookEntryId = null
    this.lorebookEditMode = false
    this.lorebookBulkSelection = new Set()
    this.lorebookSearchQuery = ''
    this.lorebookShowDetail = false
  }

  // Memory panel methods
  setMemoryEditingChapter(id: string | null) {
    this.memoryEditingChapterId = id
  }

  toggleChapterExpanded(id: string) {
    this.memoryExpandedChapterId = this.memoryExpandedChapterId === id ? null : id
  }

  toggleMemorySettings() {
    this.memorySettingsOpen = !this.memorySettingsOpen
  }

  openManualChapterModal() {
    this.manualChapterModalOpen = true
  }

  closeManualChapterModal() {
    this.manualChapterModalOpen = false
  }

  openResummarizeModal(chapterId: string) {
    this.resummarizeChapterId = chapterId
    this.resummarizeModalOpen = true
  }

  closeResummarizeModal() {
    this.resummarizeModalOpen = false
    this.resummarizeChapterId = null
  }

  setMemoryLoading(loading: boolean) {
    this.memoryLoading = loading
  }

  resetMemoryPanel() {
    this.memoryEditingChapterId = null
    this.memoryExpandedChapterId = null
    this.memorySettingsOpen = false
    this.manualChapterModalOpen = false
    this.resummarizeModalOpen = false
    this.resummarizeChapterId = null
    this.memoryLoading = false
  }

  // Sync modal methods
  openSyncModal() {
    this.syncModalOpen = true
    this.syncMode = 'select'
  }

  // SillyTavern chat import modal methods
  openSTChatImport() {
    this.stChatImportModalOpen = true
  }

  closeSTChatImport() {
    this.stChatImportModalOpen = false
  }

  closeSyncModal() {
    this.syncModalOpen = false
    this.syncMode = 'select'
  }

  setSyncMode(mode: SyncMode) {
    this.syncMode = mode
  }

  // Activation tracking methods for lorebook stickiness

  // Track the current story ID for activation persistence
  private currentActivationStoryId: string | null = null

  /**
   * Create an activation tracker for the current story position.
   * The tracker maintains references to our state so activations are persisted.
   */
  getActivationTracker(storyPosition: number): ActivationTracker {
    this.currentStoryPosition = storyPosition
    const tracker = new SimpleActivationTracker(storyPosition)
    // Create a fresh copy of activation data for the tracker
    tracker.loadActivationData(Object.fromEntries(Object.entries(this.activationData)))
    return tracker
  }

  /**
   * Update activation data after retrieval completes.
   * Called with the tracker that was modified during retrieval.
   */
  updateActivationData(tracker: SimpleActivationTracker, storyId?: string) {
    // Prune first, then read once. Reading before the prune as well was dead: the value
    // was overwritten two lines later without ever being observed.
    tracker.pruneOldActivations(10)
    this.activationData = tracker.getActivationData()

    // Persist to database
    const targetStoryId = storyId || this.currentActivationStoryId
    if (targetStoryId) {
      this.saveActivationData(targetStoryId)
    }
  }

  /**
   * Clear activation data (e.g., when switching stories).
   */
  clearActivationData() {
    this.activationData = {}
    this.currentStoryPosition = 0
    this.currentActivationStoryId = null
  }

  /**
   * Forget one entry's activation, so its carry-over ends now instead of at its countdown.
   *
   * Only the in-memory copy: the next retrieval writes the whole map back to the database
   * through `updateActivationData`, so persisting here would be overwritten a turn later.
   */
  clearActivationFor(entryId: string) {
    if (!(entryId in this.activationData)) return
    const { [entryId]: _dropped, ...rest } = this.activationData
    this.activationData = rest
  }

  /**
   * Save activation data to the database for persistence.
   */
  saveActivationData(storyId: string) {
    this.currentActivationStoryId = storyId
    const data: PersistedActivationData = {
      storyId,
      activationData: { ...this.activationData },
      storyPosition: this.currentStoryPosition,
    }
    database.setSetting(`lorebook_activation_${storyId}`, JSON.stringify(data)).catch((err) => {
      console.warn('[UI] Failed to persist activation data:', err)
    })
  }

  /**
   * Load activation data from the database for a story.
   * Called when a story is loaded.
   */
  async loadActivationData(storyId: string) {
    try {
      let data = await database.getSetting(`lorebook_activation_${storyId}`)
      // Activation data used to live under one global key, so only the last story played
      // had any. Migrate it to whichever story it belonged to, then drop it -- kept around
      // it would be read on every load of every story, forever, to answer "not yours".
      //
      // The migration deliberately does not depend on which story triggered it. Deleting
      // the legacy row while only adopting it for the story being opened threw away data
      // belonging to a *different* story, before that story was ever loaded -- the one
      // outcome this whole path exists to avoid.
      if (!data) {
        const legacyData = await database.getSetting('lorebook_activation')
        if (legacyData) {
          let ownerId: string | null = null
          try {
            ownerId = (JSON.parse(legacyData) as PersistedActivationData).storyId ?? null
          } catch (err) {
            // Unparseable: there is no story to give it to, so dropping it below is right.
            console.warn('[UI] Discarding unreadable legacy activation data:', err)
          }

          if (ownerId) {
            await database.setSetting(`lorebook_activation_${ownerId}`, legacyData)
            if (ownerId === storyId) data = legacyData
          }
          await database.deleteSetting('lorebook_activation')
        }
      }
      if (data) {
        const parsed: PersistedActivationData = JSON.parse(data)
        // Only restore if it's for the same story
        if (parsed.storyId === storyId) {
          this.activationData = parsed.activationData
          this.currentStoryPosition = parsed.storyPosition
          this.currentActivationStoryId = storyId
          console.log('[UI] Restored activation data for story:', storyId, {
            entriesCount: Object.keys(parsed.activationData).length,
            storyPosition: parsed.storyPosition,
          })
          return
        }
      }
      // No matching data found, start fresh
      this.activationData = {}
      this.currentStoryPosition = 0
      this.currentActivationStoryId = storyId
    } catch (err) {
      console.warn('[UI] Failed to load persisted activation data:', err)
      this.activationData = {}
      this.currentStoryPosition = 0
      this.currentActivationStoryId = storyId
    }
  }

  /**
   * Get current activation data for debugging.
   */
  getActivationDebugInfo(): { data: Record<string, number>; position: number } {
    return {
      data: { ...this.activationData },
      position: this.currentStoryPosition,
    }
  }

  // Toast notification state
  toastVisible = $state(false)
  toastMessage = $state('')
  toastType = $state<'error' | 'warning' | 'info'>('info')
  toastHovering = $state(false)
  private toastTimeout: ReturnType<typeof setTimeout> | null = null

  /**
   * Show a toast notification.
   * @param message - The message to display
   * @param type - The type of toast (error, warning, info)
   * @param duration - Duration in milliseconds (default: 4000, errors use 8000)
   */
  showToast(message: string, type: 'error' | 'warning' | 'info' = 'info', duration?: number) {
    const capitalized = message.charAt(0).toUpperCase() + message.slice(1)
    this.toastMessage = capitalized
    this.toastType = type
    this.toastVisible = true
    this.toastHovering = false

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout)
    }

    const autoDuration = duration ?? (type === 'error' ? 8000 : 4000)

    this.toastTimeout = setTimeout(() => {
      if (!this.toastHovering) {
        this.toastVisible = false
      }
    }, autoDuration)
  }

  setToastHovering(hovering: boolean) {
    this.toastHovering = hovering
    if (hovering && this.toastTimeout) {
      clearTimeout(this.toastTimeout)
    } else if (!hovering && this.toastVisible) {
      const autoDuration = this.toastType === 'error' ? 8000 : 4000
      this.toastTimeout = setTimeout(() => {
        this.toastVisible = false
      }, autoDuration)
    }
  }

  /**
   * Hide toast notification.
   */
  hideToast() {
    this.toastVisible = false
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout)
      this.toastTimeout = null
    }
  }

  // Settings navigation state
  private settingsActiveTab = $state<string>('api')

  /**
   * Get the active settings tab to navigate to.
   */
  get settingsTab(): string {
    return this.settingsActiveTab
  }

  /**
   * Open settings modal and navigate to the API tab to fix profiles.
   */
  openSettingsToApiTab() {
    this.settingsActiveTab = 'api'
    this.settingsModalOpen = true
  }

  /**
   * Open settings modal and navigate to the Generation tab to configure models.
   */
  openSettingsToGenerationTab() {
    this.settingsActiveTab = 'generation'
    this.settingsModalOpen = true
  }

  /**
   * Set the active settings tab.
   */
  setSettingsTab(tab: string) {
    this.settingsActiveTab = tab
  }

  set settingsTab(v: string) {
    this.settingsActiveTab = v
  }

  // -- App visibility tracking (Android background generation) ---------------

  /** Start tracking document visibility changes for background generation detection. */
  initVisibilityTracking() {
    if (typeof document === 'undefined') return
    // Avoid double-init
    if (this.visibilityCleanup) return

    const handler = () => {
      const hidden = document.hidden
      this.isAppBackgrounded = hidden
      if (hidden && this.isGenerating) {
        this.wasBackgroundedDuringGeneration = true
      }
    }

    document.addEventListener('visibilitychange', handler)
    this.visibilityCleanup = () => document.removeEventListener('visibilitychange', handler)
  }

  /** Clean up visibility tracking listener. */
  destroyVisibilityTracking() {
    this.visibilityCleanup?.()
    this.visibilityCleanup = null
  }

  /** Reset the backgrounded-during-generation flag (call when a new generation starts). */
  resetBackgroundedFlag() {
    this.wasBackgroundedDuringGeneration = false
  }
}

export const ui = new UIStore()
