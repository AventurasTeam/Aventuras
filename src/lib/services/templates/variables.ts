/**
 * Variable Registry
 *
 * Manages variable definitions across three categories:
 * - system: Auto-filled by the application
 * - runtime: Injected by services at render time
 * - custom: User-defined variables in preset packs
 */

import type { VariableDefinition, VariableCategory, VariableFieldInfo } from './types'

/**
 * System variables - auto-filled by the application
 * These variables are always available in templates and are populated from story context.
 */
export const SYSTEM_VARIABLES: VariableDefinition[] = [
  {
    name: 'protagonistName',
    type: 'text',
    category: 'system',
    description: 'Name of the main character',
    required: true,
  },
  {
    name: 'currentLocation',
    type: 'text',
    category: 'system',
    description: 'Current story location',
    required: false,
  },
  {
    name: 'storyTime',
    type: 'text',
    category: 'system',
    description: 'Current in-story time',
    required: false,
  },
  {
    name: 'genre',
    type: 'text',
    category: 'system',
    description: 'Story genre',
    required: false,
  },
  {
    name: 'tone',
    type: 'text',
    category: 'system',
    description: 'Story tone/mood',
    required: false,
  },
  {
    name: 'settingDescription',
    type: 'text',
    category: 'system',
    description: 'World/setting description',
    required: false,
  },
  {
    name: 'themes',
    type: 'text',
    category: 'system',
    description: 'Story themes as comma-separated list',
    required: false,
  },
  {
    name: 'mode',
    type: 'enum',
    category: 'system',
    description: 'Story mode',
    required: true,
    enumValues: ['adventure', 'creative-writing'],
  },
  {
    name: 'pov',
    type: 'enum',
    category: 'system',
    description: 'Point of view',
    required: true,
    enumValues: ['first', 'second', 'third'],
  },
  {
    name: 'tense',
    type: 'enum',
    category: 'system',
    description: 'Narrative tense',
    required: true,
    enumValues: ['past', 'present'],
  },
]

/**
 * Variable Registry class
 * Manages variable definitions with lookup and categorization capabilities.
 */
class VariableRegistry {
  private variables: Map<string, VariableDefinition>

  constructor() {
    this.variables = new Map()
    // Pre-populate with system variables
    this.registerMany(SYSTEM_VARIABLES)
  }

  /**
   * Register a single variable definition
   *
   * @param definition - Variable definition to register
   * @throws Error if variable name already registered (prevents duplicates)
   */
  register(definition: VariableDefinition): void {
    if (this.variables.has(definition.name)) {
      throw new Error(`Variable '${definition.name}' is already registered`)
    }
    this.variables.set(definition.name, definition)
  }

