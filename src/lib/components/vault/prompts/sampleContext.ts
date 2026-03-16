/**
 * Sample values for template preview rendering.
 * Used by both TemplatePreview (rendering) and TestVariablesModal (pre-filling inputs).
 */

export const systemSamples: Record<string, string> = {
  protagonistName: 'Aria',
  currentLocation: 'The Whispering Woods',
  storyTime: 'Year 1, Day 15, 14:30',
  genre: 'Fantasy',
  tone: 'Mysterious',
  settingDescription: 'A vast magical realm where ancient forests conceal forgotten ruins.',
  themes: 'courage, discovery, friendship',
  mode: 'adventure',
  pov: 'second',
  tense: 'present',
}

export const runtimeSamples: Record<string, string> = {
  // Narrative Service
  recentContent: '[Recent story content would appear here...]',
  visualProseMode: 'false',
  inlineImageMode: 'false',

  // Classifier Service
  entityCounts: 'Characters: 3, Locations: 5, Items: 4',
  currentTimeInfo: 'Year 1, Day 15, 14:30',
  inputLabel: 'Player Action',
  userAction: 'I want to explore the ancient ruins to the north.',
  narrativeResponse: '[The narrative response text...]',
  existingLocations: 'The Whispering Woods, Crystal Caverns, Thornhold Castle',
  existingItems: 'Enchanted Compass, Shadow Cloak, Moonstone Pendant',
  storyBeatTypes: 'discovery, encounter, revelation, conflict, resolution',
  itemLocationOptions: 'inventory, equipped, location, npc',
  defaultItemLocation: 'location',

  // Memory Service
  firstValidId: '1',
  lastValidId: '25',
  maxChaptersPerRetrieval: '3',

  // Suggestions Service
  activeThreads: 'Finding the lost artifact, Resolving the conflict with Lyra',

  // Action Choices Service
  npcsPresent: 'Theron the Ranger, Old Sage Maren',
  inventory: 'Enchanted Compass, Shadow Cloak, Healing Potion x2',
  activeQuests: 'Find the Moonstone Pendant, Explore the Crystal Caverns',
  protagonistDescription: 'A young woman with silver hair and violet eyes',
  povInstruction: 'Write in second person perspective.',
  lengthInstruction: 'Write 2-3 paragraphs.',

  // Shared / Common
  userInput: 'I want to explore the ancient ruins to the north.',

  // Style Reviewer
  passageCount: '5',

  // Agentic Retrieval
  chaptersCount: '8',
  chapterList: '[Formatted chapter list for retrieval...]',
  entriesCount: '15',
  entryList: '[Formatted lorebook entry list...]',

  // Timeline Fill
  query: 'What happened between the forest encounter and arriving at the castle?',

  // Translation
  targetLanguage: 'Spanish',
  sourceLanguage: 'English',
  content: '[Content to translate or process...]',
  elementsJson: '[JSON of UI elements for translation...]',
  suggestionsJson: '[JSON of suggestions for translation...]',
  choicesJson: '[JSON of action choices for translation...]',

  // Image Services
  imageStylePrompt: '[Style prompt for image generation...]',
  maxImages: '3',
  translatedNarrativeBlock: '[Translated narrative for image analysis...]',

  // Wizard Service
  genreLabel: 'Fantasy',
  seed: 'A world where magic flows through ancient ley lines...',
  customInstruction: 'Make it feel epic and mysterious.',
  toneInstruction: 'Maintain a mysterious and wonder-filled tone.',
  settingInstruction: 'Set in a high fantasy world with elemental magic.',
  settingContext: 'A high fantasy world with elemental magic and feudal kingdoms.',
  settingName: 'The Shattered Realms',
  count: '3',
  title: 'Echoes of the Forgotten',
  atmosphere: 'A sense of ancient mystery pervades the land...',
  tenseInstruction: 'Write in present tense.',
  openingGuidance: 'Begin with the protagonist arriving at the forest edge.',
  settingAtmosphere: 'Eerie and mystical, where the air hums with ancient power.',
  settingThemesText: 'magic, discovery, redemption',
  cardContent: '[Character card content for import...]',
  lorebookName: 'The Shattered Realms Lore',
  entriesJson: '[Lorebook entries JSON for vault import...]',
  entryCount: '12',

  // Interactive Lorebook (scalar counts)
  characterCount: '12',
  lorebookCount: '3',
  totalEntryCount: '47',
  scenarioCount: '5',
  lastNarrationIndex: '2',

  // Interactive Lorebook (chat)
  userMessage: 'Tell me about the Crystal Caverns.',
  conversationHistory: '[Conversation history for interactive lorebook...]',

  // Agentic Retrieval Output
  agenticReasoning:
    '[Agent reasoning: selected entries for current context based on scene relevance and character proximity...]',
  agenticChapterSummary:
    '[Chapter facts: protagonist learned about the ancient prophecy in chapter 3, encountered Elder Maren in chapter 5...]',
}

