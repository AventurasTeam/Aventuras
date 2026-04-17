/**
 * Template Context Map
 *
 * Maps each templateId to a context group name and defines the variables
 * available in that group. This is the single source of truth for which
 * variables each template family can reference at render time.
 */

import type { VariableDefinition, VariableFieldInfo } from './types'
import { createLogger } from '$lib/log'

const log = createLogger('TemplateContextMap')
const warnedUnmappedIds = new Set<string>()

// ---------------------------------------------------------------------------
// Context group names
// ---------------------------------------------------------------------------

export type ContextGroupName =
  | 'promptContext'
  | 'timelineFillAnswer'
  | 'wizard'
  | 'vault'
  | 'lore'
  | 'import'
  | 'portrait'
  | 'translateWizard'
  | 'staticContent'

// ---------------------------------------------------------------------------
// Display group (semantic UI grouping)
// ---------------------------------------------------------------------------

export interface DisplayGroup {
  label: string
  variables: readonly string[]
}

// ---------------------------------------------------------------------------
// Template -> context group mapping
// ---------------------------------------------------------------------------

const TEMPLATE_GROUP_MAP: Record<string, ContextGroupName> = {
  // promptContext
  adventure: 'promptContext',
  'creative-writing': 'promptContext',
  classifier: 'promptContext',
  suggestions: 'promptContext',
  'action-choices': 'promptContext',
  'style-reviewer': 'promptContext',
  'chapter-analysis': 'promptContext',
  'chapter-summarization': 'promptContext',
  'agentic-retrieval': 'promptContext',
  'timeline-fill': 'promptContext',
  'tier3-entry-selection': 'promptContext',
  'image-prompt-analysis': 'promptContext',
  'image-prompt-analysis-reference': 'promptContext',
  'background-image-prompt-analysis': 'promptContext',
  'translate-narration': 'promptContext',
  'translate-input': 'promptContext',
  'translate-ui': 'promptContext',
  'translate-suggestions': 'promptContext',
  'translate-action-choices': 'promptContext',

  // timelineFillAnswer — same variables as promptContext plus `answerChapters`
  // and `query`, which only exist during the second stage of timeline fill.
  'timeline-fill-answer': 'timelineFillAnswer',

  // wizard
  'setting-expansion': 'wizard',
  'setting-refinement': 'wizard',
  'character-elaboration': 'wizard',
  'character-refinement': 'wizard',
  'protagonist-generation': 'wizard',
  'supporting-characters': 'wizard',
  'opening-generation-adventure': 'wizard',
  'opening-generation-creative': 'wizard',
  'opening-refinement-adventure': 'wizard',
  'opening-refinement-creative': 'wizard',

  // vault
  'interactive-lorebook': 'vault',

  // lore
  'lore-management': 'lore',

  // import
  'character-card-import': 'import',
  'vault-character-import': 'import',
  'lorebook-classifier': 'import',

  // portrait
  'image-portrait-generation': 'portrait',

  // translateWizard
  'translate-wizard-content': 'translateWizard',

  // staticContent (partials with no variables, included by other templates)
  'image-style-photorealistic': 'staticContent',
  'image-style-semi-realistic': 'staticContent',
  'image-style-soft-anime': 'staticContent',
}

// ---------------------------------------------------------------------------
// Helper to build VariableDefinition concisely
// ---------------------------------------------------------------------------

function v(
  name: string,
  type: VariableDefinition['type'],
  description: string,
  opts?: {
    required?: boolean
    category?: VariableDefinition['category']
    enumValues?: string[]
    infoFields?: VariableFieldInfo[]
  },
): VariableDefinition {
  return {
    name,
    type,
    category: opts?.category ?? 'runtime',
    description,
    required: opts?.required ?? false,
    ...(opts?.enumValues ? { enumValues: opts.enumValues } : {}),
    ...(opts?.infoFields ? { infoFields: opts.infoFields } : {}),
  }
}

// ---------------------------------------------------------------------------
// Shared infoFields used across multiple groups
// ---------------------------------------------------------------------------

