/**
 * Shared prompt context fixture for template unit tests.
 *
 * Shape mirrors StoryPromptContext from generationContext.svelte.ts.
 * All fields are populated with realistic data so every template variable
 * can be verified.  Individual tests spread this and override as needed.
 */

import type {
  Chapter,
  Character,
  Entry,
  Item,
  Location,
  MemoryConfig,
  StoryBeat,
  StoryEntry,
  TimeTracker,
} from '$lib/types'
import type { ContextStoryEntry, WorldStateArrays } from '$lib/services/context/context-types'
import type { RetrievalResult, AgenticRetrievalFields } from '$lib/services/generation/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type { Suggestion } from '$lib/services/ai/sdk/schemas/suggestions'
import type { ActionChoice } from '$lib/services/ai/sdk/schemas/actionchoices'
import type { UITranslationItem } from '$lib/services/ai/utils/TranslationService'
import type { EntityRuntimeVars } from '$lib/services/context/context-builder'
import type { Tier3Candidate } from '$lib/services/ai/generation/EntryInjector'
import type { NarrativeResult } from '$lib/services/generation/phases/NarrativePhase'
import type { ClassificationResult } from '$lib/services/ai/sdk/schemas/classifier'
import type { LorebookLimitsSettings } from '$lib/stores/settings.svelte'

// ---------------------------------------------------------------------------
// Story entries
// ---------------------------------------------------------------------------

const storyEntry1: ContextStoryEntry = {
  id: 'e1',
  storyId: 's1',
  type: 'narration',
  content: 'The torches flickered against the stone walls of the ancient chamber.',
  parentId: null,
  position: 0,
  createdAt: Date.now(),
  metadata: { timeStart: { years: 1, days: 42, hours: 14, minutes: 0 } },
  branchId: null,
}

const storyEntry2: ContextStoryEntry = {
  id: 'e2',
  storyId: 's1',
  type: 'user_action',
  content: 'I draw my sword and step cautiously forward.',
  parentId: 'e1',
  position: 1,
  createdAt: Date.now(),
  metadata: { timeStart: { years: 1, days: 42, hours: 14, minutes: 5 } },
  branchId: null,
}

const storyEntry3: ContextStoryEntry = {
  id: 'e3',
  storyId: 's1',
  type: 'narration',
  content:
    'The gate creaked open, revealing a vast underground chamber lit by phosphorescent moss.',
  parentId: 'e2',
  position: 2,
  createdAt: Date.now(),
  metadata: { timeStart: { years: 1, days: 42, hours: 14, minutes: 10 } },
  branchId: null,
}

const storyEntries: ContextStoryEntry[] = [storyEntry1, storyEntry2, storyEntry3]

const storyEntriesRaw: StoryEntry[] = [
  { ...storyEntry1, type: 'narration' },
  { ...storyEntry2, type: 'user_action' },
  { ...storyEntry3, type: 'narration' },
]

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const characters: Character[] = [
  {
    id: 'c1',
    storyId: 's1',
    name: 'Aria',
    description: 'A resourceful elven scout',
    relationship: 'companion',
    traits: ['brave', 'perceptive'],
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
    status: 'active',
    metadata: null,
    branchId: null,
  },
  {
    id: 'c2',
    storyId: 's1',
    name: 'Marcus',
    description: 'An old mercenary with a troubled past',
    relationship: 'ally',
    traits: ['stoic'],
    visualDescriptors: { face: 'Weathered, grey stubble', build: 'Stocky' },
    portrait: null,
    status: 'active',
    metadata: null,
    branchId: null,
  },
]

// ---------------------------------------------------------------------------
// Lorebook entries (Entry[] for both promptContext and retrievalResult)
// ---------------------------------------------------------------------------

const rawLorebookEntries: Entry[] = [
  {
    id: 'lb1',
    storyId: 's1',
    name: 'The Shadow Guild',
    type: 'faction',
    description: 'A secretive criminal organization.',
    hiddenInfo: null,
    aliases: [],
    state: { type: 'faction', playerStanding: 0, status: 'hostile', knownMembers: [] },
    adventureState: null,
    creativeState: null,
    injection: { mode: 'keyword', keywords: ['shadow', 'guild'], priority: 1 },
    firstMentioned: null,
    lastMentioned: null,
    mentionCount: 0,
    createdBy: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    loreManagementBlacklisted: false,
    branchId: null,
  },
  {
    id: 'lb2',
    storyId: 's1',
    name: 'Elder Dragon',
    type: 'character',
    description: 'An ancient beast guarding the Sunken Temple.',
    hiddenInfo: null,
    aliases: [],
    state: {
      type: 'character',
      isPresent: false,
      lastSeenLocation: 'Sunken Temple',
      currentDisposition: 'hostile',
      relationship: { level: 0, status: 'hostile', history: [] },
      knownFacts: [],
      revealedSecrets: [],
    },
    adventureState: null,
    creativeState: null,
    injection: { mode: 'keyword', keywords: ['dragon', 'temple'], priority: 2 },
    firstMentioned: null,
    lastMentioned: null,
    mentionCount: 0,
    createdBy: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    loreManagementBlacklisted: false,
    branchId: null,
  },
]

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

