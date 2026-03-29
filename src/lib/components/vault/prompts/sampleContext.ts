/**
 * Sample values for template preview rendering.
 * Organized per context group to match actual runtime shapes.
 *
 * Used by:
 * - TemplatePreview.svelte (rendering previews)
 * - TemplateEditor.svelte (tooltip example values)
 * - PromptPackEditor.svelte (test value defaults)
 */

import { getContextGroup, type ContextGroupName } from '$lib/services/templates/templateContextMap'
import type { TemplateContext } from '$lib/services/templates/types'

// ---------------------------------------------------------------------------
// Reusable sample data fragments
// ---------------------------------------------------------------------------

const sampleCharacters = [
  {
    name: 'Theron',
    relationship: 'companion',
    description: 'A seasoned ranger who has guided Aria through the Whispering Woods.',
    traits: ['loyal', 'perceptive', 'cautious'],
    appearance: ['rugged leather armor', 'shortbow', 'weathered cloak'],
    tier: 1,
    status: 'active',
  },
  {
    name: 'Lyra',
    relationship: 'rival',
    description: 'A rival mage who seeks the same ancient artifacts as Aria.',
    traits: ['ambitious', 'cunning', 'talented'],
    appearance: ['dark robes', 'silver staff', 'cold eyes'],
    tier: 2,
    status: 'active',
  },
]

const sampleLocations = [
  {
    name: 'Crystal Caverns',
    description: 'Shimmering caverns of magical crystal beneath the mountains.',
    visited: false,
    tier: 2,
  },
  {
    name: 'Thornhold Castle',
    description: 'Ancient fortress occupied by the Order of the Iron Veil.',
    visited: true,
    tier: 3,
  },
]

const sampleItems = [
  {
    name: 'Enchanted Compass',
    description: 'Points toward hidden magical sources.',
    quantity: 1,
    equipped: false,
  },
  {
    name: 'Shadow Cloak',
    description: 'Grants partial invisibility in dim light.',
    quantity: 1,
    equipped: true,
  },
  {
    name: 'Healing Potion',
    description: 'Restores 2d4+2 health points.',
    quantity: 2,
    equipped: false,
  },
]

const sampleStoryBeats = [
  {
    title: 'Discovered the Hidden Map',
    description: 'Found a map leading to the Crystal Caverns.',
    type: 'discovery',
    status: 'completed',
  },
  {
    title: 'Confrontation with Lyra',
    description: 'Lyra demands the compass at the forest edge.',
    type: 'conflict',
    status: 'active',
  },
]

const sampleChapters = [
  {
    number: 1,
    title: 'Into the Woods',
    summary: 'Aria entered the Whispering Woods and encountered her first magical creature.',
    startTime: 'Year 1, Day 1',
    endTime: 'Year 1, Day 3',
    characters: ['Aria', 'Theron'],
    locations: ['The Whispering Woods'],
    emotionalTone: 'curious',
  },
  {
    number: 2,
    title: 'The Map Revealed',
    summary: 'Aria discovered the hidden map leading to the Crystal Caverns.',
    startTime: 'Year 1, Day 4',
    endTime: 'Year 1, Day 10',
    characters: ['Aria', 'Theron', 'Elder Maren'],
    locations: ['The Whispering Woods', 'Crystal Caverns entrance'],
    emotionalTone: 'hopeful',
  },
]

const sampleLorebookEntries = [
  {
    name: 'The Whispering Woods',
    type: 'location',
    description: 'Ancient forest where trees carry memories of the world.',
    tier: 1,
  },
  {
    name: 'The Moonstone Pendant',
    type: 'item',
    description: 'A pendant that glows under moonlight, said to reveal hidden paths.',
    tier: 1,
  },
  {
    name: 'Elder Maren',
    type: 'character',
    description: 'A wandering sage who guards forgotten knowledge.',
    tier: 2,
    disposition: 'cautiously helpful',
  },
]

const sampleStoryEntries = [
  { type: 'user_action', content: 'I draw my sword and step into the shadows.' },
  {
    type: 'narration',
    content:
      'The forest falls silent as Aria moves into the darkness, her blade catching the last slivers of moonlight.',
  },
  { type: 'user_action', content: 'I whisper to Theron to flank left.' },
]

const sampleWorldStateRelevantItems = [
  {
    name: 'Enchanted Compass',
    description: 'Points toward the nearest ley line convergence',
    tier: 2,
  },
  {
    name: 'Faded Map Fragment',
    description: 'Partial map of the Thornwood labyrinth',
    tier: 3,
  },
]