const storyEntryFields: VariableFieldInfo[] = [
  { name: 'type', type: 'string', description: 'user_action or narration' },
  { name: 'content', type: 'string', description: 'Entry text' },
]

const storyEntryRawFields: VariableFieldInfo[] = [
  { name: 'type', type: 'string', description: 'Entry type' },
  { name: 'content', type: 'string', description: 'Entry text' },
  { name: 'id', type: 'string', description: 'Entry ID' },
]

const characterFields: VariableFieldInfo[] = [
  { name: 'name', type: 'string', description: 'Character name' },
  { name: 'relationship', type: 'string', description: 'e.g. companion, rival, ally (nullable)' },
  { name: 'description', type: 'string', description: 'Character description (nullable)' },
  { name: 'traits', type: 'string[]', description: 'Personality traits' },
  { name: 'appearance', type: 'string[]', description: 'Visual appearance details' },
  { name: 'status', type: 'string', description: 'active, inactive, or deceased' },
]

const locationFields: VariableFieldInfo[] = [
  { name: 'name', type: 'string', description: 'Location name' },
  { name: 'description', type: 'string', description: 'Location description' },
  { name: 'visited', type: 'boolean', description: 'Whether the protagonist has visited' },
  { name: 'current', type: 'boolean', description: 'Whether this is the current location' },
]

const itemFields: VariableFieldInfo[] = [
  { name: 'name', type: 'string', description: 'Item name' },
  { name: 'description', type: 'string', description: 'Item description (nullable)' },
  { name: 'quantity', type: 'number', description: 'Quantity held' },
  { name: 'equipped', type: 'boolean', description: 'Whether equipped' },
  { name: 'location', type: 'string', description: 'Item location' },
]

const storyBeatFields: VariableFieldInfo[] = [
  { name: 'title', type: 'string', description: 'Beat title' },
  { name: 'description', type: 'string', description: 'Beat description' },
  { name: 'type', type: 'string', description: 'e.g. discovery, conflict, quest' },
  { name: 'status', type: 'string', description: 'e.g. active, completed, failed' },
]

const chapterFields: VariableFieldInfo[] = [
  { name: 'number', type: 'number', description: 'Chapter number' },
  { name: 'title', type: 'string', description: 'Chapter title' },
  { name: 'summary', type: 'string', description: 'Chapter summary text' },
  { name: 'startTime', type: 'string', description: 'Formatted time or null' },
  { name: 'endTime', type: 'string', description: 'Formatted time or null' },
  { name: 'characters', type: 'string[]', description: 'Character names' },
  { name: 'locations', type: 'string[]', description: 'Location names' },
  { name: 'emotionalTone', type: 'string', description: 'Emotional tone' },
]

const lorebookEntryFields: VariableFieldInfo[] = [
  { name: 'name', type: 'string', description: 'Entry name' },
  { name: 'type', type: 'string', description: 'e.g. character, location, item, faction' },
  { name: 'description', type: 'string', description: 'Entry description' },
  { name: 'tier', type: 'number', description: 'Retrieval tier 1-3 (optional)' },
  {
    name: 'disposition',
    type: 'string',
    description: 'Current disposition (character-only, optional)',
  },
  { name: 'hiddenInfo', type: 'string', description: 'Hidden lore (optional)' },
]

// Wizard runs before retrieval tiers are assigned, so `tier` is meaningless
// there — drop it from the documented fields to avoid misleading authors.
const lorebookEntryWizardFields: VariableFieldInfo[] = lorebookEntryFields.filter(
  (f) => f.name !== 'tier',
)

// ---------------------------------------------------------------------------
// promptContext variable definitions
// ---------------------------------------------------------------------------