const chapters: Chapter[] = [
  {
    id: 'ch1',
    storyId: 's1',
    number: 1,
    title: 'Into the Woods',
    startEntryId: 'e1',
    endEntryId: 'e10',
    entryCount: 10,
    summary: 'The party ventured into the Thornwood seeking the lost temple.',
    startTime: { years: 1, days: 1, hours: 8, minutes: 0 },
    endTime: { years: 1, days: 3, hours: 18, minutes: 0 },
    keywords: ['thornwood', 'temple'],
    characters: ['Kael', 'Aria'],
    locations: ['Thornwood', 'River Crossing'],
    plotThreads: ['Find the Lost Temple'],
    emotionalTone: 'Tense',
    branchId: null,
    createdAt: Date.now(),
  },
  {
    id: 'ch2',
    storyId: 's1',
    number: 2,
    title: 'The Sunken Temple',
    startEntryId: 'e11',
    endEntryId: 'e20',
    entryCount: 10,
    summary: 'Discovery of the ancient temple and its guardian.',
    startTime: { years: 1, days: 4, hours: 9, minutes: 0 },
    endTime: { years: 1, days: 5, hours: 22, minutes: 0 },
    keywords: ['temple', 'dragon'],
    characters: ['Kael', 'Aria', 'Marcus'],
    locations: ['Sunken Temple'],
    plotThreads: ['Find the Lost Temple'],
    emotionalTone: 'Ominous',
    branchId: null,
    createdAt: Date.now(),
  },
]

// ---------------------------------------------------------------------------
// Retrieval result
// ---------------------------------------------------------------------------

const agenticRetrieval: AgenticRetrievalFields = {
  agenticReasoning: 'Selected entries relevant to the temple exploration.',
  agenticChapterSummary:
    'In chapter 1, the party entered the Thornwood. In chapter 2, they found the Sunken Temple.',
  agenticSelectedEntries: rawLorebookEntries,
}

