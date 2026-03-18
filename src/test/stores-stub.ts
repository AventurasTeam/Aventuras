// Prevents settings.svelte.ts from loading — avoids Svelte rune transform requirement
export const settings = {
  getPresetConfig: () => ({}),
  serviceSpecificSettings: null,
}
export const story = {}
export const storyUI = {}
export const storyContext = {
  // Category 1 — world state
  currentStory: null,
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

  // Lifecycle methods (no-ops)
  init: () => {},
  reset: () => {},
  hydrate: () => {},
  clear: () => {},
}