const sampleWorldStateRelatedBeats = [
  {
    title: 'The Missing Apprentice',
    description: 'Rumors of a sorcerer apprentice who vanished near the old ruins',
    type: 'quest',
    status: 'active',
    tier: 2,
  },
  {
    title: 'Harvest Festival Preparations',
    description: 'The village is preparing for the annual harvest celebration',
    type: 'discovery',
    status: 'active',
    tier: 3,
  },
]

const sampleVisualDescriptors = {
  face: 'angular features, sharp cheekbones',
  hair: 'silver, flowing to shoulders',
  eyes: 'violet, luminous',
  build: 'athletic, graceful',
  clothing: 'leather armor with arcane engravings',
  accessories: 'enchanted compass on a chain',
  distinguishing: 'scar across left cheek',
}

// ---------------------------------------------------------------------------
// promptContext samples — matches StoryPromptContext shape
// ---------------------------------------------------------------------------

const PROMPT_CONTEXT_SAMPLES: TemplateContext = {
  // Story Config (flat scalars)
  mode: 'adventure',
  pov: 'second',
  tense: 'present',
  protagonistName: 'Aria',
  protagonistDescription: 'A young woman with silver hair and violet eyes',
  genre: 'Fantasy',
  settingDescription: 'A vast magical realm where ancient forests conceal forgotten ruins.',
  tone: 'Mysterious',
  themes: ['courage', 'discovery', 'friendship'],

  // Story Content
  storyEntries: sampleStoryEntries,
  storyEntriesRaw: sampleStoryEntries.map((e, i) => ({ ...e, id: `entry-${i}` })),
  storyEntriesVisible: sampleStoryEntries,
  storyEntriesVisibleRaw: sampleStoryEntries.map((e, i) => ({ ...e, id: `entry-${i}` })),
  userInput: 'I want to explore the ancient ruins to the north.',
  userActionOriginal: 'I want to explore the ancient ruins to the north.',
  lastNarrativeEntry: {
    type: 'narration',
    content:
      'The forest falls silent as Aria moves into the darkness, her blade catching the last slivers of moonlight.',
  },

  // Entity Data
  characters: sampleCharacters,
  locations: sampleLocations,
  items: sampleItems,
  storyBeats: sampleStoryBeats,
  chapters: sampleChapters,
  lorebookEntries: sampleLorebookEntries,

  // World State (nested)
  relevantWorldState: {
    characters: sampleCharacters,
    inventory: sampleItems,
    storyBeats: sampleStoryBeats,
    locations: sampleLocations,
    relevantItems: sampleWorldStateRelevantItems,
    relatedStoryBeats: sampleWorldStateRelatedBeats,
  },

  // Entry Selection
  loreEntriesForTier3: sampleLorebookEntries,
  worldStateForTier3: sampleCharacters,

  // Settings (nested)
  userSettings: {
    visualProseMode: false,
    classifier: { maxEntries: 20 },
    retieval: { maxStoryEntries: 50 },
    agenticRetrieval: {
      recentEntriesCount: 5,
      maxChapters: 3,
      summaryCharLimit: 500,
      maxLorebookEntries: 10,
    },
    memoryConfig: {
      chapterLength: 20,
      maxProtectedEntries: 5,
    },
    lorebookConfig: {
      maxTier1Entries: 5,
      maxTier2Entries: 10,
      maxTier3Entries: 3,
    },
    imageGeneration: {
      inlineImageMode: false,
      referenceMode: false,
      maxImages: 3,
      stylePrompt: '[Style prompt for image generation...]',
    },
    translationSettings: {
      targetLanguage: { name: 'Spanish', code: 'es' },
      sourceLanguage: { name: 'English', code: 'en' },
    },
  },

  // Generation Results
  styleReview: {
    phrases: [
      {
        phrase: 'suddenly',
        frequency: 4,
        severity: 'medium',
        alternatives: ['abruptly', 'without warning'],
      },
      {
        phrase: 'all of a sudden',
        frequency: 2,
        severity: 'low',
        alternatives: ['without warning', 'unexpectedly'],
      },
    ],
    overallAssessment: 'Writing is clear but relies on sudden-transition clich\u00e9s.',
    reviewedEntryCount: 12,
  },
  retrievalResult: null,
  classificationResult: null,
  narrativeResult: {
    content: '[The narrative response text...]',
  },
  translationResult: null,

  // Memory
  chapterAnalysis: {
    analysisEntries: sampleStoryEntries,
    chapterEntries: [
      { type: 'narration', content: 'Aria and Theron entered the Crystal Caverns at dawn.' },
      { type: 'user_action', content: 'I run my hand along the glowing crystal wall.' },
      {
        type: 'narration',
        content:
          'The crystals hum under your touch, resonating with a frequency you feel in your bones.',
      },
    ],
  },
  lastChapterEndIndex: 25,

  // Pack Variables
  packVariables: {
    runtimeVariables: {
      character: [
        {
          variableName: 'loyalty',
          variableType: 'number',
          minValue: 0,
          maxValue: 100,
          defaultValue: '50',
          description: 'Character loyalty level toward the protagonist',
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
  },

  // Translation Data
  suggestionsToTranslate: [
    { text: 'Explore the ruins' },
    { text: 'Talk to the stranger' },
  ],
  actionChoicesToTranslate: [
    { text: 'Draw your sword', description: 'Prepare for combat' },
    { text: 'Attempt to sneak past', description: 'Use stealth' },
  ],
  uiElementsToTranslate: [
    { key: 'continue', text: 'Continue' },
    { key: 'undo', text: 'Undo' },
  ],

  // Time
  timeTracker: {
    years: 1,
    days: 15,
    hours: 14,
    minutes: 30,
  },
}

// ---------------------------------------------------------------------------
// timelineFillAnswer samples — promptContext + extras
// ---------------------------------------------------------------------------

const TIMELINE_FILL_ANSWER_SAMPLES: TemplateContext = {
  ...PROMPT_CONTEXT_SAMPLES,
  answerChapters: [
    {
      number: 1,
      title: 'Into the Woods',
      summary: 'Aria entered the Whispering Woods and encountered her first magical creature.',
      entries: [
        {
          type: 'narration',
          content: 'The tree line swallows the last light of the village behind you.',
        },
        {
          type: 'user_action',
          content: 'I press deeper into the forest, following the faint luminescence.',
        },
      ],
    },
    {
      number: 2,
      title: 'The Map Revealed',
      summary: 'Aria discovered the hidden map leading to the Crystal Caverns.',
    },
  ],
  query: 'What happened between the forest encounter and arriving at the castle?',
}

// ---------------------------------------------------------------------------
// wizard samples
// ---------------------------------------------------------------------------

const WIZARD_SAMPLES: TemplateContext = {
  // Story Setup (scalars)
  genreLabel: 'Fantasy',
  seed: 'A world where magic flows through ancient ley lines...',
  customInstruction: 'Make it feel epic and mysterious.',
  toneInstruction: 'Maintain a mysterious and wonder-filled tone.',
  settingInstruction: 'Set in a high fantasy world with elemental magic.',
  settingContext: 'A high fantasy world with elemental magic and feudal kingdoms.',
  settingName: 'The Shattered Realms',
  settingDescription: 'A vast magical realm where ancient forests conceal forgotten ruins.',
  settingAtmosphere: 'Eerie and mystical, where the air hums with ancient power.',
  settingThemesText: 'magic, discovery, redemption',
  count: 3,
  title: 'Echoes of the Forgotten',
  atmosphere: 'A sense of ancient mystery pervades the land...',
  tenseInstruction: 'Write in present tense.',
  openingGuidance: 'Begin with the protagonist arriving at the forest edge.',
  mode: 'adventure',
  pov: 'second',
  tone: 'Mysterious',
  protagonistName: 'Aria',
  protagonistDescription: 'A young woman with silver hair and violet eyes',

  // Setting (object)
  currentSetting: {
    name: 'The Whispering Woods',
    description: 'An ancient forest where trees carry memories of the world.',
    atmosphere: 'Eerie and mystical',
    themes: ['nature', 'mystery'],
    potentialConflicts: ['forest corruption', 'ancient awakening'],
    keyLocations: [
      { name: 'Elder Tree', description: 'A massive ancient oak at the heart of the woods.' },
    ],
  },

  // Character (objects)
  characterInput: {
    name: 'Aria',
    description: 'A young woman with silver hair and violet eyes',
    background: 'Raised in the hidden village of Thornhollow...',
    motivation: '',
    traits: [],
  },
  currentCharacter: {
    name: 'Aria',
    description: 'A young woman with silver hair and violet eyes',
    background: 'Raised in the hidden village of Thornhollow by a foster family of herbalists.',
    motivation: 'To uncover the truth about her parents',
    traits: ['curious', 'brave', 'compassionate'],
    appearance: "Silver hair, violet eyes, slender build, wears a traveler's cloak",
  },
  protagonist: {
    name: 'Kael',
    description: 'A brave warrior with a troubled past',
    motivation: 'To protect the realm from the encroaching darkness',
  },

  // Opening (object)
  currentOpening: {
    title: 'The Journey Begins',
    scene: 'The morning mist clings to the tree line as the sun crests the distant hills...',
    initialLocation: {
      name: 'Forest Edge',
      description: 'Where the ancient trees begin and civilization ends.',
    },
  },

  // Lorebook
  lorebookEntries: sampleLorebookEntries,

  // Supporting Characters
  supportingCharacters: [
    {
      name: 'Theron',
      role: 'ally',
      description: 'A loyal ranger',
      relationship: 'companion',
      traits: ['steadfast', 'quiet'],
    },
    {
      name: 'Lyra',
      role: 'rival',
      description: 'A rival mage',
      relationship: 'rival',
      traits: ['ambitious', 'clever'],
    },
  ],
}

// ---------------------------------------------------------------------------
// vault samples
// ---------------------------------------------------------------------------

const VAULT_SAMPLES: TemplateContext = {
  characterCount: 12,
  lorebookCount: 3,
  totalEntryCount: 47,
  scenarioCount: 5,
  focusedEntity: {
    entityType: 'character',
    entityName: 'Theron',
    entityId: 'char-001',
  },
}

// ---------------------------------------------------------------------------
// lore samples
// ---------------------------------------------------------------------------

const LORE_SAMPLES: TemplateContext = {
  loreEntries: [
    {
      name: 'The Whispering Woods',
      type: 'location',
      description: 'Ancient forest where trees carry memories of the world.',
      state: 'Partially explored — southern trails mapped by Aria and Theron.',
    },
    {
      name: 'The Moonstone Pendant',
      type: 'item',
      description: 'A pendant that glows under moonlight, said to reveal hidden paths.',
    },
    {
      name: 'Elder Maren',
      type: 'character',
      description: 'A wandering sage who guards forgotten knowledge.',
      state: 'Last seen at the Crystal Caverns entrance, offering cryptic guidance.',
    },
  ],
  loreChapters: [
    {
      number: 1,
      title: 'Into the Woods',
      summary: 'Aria entered the Whispering Woods and encountered her first magical creature.',
    },
    {
      number: 2,
      title: 'The Map Revealed',
      summary: 'Aria discovered the hidden map leading to the Crystal Caverns.',
    },
    {
      number: 3,
      title: 'Crystal Dawn',
      summary: 'Aria and Theron reached the Crystal Caverns entrance and met Elder Maren.',
    },
  ],
}

// ---------------------------------------------------------------------------
// import samples
// ---------------------------------------------------------------------------

const IMPORT_SAMPLES: TemplateContext = {
  genre: 'Fantasy',
  title: 'Echoes of the Forgotten',
  cardContent: '[Character card content for import...]',
  entriesJson: '[Lorebook entries JSON for vault import...]',
}

// ---------------------------------------------------------------------------
// portrait samples
// ---------------------------------------------------------------------------

const PORTRAIT_SAMPLES: TemplateContext = {
  imageStylePrompt: '[Style prompt for image generation...]',
  visualDescriptors: sampleVisualDescriptors,
}

// ---------------------------------------------------------------------------
// translateWizard samples
// ---------------------------------------------------------------------------

const TRANSLATE_WIZARD_SAMPLES: TemplateContext = {
  targetLanguage: 'Spanish',
  content: '[Content to translate or process...]',
}

// ---------------------------------------------------------------------------
// Group name -> sample data
// ---------------------------------------------------------------------------

const GROUP_SAMPLES: Record<ContextGroupName, TemplateContext> = {
  promptContext: PROMPT_CONTEXT_SAMPLES,
  timelineFillAnswer: TIMELINE_FILL_ANSWER_SAMPLES,
  wizard: WIZARD_SAMPLES,
  vault: VAULT_SAMPLES,
  lore: LORE_SAMPLES,
  import: IMPORT_SAMPLES,
  portrait: PORTRAIT_SAMPLES,
  translateWizard: TRANSLATE_WIZARD_SAMPLES,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns sample context data for a given template ID.
 * Returns an empty object if the template has no mapped context group.
 */
export function getSamplesForTemplate(templateId: string): TemplateContext {
  const group = getContextGroup(templateId)
  if (!group) return {}
  return GROUP_SAMPLES[group]
}
