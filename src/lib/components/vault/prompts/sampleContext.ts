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
  tieredContextBlock: '[Lorebook entries injected by tiered retrieval...]',
  chapterSummaries: '[Formatted chapter summaries from memory system...]',
  styleGuidance: '[Style guidance from repetition analysis...]',
  retrievedChapterContext: '[Retrieved chapter context from memory...]',
  inlineImageInstructions: '[Instructions for inline image generation...]',
  visualProseInstructions: '[Instructions for visual prose mode...]',
  visualProseMode: 'false',
  inlineImageMode: 'false',

  // Classifier Service
  entityCounts: 'Characters: 3, Locations: 5, Items: 4',
  currentTimeInfo: 'Year 1, Day 15, 14:30',
  chatHistoryBlock: '[Formatted chat history...]',
  inputLabel: 'Player Action',
  userAction: 'I want to explore the ancient ruins to the north.',
  narrativeResponse: '[The narrative response text...]',
  existingCharacters: 'Aria (protagonist), Theron (companion), Lyra (antagonist)',
  existingLocations: 'The Whispering Woods, Crystal Caverns, Thornhold Castle',
  existingItems: 'Enchanted Compass, Shadow Cloak, Moonstone Pendant',
  existingBeats: 'Discovered the hidden map, Met the wandering sage',
  storyBeatTypes: 'discovery, encounter, revelation, conflict, resolution',
  itemLocationOptions: 'inventory, equipped, location, npc',
  defaultItemLocation: 'location',

  // Memory Service
  chapterContent: '[Chapter entries to summarize...]',
  previousContext: '[Previous chapter summaries for context...]',
  messagesInRange: '[Messages in range for chapter analysis...]',
  firstValidId: '1',
  lastValidId: '25',
  recentContext: '[Recent narrative context for retrieval...]',
  maxChaptersPerRetrieval: '3',

  // Suggestions Service
  activeThreads: 'Finding the lost artifact, Resolving the conflict with Lyra',

  // Action Choices Service
  npcsPresent: 'Theron the Ranger, Old Sage Maren',
  inventory: 'Enchanted Compass, Shadow Cloak, Healing Potion x2',
  activeQuests: 'Find the Moonstone Pendant, Explore the Crystal Caverns',
  lorebookContext: '[Relevant lorebook entries injected by context system...]',
  protagonistDescription: 'A young woman with silver hair and violet eyes',
  povInstruction: 'Write in second person perspective.',
  lengthInstruction: 'Write 2-3 paragraphs.',

  // Shared / Common
  userInput: 'I want to explore the ancient ruins to the north.',

  // Style Reviewer
  passageCount: '5',
  passages: '[Formatted passages for style review...]',

  // Lore Management
  entrySummary: '[Summary of lorebook entries...]',
  recentStorySection: '[Recent story content for lore analysis...]',
  chapterSummary: '[Chapter summary for lore context...]',

  // Agentic Retrieval
  chaptersCount: '8',
  chapterList: '[Formatted chapter list for retrieval...]',
  entriesCount: '15',
  entryList: '[Formatted lorebook entry list...]',

  // Entry Retrieval (Tier 3)
  entrySummaries: '[Formatted entry summaries for LLM selection...]',

  // Timeline Fill
  chapterHistory: '[Chapter history for timeline fill...]',
  timeline: '[Timeline data for gap filling...]',
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
  characterDescriptors: 'Silver hair, violet eyes, leather armor, elven features',
  charactersWithPortraits: 'Aria, Theron',
  charactersWithoutPortraits: 'Lyra, Old Sage Maren',
  maxImages: '3',
  chatHistory: '[Chat history for image context...]',
  translatedNarrativeBlock: '[Translated narrative for image analysis...]',
  previousResponse: '[Previous narrative response...]',
  currentResponse: '[Current narrative response...]',
  visualDescriptors: '[Visual descriptors for portrait generation...]',

  // Wizard Service
  genreLabel: 'Fantasy',
  seed: 'A world where magic flows through ancient ley lines...',
  customInstruction: 'Make it feel epic and mysterious.',
  currentSetting: '[Current setting data for refinement...]',
  toneInstruction: 'Maintain a mysterious and wonder-filled tone.',
  settingInstruction: 'Set in a high fantasy world with elemental magic.',
  characterName: 'Aria',
  characterDescription: 'A young woman with silver hair and violet eyes',
  characterBackground: 'Raised in the hidden village of Thornhollow...',
  settingContext: 'A high fantasy world with elemental magic and feudal kingdoms.',
  currentCharacter: '[Current character data for refinement...]',
  settingName: 'The Shattered Realms',
  count: '3',
  outputFormat: 'JSON',
  title: 'Echoes of the Forgotten',
  atmosphereSection: 'A sense of ancient mystery pervades the land...',
  supportingCharactersSection: 'Theron: A loyal ranger. Lyra: A rival mage.',
  tenseInstruction: 'Write in present tense.',
  povPerspective: 'second person',
  povPerspectiveInstructions: 'Address the reader as "you".',
  currentOpening: '[Current opening text for refinement...]',
  openingInstruction: 'Begin with the protagonist arriving at the forest edge.',
  guidanceSection: '[Guidance section for opening refinement...]',
  cardContent: '[Character card content for import...]',
  lorebookName: 'The Shattered Realms Lore',
  entriesJson: '[Lorebook entries JSON for vault import...]',
  entryCount: '12',

  // Interactive Lorebook
  userMessage: 'Tell me about the Crystal Caverns.',
  conversationHistory: '[Conversation history for interactive lorebook...]',
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
      aliases: ['the Woods', 'the Ancient Forest'],
      tier: 1,
    },
    {
      name: 'The Moonstone Pendant',
      type: 'item',
      description: 'A pendant that glows under moonlight, said to reveal hidden paths.',
      aliases: ['the pendant'],
      tier: 1,
    },
    {
      name: 'Elder Maren',
      type: 'character',
      description: 'A wandering sage who guards forgotten knowledge.',
      aliases: ['Old Maren', 'the Sage'],
      tier: 2,
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
  styleOverusedPhrases: ['suddenly', 'all of a sudden', 'with a smile'],
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
}

/** All sample values combined — system strings, runtime strings, and structured arrays */
export const allSamples: Record<string, unknown> = {
  ...systemSamples,
  ...runtimeSamples,
  ...structuredSamples,
}