const PROMPT_CONTEXT_VARS: VariableDefinition[] = [
  // Story Config
  v('mode', 'enum', 'Story mode', {
    required: true,
    category: 'system',
    enumValues: ['adventure', 'creative-writing'],
  }),
  v('pov', 'enum', 'Point of view', {
    required: true,
    category: 'system',
    enumValues: ['first', 'second', 'third'],
  }),
  v('tense', 'enum', 'Narrative tense', {
    required: true,
    category: 'system',
    enumValues: ['past', 'present'],
  }),
  v('protagonistName', 'text', 'Name of the main character', {
    required: true,
    category: 'system',
  }),
  v('protagonistDescription', 'text', 'Physical/personality description of the protagonist', {
    category: 'system',
  }),
  v('genre', 'text', 'Story genre', { category: 'system' }),
  v('settingDescription', 'text', 'World/setting description', { category: 'system' }),
  v('tone', 'text', 'Story tone/mood', { category: 'system' }),
  v('themes', 'array', 'Story themes', { category: 'system' }),

  // Story Content
  v('storyEntries', 'array', 'Story entries (type + content pairs)', {
    infoFields: storyEntryFields,
  }),
  v('storyEntriesRaw', 'array', 'Full StoryEntry objects (unfiltered)', {
    infoFields: storyEntryRawFields,
  }),
  v('storyEntriesVisible', 'array', 'Visible story entries (filtered)', {
    infoFields: storyEntryFields,
  }),
  v('storyEntriesVisibleRaw', 'array', 'Visible story entries (full objects)', {
    infoFields: storyEntryRawFields,
  }),
  v('userInput', 'text', 'Current user input text'),
  v('userActionOriginal', 'text', 'Original user action before processing'),
  v(
    'narrationEntryId',
    'text',
    'ID of the narration entry currently being classified (used to exclude it from chat history)',
  ),
  v('lastNarrativeEntry', 'object', 'Most recent narrative entry', {
    infoFields: [
      { name: 'type', type: 'string', description: 'Always narration' },
      { name: 'content', type: 'string', description: 'Narration text' },
    ],
  }),

  // Entity Data
  v('characters', 'array', 'Story characters', { infoFields: characterFields }),
  v('locations', 'array', 'Known story locations', { infoFields: locationFields }),
  v('items', 'array', 'Player inventory items', { infoFields: itemFields }),
  v('storyBeats', 'array', 'Active story beats/threads', { infoFields: storyBeatFields }),
  v('chapters', 'array', 'Story chapters', { infoFields: chapterFields }),
  v('lorebookEntries', 'array', 'Lorebook entries', { infoFields: lorebookEntryFields }),

  // World State
  v('relevantWorldState', 'object', 'Tiered world state from EntryInjector', {
    infoFields: [
      {
        name: 'characters',
        type: 'array',
        description: 'Tiered characters with visual descriptors',
      },
      { name: 'inventory', type: 'array', description: 'Player inventory items' },
      { name: 'storyBeats', type: 'array', description: 'Active story threads' },
      { name: 'locations', type: 'array', description: 'Known locations' },
      { name: 'relevantItems', type: 'array', description: 'Tier 2/3 relevant items' },
      { name: 'relatedStoryBeats', type: 'array', description: 'Tier 2/3 related beats' },
    ],
  }),

  // Entry Selection
  v('loreEntriesForTier3', 'array', 'Lorebook entries for tier-3 LLM selection'),
  v('worldStateForTier3', 'array', 'World state candidates for tier-3 selection'),

  // Settings
  v('userSettings', 'object', 'User and story settings', {
    infoFields: [
      {
        name: 'visualProseMode',
        type: 'boolean',
        description: 'Whether visual prose mode is enabled',
      },
      {
        name: 'classifier.maxEntries',
        type: 'number',
        description: 'Max entries for classifier',
      },
      {
        name: 'retrieval.maxStoryEntries',
        type: 'number',
        description: 'Max story entries for retrieval',
      },
      {
        name: 'agenticRetrieval.recentEntriesCount',
        type: 'number',
        description: 'Recent entries count',
      },
      {
        name: 'agenticRetrieval.maxChapters',
        type: 'number',
        description: 'Max chapters per retrieval',
      },
      {
        name: 'agenticRetrieval.summaryCharLimit',
        type: 'number',
        description: 'Summary character limit',
      },
      {
        name: 'agenticRetrieval.maxLorebookEntries',
        type: 'number',
        description: 'Max lorebook entries',
      },
      { name: 'memoryConfig', type: 'object', description: 'Memory configuration' },
      { name: 'lorebookConfig', type: 'object', description: 'Lorebook limits settings' },
      {
        name: 'imageGeneration.inlineImageMode',
        type: 'boolean',
        description: 'Inline image mode enabled',
      },
      {
        name: 'imageGeneration.referenceMode',
        type: 'boolean',
        description: 'Reference mode enabled',
      },
      {
        name: 'imageGeneration.maxImages',
        type: 'number',
        description: 'Max images per message',
      },
      {
        name: 'imageGeneration.stylePrompt',
        type: 'string',
        description: 'Style prompt for image generation',
      },
      {
        name: 'translationSettings.targetLanguage.code',
        type: 'string',
        description: 'Target language code',
      },
      {
        name: 'translationSettings.targetLanguage.name',
        type: 'string',
        description: 'Target language name',
      },
      {
        name: 'translationSettings.sourceLanguage.code',
        type: 'string',
        description: 'Source language code',
      },
      {
        name: 'translationSettings.sourceLanguage.name',
        type: 'string',
        description: 'Source language name',
      },
    ],
  }),

  // Generation Results
  v('styleReview', 'object', 'Style analysis result', {
    infoFields: [
      { name: 'phrases', type: 'array', description: 'Array of PhraseAnalysis objects' },
      { name: 'phrases[].phrase', type: 'string', description: 'The overused phrase' },
      { name: 'phrases[].frequency', type: 'number', description: 'Times used' },
      { name: 'phrases[].severity', type: 'string', description: 'low, medium, or high' },
      { name: 'phrases[].alternatives', type: 'string[]', description: 'Suggested replacements' },
      { name: 'overallAssessment', type: 'string', description: 'Overall style assessment' },
      { name: 'reviewedEntryCount', type: 'number', description: 'Entries analyzed' },
    ],
  }),
  v('retrievalResult', 'object', 'Lorebook retrieval results'),
  v('classificationResult', 'object', 'World state classification results'),
  v('narrativeResult', 'object', 'Narrative generation result', {
    infoFields: [{ name: 'content', type: 'string', description: 'Generated narrative text' }],
  }),
  v('translationResult', 'object', 'Translation results'),

  // Memory
  v('chapterAnalysis', 'object', 'Chapter analysis context', {
    infoFields: [
      { name: 'result', type: 'object', description: 'Chapter analysis result' },
      { name: 'protectedEntryCount', type: 'number', description: 'Protected entry count' },
      {
        name: 'analysisEntries',
        type: 'array',
        description: 'Entries for analysis (StoryEntry[])',
      },
      {
        name: 'chapterEntries',
        type: 'array',
        description: 'Entries within chapter (StoryEntry[])',
      },
    ],
  }),
  v('lastChapterEndIndex', 'number', 'Index of last chapter end'),

  // Pack Variables (classifier uses packVariables.runtimeVariables for extraction instructions)
  v(
    'packVariables.runtimeVariables',
    'object',
    'Runtime variable definitions grouped by entity type (for classifier)',
    {
      infoFields: [
        {
          name: 'character',
          type: 'RuntimeVariable[]',
          description: 'Variables for character entities',
        },
        {
          name: 'location',
          type: 'RuntimeVariable[]',
          description: 'Variables for location entities',
        },
        { name: 'item', type: 'RuntimeVariable[]', description: 'Variables for item entities' },
        {
          name: 'story_beat',
          type: 'RuntimeVariable[]',
          description: 'Variables for story beat entities',
        },
      ],
    },
  ),

  // Translation Data
  v('suggestionsToTranslate', 'array', 'Suggestions for translation'),
  v('actionChoicesToTranslate', 'array', 'Action choices for translation'),
  v('uiElementsToTranslate', 'array', 'UI elements for translation'),

  // Time
  v('timeTracker', 'object', 'In-story time tracking'),
]