const retrievalResult: RetrievalResult = {
  agenticRetrieval,
  lorebookEntries: rawLorebookEntries,
  lorebookRetrievalResult: null,
  timelineFillResult: {
    queries: [],
    responses: [
      {
        query: 'What happened at the river crossing?',
        answer: 'The party was ambushed by shadow guild agents.',
        chapterNumbers: [1],
      },
      {
        query: 'Who guards the temple?',
        answer: 'An elder dragon has nested in the temple ruins.',
        chapterNumbers: [1, 2],
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// Style review
// ---------------------------------------------------------------------------

const styleReview: StyleReviewResult = {
  phrases: [
    {
      phrase: 'dark and stormy',
      frequency: 3,
      severity: 'low',
      alternatives: ['gloomy', 'tempestuous'],
      contexts: [],
    },
    {
      phrase: 'eyes widening',
      frequency: 5,
      severity: 'medium',
      alternatives: ['gaze sharpening', 'brow lifting'],
      contexts: [],
    },
  ],
  overallAssessment: 'Generally strong prose with some repetitive descriptive patterns.',
  reviewedEntryCount: 8,
  timestamp: Date.now(),
}

// ---------------------------------------------------------------------------
// Pack variables
// ---------------------------------------------------------------------------

const packVariables: {
  runtimeVariables: Record<string, EntityRuntimeVars[]>
} = {
  runtimeVariables: {
    character: [{ name: 'Aria', vars: [{ label: 'loyalty', value: '75' }] }],
    item: [],
  },
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

const lorebookConfig: LorebookLimitsSettings = {
  maxForActionChoices: 5,
  maxForSuggestions: 5,
  maxForAgenticPreview: 10,
  llmThreshold: 20,
  maxEntriesPerTier: 10,
}

const memoryConfig: MemoryConfig = {
  tokenThreshold: 4000,
  chapterBuffer: 3,
  autoSummarize: true,
  enableRetrieval: true,
  maxChaptersPerRetrieval: 3,
}

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
  lorebookConfig,
  memoryConfig,
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
// Locations / Items / StoryBeats
// ---------------------------------------------------------------------------

const locations: Location[] = [
  {
    id: 'l1',
    storyId: 's1',
    name: 'Thornwood Edge',
    description: 'The cursed treeline',
    visited: true,
    current: false,
    connections: [],
    metadata: null,
    branchId: null,
  },
  {
    id: 'l2',
    storyId: 's1',
    name: 'Sunken Temple',
    description: 'An ancient temple beneath the forest',
    visited: true,
    current: true,
    connections: ['l1'],
    metadata: null,
    branchId: null,
  },
]

const items: Item[] = [
  {
    id: 'i1',
    storyId: 's1',
    name: 'Iron Sword',
    description: 'A sturdy blade',
    quantity: 1,
    equipped: true,
    location: 'inventory',
    metadata: null,
    branchId: null,
  },
  {
    id: 'i2',
    storyId: 's1',
    name: 'Health Potion',
    description: 'Restores vitality',
    quantity: 3,
    equipped: false,
    location: 'inventory',
    metadata: null,
    branchId: null,
  },
]

const storyBeats: StoryBeat[] = [
  {
    id: 'b1',
    storyId: 's1',
    title: 'Find the Lost Temple',
    description: 'Locate the Sunken Temple in the Thornwood',
    type: 'quest',
    status: 'active',
    triggeredAt: Date.now(),
    metadata: null,
    branchId: null,
  },
  {
    id: 'b2',
    storyId: 's1',
    title: "Earn Marcus's Trust",
    description: 'Prove yourself to the old mercenary',
    type: 'quest',
    status: 'pending',
    triggeredAt: null,
    metadata: null,
    branchId: null,
  },
  {
    id: 'b3',
    storyId: 's1',
    title: 'Defeated the Wolves',
    description: 'Wolf pack at the river',
    type: 'event',
    status: 'completed',
    triggeredAt: Date.now(),
    metadata: null,
    branchId: null,
  },
]

// ---------------------------------------------------------------------------
// World state arrays
// ---------------------------------------------------------------------------

const relevantWorldState: WorldStateArrays = {
  characters,
  inventory: items,
  relevantItems: [
    {
      id: 'i3',
      storyId: 's1',
      name: 'Crystal of Aethon',
      description: 'A powerful artifact',
      quantity: 1,
      equipped: false,
      location: 'world',
      metadata: null,
      branchId: null,
    },
  ],
  storyBeats: storyBeats.filter((b) => b.status === 'active' || b.status === 'pending'),
  relatedStoryBeats: [
    {
      id: 'b4',
      storyId: 's1',
      title: 'The Prophecy',
      description: 'An ancient prophecy speaks of a chosen one',
      type: 'revelation',
      status: 'active',
      triggeredAt: null,
      metadata: null,
      branchId: null,
    },
  ],
  locations: locations.filter((l) => !l.current),
}

// ---------------------------------------------------------------------------
// Tier 3 candidates
// ---------------------------------------------------------------------------

const loreEntriesForTier3: Entry[] = rawLorebookEntries

const worldStateForTier3: Tier3Candidate[] = [
  { type: 'location', id: 'ws1', name: 'Shadow Guild Hideout', description: 'A hidden base.' },
]

// ---------------------------------------------------------------------------
// Translation intermediates
// ---------------------------------------------------------------------------

const suggestionsToTranslate: Suggestion[] = [
  { type: 'action', text: 'Draw your sword and charge.' },
  { type: 'dialogue', text: 'Ask the guardian about the prophecy.' },
]

const actionChoicesToTranslate: ActionChoice[] = [
  { type: 'action', text: 'Open the ancient chest.' },
  { type: 'dialogue', text: 'Greet the stranger.' },
]

const uiElementsToTranslate: UITranslationItem[] = [
  { id: 'loc1', text: 'The Keep', type: 'name' },
  { id: 'loc2', text: 'The Marketplace', type: 'name' },
]

// ---------------------------------------------------------------------------
// Classification result
// ---------------------------------------------------------------------------

const classificationResult: ClassificationResult = {
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
    presentCharacterNames: ['Kael', 'Aria'],
    timeProgression: 'none',
  },
}

// ---------------------------------------------------------------------------
// Narrative result
// ---------------------------------------------------------------------------

const narrativeResult: NarrativeResult = {
  content:
    'The gate opened slowly, revealing the chamber beyond. Phosphorescent moss cast an eerie green glow across ancient stone columns.',
  reasoning: '',
  chunkCount: 1,
}

// ---------------------------------------------------------------------------
// Time tracker
// ---------------------------------------------------------------------------

const timeTracker: TimeTracker = { years: 1, days: 42, hours: 14, minutes: 30 }

// ---------------------------------------------------------------------------
// Chapter analysis
// ---------------------------------------------------------------------------

const analysisEntry = (
  type: 'user_action' | 'narration',
  content: string,
  pos: number,
): StoryEntry => ({
  id: `ae${pos}`,
  storyId: 's1',
  type,
  content,
  parentId: null,
  position: pos,
  createdAt: Date.now(),
  metadata: null,
  branchId: null,
})

const chapterAnalysis: {
  analysisEntries: StoryEntry[]
  chapterEntries: StoryEntry[]
  protectedEntryCount: number
} = {
  analysisEntries: [
    analysisEntry('user_action', 'I open the gate.', 0),
    analysisEntry('narration', 'The gate creaks open, revealing a passage.', 1),
    analysisEntry('narration', 'Ancient runes glow along the walls.', 2),
  ],
  chapterEntries: [
    analysisEntry('narration', 'The hero arrived at dawn.', 0),
    analysisEntry('user_action', 'I search the room carefully.', 1),
    analysisEntry('narration', 'Hidden behind a tapestry was a narrow passage.', 2),
  ],
  protectedEntryCount: 2,
}

// ---------------------------------------------------------------------------
// Full promptContext fixture
// ---------------------------------------------------------------------------

export const promptContext = {
  mode: 'adventure' as const,
  pov: 'second' as const,
  tense: 'present' as const,
  protagonistName: 'Kael',
  protagonistDescription: 'A wandering swordsman seeking redemption',
  genre: 'Fantasy',
  settingDescription: 'A dark medieval realm plagued by an ancient curse',
  tone: 'Epic',
  themes: ['redemption', 'sacrifice'],

  storyEntries,
  storyEntriesRaw,
  storyEntriesVisible: storyEntries,
  storyEntriesVisibleRaw: storyEntriesRaw,

  userInput: 'I look around the chamber carefully',

  loreEntriesForTier3,
  worldStateForTier3,

  userSettings,

  chapters,
  lorebookEntries: rawLorebookEntries,
  characters,
  locations,
  items,
  timeTracker,
  storyBeats,

  styleReview,
  retrievalResult,
  relevantWorldState,
  packVariables,

  suggestionsToTranslate,
  actionChoicesToTranslate,
  uiElementsToTranslate,

  classificationResult,

  narrativeResult,
  lastNarrativeEntry: storyEntry3 as StoryEntry,
  userActionOriginal: 'I draw my sword and step forward',

  lastChapterEndIndex: 0,
  chapterAnalysis,

  narrationEntryId: 'e3',
}

// ---------------------------------------------------------------------------
// Minimal base context — just enough so templates render without crashing
// when testing conditional suppression (empty arrays, no optional fields).
// ---------------------------------------------------------------------------

const emptyWorldState: WorldStateArrays = {
  characters: [],
  inventory: [],
  relevantItems: [],
  storyBeats: [],
  relatedStoryBeats: [],
  locations: [],
}

const emptyRetrievalResult: RetrievalResult = {
  agenticRetrieval: null,
  lorebookEntries: [],
  lorebookRetrievalResult: null,
  timelineFillResult: null,
}

const emptyTimeTracker: TimeTracker = { years: 0, days: 0, hours: 0, minutes: 0 }

export const promptContextMinimal = {
  mode: 'adventure' as const,
  pov: 'second' as const,
  tense: 'present' as const,
  protagonistName: 'Kael',
  protagonistDescription: '',
  genre: '',
  settingDescription: '',
  tone: '',
  themes: [] as string[],
  storyEntries: [] as ContextStoryEntry[],
  storyEntriesRaw: [] as StoryEntry[],
  storyEntriesVisible: [] as ContextStoryEntry[],
  storyEntriesVisibleRaw: [] as StoryEntry[],
  userInput: '',
  loreEntriesForTier3: [] as Entry[],
  worldStateForTier3: [] as Tier3Candidate[],
  userSettings,
  chapters: [] as Chapter[],
  lorebookEntries: [] as Entry[],
  characters: [] as Character[],
  locations: [] as Location[],
  items: [] as Item[],
  timeTracker: emptyTimeTracker,
  storyBeats: [] as StoryBeat[],
  relevantWorldState: emptyWorldState,
  retrievalResult: emptyRetrievalResult,
  chapterAnalysis: {} as typeof chapterAnalysis,
  lastChapterEndIndex: 0,
}
