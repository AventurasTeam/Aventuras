/**
 * Shared prompt context fixture for template unit tests.
 *
 * Shape mirrors StoryPromptContext from generationContext.svelte.ts.
 * All fields are populated with realistic data so every template variable
 * can be verified.  Individual tests spread this and override as needed.
 *
 * NOTE: Liquid is dynamically typed, so we export a plain object rather
 * than importing the full type tree (which would pull in Svelte runes).
 */

// ---------------------------------------------------------------------------
// Story entries (shared across storyEntries / storyEntriesRaw / visible)
// ---------------------------------------------------------------------------

const storyEntry1 = {
  id: 'e1',
  type: 'narration' as const,
  content: 'The torches flickered against the stone walls of the ancient chamber.',
  timeStart: 'Y1D42 14:00',
}

const storyEntry2 = {
  id: 'e2',
  type: 'user_action' as const,
  content: 'I draw my sword and step cautiously forward.',
  timeStart: 'Y1D42 14:05',
}

const storyEntry3 = {
  id: 'e3',
  type: 'narration' as const,
  content: 'The gate creaked open, revealing a vast underground chamber lit by phosphorescent moss.',
  timeStart: 'Y1D42 14:10',
}

const storyEntries = [storyEntry1, storyEntry2, storyEntry3]

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const characters = [
  {
    name: 'Aria',
    description: 'A resourceful elven scout',
    relationship: 'companion',
    traits: ['brave', 'perceptive'],
    status: 'active' as const,
    appearance: ['Silver hair', 'Green eyes', 'Leather armor'],
    tier: 1 as const,
    visualDescriptors: {
      face: 'Angular features, bronze skin',
      hair: 'Silver, waist-length, braided',
      eyes: 'Teal, sharp gaze',
      build: 'Tall, athletic',
      clothing: 'Dark leather armor',
      accessories: 'Silver pendant',
      distinguishing: 'Scar across left cheek',
    },
    portrait: 'data:image/png;base64,abc',
  },
  {
    name: 'Marcus',
    description: 'An old mercenary with a troubled past',
    relationship: 'ally',
    traits: ['stoic'],
    status: 'active' as const,
    appearance: ['Grey stubble', 'Stocky build'],
    tier: 2 as const,
    visualDescriptors: { face: 'Weathered, grey stubble', build: 'Stocky' },
    portrait: null,
  },
]

// ---------------------------------------------------------------------------
// Lorebook entries (context-layer shape with tier)
// ---------------------------------------------------------------------------

const lorebookEntries = [
  { name: 'The Shadow Guild', type: 'faction', description: 'A secretive criminal organization.', tier: 1 as const, disposition: undefined },
  { name: 'Elder Dragon', type: 'character', description: 'An ancient beast guarding the Sunken Temple.', tier: 2 as const, disposition: 'hostile' },
  { name: 'Crystal of Aethon', type: 'item', description: 'A powerful artifact of unknown origin.', tier: 1 as const, disposition: undefined },
  { name: 'The Thornwood', type: 'location', description: 'A cursed forest north of the kingdom.', tier: 2 as const, disposition: undefined },
  { name: 'Arcane Weaving', type: 'concept', description: 'The art of channeling raw magical energy.', tier: 3 as const, disposition: undefined },
  { name: 'The Sundering', type: 'event', description: 'A cataclysm that split the continent a thousand years ago.', tier: 3 as const, disposition: undefined },
]

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

const chapters = [
  {
    number: 1,
    title: 'Into the Woods',
    summary: 'The party ventured into the Thornwood seeking the lost temple.',
    startTime: 'Y1D1 08:00',
    endTime: 'Y1D3 18:00',
    characters: ['Kael', 'Aria'],
    locations: ['Thornwood', 'River Crossing'],
    emotionalTone: 'Tense',
  },
  {
    number: 2,
    title: 'The Sunken Temple',
    summary: 'Discovery of the ancient temple and its guardian.',
    startTime: 'Y1D4 09:00',
    endTime: 'Y1D5 22:00',
    characters: ['Kael', 'Aria', 'Marcus'],
    locations: ['Sunken Temple'],
    emotionalTone: 'Ominous',
  },
]

// ---------------------------------------------------------------------------
// World state arrays (from WorldStateMapper)
// ---------------------------------------------------------------------------

const relevantWorldState = {
  characters: [
    { name: 'Aria', relationship: 'companion', description: 'A resourceful elven scout', traits: ['brave', 'perceptive'], appearance: ['Silver hair', 'Green eyes'], tier: 1 as const, status: 'active' as const },
    { name: 'Marcus', relationship: 'ally', description: 'An old mercenary', traits: ['stoic'], appearance: ['Grey stubble'], tier: 2 as const, status: 'active' as const },
  ],
  inventory: [
    { name: 'Iron Sword', description: 'A sturdy blade', quantity: 1, equipped: true },
    { name: 'Health Potion', description: 'Restores vitality', quantity: 3, equipped: false },
  ],
  relevantItems: [
    { name: 'Crystal of Aethon', description: 'A powerful artifact', quantity: 1, equipped: false, tier: 2 as const },
  ],
  storyBeats: [
    { title: 'Find the Lost Temple', description: 'Locate the Sunken Temple in the Thornwood', type: 'quest', status: 'active' },
    { title: 'Earn Marcus\'s Trust', description: 'Prove yourself to the old mercenary', type: 'quest', status: 'pending' },
  ],
  relatedStoryBeats: [
    { title: 'The Prophecy', description: 'An ancient prophecy speaks of a chosen one', type: 'revelation', status: 'active', tier: 3 as const },
  ],
  locations: [
    { name: 'Thornwood Edge', description: 'The cursed treeline at the forest border', visited: true, tier: 2 as const },
  ],
}