/**
 * Structured sample arrays for the 9 new context-layer array variables.
 * Uses the Aventura fantasy world (Aria, Theron, Lyra, Whispering Woods, Crystal Caverns).
 */
export const structuredSamples: Record<string, unknown> = {
  worldStateCharacters: [
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
  ],
  worldStateInventory: [
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
  ],
  worldStateBeats: [
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
  ],
  worldStateLocations: [
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
  ],
  lorebookEntries: [
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
  ],
  chapters: [
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
  ],
  timelineFill: [
    {
      query: 'What happened between the forest encounter and arriving at the caverns?',
      answer:
        'Aria and Theron tracked a faint magical signal through three days of dense forest, camping near the Silver Creek.',
      chapterNumbers: [1, 2],
    },
  ],
  storyEntries: [
    { type: 'user_action', content: 'I draw my sword and step into the shadows.' },
    {
      type: 'narration',
      content:
        'The forest falls silent as Aria moves into the darkness, her blade catching the last slivers of moonlight.',
    },
    { type: 'user_action', content: 'I whisper to Theron to flank left.' },
  ],
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
  worldStateRelevantItems: [
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
  ],
  worldStateRelatedBeats: [
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
  ],
  currentLocationObject: {
    name: 'The Silver Stag Inn',
    description:
      'A cozy tavern at the crossroads, known for its warm hearth and loose-lipped travelers',
  },

  // Style Reviewer
  passages: [
    {
      content:
        'Aria stepped into the clearing, her breath catching as the moonlight spilled across the ancient stone altar.',
      entryId: 'entry-001',
    },
    {
      content:
        'The forest whispered around them — a language older than words, older than the kingdom itself.',
      entryId: 'entry-002',
    },
    {
      content:
        "Theron's hand tightened on his bow. 'Something moved out there,' he said, his voice barely audible.",
      entryId: 'entry-003',
    },
  ],

  // Entry Retrieval (Tier 3)
  availableEntries: [
    {
      name: 'The Whispering Woods',
      type: 'location',
      description: 'Ancient forest where trees carry memories of the world.',
      keywords: 'forest, ancient, magic, trees, memory',
    },
    {
      name: 'The Moonstone Pendant',
      type: 'item',
      description: 'A pendant that glows under moonlight, said to reveal hidden paths.',
      keywords: 'pendant, moonstone, glow, path',
    },
    {
      name: 'Elder Maren',
      type: 'character',
      description: 'A wandering sage who guards forgotten knowledge.',
    },
  ],

  // Agentic Retrieval (recentEntries)
  recentEntries: [
    {
      type: 'narration',
      content: 'The lantern flickered as shadows crept along the walls.',
    },
    {
      type: 'user_action',
      content: 'I cautiously step forward, hand on my sword.',
    },
  ],

  // Agentic Retrieval Output (agenticSelectedEntries)
  agenticSelectedEntries: [
    {
      name: 'The Moonstone Pendant',
      type: 'item',
      description: 'A pendant that glows under moonlight, said to reveal hidden paths.',
    },
    {
      name: 'Elder Maren',
      type: 'character',
      description: 'A wandering sage who guards forgotten knowledge.',
    },
  ],

  // Classifier (chatHistory — Omit<StoryEntry> + timeStart)
  chatHistory: [
    {
      type: 'user_action',
      content: 'I examine the Moonstone Pendant carefully.',
      timeStart: 'Y1D15 13:45',
      metadata: null,
    },
    {
      type: 'narration',
      content: 'The pendant pulses with a soft blue light in your hands.',
      timeStart: 'Y1D15 13:45',
      metadata: null,
    },
    {
      type: 'user_action',
      content: 'I ask Theron if he has ever seen anything like this.',
      timeStart: 'Y1D15 13:50',
      metadata: null,
    },
  ],

  // Chapter Analysis (messagesInRange — same shape as storyEntries)
  messagesInRange: [
    { type: 'user_action', content: 'I draw my sword and step into the shadows.' },
    {
      type: 'narration',
      content:
        'The forest falls silent as Aria moves into the darkness, her blade catching the last slivers of moonlight.',
    },
    { type: 'user_action', content: 'I whisper to Theron to flank left.' },
  ],

  // Chapter Summarization
  chapterEntries: [
    { type: 'narration', content: 'Aria and Theron entered the Crystal Caverns at dawn.' },
    { type: 'user_action', content: 'I run my hand along the glowing crystal wall.' },
    {
      type: 'narration',
      content:
        'The crystals hum under your touch, resonating with a frequency you feel in your bones.',
    },
  ],

  // Chapter Summarization (previousChapters — same shape as chapters)
  previousChapters: [
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
  ],

  // Lore Management
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

  // Lore Management (loreChapters)
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

  // Agentic Retrieval (agenticChapters — same shape as loreChapters)
  agenticChapters: [
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

  // Agentic Retrieval (agenticEntries — name and type only)
  agenticEntries: [
    { name: 'The Whispering Woods', type: 'location' },
    { name: 'The Moonstone Pendant', type: 'item' },
    { name: 'Elder Maren', type: 'character' },
  ],

  // Image Analysis (sceneCharacters — mixed portrait state)
  sceneCharacters: [
    {
      name: 'Theron',
      relationship: 'companion',
      description: 'A seasoned ranger who has guided Aria through the Whispering Woods.',
      traits: ['loyal', 'perceptive', 'cautious'],
      status: 'active',
      portrait: null,
      visualDescriptors: {
        face: 'weathered, strong jaw, high cheekbones',
        hair: 'dark brown, shoulder-length',
        eyes: 'amber, watchful',
        build: 'lean and athletic',
        clothing: 'worn leather armor, forest-green cloak',
        accessories: 'shortbow, quiver of black-fletched arrows',
        distinguishing: 'faint scar above left brow',
      },
    },
    {
      name: 'Lyra',
      relationship: 'rival',
      description: 'A rival mage who seeks the same ancient artifacts as Aria.',
      traits: ['ambitious', 'cunning', 'talented'],
      status: 'active',
      portrait: 'portrait://lyra.png',
      visualDescriptors: {
        face: 'sharp features, pale complexion',
        hair: 'raven black, pulled back tightly',
        eyes: 'ice blue, calculating',
        build: 'slender',
        clothing: 'dark robes with silver trim',
        accessories: 'silver staff',
        distinguishing: '',
      },
    },
    {
      name: 'Elder Maren',
      relationship: 'neutral',
      description: 'A wandering sage who guards forgotten knowledge.',
      traits: ['wise', 'cryptic', 'ancient'],
      status: 'active',
      portrait: null,
      visualDescriptors: {},
    },
  ],

  // Timeline Fill Answer (answerChapters — dual-mode)
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

  // Background Image (narrationEntries — all type narration)
  narrationEntries: [
    {
      type: 'narration',
      content:
        'The Crystal Caverns stretch endlessly before you, each surface faceted like a gemstone.',
    },
    {
      type: 'narration',
      content:
        'Pale blue light pulses from deep within the cave, casting long shadows across the floor.',
    },
    {
      type: 'narration',
      content:
        'A low hum fills the air — the crystals are singing, resonating with some ancient frequency.',
    },
  ],

  // Classifier (characters — same shape as worldStateCharacters)
  characters: [
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
  ],

  // Classifier (storyBeats — same shape as worldStateBeats)
  storyBeats: [
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
  ],

  // Wizard Service (structured objects replacing scalar strings)
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
  currentCharacter: {
    name: 'Aria',
    description: 'A young woman with silver hair and violet eyes',
    background: 'Raised in the hidden village of Thornhollow by a foster family of herbalists.',
    motivation: 'To uncover the truth about her parents',
    traits: ['curious', 'brave', 'compassionate'],
    appearance: "Silver hair, violet eyes, slender build, wears a traveler's cloak",
  },
  characterInput: {
    name: 'Aria',
    description: 'A young woman with silver hair and violet eyes',
    background: 'Raised in the hidden village of Thornhollow...',
    motivation: '',
    traits: [],
  },
  protagonist: {
    name: 'Kael',
    description: 'A brave warrior with a troubled past',
    motivation: 'To protect the realm from the encroaching darkness',
  },
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
  currentOpening: {
    title: 'The Journey Begins',
    scene: 'The morning mist clings to the tree line as the sun crests the distant hills...',
    initialLocation: {
      name: 'Forest Edge',
      description: 'Where the ancient trees begin and civilization ends.',
    },
  },

  // Classifier (runtimeVariables - grouped by entity type)
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

  // Interactive Lorebook (focusedEntity object)
  focusedEntity: {
    entityType: 'character',
    entityName: 'Theron',
    entityId: 'char-001',
  },

  // Image Portrait (visualDescriptors object)
  visualDescriptors: {
    face: 'angular features, sharp cheekbones',
    hair: 'silver, flowing to shoulders',
    eyes: 'violet, luminous',
    build: 'athletic, graceful',
    clothing: 'leather armor with arcane engravings',
    accessories: 'enchanted compass on a chain',
    distinguishing: 'scar across left cheek',
  },
}

/** All sample values combined — system strings, runtime strings, and structured arrays */
export const allSamples: Record<string, unknown> = {
  ...systemSamples,
  ...runtimeSamples,
  ...structuredSamples,
}