// ---------------------------------------------------------------------------
// timelineFillAnswer variable definitions
// (all promptContext vars + extras)
// ---------------------------------------------------------------------------

const TIMELINE_FILL_ANSWER_EXTRA_VARS: VariableDefinition[] = [
  v('answerChapters', 'array', 'Chapters with optional embedded entries', {
    infoFields: [
      { name: 'number', type: 'number', description: 'Chapter number' },
      { name: 'title', type: 'string', description: 'Chapter title' },
      { name: 'summary', type: 'string', description: 'Chapter summary' },
      { name: 'entries', type: 'array', description: 'Optional story entries within chapter' },
    ],
  }),
  v('query', 'text', 'Query for timeline fill answer'),
]

const TIMELINE_FILL_ANSWER_VARS: VariableDefinition[] = [
  ...PROMPT_CONTEXT_VARS,
  ...TIMELINE_FILL_ANSWER_EXTRA_VARS,
]

// ---------------------------------------------------------------------------
// wizard variable definitions
// ---------------------------------------------------------------------------

const WIZARD_VARS: VariableDefinition[] = [
  // Story Setup (scalars)
  v('genreLabel', 'text', 'Genre label for display'),
  v('seed', 'text', 'Seed text or idea for generation'),
  v('customInstruction', 'text', 'Custom user instruction'),
  v('toneInstruction', 'text', 'Tone instruction text'),
  v('settingInstruction', 'text', 'Setting instruction text'),
  v('settingContext', 'text', 'Setting context text'),
  v('settingName', 'text', 'Setting name'),
  v('settingDescription', 'text', 'Setting description'),
  v('settingAtmosphere', 'text', 'Setting atmosphere and mood'),
  v('settingThemesText', 'text', 'Setting themes as text'),
  v('count', 'number', 'Number of items to generate'),
  v('title', 'text', 'Title for generation'),
  v('atmosphere', 'text', 'Atmosphere description'),
  v('openingGuidance', 'text', 'Guidance for opening generation'),
  v('tenseInstruction', 'text', 'Tense instruction text'),
  v('mode', 'enum', 'Story mode', {
    enumValues: ['adventure', 'creative-writing'],
  }),
  v('pov', 'enum', 'Point of view', {
    enumValues: ['first', 'second', 'third'],
  }),
  v('tone', 'text', 'Story tone/mood'),
  v('protagonistName', 'text', 'Protagonist name'),
  v('protagonistDescription', 'text', 'Protagonist description'),

  // Setting (objects)
  v('currentSetting', 'object', 'Current setting data', {
    infoFields: [
      { name: 'name', type: 'string', description: 'Setting name' },
      { name: 'description', type: 'string', description: 'Setting description' },
      { name: 'atmosphere', type: 'string', description: 'Atmosphere and mood' },
      { name: 'themes', type: 'string[]', description: 'Thematic elements' },
      { name: 'potentialConflicts', type: 'string[]', description: 'Potential story conflicts' },
      {
        name: 'keyLocations',
        type: 'array',
        description: 'Key locations ({name, description})',
      },
    ],
  }),

  // Character (objects)
  v('characterInput', 'object', 'Character input for elaboration', {
    infoFields: [
      { name: 'name', type: 'string', description: 'Character name' },
      { name: 'description', type: 'string', description: 'Physical description' },
      { name: 'background', type: 'string', description: 'Backstory' },
      { name: 'motivation', type: 'string', description: 'Goals' },
      { name: 'traits', type: 'string[]', description: 'Personality traits' },
    ],
  }),
  v('currentCharacter', 'object', 'Current character data for refinement', {
    infoFields: [
      { name: 'name', type: 'string', description: 'Character name' },
      { name: 'description', type: 'string', description: 'Physical description' },
      { name: 'background', type: 'string', description: 'Backstory' },
      { name: 'motivation', type: 'string', description: 'Goals' },
      { name: 'traits', type: 'string[]', description: 'Personality traits' },
      { name: 'appearance', type: 'string', description: 'Detailed appearance' },
    ],
  }),
  v('protagonist', 'object', 'Protagonist data', {
    infoFields: [
      { name: 'name', type: 'string', description: 'Protagonist name' },
      { name: 'description', type: 'string', description: 'Description' },
      { name: 'motivation', type: 'string', description: 'Motivation' },
    ],
  }),

  // Opening (object)
  v('currentOpening', 'object', 'Current opening data for refinement', {
    infoFields: [
      { name: 'title', type: 'string', description: 'Opening title' },
      { name: 'scene', type: 'string', description: 'Opening scene prose' },
      {
        name: 'initialLocation',
        type: 'object',
        description: 'Starting location ({name, description})',
      },
    ],
  }),

  // Lorebook
  v('lorebookEntries', 'array', 'Lorebook entries', { infoFields: lorebookEntryWizardFields }),

  // Supporting Characters
  v('supportingCharacters', 'array', 'Supporting characters', {
    infoFields: [
      { name: 'name', type: 'string', description: 'Character name' },
      { name: 'role', type: 'string', description: 'Role (ally, antagonist, etc.)' },
      { name: 'description', type: 'string', description: 'Character description' },
      { name: 'relationship', type: 'string', description: 'Relationship to protagonist' },
      { name: 'traits', type: 'string[]', description: 'Personality traits' },
    ],
  }),
]