  /**
   * Register multiple variable definitions
   *
   * @param definitions - Array of variable definitions to register
   */
  registerMany(definitions: VariableDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition)
    }
  }

  /**
   * Get a variable definition by name
   *
   * @param name - Variable name
   * @returns Variable definition or undefined if not found
   */
  get(name: string): VariableDefinition | undefined {
    return this.variables.get(name)
  }

  /**
   * Check if a variable is registered
   *
   * @param name - Variable name
   * @returns True if variable exists
   */
  has(name: string): boolean {
    return this.variables.has(name)
  }

  /**
   * Get all variables in a specific category
   *
   * @param category - Variable category (system, runtime, or custom)
   * @returns Array of variable definitions in that category
   */
  getByCategory(category: VariableCategory): VariableDefinition[] {
    return Array.from(this.variables.values())
      .filter((v) => v.category === category)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Get all registered variable names
   *
   * @returns Array of all variable names
   */
  getAllNames(): string[] {
    return Array.from(this.variables.keys())
  }

  /**
   * Get all registered variable definitions
   *
   * @returns Array of all variable definitions
   */
  getAll(): VariableDefinition[] {
    return Array.from(this.variables.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Clear all variable definitions
   * Useful for reinitialization.
   */
  clear(): void {
    this.variables.clear()
  }

  /**
   * Remove a single variable definition
   *
   * @param name - Variable name to remove
   */
  remove(name: string): void {
    this.variables.delete(name)
  }
}

/**
 * Runtime variables - injected by services at render time
 * These variables are populated by various AI services when building prompts.
 * Registered for autocomplete and validation in the template editor.
 */
export const RUNTIME_VARIABLES: VariableDefinition[] = [
  // === Narrative Service ===
  {
    name: 'recentContent',
    type: 'text',
    category: 'runtime',
    description: 'Recent story content for context',
    required: false,
  },
  {
    name: 'visualProseMode',
    type: 'boolean',
    category: 'runtime',
    description: 'Whether visual prose mode is enabled',
    required: false,
  },
  {
    name: 'inlineImageMode',
    type: 'boolean',
    category: 'runtime',
    description: 'Whether inline image mode is enabled',
    required: false,
  },

  // === Classifier Service ===
  {
    name: 'entityCounts',
    type: 'text',
    category: 'runtime',
    description: 'Count of existing entities (characters, locations, items)',
    required: false,
  },
  {
    name: 'currentTimeInfo',
    type: 'text',
    category: 'runtime',
    description: 'Current in-story time information',
    required: false,
  },
  {
    name: 'inputLabel',
    type: 'text',
    category: 'runtime',
    description: 'Label for user input (Player Action or Author Direction)',
    required: false,
  },
  {
    name: 'userAction',
    type: 'text',
    category: 'runtime',
    description: 'The user action or direction text',
    required: false,
  },
  {
    name: 'narrativeResponse',
    type: 'text',
    category: 'runtime',
    description: 'The narrative response text',
    required: false,
  },
  {
    name: 'storyBeatTypes',
    type: 'text',
    category: 'runtime',
    description: 'Available story beat type values',
    required: false,
  },
  {
    name: 'itemLocationOptions',
    type: 'text',
    category: 'runtime',
    description: 'Valid item location options',
    required: false,
  },
  {
    name: 'defaultItemLocation',
    type: 'text',
    category: 'runtime',
    description: 'Default item location',
    required: false,
  },

  // === Memory Service ===
  {
    name: 'firstValidId',
    type: 'text',
    category: 'runtime',
    description: 'First valid entry ID in range',
    required: false,
  },
  {
    name: 'lastValidId',
    type: 'text',
    category: 'runtime',
    description: 'Last valid entry ID in range',
    required: false,
  },
  {
    name: 'recentContext',
    type: 'text',
    category: 'runtime',
    description: 'Recent narrative context for retrieval',
    required: false,
  },
  {
    name: 'maxChaptersPerRetrieval',
    type: 'text',
    category: 'runtime',
    description: 'Maximum chapters per retrieval decision',
    required: false,
  },

  // === Suggestions Service ===
  {
    name: 'activeThreads',
    type: 'text',
    category: 'runtime',
    description: 'Active plot threads for suggestions',
    required: false,
  },

  // === Action Choices Service ===
  {
    name: 'npcsPresent',
    type: 'text',
    category: 'runtime',
    description: 'NPCs present in the current scene',
    required: false,
  },
  {
    name: 'inventory',
    type: 'text',
    category: 'runtime',
    description: 'Current inventory contents',
    required: false,
  },
  {
    name: 'activeQuests',
    type: 'text',
    category: 'runtime',
    description: 'Active quests and objectives',
    required: false,
  },
  {
    name: 'protagonistDescription',
    type: 'text',
    category: 'runtime',
    description: 'Description of the protagonist',
    required: false,
  },
  {
    name: 'povInstruction',
    type: 'text',
    category: 'runtime',
    description: 'Point of view instruction text',
    required: false,
  },
  {
    name: 'lengthInstruction',
    type: 'text',
    category: 'runtime',
    description: 'Response length instruction',
    required: false,
  },

  // === Shared / Common ===
  {
    name: 'userInput',
    type: 'text',
    category: 'runtime',
    description: 'User input or action text',
    required: false,
  },

  // === Style Reviewer Service ===
  {
    name: 'passageCount',
    type: 'text',
    category: 'runtime',
    description: 'Number of passages being reviewed',
    required: false,
  },

  // === Agentic Retrieval Service ===
  {
    name: 'chaptersCount',
    type: 'text',
    category: 'runtime',
    description: 'Number of available chapters',
    required: false,
  },
  {
    name: 'entriesCount',
    type: 'text',
    category: 'runtime',
    description: 'Number of available lorebook entries',
    required: false,
  },
  // === Timeline Fill Service ===
  {
    name: 'query',
    type: 'text',
    category: 'runtime',
    description: 'Query for timeline fill answer',
    required: false,
  },

  // === Translation Service ===
  {
    name: 'targetLanguage',
    type: 'text',
    category: 'runtime',
    description: 'Target language for translation',
    required: false,
  },
  {
    name: 'sourceLanguage',
    type: 'text',
    category: 'runtime',
    description: 'Source language for translation',
    required: false,
  },
  {
    name: 'content',
    type: 'text',
    category: 'runtime',
    description: 'Content to translate or process',
    required: false,
  },
  {
    name: 'elementsJson',
    type: 'text',
    category: 'runtime',
    description: 'JSON of UI elements for translation',
    required: false,
  },
  {
    name: 'suggestionsJson',
    type: 'text',
    category: 'runtime',
    description: 'JSON of suggestions for translation',
    required: false,
  },
  {
    name: 'choicesJson',
    type: 'text',
    category: 'runtime',
    description: 'JSON of action choices for translation',
    required: false,
  },

  // === Image Services ===
  {
    name: 'imageStylePrompt',
    type: 'text',
    category: 'runtime',
    description: 'Style prompt for image generation',
    required: false,
  },
  {
    name: 'maxImages',
    type: 'text',
    category: 'runtime',
    description: 'Maximum number of images to generate',
    required: false,
  },
  {
    name: 'translatedNarrativeBlock',
    type: 'text',
    category: 'runtime',
    description: 'Translated narrative for image analysis',
    required: false,
  },
  {
    name: 'visualDescriptors',
    type: 'object',
    category: 'runtime',
    description:
      'Structured visual descriptors for portrait generation (face, hair, eyes, build, clothing, accessories, distinguishing)',
    required: false,
    infoFields: [
      { name: 'face', type: 'string', description: 'Skin tone, facial features, expression' },
      { name: 'hair', type: 'string', description: 'Color, length, style, texture' },
      { name: 'eyes', type: 'string', description: 'Color, shape, notable features' },
      { name: 'build', type: 'string', description: 'Height, body type, posture' },
      { name: 'clothing', type: 'string', description: 'Full outfit description' },
      { name: 'accessories', type: 'string', description: 'Jewelry, weapons, bags' },
      { name: 'distinguishing', type: 'string', description: 'Scars, tattoos, birthmarks' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'narrationEntries',
    type: 'array',
    category: 'runtime',
    description: 'All narration entries for background image analysis',
    required: false,
    infoFields: [
      { name: 'type', type: 'string', description: 'Always narration' },
      { name: 'content', type: 'string', description: 'Narration text' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'lastNarrationIndex',
    type: 'text',
    category: 'runtime',
    description: 'Index of the last element in narrationEntries (narrationEntries.length - 1)',
    required: false,
  },

  // === Wizard Service ===
  {
    name: 'genreLabel',
    type: 'text',
    category: 'runtime',
    description: 'Genre label for wizard generation',
    required: false,
  },
  {
    name: 'seed',
    type: 'text',
    category: 'runtime',
    description: 'Seed text for setting expansion',
    required: false,
  },
  {
    name: 'customInstruction',
    type: 'text',
    category: 'runtime',
    description: 'Custom user instructions for generation',
    required: false,
  },
  {
    name: 'currentSetting',
    type: 'text',
    category: 'runtime',
    description: 'Current setting data for refinement',
    required: false,
  },
  {
    name: 'toneInstruction',
    type: 'text',
    category: 'runtime',
    description: 'Tone instruction for wizard generation',
    required: false,
  },
  {
    name: 'settingInstruction',
    type: 'text',
    category: 'runtime',
    description: 'Setting instruction for wizard generation',
    required: false,
  },
  {
    name: 'characterName',
    type: 'text',
    category: 'runtime',
    description: 'Character name for wizard generation',
    required: false,
  },
  {
    name: 'characterDescription',
    type: 'text',
    category: 'runtime',
    description: 'Character description for wizard',
    required: false,
  },
  {
    name: 'characterBackground',
    type: 'text',
    category: 'runtime',
    description: 'Character background for wizard',
    required: false,
  },
  {
    name: 'settingContext',
    type: 'text',
    category: 'runtime',
    description: 'Setting context for character wizard',
    required: false,
  },
  {
    name: 'currentCharacter',
    type: 'text',
    category: 'runtime',
    description: 'Current character data for refinement',
    required: false,
  },
  {
    name: 'settingName',
    type: 'text',
    category: 'runtime',
    description: 'Setting name for wizard generation',
    required: false,
  },
  {
    name: 'count',
    type: 'text',
    category: 'runtime',
    description: 'Count of supporting characters to generate',
    required: false,
  },
  {
    name: 'outputFormat',
    type: 'text',
    category: 'runtime',
    description: 'Output format instruction for wizard',
    required: false,
  },
  {
    name: 'title',
    type: 'text',
    category: 'runtime',
    description: 'Story title for opening generation',
    required: false,
  },
  {
    name: 'atmosphereSection',
    type: 'text',
    category: 'runtime',
    description: 'Atmosphere section for opening generation',
    required: false,
  },
  {
    name: 'supportingCharactersSection',
    type: 'text',
    category: 'runtime',
    description: 'Supporting characters section for opening',
    required: false,
  },
  {
    name: 'tenseInstruction',
    type: 'text',
    category: 'runtime',
    description: 'Tense instruction for wizard',
    required: false,
  },
  {
    name: 'povPerspective',
    type: 'text',
    category: 'runtime',
    description: 'POV perspective description',
    required: false,
  },
  {
    name: 'povPerspectiveInstructions',
    type: 'text',
    category: 'runtime',
    description: 'POV perspective instructions',
    required: false,
  },
  {
    name: 'currentOpening',
    type: 'text',
    category: 'runtime',
    description: 'Current opening text for refinement',
    required: false,
  },
  {
    name: 'openingInstruction',
    type: 'text',
    category: 'runtime',
    description: 'Opening generation instruction',
    required: false,
  },
  {
    name: 'guidanceSection',
    type: 'text',
    category: 'runtime',
    description: 'Guidance section for opening refinement',
    required: false,
  },
  {
    name: 'cardContent',
    type: 'text',
    category: 'runtime',
    description: 'Character card content for import',
    required: false,
  },
  {
    name: 'lorebookName',
    type: 'text',
    category: 'runtime',
    description: 'Lorebook name for vault import',
    required: false,
  },
  {
    name: 'entriesJson',
    type: 'text',
    category: 'runtime',
    description: 'Lorebook entries JSON for vault import',
    required: false,
  },
  {
    name: 'entryCount',
    type: 'text',
    category: 'runtime',
    description: 'Number of lorebook entries in vault import',
    required: false,
  },

  // === Interactive Vault (external template) ===
  {
    name: 'characterCount',
    type: 'text',
    category: 'runtime',
    description: 'Number of characters in the vault',
    required: false,
  },
  {
    name: 'lorebookCount',
    type: 'text',
    category: 'runtime',
    description: 'Number of lorebooks in the vault',
    required: false,
  },
  {
    name: 'totalEntryCount',
    type: 'text',
    category: 'runtime',
    description: 'Total number of lorebook entries in the vault',
    required: false,
  },
  {
    name: 'scenarioCount',
    type: 'text',
    category: 'runtime',
    description: 'Number of scenarios in the vault',
    required: false,
  },

  // === Runtime Variable Context ===
  {
    name: 'runtimeVars_characters',
    type: 'text',
    category: 'runtime',
    description: 'Runtime variable values for all characters (formatted text block)',
    required: false,
  },
  {
    name: 'runtimeVars_locations',
    type: 'text',
    category: 'runtime',
    description: 'Runtime variable values for all locations (formatted text block)',
    required: false,
  },
  {
    name: 'runtimeVars_items',
    type: 'text',
    category: 'runtime',
    description: 'Runtime variable values for all items (formatted text block)',
    required: false,
  },
  {
    name: 'runtimeVars_storyBeats',
    type: 'text',
    category: 'runtime',
    description: 'Runtime variable values for all story beats (formatted text block)',
    required: false,
  },
  {
    name: 'runtimeVars_protagonist',
    type: 'text',
    category: 'runtime',
    description: 'Runtime variable values for the protagonist only',
    required: false,
  },
  {
    name: 'customVariableInstructions',
    type: 'text',
    category: 'runtime',
    description:
      'Custom variable extraction instructions for the classifier (auto-generated from runtime variable definitions)',
    required: false,
  },

  // === Structured Context Arrays ===
  {
    name: 'worldStateCharacters',
    type: 'array',
    category: 'runtime',
    description: 'Characters in the world state, ordered by retrieval tier',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Character name' },
      { name: 'relationship', type: 'string', description: 'e.g. companion, rival, ally' },
      { name: 'description', type: 'string', description: 'Character description' },
      { name: 'traits', type: 'string[]', description: 'Personality traits' },
      { name: 'appearance', type: 'string[]', description: 'Visual appearance details' },
      { name: 'tier', type: 'number', description: 'Retrieval tier 1-3' },
      { name: 'status', type: 'string', description: 'active, inactive, or deceased' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'worldStateInventory',
    type: 'array',
    category: 'runtime',
    description: 'Items in player inventory',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Item name' },
      { name: 'description', type: 'string', description: 'Item description' },
      { name: 'quantity', type: 'number', description: 'Quantity held' },
      { name: 'equipped', type: 'boolean', description: 'Whether the item is currently equipped' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'worldStateBeats',
    type: 'array',
    category: 'runtime',
    description: 'Active story threads and plot beats',
    required: false,
    infoFields: [
      { name: 'title', type: 'string', description: 'Beat title' },
      { name: 'description', type: 'string', description: 'Beat description' },
      { name: 'type', type: 'string', description: 'e.g. discovery, conflict, quest' },
      { name: 'status', type: 'string', description: 'e.g. active, completed, failed' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'worldStateLocations',
    type: 'array',
    category: 'runtime',
    description: 'Known locations (excluding current location)',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Location name' },
      { name: 'description', type: 'string', description: 'Location description' },
      { name: 'visited', type: 'boolean', description: 'Whether the protagonist has visited' },
      { name: 'tier', type: 'number', description: 'Retrieval tier 1-3' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'worldStateRelevantItems',
    type: 'array',
    category: 'runtime',
    description: 'Tier 2/3 items relevant to current context (non-inventory)',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Item name' },
      { name: 'description', type: 'string', description: 'Item description' },
      { name: 'tier', type: 'number', description: 'Retrieval tier (2 or 3)' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'worldStateRelatedBeats',
    type: 'array',
    category: 'runtime',
    description: 'Tier 2/3 story beats related to current context',
    required: false,
    infoFields: [
      { name: 'title', type: 'string', description: 'Beat title' },
      { name: 'description', type: 'string', description: 'Beat description' },
      {
        name: 'type',
        type: 'string',
        description: 'Beat type (discovery, conflict, quest, revelation)',
      },
      {
        name: 'status',
        type: 'string',
        description: 'Beat status (active, completed, failed)',
      },
      { name: 'tier', type: 'number', description: 'Retrieval tier (2 or 3)' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'currentLocationObject',
    type: 'object',
    category: 'runtime',
    description: 'Current location as object with name and description',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Location name' },
      { name: 'description', type: 'string', description: 'Location description' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'lorebookEntries',
    type: 'array',
    category: 'runtime',
    description: 'Retrieved lorebook entries with tier metadata',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Entry name' },
      { name: 'type', type: 'string', description: 'e.g. character, location, item, faction' },
      { name: 'description', type: 'string', description: 'Entry description' },
      { name: 'tier', type: 'number', description: 'Retrieval tier 1-3' },
      {
        name: 'disposition',
        type: 'string',
        description: 'Current disposition (character-only, optional)',
      },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'chapters',
    type: 'array',
    category: 'runtime',
    description: 'Chapter summaries from story history',
    required: false,
    infoFields: [
      { name: 'number', type: 'number', description: 'Chapter number' },
      { name: 'title', type: 'string', description: 'Chapter title' },
      { name: 'summary', type: 'string', description: 'Chapter summary text' },
      { name: 'startTime', type: 'string', description: 'Formatted time or null' },
      { name: 'endTime', type: 'string', description: 'Formatted time or null' },
      { name: 'characters', type: 'string[]', description: 'Character names' },
      { name: 'locations', type: 'string[]', description: 'Location names' },
      { name: 'emotionalTone', type: 'string', description: 'Emotional tone of the chapter' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'timelineFill',
    type: 'array',
    category: 'runtime',
    description: 'Timeline gap-fill Q&A results between chapters',
    required: false,
    infoFields: [
      { name: 'query', type: 'string', description: 'The question posed to fill the timeline gap' },
      { name: 'answer', type: 'string', description: 'The generated answer' },
      { name: 'chapterNumbers', type: 'number[]', description: 'Chapter range covered' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'storyEntries',
    type: 'array',
    category: 'runtime',
    description: 'Recent story entries (actions and narration)',
    required: false,
    infoFields: [
      { name: 'type', type: 'string', description: 'user_action or narration' },
      { name: 'content', type: 'string', description: 'Entry text' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'styleReview',
    type: 'object' as const,
    category: 'runtime' as const,
    description: 'Style analysis result with overused phrases and assessment',
    required: false,
    infoFields: [
      { name: 'phrases', type: 'array', description: 'Array of PhraseAnalysis objects' },
      { name: 'phrases[].phrase', type: 'string', description: 'The overused phrase' },
      { name: 'phrases[].frequency', type: 'number', description: 'Times used in recent entries' },
      { name: 'phrases[].severity', type: 'string', description: 'low, medium, or high' },
      {
        name: 'phrases[].alternatives',
        type: 'string[]',
        description: 'Suggested replacement phrases',
      },
      {
        name: 'overallAssessment',
        type: 'string',
        description: 'Overall style assessment summary',
      },
      {
        name: 'reviewedEntryCount',
        type: 'number',
        description: 'Number of entries analyzed',
      },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'agenticRetrievalContext',
    type: 'text' as const,
    category: 'runtime' as const,
    description: 'LLM-formatted Q&A context from agentic chapter retrieval',
    required: false,
  },

  // === Structured Context Arrays (v1.2) ===
  {
    name: 'characters',
    type: 'array',
    category: 'runtime',
    description: 'Character list for classifier templates',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Character name' },
      { name: 'relationship', type: 'string', description: 'Relationship to protagonist' },
      { name: 'description', type: 'string', description: 'Character description' },
      { name: 'traits', type: 'string[]', description: 'Personality traits' },
      { name: 'appearance', type: 'string[]', description: 'Visual appearance details' },
      { name: 'tier', type: 'number', description: 'Retrieval tier 1-3' },
      { name: 'status', type: 'string', description: 'active, inactive, or deceased' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'storyBeats',
    type: 'array',
    category: 'runtime',
    description: 'Story beat list for classifier templates',
    required: false,
    infoFields: [
      { name: 'title', type: 'string', description: 'Beat title' },
      { name: 'description', type: 'string', description: 'Beat description' },
      { name: 'type', type: 'string', description: 'Beat type (milestone, quest, etc.)' },
      { name: 'status', type: 'string', description: 'pending, active, completed, or failed' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'chatHistory',
    type: 'array',
    category: 'runtime',
    description: 'Chat history for classifier and image context',
    required: false,
    infoFields: [
      { name: 'type', type: 'string', description: 'user_action or narration' },
      { name: 'content', type: 'string', description: 'Entry text content' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'passages',
    type: 'array',
    category: 'runtime',
    description: 'Story passages for style review',
    required: false,
    infoFields: [
      { name: 'content', type: 'string', description: 'Passage text content' },
      { name: 'entryId', type: 'string', description: 'ID of the source story entry' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'availableEntries',
    type: 'array',
    category: 'runtime',
    description: 'Available lorebook entries for tier-3 selection',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Entry name' },
      { name: 'type', type: 'string', description: 'e.g. character, location, item, faction' },
      { name: 'description', type: 'string', description: 'Entry description' },
      { name: 'keywords', type: 'string', description: 'Comma-separated keywords (optional)' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'recentEntries',
    type: 'array',
    category: 'runtime',
    description: 'Recent story entries for tier-3 and retrieval-decision templates',
    required: false,
    infoFields: [
      { name: 'type', type: 'string', description: 'user_action or narration' },
      { name: 'content', type: 'string', description: 'Entry text content' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'messagesInRange',
    type: 'array',
    category: 'runtime',
    description: 'Story entries in range for chapter analysis',
    required: false,
    infoFields: [
      { name: 'type', type: 'string', description: 'user_action or narration' },
      { name: 'content', type: 'string', description: 'Entry text content' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'chapterEntries',
    type: 'array',
    category: 'runtime',
    description: 'Story entries within a chapter for summarization',
    required: false,
    infoFields: [
      { name: 'type', type: 'string', description: 'user_action or narration' },
      { name: 'content', type: 'string', description: 'Entry text content' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'previousChapters',
    type: 'array',
    category: 'runtime',
    description: 'Previous chapter summaries for chapter summarization context',
    required: false,
    infoFields: [
      { name: 'number', type: 'number', description: 'Chapter number' },
      { name: 'title', type: 'string', description: 'Chapter title' },
      { name: 'summary', type: 'string', description: 'Chapter summary text' },
      { name: 'startTime', type: 'string', description: 'Formatted start time or null' },
      { name: 'endTime', type: 'string', description: 'Formatted end time or null' },
      { name: 'characters', type: 'string[]', description: 'Character names in this chapter' },
      { name: 'locations', type: 'string[]', description: 'Location names in this chapter' },
      { name: 'emotionalTone', type: 'string', description: 'Emotional tone of the chapter' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'loreEntries',
    type: 'array',
    category: 'runtime',
    description: 'Lorebook entries for lore management templates',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Entry name' },
      { name: 'type', type: 'string', description: 'e.g. character, location, item, faction' },
      { name: 'description', type: 'string', description: 'Entry description' },
      { name: 'state', type: 'string', description: 'Current dynamic state (optional)' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'loreChapters',
    type: 'array',
    category: 'runtime',
    description: 'Chapter summaries for lore management templates',
    required: false,
    infoFields: [
      { name: 'number', type: 'number', description: 'Chapter number' },
      { name: 'title', type: 'string', description: 'Chapter title' },
      { name: 'summary', type: 'string', description: 'Chapter summary text' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'agenticChapters',
    type: 'array',
    category: 'runtime',
    description: 'Chapter summaries for agentic retrieval templates',
    required: false,
    infoFields: [
      { name: 'number', type: 'number', description: 'Chapter number' },
      { name: 'title', type: 'string', description: 'Chapter title' },
      { name: 'summary', type: 'string', description: 'Chapter summary text' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'agenticEntries',
    type: 'array',
    category: 'runtime',
    description: 'Lorebook entries for agentic retrieval templates',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Entry name' },
      { name: 'type', type: 'string', description: 'e.g. character, location, item, faction' },
      { name: 'description', type: 'string', description: 'Entry description' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'sceneCharacters',
    type: 'array',
    category: 'runtime',
    description: 'Characters in scene for image generation templates',
    required: false,
    infoFields: [
      { name: 'name', type: 'string', description: 'Character name' },
      { name: 'description', type: 'string', description: 'Character description' },
      {
        name: 'visualDescriptors',
        type: 'object',
        description: 'Visual descriptor fields for image prompts',
      },
      {
        name: 'visualDescriptors.face',
        type: 'string',
        description: 'Skin tone, facial features, expression',
      },
      {
        name: 'visualDescriptors.hair',
        type: 'string',
        description: 'Color, length, style, texture',
      },
      {
        name: 'visualDescriptors.eyes',
        type: 'string',
        description: 'Color, shape, notable features',
      },
      {
        name: 'visualDescriptors.build',
        type: 'string',
        description: 'Height, body type, posture',
      },
      {
        name: 'visualDescriptors.clothing',
        type: 'string',
        description: 'Full outfit description',
      },
      {
        name: 'visualDescriptors.accessories',
        type: 'string',
        description: 'Jewelry, weapons, bags',
      },
      {
        name: 'visualDescriptors.distinguishing',
        type: 'string',
        description: 'Scars, tattoos, birthmarks',
      },
      { name: 'portrait', type: 'string', description: 'Portrait data URL (null if none)' },
    ] satisfies VariableFieldInfo[],
  },
  {
    name: 'answerChapters',
    type: 'array',
    category: 'runtime',
    description: 'Chapters for timeline-fill-answer templates',
    required: false,
    infoFields: [
      { name: 'number', type: 'number', description: 'Chapter number' },
      { name: 'title', type: 'string', description: 'Chapter title' },
      { name: 'summary', type: 'string', description: 'Chapter summary text' },
      {
        name: 'entries',
        type: 'array',
        description: 'Optional story entries within this chapter (ContextStoryEntry[])',
      },
    ] satisfies VariableFieldInfo[],
  },
]

/**
 * Singleton variable registry instance
 * Pre-loaded with system and runtime variables. Use this throughout the application.
 */
export const variableRegistry = new VariableRegistry()

// Register runtime variables at module load time
variableRegistry.registerMany(RUNTIME_VARIABLES)
