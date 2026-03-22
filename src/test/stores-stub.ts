// Prevents settings.svelte.ts from loading — avoids Svelte rune transform requirement
export const settings = {
  getPresetConfig: () => ({}),
  serviceSpecificSettings: null,
}
export const story = {
  id: null as any,
  title: null as any,
  description: null as any,
  genre: null as any,
  templateId: null as any,
  mode: 'adventure' as any,
  createdAt: 0,
  updatedAt: 0,
  isLoaded: false,
  settings: {
    pov: 'first' as string,
    tense: 'present' as string,
    memoryConfig: null as any,
    visualProseMode: false,
    imageGenerationMode: undefined as any,
    backgroundImagesEnabled: false,
    referenceMode: false,
    tone: undefined as any,
    themes: undefined as any,
    load: () => {},
    clear: () => {},
  },
  image: {
    currentBgImage: null as any,
    clear: () => {},
  },
  branch: {
    currentBranchId: null as any,
  },
  chapter: {
    currentBranchChapters: [] as any[],
    chapters: [] as any[],
  },
  character: {
    characters: [] as any[],
    protagonist: undefined as any,
  },
  location: {
    locations: [] as any[],
    currentLocation: undefined as any,
  },
  item: {
    items: [] as any[],
  },
  storyBeat: {
    storyBeats: [] as any[],
  },
  time: {
    timeTracker: null as any,
    load: () => {},
    clear: () => {},
  },
  generationContext: {
    retrievalResult: null as any,
    clear: () => {},
  },
}
export const storyUI = {}
export const storyContext = {
  // Category 1 — world state
  entries: [],
  characters: [],
  locations: [],
  items: [],
  storyBeats: [],
  chapters: [],
  lorebookEntries: [],

  // Category 2 — generation inputs
  userAction: null,
  narrationEntryId: null,
  abortSignal: null,
  embeddedImages: [],
  rawInput: '',
  actionType: 'do',
  wasRawActionChoice: false,
  styleReview: null,
  activationTracker: null,

  // Category 3 — generation intermediates
  retrievalResult: null,
  narrativeResult: null,
  classificationResult: null,
  translationResult: null,
  imageResult: null,
  postGenerationResult: null,
  backgroundResult: null,
  preGenerationResult: null,

  // Derived views (static defaults for tests)
  visibleEntries: [],
  pov: 'first',
  tense: 'present',
  storyMode: 'adventure',
  protagonist: undefined,
  currentLocation: undefined,
  pendingQuests: [],
  lastChapterEndIndex: 0,
  currentBranchChapters: [],
  promptContext: {
    mode: 'adventure',
    pov: 'first',
    tense: 'present',
    protagonistName: 'the protagonist',
    genre: undefined,
  },

  // New derived getters (Phase 27)
  activeCharacters: [],
  inventoryItems: [],
  equippedItems: [],
  wordCount: 0,
  memoryConfig: { tokenThreshold: 2000, chapterBuffer: 3, autoSummarize: false },
  timeTracker: { years: 0, days: 0, hours: 0, minutes: 0 },
  messagesSinceLastChapter: 0,
  tokensSinceLastChapter: 0,
  tokensOutsideBuffer: 0,

  // Cache invalidation methods (no-ops for tests)
  invalidateWordCountCache: () => {},
  invalidateChapterCache: () => {},

  // Lifecycle methods (no-ops)
  init: () => {},
  reset: () => {},
  hydrate: () => {},
  clear: () => {},
}