// ---------------------------------------------------------------------------
// vault variable definitions
// ---------------------------------------------------------------------------

const VAULT_VARS: VariableDefinition[] = [
  v('characterCount', 'number', 'Number of vault characters'),
  v('lorebookCount', 'number', 'Number of lorebook entries'),
  v('totalEntryCount', 'number', 'Total number of vault entries'),
  v('scenarioCount', 'number', 'Number of scenarios'),
  v('focusedEntity', 'object', 'Currently focused vault entity', {
    infoFields: [
      { name: 'entityType', type: 'string', description: 'Entity type' },
      { name: 'entityName', type: 'string', description: 'Entity name' },
      { name: 'entityId', type: 'string', description: 'Entity ID' },
    ],
  }),
]

// ---------------------------------------------------------------------------
// lore variable definitions
// ---------------------------------------------------------------------------

const LORE_VARS: VariableDefinition[] = [
  v('loreEntries', 'array', 'Lorebook entries for management', {
    infoFields: [
      { name: 'name', type: 'string', description: 'Entry name' },
      { name: 'type', type: 'string', description: 'Entry type' },
      { name: 'description', type: 'string', description: 'Entry description' },
      { name: 'state', type: 'string', description: 'Current dynamic state (optional)' },
    ],
  }),
  v('loreChapters', 'array', 'Chapters for lore context', {
    infoFields: [
      { name: 'number', type: 'number', description: 'Chapter number' },
      { name: 'title', type: 'string', description: 'Chapter title' },
      { name: 'summary', type: 'string', description: 'Chapter summary' },
    ],
  }),
]