// ---------------------------------------------------------------------------
// Retrieval result
// ---------------------------------------------------------------------------

const retrievalResult = {
  agenticRetrieval: {
    agenticReasoning: 'Selected entries relevant to the temple exploration.',
    agenticChapterSummary: 'In chapter 1, the party entered the Thornwood. In chapter 2, they found the Sunken Temple.',
    agenticSelectedEntries: [
      { name: 'Elder Dragon', type: 'character', description: 'An ancient beast guarding the Sunken Temple.' },
      { name: 'Crystal of Aethon', type: 'item', description: 'A powerful artifact of unknown origin.' },
    ],
  },
  lorebookEntries,
  lorebookRetrievalResult: null,
  timelineFillResult: {
    responses: {
      timelineFill: [
        { query: 'What happened at the river crossing?', answer: 'The party was ambushed by shadow guild agents.', chapterNumbers: [1] },
        { query: 'Who guards the temple?', answer: 'An elder dragon has nested in the temple ruins.', chapterNumbers: [1, 2] },
      ],
    },
  },
}

// ---------------------------------------------------------------------------
// Style review
// ---------------------------------------------------------------------------

const styleReview = {
  phrases: [
    { phrase: 'dark and stormy', count: 3, frequency: 3, severity: 'low', alternatives: ['gloomy', 'tempestuous'] },
    { phrase: 'eyes widening', count: 5, frequency: 5, severity: 'medium', alternatives: ['gaze sharpening', 'brow lifting'] },
  ],
  overallAssessment: 'Generally strong prose with some repetitive descriptive patterns.',
  reviewedEntryCount: 8,
}

// ---------------------------------------------------------------------------
// Pack variables / runtime variables
// ---------------------------------------------------------------------------

