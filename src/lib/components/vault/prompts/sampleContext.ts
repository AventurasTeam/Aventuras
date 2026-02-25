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

/** All sample values combined (system + runtime) */
export const allSamples: Record<string, string> = { ...systemSamples, ...runtimeSamples }