// ---------------------------------------------------------------------------
// import variable definitions
// ---------------------------------------------------------------------------

const IMPORT_VARS: VariableDefinition[] = [
  v('genre', 'text', 'Genre for import context'),
  v('title', 'text', 'Title of imported content'),
  v('cardContent', 'text', 'Raw character card content'),
  v('entriesJson', 'text', 'Entries as JSON string'),
]

// ---------------------------------------------------------------------------
// portrait variable definitions
// ---------------------------------------------------------------------------

const PORTRAIT_VARS: VariableDefinition[] = [
  v('imageStylePrompt', 'text', 'Style prompt for portrait generation'),
  v('visualDescriptors', 'object', 'Character visual descriptors', {
    infoFields: [
      { name: 'face', type: 'string', description: 'Skin tone, facial features, expression' },
      { name: 'hair', type: 'string', description: 'Color, length, style' },
      { name: 'eyes', type: 'string', description: 'Color, shape, notable features' },
      { name: 'build', type: 'string', description: 'Height, body type, posture' },
      { name: 'clothing', type: 'string', description: 'Full outfit description' },
      { name: 'accessories', type: 'string', description: 'Jewelry, weapons, bags' },
      { name: 'distinguishing', type: 'string', description: 'Scars, tattoos, birthmarks' },
    ],
  }),
]