const packVariables = {
  runtimeVariables: {
    character: [
      {
        variableName: 'loyalty',
        variableType: 'number',
        minValue: 0,
        maxValue: 100,
        defaultValue: '50',
        description: 'Loyalty toward protagonist',
      },
      {
        variableName: 'mood',
        variableType: 'enum',
        enumOptions: [{ value: 'happy' }, { value: 'neutral' }, { value: 'hostile' }],
        defaultValue: 'neutral',
        description: 'Current emotional state',
      },
    ],
    item: [
      {
        variableName: 'durability',
        variableType: 'number',
        minValue: 0,
        maxValue: 100,
        defaultValue: undefined,
        description: 'Item condition as a percentage',
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

const userSettings = {
  // Note: interface has typo 'retieval', templates use 'retrieval'
  // Provide both for compatibility
  retieval: { maxStoryEntries: 10 },
  retrieval: { maxStoryEntries: 10 },
  agenticRetrieval: {
    recentEntriesCount: 5,
    maxChapters: 20,
    summaryCharLimit: 100,
    maxLorebookEntries: 50,
  },
  classifier: { maxEntries: 100 },
  lorebookConfig: {
    maxForNarrative: 10,
    maxForActionChoices: 5,
    maxForSuggestions: 5,
  },
  memoryConfig: {
    tokenThreshold: 4000,
    chapterBuffer: 3,
    autoSummarize: true,
    enableRetrieval: true,
    maxChaptersPerRetrieval: 3,
  },
  visualProseMode: false,
  imageGeneration: {
    inlineImageMode: false,
    referenceMode: false,
    maxImages: 3,
    stylePrompt: 'Soft cel-shaded anime illustration with muted pastel color palette.',
  },
  translationSettings: {
    targetLanguage: { code: 'fr', name: 'French' },
    sourceLanguage: { code: 'ja', name: 'Japanese' },
  },
}

// ---------------------------------------------------------------------------
// Locations / Items / StoryBeats (raw domain entities for templates
// that use them directly instead of through relevantWorldState)
// ---------------------------------------------------------------------------

const locations = [
  { name: 'Thornwood Edge', description: 'The cursed treeline', visited: true, current: false, tier: 1 as const },
  { name: 'Sunken Temple', description: 'An ancient temple beneath the forest', visited: true, current: true, tier: 1 as const },
]

const items = [
  { name: 'Iron Sword', description: 'A sturdy blade', quantity: 1, equipped: true },
  { name: 'Health Potion', description: 'Restores vitality', quantity: 3, equipped: false },
]

const storyBeats = [
  { title: 'Find the Lost Temple', description: 'Locate the Sunken Temple in the Thornwood', type: 'quest', status: 'active' },
  { title: 'Earn Marcus\'s Trust', description: 'Prove yourself to the old mercenary', type: 'quest', status: 'pending' },
  { title: 'Defeated the Wolves', description: 'Wolf pack at the river', type: 'event', status: 'completed' },
]

// ---------------------------------------------------------------------------
// Classification result
// ---------------------------------------------------------------------------

const classificationResult = {
  scene: {
    presentCharacterNames: 'Kael,Aria',
    currentLocation: 'Sunken Temple',
    emotionalTone: 'tense',
  },
}

// ---------------------------------------------------------------------------
// Full promptContext fixture
// ---------------------------------------------------------------------------

export const promptContext = {
  // Story metadata
  mode: 'adventure' as const,
  pov: 'second' as const,
  tense: 'present' as const,
  protagonistName: 'Kael',
  protagonistDescription: 'A wandering swordsman seeking redemption',
  genre: 'Fantasy',
  settingDescription: 'A dark medieval realm plagued by an ancient curse',
  tone: 'Epic',
  themes: ['redemption', 'sacrifice'],

  // Story entries (all four variants)
  storyEntries,
  storyEntriesRaw: storyEntries,
  storyEntriesVisible: storyEntries,
  storyEntriesVisibleRaw: storyEntries,

  // User input
  userInput: 'I look around the chamber carefully',

  // Tier 3 candidates
  loreEntriesForTier3: [
    { name: 'The Sundering', type: 'event', description: 'A cataclysm that split the continent.' },
    { name: 'Arcane Weaving', type: 'concept', description: 'The art of channeling raw magical energy.' },
  ],
  worldStateForTier3: [
    { name: 'Shadow Guild Hideout', type: 'location', description: 'A hidden base.' },
  ],

  // User settings
  userSettings,

  // Domain entities
  chapters,
  lorebookEntries,
  characters,
  locations,
  items,
  timeTracker: { years: 1, days: 42, hours: 14, minutes: 30 },
  storyBeats,

  // Retrieval & analysis results
  styleReview,
  retrievalResult,
  relevantWorldState,
  packVariables,

  // Translation intermediates
  suggestionsToTranslate: [
    { type: 'action', text: 'Draw your sword and charge.' },
    { type: 'dialogue', text: 'Ask the guardian about the prophecy.' },
  ],
  actionChoicesToTranslate: [
    { type: 'do', text: 'Open the ancient chest.' },
    { type: 'say', text: 'Greet the stranger.' },
  ],
  uiElementsToTranslate: [
    { id: 'loc1', text: 'The Keep' },
    { id: 'loc2', text: 'The Marketplace' },
  ],

  // Classification
  classificationResult,

  // Narrative result
  narrativeResult: { content: 'The gate opened slowly, revealing the chamber beyond. Phosphorescent moss cast an eerie green glow across ancient stone columns.' },
  lastNarrativeEntry: storyEntry3,
  userActionOriginal: 'I draw my sword and step forward',

  // Chapter analysis
  lastChapterEndIndex: 0,
  chapterAnalysis: {
    analysisEntries: [
      { type: 'user_action', content: 'I open the gate.' },
      { type: 'narration', content: 'The gate creaks open, revealing a passage.' },
      { type: 'narration', content: 'Ancient runes glow along the walls.' },
    ],
    chapterEntries: [
      { type: 'narration', content: 'The hero arrived at dawn.' },
      { type: 'user_action', content: 'I search the room carefully.' },
      { type: 'narration', content: 'Hidden behind a tapestry was a narrow passage.' },
    ],
    protectedEntryCount: 2,
  },

  // narrationEntryId (used by classifier to exclude current narration)
  narrationEntryId: 'e3',
}

// ---------------------------------------------------------------------------
// Minimal base context — just enough so templates render without crashing
// when testing conditional suppression (empty arrays, no optional fields).
// ---------------------------------------------------------------------------

export const promptContextMinimal = {
  mode: 'adventure' as const,
  pov: 'second' as const,
  tense: 'present' as const,
  protagonistName: 'Kael',
  protagonistDescription: '',
  genre: '',
  settingDescription: '',
  tone: '',
  themes: [],
  storyEntries: [],
  storyEntriesRaw: [],
  storyEntriesVisible: [],
  storyEntriesVisibleRaw: [],
  userInput: '',
  loreEntriesForTier3: [],
  worldStateForTier3: [],
  userSettings,
  chapters: [],
  lorebookEntries: [],
  characters: [],
  locations: [],
  items: [],
  timeTracker: { years: 0, days: 0, hours: 0, minutes: 0 },
  storyBeats: [],
  relevantWorldState: {
    characters: [],
    inventory: [],
    relevantItems: [],
    storyBeats: [],
    relatedStoryBeats: [],
    locations: [],
  },
  retrievalResult: {
    agenticRetrieval: null,
    lorebookEntries: [],
    lorebookRetrievalResult: null,
    timelineFillResult: null,
  },
  chapterAnalysis: {},
  lastChapterEndIndex: 0,
}