// ---------------------------------------------------------------------------
// translateWizard variable definitions
// ---------------------------------------------------------------------------

const TRANSLATE_WIZARD_VARS: VariableDefinition[] = [
  v('targetLanguage', 'text', 'Target language for translation'),
  v('content', 'text', 'Content to translate'),
]

// ---------------------------------------------------------------------------
// Group name -> variable definitions
// ---------------------------------------------------------------------------

const GROUP_VARIABLES: Record<ContextGroupName, VariableDefinition[]> = {
  promptContext: PROMPT_CONTEXT_VARS,
  timelineFillAnswer: TIMELINE_FILL_ANSWER_VARS,
  wizard: WIZARD_VARS,
  vault: VAULT_VARS,
  lore: LORE_VARS,
  import: IMPORT_VARS,
  portrait: PORTRAIT_VARS,
  translateWizard: TRANSLATE_WIZARD_VARS,
  staticContent: [],
}

// ---------------------------------------------------------------------------
// Display groups per context group
// ---------------------------------------------------------------------------

const PROMPT_CONTEXT_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    label: 'Story Config',
    variables: [
      'mode',
      'pov',
      'tense',
      'protagonistName',
      'protagonistDescription',
      'genre',
      'settingDescription',
      'tone',
      'themes',
    ],
  },
  {
    label: 'Story Content',
    variables: [
      'storyEntries',
      'storyEntriesRaw',
      'storyEntriesVisible',
      'storyEntriesVisibleRaw',
      'userInput',
      'userActionOriginal',
      'narrationEntryId',
      'lastNarrativeEntry',
    ],
  },
  {
    label: 'Entities',
    variables: ['characters', 'locations', 'items', 'storyBeats', 'chapters', 'lorebookEntries'],
  },
  {
    label: 'World State',
    variables: ['relevantWorldState'],
  },
  {
    label: 'Entry Selection',
    variables: ['loreEntriesForTier3', 'worldStateForTier3'],
  },
  {
    label: 'Settings',
    variables: ['userSettings'],
  },
  {
    label: 'Generation Results',
    variables: [
      'styleReview',
      'retrievalResult',
      'classificationResult',
      'narrativeResult',
      'translationResult',
    ],
  },
  {
    label: 'Memory',
    variables: ['chapterAnalysis', 'lastChapterEndIndex'],
  },
  {
    label: 'Pack Variables',
    variables: ['packVariables.runtimeVariables'],
  },
  {
    label: 'Translation Data',
    variables: ['suggestionsToTranslate', 'actionChoicesToTranslate', 'uiElementsToTranslate'],
  },
  {
    label: 'Time',
    variables: ['timeTracker'],
  },
]

const TIMELINE_FILL_ANSWER_DISPLAY_GROUPS: DisplayGroup[] = [
  ...PROMPT_CONTEXT_DISPLAY_GROUPS,
  {
    label: 'Timeline Fill',
    variables: ['answerChapters', 'query'],
  },
]

const WIZARD_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    label: 'Story Setup',
    variables: [
      'genreLabel',
      'seed',
      'customInstruction',
      'toneInstruction',
      'settingInstruction',
      'settingContext',
      'settingName',
      'settingDescription',
      'settingAtmosphere',
      'settingThemesText',
      'count',
      'title',
      'atmosphere',
      'openingGuidance',
      'tenseInstruction',
      'mode',
      'pov',
      'tone',
      'protagonistName',
      'protagonistDescription',
    ],
  },
  {
    label: 'Setting',
    variables: ['currentSetting'],
  },
  {
    label: 'Character',
    variables: ['characterInput', 'currentCharacter', 'protagonist', 'supportingCharacters'],
  },
  {
    label: 'Opening',
    variables: ['currentOpening'],
  },
  {
    label: 'Lorebook',
    variables: ['lorebookEntries'],
  },
]

const VAULT_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    label: 'Vault',
    variables: [
      'characterCount',
      'lorebookCount',
      'totalEntryCount',
      'scenarioCount',
      'focusedEntity',
    ],
  },
]

const LORE_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    label: 'Lore',
    variables: ['loreEntries', 'loreChapters'],
  },
]

const IMPORT_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    label: 'Import',
    variables: ['genre', 'title', 'cardContent', 'entriesJson'],
  },
]

const PORTRAIT_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    label: 'Portrait',
    variables: ['imageStylePrompt', 'visualDescriptors'],
  },
]

const TRANSLATE_WIZARD_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    label: 'Translate Wizard',
    variables: ['targetLanguage', 'content'],
  },
]

const GROUP_DISPLAY_GROUPS: Record<ContextGroupName, DisplayGroup[]> = {
  promptContext: PROMPT_CONTEXT_DISPLAY_GROUPS,
  timelineFillAnswer: TIMELINE_FILL_ANSWER_DISPLAY_GROUPS,
  wizard: WIZARD_DISPLAY_GROUPS,
  vault: VAULT_DISPLAY_GROUPS,
  lore: LORE_DISPLAY_GROUPS,
  import: IMPORT_DISPLAY_GROUPS,
  portrait: PORTRAIT_DISPLAY_GROUPS,
  translateWizard: TRANSLATE_WIZARD_DISPLAY_GROUPS,
  staticContent: [],
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getContextGroup(templateId: string): ContextGroupName | null {
  const group = TEMPLATE_GROUP_MAP[templateId]
  if (group) return group
  if (templateId && !warnedUnmappedIds.has(templateId)) {
    warnedUnmappedIds.add(templateId)
    log('unmapped templateId — no context group registered', { templateId })
  }
  return null
}

export function getVariablesForTemplate(templateId: string): readonly VariableDefinition[] {
  const group = getContextGroup(templateId)
  if (!group) return EMPTY_VARS
  return GROUP_VARIABLES[group]
}

export function getDisplayGroupsForTemplate(templateId: string): readonly DisplayGroup[] {
  const group = getContextGroup(templateId)
  if (!group) return EMPTY_DISPLAY_GROUPS
  return GROUP_DISPLAY_GROUPS[group]
}

export function getVariableNamesForTemplate(templateId: string): string[] {
  return getVariablesForTemplate(templateId).map((def) => def.name)
}

const EMPTY_VARS: readonly VariableDefinition[] = Object.freeze([])
const EMPTY_DISPLAY_GROUPS: readonly DisplayGroup[] = Object.freeze([])

/**
 * Integrity report used by tests and dev tooling to surface map drift:
 * templateIds loaded from .liquid files that lack a group entry, and
 * display-group variable names that don't match any definition.
 */
export interface ContextMapIntegrityReport {
  unmappedTemplateIds: string[]
  orphanedDisplayVariables: { group: ContextGroupName; label: string; name: string }[]
}

export function validateContextMapIntegrity(
  templateIds: readonly string[],
): ContextMapIntegrityReport {
  const unmappedTemplateIds = templateIds.filter((id) => !(id in TEMPLATE_GROUP_MAP))
  const orphanedDisplayVariables: ContextMapIntegrityReport['orphanedDisplayVariables'] = []
  for (const [group, displayGroups] of Object.entries(GROUP_DISPLAY_GROUPS) as [
    ContextGroupName,
    DisplayGroup[],
  ][]) {
    const definedNames = new Set(GROUP_VARIABLES[group].map((v) => v.name))
    for (const dg of displayGroups) {
      for (const name of dg.variables) {
        if (!definedNames.has(name)) {
          orphanedDisplayVariables.push({ group, label: dg.label, name })
        }
      }
    }
  }
  return { unmappedTemplateIds, orphanedDisplayVariables }
}
