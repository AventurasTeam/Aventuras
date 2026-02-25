import type {
  APISettings,
  UISettings,
  ThemeId,
  FontSource,
  UpdateSettings,
  APIProfile,
  GenerationPreset,
  TranslationSettings,
  ProviderType,
  ImageProfile,
  ImageProviderType,
  ExperimentalFeatures,
} from '$lib/types'
import { database } from '$lib/services/database'
import {
  type AdvancedWizardSettings,
  getDefaultAdvancedSettings,
  getDefaultAdvancedSettingsForProvider,
} from '$lib/services/ai/wizard/ScenarioService'
import { PROVIDERS } from '$lib/services/ai/sdk/providers/config'
import type { ReasoningEffort } from '$lib/types'
import { ui } from '$lib/stores/ui.svelte'
import { getTheme } from '../../themes/themes'
import { LLM_TIMEOUT_DEFAULT, LLM_TIMEOUT_MIN, LLM_TIMEOUT_MAX } from '$lib/constants/timeout'
import { SvelteSet, SvelteMap } from 'svelte/reactivity'

// Provider preset type (used by WelcomeScreen)
export type ProviderPreset = 'openrouter' | 'nanogpt' | 'openai-compatible'

// Default profile IDs for each provider
export const DEFAULT_OPENROUTER_PROFILE_ID = 'default-openrouter-profile'
export const DEFAULT_NANOGPT_PROFILE_ID = 'default-nanogpt-profile'

// ===== System Services Settings =====

export interface AdvancedRequestSettings {
  manualMode: boolean
}

export function getDefaultAdvancedRequestSettings(): AdvancedRequestSettings {
  return {
    manualMode: false,
  }
}

// Classifier service settings (World State Classifier - extracts entities from narrative)
export interface ClassifierSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  maxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string
  chatHistoryTruncation: number // Max words per chat history entry (0 = no truncation, up to 500)
}

export function getDefaultClassifierSettings(): ClassifierSettings {
  return getDefaultClassifierSettingsForProvider('openrouter')
}

export function getDefaultClassifierSettingsForProvider(
  provider: ProviderType,
): ClassifierSettings {
  const preset = getPresetDefaults(provider, 'classification')
  return {
    presetId: 'classification',
    profileId: null, // Use default profile
    model: preset.model,
    temperature: 0.3,
    maxTokens: 8192,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
    chatHistoryTruncation: 0,
  }
}

// Lorebook Import Classifier settings (classifies imported lorebook entries by type)
export interface LorebookClassifierSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use main narrative profile)
  model: string
  temperature: number
  maxTokens: number
  batchSize: number // Entries per batch for LLM classification
  maxConcurrent: number // Max concurrent batch requests
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultLorebookClassifierSettings(): LorebookClassifierSettings {
  return getDefaultLorebookClassifierSettingsForProvider('openrouter')
}

export function getDefaultLorebookClassifierSettingsForProvider(
  provider: ProviderType,
): LorebookClassifierSettings {
  const preset = getPresetDefaults(provider, 'classification')
  return {
    presetId: 'classification',
    profileId: null, // null = use main narrative profile
    model: preset.model,
    temperature: 0.1,
    maxTokens: 8192,
    batchSize: 50,
    maxConcurrent: 5,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Memory service settings
export interface MemorySettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultMemorySettings(): MemorySettings {
  return getDefaultMemorySettingsForProvider('openrouter')
}

export function getDefaultMemorySettingsForProvider(provider: ProviderType): MemorySettings {
  const preset = getPresetDefaults(provider, 'memory')
  return {
    presetId: 'memory',
    profileId: null, // Use default profile
    model: preset.model,
    temperature: 0.3,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Suggestions service settings
export interface SuggestionsSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  maxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultSuggestionsSettings(): SuggestionsSettings {
  return getDefaultSuggestionsSettingsForProvider('openrouter')
}

export function getDefaultSuggestionsSettingsForProvider(
  provider: ProviderType,
): SuggestionsSettings {
  const preset = getPresetDefaults(provider, 'suggestions')
  return {
    presetId: 'suggestions',
    profileId: null, // Use default profile
    model: preset.model,
    temperature: 0.7,
    maxTokens: 8192,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Action choices settings (RPG-style choices for adventure mode)
export interface ActionChoicesSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  maxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultActionChoicesSettings(): ActionChoicesSettings {
  return getDefaultActionChoicesSettingsForProvider('openrouter')
}

export function getDefaultActionChoicesSettingsForProvider(
  provider: ProviderType,
): ActionChoicesSettings {
  const preset = getPresetDefaults(provider, 'suggestions')
  return {
    presetId: 'suggestions',
    profileId: null, // Use default profile
    model: preset.model,
    temperature: 0.8,
    maxTokens: 8192,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Style reviewer service settings
export interface StyleReviewerSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  enabled: boolean
  model: string
  temperature: number
  maxTokens: number
  triggerInterval: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultStyleReviewerSettings(): StyleReviewerSettings {
  return getDefaultStyleReviewerSettingsForProvider('openrouter')
}

export function getDefaultStyleReviewerSettingsForProvider(
  provider: ProviderType,
): StyleReviewerSettings {
  const preset = getPresetDefaults(provider, 'suggestions')
  return {
    presetId: 'suggestions',
    profileId: null, // Use default profile
    enabled: true,
    model: preset.model,
    temperature: 0.3,
    maxTokens: 8192,
    triggerInterval: 5,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Lore Management service settings (per design doc section 3.4)
export interface LoreManagementSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  maxIterations: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultLoreManagementSettings(): LoreManagementSettings {
  return getDefaultLoreManagementSettingsForProvider('openrouter')
}

export function getDefaultLoreManagementSettingsForProvider(
  provider: ProviderType,
): LoreManagementSettings {
  const preset = getPresetDefaults(provider, 'agentic')
  return {
    presetId: 'agentic',
    profileId: null, // Use default profile
    model: preset.model,
    temperature: 0.3,
    maxIterations: 50,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Interactive Vault service settings (AI-assisted vault management)
// Note: System prompt is managed via the Prompts tab (template id: 'interactive-vault')
export interface InteractiveVaultSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use main narrative profile)
  model: string
  temperature: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultInteractiveVaultSettings(): InteractiveVaultSettings {
  return getDefaultInteractiveVaultSettingsForProvider('openrouter')
}

export function getDefaultInteractiveVaultSettingsForProvider(
  provider: ProviderType,
): InteractiveVaultSettings {
  const preset = getPresetDefaults(provider, 'agentic')
  return {
    presetId: 'agentic',
    profileId: null,
    model: preset.model,
    temperature: 0.7,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Agentic Retrieval service settings (per design doc section 3.1.4)
export interface AgenticRetrievalSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  enabled: boolean
  model: string
  temperature: number
  maxIterations: number
  agenticThreshold: number // Use agentic if chapters > N
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultAgenticRetrievalSettings(): AgenticRetrievalSettings {
  return getDefaultAgenticRetrievalSettingsForProvider('openrouter')
}

export function getDefaultAgenticRetrievalSettingsForProvider(
  provider: ProviderType,
): AgenticRetrievalSettings {
  const preset = getPresetDefaults(provider, 'agentic')
  return {
    presetId: 'agentic',
    profileId: null, // Use default profile
    enabled: false,
    model: preset.model,
    temperature: 0.3,
    maxIterations: 30,
    agenticThreshold: 30,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Timeline Fill service settings (per design doc section 3.1.4: Static Retrieval)
export interface TimelineFillSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  enabled: boolean
  mode: 'static' | 'agentic' // 'static' is default, 'agentic' for tool-calling retrieval
  model: string
  temperature: number
  maxQueries: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultTimelineFillSettings(): TimelineFillSettings {
  return getDefaultTimelineFillSettingsForProvider('openrouter')
}

export function getDefaultTimelineFillSettingsForProvider(
  provider: ProviderType,
): TimelineFillSettings {
  const preset = getPresetDefaults(provider, 'memory')
  return {
    presetId: 'memory',
    profileId: null, // Use default profile
    enabled: true,
    mode: 'static',
    model: preset.model,
    temperature: 0.3,
    maxQueries: 5,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Chapter Query settings (used by both static and agentic timeline fill modes)
export interface ChapterQuerySettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultChapterQuerySettings(): ChapterQuerySettings {
  return getDefaultChapterQuerySettingsForProvider('openrouter')
}

export function getDefaultChapterQuerySettingsForProvider(
  provider: ProviderType,
): ChapterQuerySettings {
  const preset = getPresetDefaults(provider, 'memory')
  return {
    presetId: 'memory',
    profileId: null, // Use default profile
    model: preset.model,
    temperature: 0.2,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Entry Retrieval settings (Tier 3 LLM selection for lorebook entries)
export interface EntryRetrievalSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  maxTier3Entries: number // 0 = unlimited
  maxWordsPerEntry: number // 0 = unlimited
  enableLLMSelection: boolean
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultEntryRetrievalSettings(): EntryRetrievalSettings {
  return getDefaultEntryRetrievalSettingsForProvider('openrouter')
}

export function getDefaultEntryRetrievalSettingsForProvider(
  provider: ProviderType,
): EntryRetrievalSettings {
  const preset = getPresetDefaults(provider, 'classification')
  return {
    presetId: 'classification',
    profileId: null, // Use default profile
    model: preset.model,
    temperature: 0.2,
    maxTier3Entries: 0,
    maxWordsPerEntry: 0,
    enableLLMSelection: true,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Update settings
export function getDefaultUpdateSettings(): UpdateSettings {
  return {
    autoCheck: true,
    autoDownload: false,
    checkInterval: 24, // Check every 24 hours
    lastChecked: null,
  }
}

// Image Generation settings (automatic image generation for narrative)
export interface ImageGenerationServiceSettings {
  // Profile-based image generation (profiles must have supportsImageGeneration capability)
  profileId: string | null // API profile for standard image generation
  size: string // Regular image size

  // Reference model settings (for image-to-image with portrait references)
  referenceProfileId: string | null // API profile for image-to-image with portrait references
  referenceSize: string // Reference image size

  // General story image settings
  styleId: string // Selected image style template
  maxImagesPerMessage: number // Max images per narrative (0 = unlimited, default: 3)

  // Portrait model settings (character reference images)
  portraitProfileId: string | null // API profile for generating character portraits
  portraitStyleId: string // Selected character portrait style template
  portraitSize: string // Portrait image size

  // Scene analysis model settings (for identifying imageable scenes)
  promptProfileId: string | null // API profile for scene analysis
  promptModel: string // Model for scene analysis (empty = use profile default)
  promptTemperature: number
  promptMaxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string

  // Background image settings
  backgroundProfileId: string | null // API profile for background image generation
  backgroundSize: string // Background image size (default: '1280x720')
  backgroundBlur: number // Background blur amount in pixels (default: 0)
}

export function getDefaultImageGenerationSettings(): ImageGenerationServiceSettings {
  return {
    profileId: null, // User must select an image-capable profile
    styleId: 'image-style-soft-anime',
    portraitStyleId: 'image-style-soft-anime',
    size: '1024x1024',
    referenceSize: '1024x1024',
    portraitSize: '512x512',
    maxImagesPerMessage: 3,
    portraitProfileId: null,
    referenceProfileId: null,
    promptProfileId: null, // Use default profile for scene analysis
    promptModel: '', // Empty = use profile default
    promptTemperature: 0.3,
    promptMaxTokens: 16384,
    reasoningEffort: 'high',
    manualBody: '',
    backgroundProfileId: null,
    backgroundSize: '1280x720',
    backgroundBlur: 2, // Default blur for atmosphere
  }
}

export function getDefaultImageGenerationSettingsForProvider(
  _provider: ProviderType,
): ImageGenerationServiceSettings {
  // Profile selection determines available models, so use generic defaults here
  // The UI will show appropriate models based on the selected profile's provider
  return getDefaultImageGenerationSettings()
}

// Text-To-Speech settings (TTS narration audio generation)
export interface TTSServiceSettings {
  enabled: boolean // Toggle for TTS (default: false)
  endpoint: string // TTS API endpoint (required, e.g., https://api.openai.com/v1/audio/speech)
  apiKey: string // API key for TTS endpoint (required)
  model: string // TTS model (default: 'tts-1')
  voice: string // Voice ID (default: 'alloy')
  speed: number // Speech speed 0.25-4.0 (default: 1.0)
  autoPlay: boolean // Auto-play narration TTS (default: false)
  excludedCharacters: string // List of banned characters for TTS (default: *, #, _, ~)
  removeHtmlTags: boolean // Removes HTML tags from text (default: false)
  removeAllHtmlContent: boolean // Removes content within all HTML tags (default: false)
  htmlTagsToRemoveContent: string // Specific HTML tags to remove content from (default: span, div)
  provider: 'openai' | 'google' | 'microsoft' // TTS Provider (default: 'openai')
  volume: number // TTS volume 0.0-1.0 (default: 1.0)
  volumeOverride: boolean // Enable volume override (default: false)
  providerVoices: Record<string, string> // Provider-specific voices
}

export function getDefaultTTSSettings(): TTSServiceSettings {
  return {
    enabled: false,
    endpoint: '',
    apiKey: '',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1.0,
    autoPlay: false,
    excludedCharacters: '*, #, _, ~',
    removeHtmlTags: false,
    removeAllHtmlContent: false,
    htmlTagsToRemoveContent: 'span, div',
    provider: 'openai',
    volume: 1.0,
    volumeOverride: false,
    providerVoices: { openai: 'alloy', google: 'en', microsoft: '' },
  }
}

export function getDefaultTTSSettingsForProvider(_provider: ProviderType): TTSServiceSettings {
  return {
    enabled: false,
    endpoint: '',
    apiKey: '',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1.0,
    autoPlay: false,
    excludedCharacters: '*, #, _, ~',
    removeHtmlTags: false,
    removeAllHtmlContent: false,
    htmlTagsToRemoveContent: 'span, div',
    provider: 'openai',
    volume: 1.0,
    volumeOverride: false,
    providerVoices: { openai: 'alloy', google: 'en', microsoft: '' },
  }
}

// Translation settings
export function getDefaultTranslationSettings(): TranslationSettings {
  return {
    enabled: false,
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    translateNarration: true,
    translateUserInput: true,
    translateWorldState: true,
  }
}

// Character Card Import settings (SillyTavern card conversion)
export interface CharacterCardImportSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use main narrative profile)
  model: string
  temperature: number
  maxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

export function getDefaultCharacterCardImportSettings(): CharacterCardImportSettings {
  return getDefaultCharacterCardImportSettingsForProvider('openrouter')
}

export function getDefaultCharacterCardImportSettingsForProvider(
  provider: ProviderType,
): CharacterCardImportSettings {
  const preset = getPresetDefaults(provider, 'classification')
  return {
    presetId: 'classification',
    profileId: null,
    model: preset.model,
    temperature: 0.3,
    maxTokens: 16384,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// Combined system services settings
// Service-specific settings (only extra fields, not generation config)
export interface ClassifierSpecificSettings {
  chatHistoryTruncation: number
}

export interface LorebookClassifierSpecificSettings {
  batchSize: number
  maxConcurrent: number
}

// Linter doesnt like empty objects interfaces, but keeping them for potential future use.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SuggestionsSpecificSettings {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ActionChoicesSpecificSettings {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StyleReviewerSpecificSettings {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LoreManagementSpecificSettings {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InteractiveVaultSpecificSettings {}

export interface AgenticRetrievalSpecificSettings {
  maxIterations: number
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TimelineFillSpecificSettings {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChapterQuerySpecificSettings {}

// Global context configuration - controls how much context is included in AI operations
export interface ContextWindowSettings {
  /** Number of recent entries for main narrative context */
  recentEntriesForNarrative: number
  /** Number of recent entries for tiered context building */
  recentEntriesForTiered: number
  /** Number of recent entries for classification/retrieval operations */
  recentEntriesForRetrieval: number
  /** Number of recent entries for action choices context */
  recentEntriesForChoices: number
  /** Number of user actions to analyze for style matching */
  userActionsForStyle: number
  /** Number of recent entries for lore management context */
  recentEntriesForLoreManagement: number
  /** Number of recent entries for name matching in tiered context */
  recentEntriesForNameMatching: number
}

// Lorebook injection limits
export interface LorebookLimitsSettings {
  /** Max lorebook entries for action choices */
  maxForActionChoices: number
  /** Max lorebook entries for suggestions */
  maxForSuggestions: number
  /** Max lorebook entries for agentic preview */
  maxForAgenticPreview: number
  /** Threshold for switching to LLM-based selection */
  llmThreshold: number
  /** Max entries per tier in context building */
  maxEntriesPerTier: number
}

export interface EntryRetrievalSpecificSettings {
  enableLLMSelection: boolean
  activationTimeout: number
  stickyTimeout: number
  stickinessDecay: number
  tier1DistanceThreshold: number
  tier2DistanceThreshold: number
  tier2Boost: number
  tier3Boost: number
  entryContextWindow: number
  recencyWeight: number
}

export interface ImageGenerationSpecificSettings {
  promptProfileId: string | null
}

export interface TTSSpecificSettings {
  model: string
  voice: string
  speed: number
  volume: number
}

// Linter doesnt like empty objects interfaces, but keeping them for potential future use.
export type CharacterCardImportSpecificSettings = object

export interface ServiceSpecificSettings {
  classifier: ClassifierSpecificSettings
  lorebookClassifier: LorebookClassifierSpecificSettings
  suggestions: SuggestionsSpecificSettings
  actionChoices: ActionChoicesSpecificSettings
  styleReviewer: StyleReviewerSpecificSettings
  loreManagement: LoreManagementSpecificSettings
  interactiveVault: InteractiveVaultSpecificSettings
  agenticRetrieval: AgenticRetrievalSpecificSettings
  timelineFill: TimelineFillSpecificSettings
  chapterQuery: ChapterQuerySpecificSettings
  entryRetrieval: EntryRetrievalSpecificSettings
  imageGeneration: ImageGenerationSpecificSettings
  tts: TTSSpecificSettings
  characterCardImport: CharacterCardImportSpecificSettings
  // Global configuration
  contextWindow: ContextWindowSettings
  lorebookLimits: LorebookLimitsSettings
}

export function getDefaultExperimentalFeatures(): ExperimentalFeatures {
  return {
    stateTracking: false,
    rollbackOnDelete: false,
    lightweightBranches: false,
    autoSnapshotInterval: 20,
  }
}

export function getDefaultServiceSpecificSettings(): ServiceSpecificSettings {
  return {
    classifier: getDefaultClassifierSpecificSettings(),
    lorebookClassifier: getDefaultLorebookClassifierSpecificSettings(),
    suggestions: getDefaultSuggestionsSpecificSettings(),
    actionChoices: getDefaultActionChoicesSpecificSettings(),
    styleReviewer: getDefaultStyleReviewerSpecificSettings(),
    loreManagement: getDefaultLoreManagementSpecificSettings(),
    interactiveVault: getDefaultInteractiveVaultSpecificSettings(),
    agenticRetrieval: getDefaultAgenticRetrievalSpecificSettings(),
    timelineFill: getDefaultTimelineFillSpecificSettings(),
    chapterQuery: getDefaultChapterQuerySpecificSettings(),
    entryRetrieval: getDefaultEntryRetrievalSpecificSettings(),
    imageGeneration: getDefaultImageGenerationSpecificSettings(),
    tts: getDefaultTTSSpecificSettings(),
    characterCardImport: getDefaultCharacterCardImportSpecificSettings(),
    contextWindow: getDefaultContextWindowSettings(),
    lorebookLimits: getDefaultLorebookLimitsSettings(),
  }
}

export function getDefaultClassifierSpecificSettings(): ClassifierSpecificSettings {
  return {
    chatHistoryTruncation: 0,
  }
}

export function getDefaultLorebookClassifierSpecificSettings(): LorebookClassifierSpecificSettings {
  return {
    batchSize: 50,
    maxConcurrent: 5,
  }
}

export function getDefaultSuggestionsSpecificSettings(): SuggestionsSpecificSettings {
  return {}
}

export function getDefaultActionChoicesSpecificSettings(): ActionChoicesSpecificSettings {
  return {}
}

export function getDefaultStyleReviewerSpecificSettings(): StyleReviewerSpecificSettings {
  return {}
}

export function getDefaultLoreManagementSpecificSettings(): LoreManagementSpecificSettings {
  return {}
}

export function getDefaultInteractiveVaultSpecificSettings(): InteractiveVaultSpecificSettings {
  return {}
}

export function getDefaultAgenticRetrievalSpecificSettings(): AgenticRetrievalSpecificSettings {
  return {
    maxIterations: 10,
  }
}

export function getDefaultTimelineFillSpecificSettings(): TimelineFillSpecificSettings {
  return {}
}

export function getDefaultChapterQuerySpecificSettings(): ChapterQuerySpecificSettings {
  return {}
}

export function getDefaultEntryRetrievalSpecificSettings(): EntryRetrievalSpecificSettings {
  return {
    enableLLMSelection: true,
    activationTimeout: 2000,
    stickyTimeout: 10000,
    stickinessDecay: 0.9,
    tier1DistanceThreshold: 0.5,
    tier2DistanceThreshold: 0.7,
    tier2Boost: 0.5,
    tier3Boost: 0.3,
    entryContextWindow: 1000,
    recencyWeight: 0.3,
  }
}

export function getDefaultImageGenerationSpecificSettings(): ImageGenerationSpecificSettings {
  return {
    promptProfileId: null,
  }
}

export function getDefaultTTSSpecificSettings(): TTSSpecificSettings {
  return {
    model: 'tts-1',
    voice: 'alloy',
    speed: 1.0,
    volume: 1.0,
  }
}

export function getDefaultCharacterCardImportSpecificSettings(): CharacterCardImportSpecificSettings {
  return {}
}

export function getDefaultContextWindowSettings(): ContextWindowSettings {
  return {
    recentEntriesForNarrative: 20,
    recentEntriesForTiered: 10,
    recentEntriesForRetrieval: 5,
    recentEntriesForChoices: 3,
    userActionsForStyle: 6,
    recentEntriesForLoreManagement: 10,
    recentEntriesForNameMatching: 3,
  }
}

export function getDefaultLorebookLimitsSettings(): LorebookLimitsSettings {
  return {
    maxForActionChoices: 12,
    maxForSuggestions: 15,
    maxForAgenticPreview: 20,
    llmThreshold: 30,
    maxEntriesPerTier: 10,
  }
}

export interface SystemServicesSettings {
  classifier: ClassifierSettings
  lorebookClassifier: LorebookClassifierSettings
  memory: MemorySettings
  suggestions: SuggestionsSettings
  actionChoices: ActionChoicesSettings
  styleReviewer: StyleReviewerSettings
  loreManagement: LoreManagementSettings
  interactiveVault: InteractiveVaultSettings
  agenticRetrieval: AgenticRetrievalSettings
  timelineFill: TimelineFillSettings
  chapterQuery: ChapterQuerySettings
  entryRetrieval: EntryRetrievalSettings
  imageGeneration: ImageGenerationServiceSettings
  tts: TTSServiceSettings
  characterCardImport: CharacterCardImportSettings
}

export function getDefaultSystemServicesSettings(): SystemServicesSettings {
  return {
    classifier: getDefaultClassifierSettings(),
    lorebookClassifier: getDefaultLorebookClassifierSettings(),
    memory: getDefaultMemorySettings(),
    suggestions: getDefaultSuggestionsSettings(),
    actionChoices: getDefaultActionChoicesSettings(),
    styleReviewer: getDefaultStyleReviewerSettings(),
    loreManagement: getDefaultLoreManagementSettings(),
    interactiveVault: getDefaultInteractiveVaultSettings(),
    agenticRetrieval: getDefaultAgenticRetrievalSettings(),
    timelineFill: getDefaultTimelineFillSettings(),
    chapterQuery: getDefaultChapterQuerySettings(),
    entryRetrieval: getDefaultEntryRetrievalSettings(),
    imageGeneration: getDefaultImageGenerationSettings(),
    tts: getDefaultTTSSettings(),
    characterCardImport: getDefaultCharacterCardImportSettings(),
  }
}

export function getDefaultSystemServicesSettingsForProvider(
  provider: ProviderType,
): SystemServicesSettings {
  return {
    classifier: getDefaultClassifierSettingsForProvider(provider),
    lorebookClassifier: getDefaultLorebookClassifierSettingsForProvider(provider),
    memory: getDefaultMemorySettingsForProvider(provider),
    suggestions: getDefaultSuggestionsSettingsForProvider(provider),
    actionChoices: getDefaultActionChoicesSettingsForProvider(provider),
    styleReviewer: getDefaultStyleReviewerSettingsForProvider(provider),
    loreManagement: getDefaultLoreManagementSettingsForProvider(provider),
    interactiveVault: getDefaultInteractiveVaultSettingsForProvider(provider),
    agenticRetrieval: getDefaultAgenticRetrievalSettingsForProvider(provider),
    timelineFill: getDefaultTimelineFillSettingsForProvider(provider),
    chapterQuery: getDefaultChapterQuerySettingsForProvider(provider),
    entryRetrieval: getDefaultEntryRetrievalSettingsForProvider(provider),
    imageGeneration: getDefaultImageGenerationSettingsForProvider(provider),
    tts: getDefaultTTSSettingsForProvider(provider),
    characterCardImport: getDefaultCharacterCardImportSettingsForProvider(provider),
  }
}

/**
 * Get default generation presets (Agent Profiles) for a specific provider.
 * Uses PROVIDERS from the SDK for model and settings defaults.
 * @param provider - The provider type to get defaults for
 */
export function getDefaultGenerationPresetsForProvider(provider: ProviderType): GenerationPreset[] {
  const config = PROVIDERS[provider]
  const services = config.services

  // For providers without service defaults, use empty model (requires manual configuration)
  const emptyServiceDefault = {
    model: '',
    temperature: 0.5,
    maxTokens: 8192,
    reasoningEffort: 'off' as const,
  }

  return [
    {
      id: 'classification',
      name: 'Classification',
      description: 'World state, lorebook parsing, entity extraction',
      profileId: null,
      model: services?.classification.model ?? emptyServiceDefault.model,
      temperature: services?.classification.temperature ?? 0.3,
      maxTokens: services?.classification.maxTokens ?? emptyServiceDefault.maxTokens,
      reasoningEffort:
        services?.classification.reasoningEffort ?? emptyServiceDefault.reasoningEffort,
      manualBody: '',
    },
    {
      id: 'memory',
      name: 'Memory & Context',
      description: 'Chapter analysis, timeline, context retrieval',
      profileId: null,
      model: services?.memory.model ?? emptyServiceDefault.model,
      temperature: services?.memory.temperature ?? 0.3,
      maxTokens: services?.memory.maxTokens ?? emptyServiceDefault.maxTokens,
      reasoningEffort: services?.memory.reasoningEffort ?? emptyServiceDefault.reasoningEffort,
      manualBody: '',
    },
    {
      id: 'suggestions',
      name: 'Suggestions',
      description: 'Plot suggestions, action choices, style review',
      profileId: null,
      model: services?.suggestions.model ?? emptyServiceDefault.model,
      temperature: services?.suggestions.temperature ?? 0.7,
      maxTokens: services?.suggestions.maxTokens ?? emptyServiceDefault.maxTokens,
      reasoningEffort: services?.suggestions.reasoningEffort ?? emptyServiceDefault.reasoningEffort,
      manualBody: '',
    },
    {
      id: 'agentic',
      name: 'Agentic',
      description: 'Autonomous lore management and retrieval',
      profileId: null,
      model: services?.agentic.model ?? emptyServiceDefault.model,
      temperature: services?.agentic.temperature ?? 0.3,
      maxTokens: services?.agentic.maxTokens ?? emptyServiceDefault.maxTokens,
      reasoningEffort: services?.agentic.reasoningEffort ?? emptyServiceDefault.reasoningEffort,
      manualBody: '',
    },
    {
      id: 'wizard',
      name: 'Story Wizard',
      description: 'Story setup, character and setting generation',
      profileId: null,
      model: services?.wizard.model ?? emptyServiceDefault.model,
      temperature: services?.wizard.temperature ?? 0.7,
      maxTokens: services?.wizard.maxTokens ?? emptyServiceDefault.maxTokens,
      reasoningEffort: services?.wizard.reasoningEffort ?? emptyServiceDefault.reasoningEffort,
      manualBody: '',
    },
    {
      id: 'translation',
      name: 'Translation',
      description: 'Text translation between languages',
      profileId: null,
      model: services?.translation.model ?? emptyServiceDefault.model,
      temperature: services?.translation.temperature ?? 0.3,
      maxTokens: services?.translation.maxTokens ?? 4096,
      reasoningEffort: services?.translation.reasoningEffort ?? emptyServiceDefault.reasoningEffort,
      manualBody: '',
    },
  ]
}

/**
 * Helper to get a specific preset's config from the provider defaults.
 * Services should use this to derive their model/reasoning from the preset they're assigned to.
 */
export function getPresetDefaults(provider: ProviderType, presetId: string): GenerationPreset {
  const presets = getDefaultGenerationPresetsForProvider(provider)
  const preset = presets.find((p) => p.id === presetId)
  if (!preset) {
    throw new Error(`Unknown preset ID: ${presetId}`)
  }
  return preset
}

// Settings Store using Svelte 5 runes
class SettingsStore {
  // Provider preset - which provider's defaults to use
  providerPreset = $state<ProviderType>('openrouter')

  // First-run detection - true if user has completed initial setup
  firstRunComplete = $state(false)

  apiSettings = $state<APISettings>({
    openaiApiKey: null,
    openaiApiURL: PROVIDERS.openrouter.baseUrl,
    profiles: [],
    activeProfileId: null,
    mainNarrativeProfileId: DEFAULT_OPENROUTER_PROFILE_ID,
    defaultProfileId: undefined,
    defaultModel: 'z-ai/glm-4.7',
    temperature: 0.8,
    maxTokens: 8192,
    reasoningEffort: 'off',
    manualBody: '',
    enableThinking: false,
    llmTimeoutMs: LLM_TIMEOUT_DEFAULT,
    useNativeTimeout: false,
  })

  uiSettings = $state<UISettings>({
    theme: 'dark',
    fontSize: 'medium',
    fontFamily: 'default',
    fontSource: 'default',
    showWordCount: true,
    autoSave: true,
    spellcheckEnabled: true,
    debugMode: false,
    disableSuggestions: false,
    disableActionPrefixes: false,
    showReasoning: true,
    sidebarWidth: 288,
  })

  advancedRequestSettings = $state<AdvancedRequestSettings>(getDefaultAdvancedRequestSettings())

  // Advanced wizard settings for scenario generation
  wizardSettings = $state<AdvancedWizardSettings>(getDefaultAdvancedSettings())

  // System services settings (classifier, memory, suggestions)
  systemServicesSettings = $state<SystemServicesSettings>(getDefaultSystemServicesSettings())

  // Update settings
  updateSettings = $state<UpdateSettings>(getDefaultUpdateSettings())

  // Translation settings
  translationSettings = $state<TranslationSettings>(getDefaultTranslationSettings())

  // Image profiles (dedicated image provider configurations)
  imageProfiles = $state<ImageProfile[]>([])

  // Service preset assignments - which preset each service uses
  servicePresetAssignments = $state<Record<string, string>>({
    classifier: 'classification',
    lorebookClassifier: 'classification',
    entryRetrieval: 'classification',
    characterCardImport: 'classification',
    memory: 'memory',
    chapterQuery: 'memory',
    timelineFill: 'memory',
    suggestions: 'suggestions',
    actionChoices: 'suggestions',
    styleReviewer: 'suggestions',
    loreManagement: 'agentic',
    agenticRetrieval: 'agentic',
    interactiveVault: 'agentic',
    imageGeneration: 'suggestions',
    bgImageGeneration: 'suggestions',
    'wizard:settingExpansion': 'wizard',
    'wizard:settingRefinement': 'wizard',
    'wizard:protagonistGeneration': 'wizard',
    'wizard:characterElaboration': 'wizard',
    'wizard:characterRefinement': 'wizard',
    'wizard:supportingCharacters': 'wizard',
    'wizard:openingGeneration': 'wizard',
    'wizard:openingRefinement': 'wizard',
    'translation:narration': 'translation',
    'translation:input': 'translation',
    'translation:ui': 'translation',
    'translation:suggestions': 'translation',
    'translation:actionChoices': 'translation',
    'translation:wizard': 'translation',
  })

  serviceSpecificSettings = $state<ServiceSpecificSettings>(getDefaultServiceSpecificSettings())

  experimentalFeatures = $state<ExperimentalFeatures>(getDefaultExperimentalFeatures())

  // Generation Presets (Profiles)
  generationPresets = $state<GenerationPreset[]>([
    {
      id: 'classification',
      name: 'Classification',
      description: 'World state, lorebook parsing, entity extraction',
      profileId: null,
      model: 'x-ai/grok-4.1-fast',
      temperature: 0.3,
      maxTokens: 8192,
      reasoningEffort: 'high',
      manualBody: '',
    },
    {
      id: 'memory',
      name: 'Memory & Context',
      description: 'Chapter analysis, timeline, context retrieval',
      profileId: null,
      model: 'x-ai/grok-4.1-fast',
      temperature: 0.3,
      maxTokens: 8192,
      reasoningEffort: 'high',
      manualBody: '',
    },
    {
      id: 'suggestions',
      name: 'Suggestions',
      description: 'Plot suggestions, action choices, style review',
      profileId: null,
      model: 'deepseek/deepseek-v3.2',
      temperature: 0.7,
      maxTokens: 8192,
      reasoningEffort: 'off',
      manualBody: '',
    },
    {
      id: 'agentic',
      name: 'Agentic',
      description: 'Autonomous lore management and retrieval',
      profileId: null,
      model: 'z-ai/glm-4.7',
      temperature: 0.3,
      maxTokens: 8192,
      reasoningEffort: 'high',
      manualBody: '',
    },
    {
      id: 'wizard',
      name: 'Story Wizard',
      description: 'Story setup, character and setting generation',
      profileId: null,
      model: 'deepseek/deepseek-v3.2',
      temperature: 0.7,
      maxTokens: 8192,
      reasoningEffort: 'off',
      manualBody: '',
    },
    {
      id: 'translation',
      name: 'Translation',
      description: 'Text translation between languages',
      profileId: null,
      model: 'deepseek/deepseek-v3.2',
      temperature: 0.3,
      maxTokens: 4096,
      reasoningEffort: 'off',
      manualBody: '',
    },
  ])

  initialized = $state(false)

  async init() {
    if (this.initialized) return

    try {
      // Load API settings
      const apiURL = (await database.getSetting('openai_api_url')) ?? PROVIDERS.openrouter.baseUrl //Default to OpenRouter.

      // Load API key - check multiple locations for migration
      // Must handle empty strings explicitly since ?? only checks for null/undefined
      let apiKey = await database.getSetting('openai_api_key')
      if (!apiKey || apiKey.length === 0) {
        // Fall back to legacy openrouter_api_key location
        apiKey = await database.getSetting('openrouter_api_key')
      }

      const defaultModel = await database.getSetting('default_model')
      const temperature = await database.getSetting('temperature')
      const maxTokens = await database.getSetting('max_tokens')

      if (apiURL) this.apiSettings.openaiApiURL = apiURL
      if (apiKey) this.apiSettings.openaiApiKey = apiKey
      if (defaultModel) this.apiSettings.defaultModel = defaultModel
      if (temperature) this.apiSettings.temperature = parseFloat(temperature)
      if (maxTokens) this.apiSettings.maxTokens = parseInt(maxTokens)

      // Load thinking toggle
      const enableThinking = await database.getSetting('enable_thinking')
      if (enableThinking) this.apiSettings.enableThinking = enableThinking === 'true'

      const reasoningEffort = await database.getSetting('main_reasoning_effort')
      if (reasoningEffort && ['off', 'low', 'medium', 'high'].includes(reasoningEffort)) {
        this.apiSettings.reasoningEffort = reasoningEffort as ReasoningEffort
      } else if (this.apiSettings.enableThinking) {
        this.apiSettings.reasoningEffort = 'high'
      }

      const manualBody = await database.getSetting('main_manual_body')
      if (manualBody !== null) {
        this.apiSettings.manualBody = manualBody
      }

      // Load profiles
      const profilesJson = await database.getSetting('api_profiles')
      if (profilesJson) {
        try {
          const parsed = JSON.parse(profilesJson) as import('$lib/types').APIProfile[]
          // Ensure new fields have defaults for profiles saved before these fields existed
          this.apiSettings.profiles = parsed.map((p) => ({
            ...p,
            customModels: Array.isArray(p.customModels) ? p.customModels : [],
            fetchedModels: Array.isArray(p.fetchedModels) ? p.fetchedModels : [],
            reasoningModels: Array.isArray(p.reasoningModels) ? p.reasoningModels : [],
            hiddenModels: Array.isArray(p.hiddenModels) ? p.hiddenModels : [],
            favoriteModels: Array.isArray(p.favoriteModels) ? p.favoriteModels : [],
            providerType: p.providerType ?? 'openai-compatible',
          }))
        } catch {
          this.apiSettings.profiles = []
        }
      }

      const activeProfileId = await database.getSetting('active_profile_id')
      if (activeProfileId) this.apiSettings.activeProfileId = activeProfileId

      // Load main narrative profile (defaults to OpenRouter if not set)
      const mainNarrativeProfileId = await database.getSetting('main_narrative_profile_id')
      if (mainNarrativeProfileId) {
        this.apiSettings.mainNarrativeProfileId = mainNarrativeProfileId
      } else {
        // Migration: default to OpenRouter for existing users
        this.apiSettings.mainNarrativeProfileId = DEFAULT_OPENROUTER_PROFILE_ID
      }

      // Load global default profile ID
      const defaultProfileId = await database.getSetting('default_profile_id')
      if (defaultProfileId) {
        this.apiSettings.defaultProfileId = defaultProfileId
      }

      // Load LLM timeout
      const llmTimeoutMs = await database.getSetting('llm_timeout_ms')
      if (llmTimeoutMs) {
        const parsed = parseInt(llmTimeoutMs, 10)
        if (!isNaN(parsed) && parsed >= LLM_TIMEOUT_MIN && parsed <= LLM_TIMEOUT_MAX) {
          this.apiSettings.llmTimeoutMs = parsed
        }
      }

      // Load native timeout setting
      const useNativeTimeout = await database.getSetting('use_native_timeout')
      if (useNativeTimeout !== null) {
        this.apiSettings.useNativeTimeout = useNativeTimeout === 'true'
      }

      // Load provider preset (which provider's defaults to use)
      const providerPreset = await database.getSetting('provider_preset')
      if (providerPreset) {
        this.providerPreset = providerPreset as ProviderType
      }

      // Load first-run status
      const firstRunComplete = await database.getSetting('first_run_complete')
      if (firstRunComplete === 'true') {
        this.firstRunComplete = true
      } else {
        // Migration: Check if this is an existing user (has API key or profiles)
        // If so, mark first run as complete and default to OpenRouter
        const hasExistingSetup =
          apiKey || (this.apiSettings.profiles && this.apiSettings.profiles.length > 0)
        if (hasExistingSetup) {
          this.firstRunComplete = true
          this.providerPreset = 'openrouter' // Default existing users to OpenRouter
          await database.setSetting('first_run_complete', 'true')
          await database.setSetting('provider_preset', 'openrouter')
          console.log('[Settings] Existing user detected, marking first run complete')
        }
      }

      // Load UI settings
      const theme = await database.getSetting('theme')
      const fontSize = await database.getSetting('font_size')
      const showWordCount = await database.getSetting('show_word_count')
      const autoSave = await database.getSetting('auto_save')
      const spellcheckEnabled = await database.getSetting('spellcheck_enabled')

      if (theme) {
        this.uiSettings.theme = theme as ThemeId
        // Apply theme immediately to prevent FOUC
        this.applyTheme(theme as ThemeId)
      }
      if (fontSize) this.uiSettings.fontSize = fontSize as 'small' | 'medium' | 'large'
      // Apply font size immediately (uses default 'medium' if not stored)
      this.applyFontSize(this.uiSettings.fontSize)

      // Load font family settings
      const fontFamilySetting = await database.getSetting('font_family')
      if (fontFamilySetting) {
        try {
          const { fontFamily, fontSource } = JSON.parse(fontFamilySetting)
          this.uiSettings.fontFamily = fontFamily || 'default'
          this.uiSettings.fontSource = (fontSource as FontSource) || 'default'

          // Load Google Font if needed
          if (this.uiSettings.fontSource === 'google' && this.uiSettings.fontFamily !== 'default') {
            await this.loadGoogleFont(this.uiSettings.fontFamily)
          }

          // Apply font family immediately
          this.applyFontFamily(this.uiSettings.fontFamily, this.uiSettings.fontSource)
        } catch {
          // If parsing fails, use defaults
          this.uiSettings.fontFamily = 'default'
          this.uiSettings.fontSource = 'default'
        }
      }

      if (showWordCount) this.uiSettings.showWordCount = showWordCount === 'true'
      if (autoSave) this.uiSettings.autoSave = autoSave === 'true'
      if (spellcheckEnabled !== null)
        this.uiSettings.spellcheckEnabled = spellcheckEnabled === 'true'

      const disableSuggestions = await database.getSetting('disable_suggestions')
      if (disableSuggestions !== null)
        this.uiSettings.disableSuggestions = disableSuggestions === 'true'

      const disableActionPrefixes = await database.getSetting('disable_action_prefixes')
      if (disableActionPrefixes !== null)
        this.uiSettings.disableActionPrefixes = disableActionPrefixes === 'true'

      const showReasoning = await database.getSetting('show_reasoning')
      if (showReasoning !== null) this.uiSettings.showReasoning = showReasoning === 'true'

      const debugMode = await database.getSetting('debug_mode')
      if (debugMode !== null) this.uiSettings.debugMode = debugMode === 'true'

      const sidebarWidth = await database.getSetting('sidebar_width')
      if (sidebarWidth) this.uiSettings.sidebarWidth = parseInt(sidebarWidth, 10)

      const manualMode = await database.getSetting('advanced_manual_mode')
      if (manualMode !== null) {
        this.advancedRequestSettings.manualMode = manualMode === 'true'
      }

      // Load wizard settings
      const wizardSettingsJson = await database.getSetting('wizard_settings')
      if (wizardSettingsJson) {
        try {
          const loaded = JSON.parse(wizardSettingsJson)
          // Merge with defaults to ensure all fields exist
          const defaults = getDefaultAdvancedSettings()
          this.wizardSettings = {
            settingExpansion: { ...defaults.settingExpansion, ...loaded.settingExpansion },
            settingRefinement: { ...defaults.settingRefinement, ...loaded.settingRefinement },
            protagonistGeneration: {
              ...defaults.protagonistGeneration,
              ...loaded.protagonistGeneration,
            },
            characterElaboration: {
              ...defaults.characterElaboration,
              ...loaded.characterElaboration,
            },
            characterRefinement: { ...defaults.characterRefinement, ...loaded.characterRefinement },
            supportingCharacters: {
              ...defaults.supportingCharacters,
              ...loaded.supportingCharacters,
            },
            openingGeneration: { ...defaults.openingGeneration, ...loaded.openingGeneration },
            openingRefinement: { ...defaults.openingRefinement, ...loaded.openingRefinement },
          }
        } catch {
          // If parsing fails, use defaults
          this.wizardSettings = getDefaultAdvancedSettings()
        }
      }

      // Load Generation Presets
      const presetsJson = await database.getSetting('generation_presets')
      if (presetsJson) {
        try {
          const loadedPresets = JSON.parse(presetsJson)
          if (Array.isArray(loadedPresets) && loadedPresets.length > 0) {
            // Populate null profileIds with default profile
            const defaultProfileId = this.getDefaultProfileIdForProvider()
            this.generationPresets = loadedPresets.map((preset) => ({
              ...preset,
              profileId: preset.profileId || defaultProfileId,
            }))
          }
        } catch {
          // Keep defaults
        }
      } else {
        // Use defaults and populate null profileIds
        const defaultProfileId = this.getDefaultProfileIdForProvider()
        this.generationPresets = this.generationPresets.map((preset) => ({
          ...preset,
          profileId: preset.profileId || defaultProfileId,
        }))
      }

      // Load service preset assignments
      const assignmentsJson = await database.getSetting('service_preset_assignments')
      if (assignmentsJson) {
        try {
          const loaded = JSON.parse(assignmentsJson)
          this.servicePresetAssignments = { ...this.servicePresetAssignments, ...loaded }
        } catch {
          // Keep defaults
        }
      }

      // Load service-specific settings
      const serviceSpecificJson = await database.getSetting('service_specific_settings')
      if (serviceSpecificJson) {
        try {
          const loaded = JSON.parse(serviceSpecificJson)
          this.serviceSpecificSettings = {
            classifier: { ...getDefaultClassifierSpecificSettings(), ...loaded.classifier },
            lorebookClassifier: {
              ...getDefaultLorebookClassifierSpecificSettings(),
              ...loaded.lorebookClassifier,
            },
            suggestions: getDefaultSuggestionsSpecificSettings(),
            actionChoices: getDefaultActionChoicesSpecificSettings(),
            styleReviewer: getDefaultStyleReviewerSpecificSettings(),
            loreManagement: getDefaultLoreManagementSpecificSettings(),
            interactiveVault: getDefaultInteractiveVaultSpecificSettings(),
            agenticRetrieval: {
              ...getDefaultAgenticRetrievalSpecificSettings(),
              ...loaded.agenticRetrieval,
            },
            timelineFill: getDefaultTimelineFillSpecificSettings(),
            chapterQuery: getDefaultChapterQuerySpecificSettings(),
            entryRetrieval: {
              ...getDefaultEntryRetrievalSpecificSettings(),
              ...loaded.entryRetrieval,
            },
            imageGeneration: {
              ...getDefaultImageGenerationSpecificSettings(),
              ...loaded.imageGeneration,
            },
            tts: { ...getDefaultTTSSpecificSettings(), ...loaded.tts },
            characterCardImport: getDefaultCharacterCardImportSpecificSettings(),
            contextWindow: { ...getDefaultContextWindowSettings(), ...loaded.contextWindow },
            lorebookLimits: { ...getDefaultLorebookLimitsSettings(), ...loaded.lorebookLimits },
          }
        } catch {
          // Keep defaults
        }
      }

      // Load experimental features
      const experimentalJson = await database.getSetting('experimental_features')
      if (experimentalJson) {
        try {
          const loaded = JSON.parse(experimentalJson)
          this.experimentalFeatures = {
            ...getDefaultExperimentalFeatures(),
            ...loaded,
          }
        } catch {
          // Keep defaults
        }
      }

      // Load system services settings
      const systemServicesJson = await database.getSetting('system_services_settings')
      if (systemServicesJson) {
        try {
          const loaded = JSON.parse(systemServicesJson)
          const defaults = getDefaultSystemServicesSettingsForProvider(
            this.getDefaultProviderType(),
          )
          this.systemServicesSettings = {
            classifier: { ...defaults.classifier, ...loaded.classifier },
            lorebookClassifier: { ...defaults.lorebookClassifier, ...loaded.lorebookClassifier },
            memory: { ...defaults.memory, ...loaded.memory },
            suggestions: { ...defaults.suggestions, ...loaded.suggestions },
            actionChoices: { ...defaults.actionChoices, ...loaded.actionChoices },
            styleReviewer: { ...defaults.styleReviewer, ...loaded.styleReviewer },
            loreManagement: { ...defaults.loreManagement, ...loaded.loreManagement },
            agenticRetrieval: { ...defaults.agenticRetrieval, ...loaded.agenticRetrieval },
            timelineFill: { ...defaults.timelineFill, ...loaded.timelineFill },
            chapterQuery: { ...defaults.chapterQuery, ...loaded.chapterQuery },
            entryRetrieval: { ...defaults.entryRetrieval, ...loaded.entryRetrieval },
            imageGeneration: { ...defaults.imageGeneration, ...loaded.imageGeneration },
            tts: { ...defaults.tts, ...loaded.tts },
            characterCardImport: { ...defaults.characterCardImport, ...loaded.characterCardImport },
            interactiveVault: {
              ...defaults.interactiveVault,
              ...(loaded.interactiveVault ?? loaded.interactiveLorebook),
            },
          }

          const isMissingProfileId = (profileId: string | null | undefined): boolean => {
            return profileId === null || profileId === undefined || profileId === ''
          }
          const suggestionsSettings = loaded?.suggestions ?? this.systemServicesSettings.suggestions
          const suggestionProfileId =
            suggestionsSettings?.profileId ?? this.systemServicesSettings.suggestions.profileId
          if (
            isMissingProfileId(this.systemServicesSettings.actionChoices.profileId) &&
            suggestionProfileId
          ) {
            this.systemServicesSettings.actionChoices.profileId = suggestionProfileId
          }
          if (!this.systemServicesSettings.actionChoices.model && suggestionsSettings?.model) {
            this.systemServicesSettings.actionChoices.model = suggestionsSettings.model
          }
          if (
            this.systemServicesSettings.actionChoices.temperature === undefined &&
            suggestionsSettings?.temperature !== undefined
          ) {
            this.systemServicesSettings.actionChoices.temperature = suggestionsSettings.temperature
          }
          if (
            this.systemServicesSettings.actionChoices.maxTokens === undefined &&
            suggestionsSettings?.maxTokens !== undefined
          ) {
            this.systemServicesSettings.actionChoices.maxTokens = suggestionsSettings.maxTokens
          }

          // Migrate timelineFill settings to chapterQuery for users who haven't configured it
          // This preserves existing behavior while allowing separate configuration
          if (!loaded.chapterQuery && loaded.timelineFill) {
            const tf = loaded.timelineFill
            this.systemServicesSettings.chapterQuery = {
              profileId: tf.profileId ?? defaults.chapterQuery.profileId,
              model: tf.model ?? defaults.chapterQuery.model,
              temperature: tf.temperature ?? defaults.chapterQuery.temperature,
              reasoningEffort: tf.reasoningEffort ?? defaults.chapterQuery.reasoningEffort,
              manualBody: tf.manualBody ?? defaults.chapterQuery.manualBody,
            }
          }
        } catch {
          this.systemServicesSettings = getDefaultSystemServicesSettingsForProvider(
            this.getDefaultProviderType(),
          )
        }
      } else {
        this.systemServicesSettings = getDefaultSystemServicesSettingsForProvider(
          this.getDefaultProviderType(),
        )
      }

      // Load update settings
      const updateSettingsJson = await database.getSetting('update_settings')
      if (updateSettingsJson) {
        try {
          const loaded = JSON.parse(updateSettingsJson)
          const defaults = getDefaultUpdateSettings()
          this.updateSettings = { ...defaults, ...loaded }
        } catch {
          this.updateSettings = getDefaultUpdateSettings()
        }
      }

      // Only ensure default profile and migrate for existing users (who have completed first run)
      // New users will get their profile created in initializeWithProvider after selecting a provider
      if (this.firstRunComplete) {
        const isOpenRouterUrl = apiURL === PROVIDERS.openrouter.baseUrl
        const isOpenRouterKey = !!apiKey && apiKey.startsWith('sk-or-')
        const shouldEnsureOpenRouterProfile =
          this.providerPreset === 'openrouter' || isOpenRouterUrl || isOpenRouterKey
        const openRouterApiKey = isOpenRouterUrl || isOpenRouterKey ? apiKey : null

        // Ensure default OpenRouter profile exists (migration for existing OpenRouter users)
        if (shouldEnsureOpenRouterProfile) {
          await this.ensureDefaultOpenRouterProfile(openRouterApiKey || null)
        }

        // Migrate null profileIds to default OpenRouter profile
        await this.migrateNullProfileIds()
      }

      // Load translation settings
      const translationSettingsJson = await database.getSetting('translation_settings')
      if (translationSettingsJson) {
        try {
          const loaded = JSON.parse(translationSettingsJson)
          const defaults = getDefaultTranslationSettings()
          this.translationSettings = { ...defaults, ...loaded }
        } catch {
          this.translationSettings = getDefaultTranslationSettings()
        }
      }

      // Load image profiles
      await this.loadImageProfiles()

      // Ensure default image generation profiles are set
      await this.migrateImageProfileDefaults()

      this.initialized = true
    } catch (error) {
      console.error('Failed to load settings:', error)
      this.initialized = true // Mark as initialized even on error to prevent infinite retries
    }
  }
  async setApiURL(apiURL: string) {
    this.apiSettings.openaiApiURL = apiURL
    await database.setSetting('openai_api_url', apiURL)
  }

  async setApiKey(key: string) {
    this.apiSettings.openaiApiKey = key
    await database.setSetting('openai_api_key', key)
  }

  async setDefaultModel(model: string) {
    this.apiSettings.defaultModel = model
    await database.setSetting('default_model', model)
  }

  async setTemperature(temp: number) {
    this.apiSettings.temperature = temp
    await database.setSetting('temperature', temp.toString())
  }

  async setMaxTokens(tokens: number) {
    this.apiSettings.maxTokens = tokens
    await database.setSetting('max_tokens', tokens.toString())
  }

  async setLlmTimeout(timeoutMs: number) {
    this.apiSettings.llmTimeoutMs = timeoutMs
    await database.setSetting('llm_timeout_ms', timeoutMs.toString())
  }

  async setUseNativeTimeout(useNative: boolean) {
    this.apiSettings.useNativeTimeout = useNative
    await database.setSetting('use_native_timeout', useNative.toString())
  }

  async setEnableThinking(enabled: boolean) {
    this.apiSettings.enableThinking = enabled
    this.apiSettings.reasoningEffort = enabled ? 'high' : 'off'
    await database.setSetting('enable_thinking', enabled.toString())
    await database.setSetting('main_reasoning_effort', this.apiSettings.reasoningEffort)
  }

  async setMainReasoningEffort(effort: ReasoningEffort) {
    this.apiSettings.reasoningEffort = effort
    this.apiSettings.enableThinking = effort !== 'off'
    await database.setSetting('main_reasoning_effort', effort)
    await database.setSetting('enable_thinking', this.apiSettings.enableThinking.toString())
  }

  async setMainManualBody(body: string) {
    this.apiSettings.manualBody = body
    await database.setSetting('main_manual_body', body)
  }

  // ===== Profile Management Methods =====

  async saveProfiles() {
    await database.setSetting('api_profiles', JSON.stringify(this.apiSettings.profiles))
    if (this.apiSettings.activeProfileId) {
      await database.setSetting('active_profile_id', this.apiSettings.activeProfileId)
    }
  }

  async addProfile(profile: Omit<APIProfile, 'id' | 'createdAt'>) {
    const newProfile: APIProfile = {
      ...profile,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    this.apiSettings.profiles = [...this.apiSettings.profiles, newProfile]
    await this.saveProfiles()

    // If no default profile exists, set this as the default (which also sets main narrative)
    if (!this.apiSettings.defaultProfileId) {
      await this.setDefaultProfile(newProfile.id)
    }

    return newProfile
  }

  async updateProfile(id: string, updates: Partial<Omit<APIProfile, 'id' | 'createdAt'>>) {
    const index = this.apiSettings.profiles.findIndex((p) => p.id === id)
    if (index === -1) return

    this.apiSettings.profiles[index] = {
      ...this.apiSettings.profiles[index],
      ...updates,
    }
    this.apiSettings.profiles = [...this.apiSettings.profiles]
    await this.saveProfiles()
  }

  async deleteProfile(id: string) {
    // Prevent deleting the main narrative profile
    if (id === this.apiSettings.mainNarrativeProfileId) {
      console.warn('[Settings] Cannot delete the main narrative profile')
      return false
    }

    // Prevent deleting the default profile for the current provider
    const defaultProfileId = this.getDefaultProfileIdForProvider()
    if (id === defaultProfileId) {
      console.warn('[Settings] Cannot delete the default profile')
      return false
    }

    this.apiSettings.profiles = this.apiSettings.profiles.filter((p) => p.id !== id)

    // If deleted profile was active, switch to default profile
    if (this.apiSettings.activeProfileId === id) {
      const defaultProfile = this.getProfile(defaultProfileId)
      if (defaultProfile) {
        this.apiSettings.activeProfileId = defaultProfileId
        this.apiSettings.openaiApiURL = defaultProfile.baseUrl ?? PROVIDERS.openrouter.baseUrl
        this.apiSettings.openaiApiKey = defaultProfile.apiKey
      } else if (this.apiSettings.profiles.length > 0) {
        const fallbackProfile = this.apiSettings.profiles[0]
        this.apiSettings.activeProfileId = fallbackProfile.id
        this.apiSettings.openaiApiURL = fallbackProfile.baseUrl ?? PROVIDERS.openrouter.baseUrl
        this.apiSettings.openaiApiKey = fallbackProfile.apiKey
      } else {
        this.apiSettings.activeProfileId = null
      }
    }

    await this.saveProfiles()
    return true
  }

  /**
   * Check if a profile can be deleted (not the default profile)
   */
  canDeleteProfile(id: string): boolean {
    return id !== this.apiSettings.defaultProfileId
  }

  /**
   * Set the active profile for editing in the API tab (UI state only)
   * This does NOT change which profile is used for API calls
   */
  setActiveProfileForEditing(id: string | null) {
    this.apiSettings.activeProfileId = id
  }

  /**
   * Set the profile used for main narrative generation
   */
  async setMainNarrativeProfile(profileId: string) {
    this.apiSettings.mainNarrativeProfileId = profileId
    await database.setSetting('main_narrative_profile_id', profileId)
  }

  /**
   * Set the global default profile used as fallback.
   * Also sets this as the main narrative profile.
   * If generation settings haven't been customized, auto-applies new defaults.
   */
  async setDefaultProfile(profileId: string | undefined) {
    // Prevent unsetting if there's only one profile or no alternative
    if (!profileId && this.apiSettings.profiles.length <= 1) {
      console.warn('[Settings] Cannot unset default profile when there is only one profile')
      return
    }

    const previousProfileId = this.apiSettings.defaultProfileId
    this.apiSettings.defaultProfileId = profileId

    if (profileId) {
      await database.setSetting('default_profile_id', profileId)
      // Also set as main narrative profile
      this.apiSettings.mainNarrativeProfileId = profileId
      await database.setSetting('main_narrative_profile_id', profileId)
    } else {
      await database.deleteSetting('default_profile_id')
      // When unsetting, set the first available profile as main narrative
      if (this.apiSettings.profiles.length > 0) {
        const fallbackProfile = this.apiSettings.profiles[0]
        this.apiSettings.mainNarrativeProfileId = fallbackProfile.id
        await database.setSetting('main_narrative_profile_id', fallbackProfile.id)
      }
    }

    // If the default profile changed, check if we should auto-apply new defaults
    if (previousProfileId !== profileId) {
      await this.applyDefaultsIfUnchanged()
    }
  }

  /**
   * Get the profile used for main narrative generation
   */
  getMainNarrativeProfile(): APIProfile | undefined {
    return this.getProfile(this.apiSettings.mainNarrativeProfileId)
  }

  /**
   * Get API settings configured for a specific profile.
   * This returns a modified APISettings object with the profile's URL and key.
   * Use this when creating an OpenAIProvider for a specific service.
   */
  getApiSettingsForProfile(profileId: string): APISettings {
    const profile = this.getProfile(profileId)
    if (!profile) {
      // Fall back to the default profile for the current provider
      const defaultProfile = this.getDefaultProfile()
      if (defaultProfile) {
        return {
          ...this.apiSettings,
          openaiApiURL: defaultProfile.baseUrl ?? PROVIDERS.openrouter.baseUrl,
          openaiApiKey: defaultProfile.apiKey,
        }
      }
      // Ultimate fallback - use current settings
      return this.apiSettings
    }

    return {
      ...this.apiSettings,
      openaiApiURL: profile.baseUrl ?? PROVIDERS.openrouter.baseUrl,
      openaiApiKey: profile.apiKey,
    }
  }

  getProfile(id: string): APIProfile | undefined {
    return this.apiSettings.profiles.find((p) => p.id === id)
  }

  getActiveProfile(): APIProfile | undefined {
    if (!this.apiSettings.activeProfileId) return undefined
    return this.getProfile(this.apiSettings.activeProfileId)
  }

  getProfileModels(profileId: string | null): string[] {
    if (!profileId) return []
    const profile = this.getProfile(profileId)
    if (!profile) return []
    return [...new Set([...profile.fetchedModels, ...profile.customModels])]
  }

  getAvailableModels(profileId: string | null): string[] {
    if (!profileId) return []
    const profile = this.getProfile(profileId)
    if (!profile) return []
    const hidden = new Set(profile.hiddenModels ?? [])
    const favSet = new Set(profile.favoriteModels ?? [])
    const all = [...new Set([...profile.fetchedModels, ...profile.customModels])].filter(
      (m) => !hidden.has(m),
    )
    const favorites = all.filter((m) => favSet.has(m))
    const rest = all.filter((m) => !favSet.has(m))
    return [...favorites, ...rest]
  }

  /**
   * Collect all models currently in use across all services.
   * This is used for migration to ensure the default profile has all needed models.
   */
  private collectModelsInUse(): string[] {
    const models = new SvelteSet<string>()

    // Default model
    if (this.apiSettings.defaultModel) {
      models.add(this.apiSettings.defaultModel)
    }

    // Classifier
    if (this.systemServicesSettings.classifier.model) {
      models.add(this.systemServicesSettings.classifier.model)
    }

    // Memory
    if (this.systemServicesSettings.memory.model) {
      models.add(this.systemServicesSettings.memory.model)
    }

    // Suggestions
    if (this.systemServicesSettings.suggestions.model) {
      models.add(this.systemServicesSettings.suggestions.model)
    }

    // Action Choices
    if (this.systemServicesSettings.actionChoices.model) {
      models.add(this.systemServicesSettings.actionChoices.model)
    }

    // Style Reviewer
    if (this.systemServicesSettings.styleReviewer.model) {
      models.add(this.systemServicesSettings.styleReviewer.model)
    }

    // Lore Management
    if (this.systemServicesSettings.loreManagement.model) {
      models.add(this.systemServicesSettings.loreManagement.model)
    }

    // Agentic Retrieval
    if (this.systemServicesSettings.agenticRetrieval.model) {
      models.add(this.systemServicesSettings.agenticRetrieval.model)
    }

    // Timeline Fill
    if (this.systemServicesSettings.timelineFill.model) {
      models.add(this.systemServicesSettings.timelineFill.model)
    }

    // Entry Retrieval (Tier 3 selection)
    if (this.systemServicesSettings.entryRetrieval.model) {
      models.add(this.systemServicesSettings.entryRetrieval.model)
    }

    // Wizard settings
    for (const process of Object.values(this.wizardSettings)) {
      if (process.model) {
        models.add(process.model)
      }
    }

    return Array.from(models).filter((m) => m.length > 0)
  }

  /**
   * Ensure the default OpenRouter profile exists.
   * This handles migration from:
   * - Fresh installs (no profiles, no API key)
   * - Pre-profile versions (existing API key but no profiles)
   * - Profile-aware versions (profiles may or may not include OpenRouter)
   */
  async ensureDefaultOpenRouterProfile(existingApiKey: string | null) {
    // Check if default OpenRouter profile already exists
    const existingDefault = this.apiSettings.profiles.find(
      (p) => p.id === DEFAULT_OPENROUTER_PROFILE_ID,
    )

    // Collect all models currently in use for migration
    const modelsInUse = this.collectModelsInUse()

    // Common OpenRouter models to include by default
    const defaultOpenRouterModels = [
      'deepseek/deepseek-v3.2',
      'x-ai/grok-4.1-fast',
      'x-ai/grok-4-fast',
      'z-ai/glm-4.7',
      'minimax/minimax-m2.1',
      'google/gemini-2.0-flash-001',
    ]

    // Combine models in use with defaults, removing duplicates
    const allModels = [...new Set([...modelsInUse, ...defaultOpenRouterModels])]

    if (!existingDefault) {
      // Create the default OpenRouter profile
      const defaultProfile: APIProfile = {
        id: DEFAULT_OPENROUTER_PROFILE_ID,
        name: 'OpenRouter',
        providerType: 'openrouter',
        baseUrl: PROVIDERS.openrouter.baseUrl,
        apiKey: existingApiKey || '', // Migrate existing key if present
        customModels: allModels, // Include all models in use plus defaults
        fetchedModels: [], // Will be populated when user fetches from API
        reasoningModels: [],
        hiddenModels: [],
        favoriteModels: [],
        createdAt: Date.now(),
      }

      // Add to profiles array (at the beginning so it's first)
      this.apiSettings.profiles = [defaultProfile, ...this.apiSettings.profiles]

      // If no active profile is set, make this the active one
      if (!this.apiSettings.activeProfileId) {
        this.apiSettings.activeProfileId = DEFAULT_OPENROUTER_PROFILE_ID
        // Also set the current URL/key to match the profile (legacy fields)
        this.apiSettings.openaiApiURL = defaultProfile.baseUrl ?? PROVIDERS.openrouter.baseUrl
        this.apiSettings.openaiApiKey = defaultProfile.apiKey
      }

      // Save to database
      await this.saveProfiles()

      console.log('[Settings] Created default OpenRouter profile with', allModels.length, 'models')
    } else {
      let needsSave = false

      // Profile exists but has no API key, and we found one in the old location
      if (existingApiKey && !existingDefault.apiKey) {
        existingDefault.apiKey = existingApiKey
        needsSave = true
        console.log('[Settings] Migrated API key to existing OpenRouter profile')
      }

      // Add any models in use that aren't already in the profile
      const existingModels = new Set([
        ...existingDefault.fetchedModels,
        ...existingDefault.customModels,
      ])
      const missingModels = modelsInUse.filter((m) => !existingModels.has(m))
      if (missingModels.length > 0) {
        existingDefault.customModels = [
          ...new Set([...existingDefault.customModels, ...missingModels]),
        ]
        needsSave = true
        console.log(
          '[Settings] Added',
          missingModels.length,
          'missing models to OpenRouter profile',
        )
      }

      if (needsSave) {
        this.apiSettings.profiles = [...this.apiSettings.profiles]
        await this.saveProfiles()
      }
    }
  }

  /**
   * Migrate null profileIds to the default OpenRouter profile.
   * This handles existing users who have null profileIds from before
   * profiles were required to be explicitly set.
   */
  async migrateNullProfileIds() {
    let needsSave = false

    // Helper to check if profileId needs migration (null, undefined, or empty string)
    const needsMigration = (profileId: string | null | undefined): boolean => {
      return profileId === null || profileId === undefined || profileId === ''
    }

    // Migrate system services settings
    if (needsMigration(this.systemServicesSettings.classifier.profileId)) {
      this.systemServicesSettings.classifier.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.memory.profileId)) {
      this.systemServicesSettings.memory.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.suggestions.profileId)) {
      this.systemServicesSettings.suggestions.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.actionChoices.profileId)) {
      this.systemServicesSettings.actionChoices.profileId =
        this.systemServicesSettings.suggestions.profileId ?? DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.styleReviewer.profileId)) {
      this.systemServicesSettings.styleReviewer.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.loreManagement.profileId)) {
      this.systemServicesSettings.loreManagement.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.agenticRetrieval.profileId)) {
      this.systemServicesSettings.agenticRetrieval.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.timelineFill.profileId)) {
      this.systemServicesSettings.timelineFill.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }
    if (needsMigration(this.systemServicesSettings.entryRetrieval.profileId)) {
      this.systemServicesSettings.entryRetrieval.profileId = DEFAULT_OPENROUTER_PROFILE_ID
      needsSave = true
    }

    if (needsSave) {
      await this.saveSystemServicesSettings()
      console.log('[Settings] Migrated null/undefined profileIds to default OpenRouter profile')
    }

    // Migrate wizard settings
    let wizardNeedsSave = false
    for (const [key, process] of Object.entries(this.wizardSettings)) {
      if (needsMigration(process.profileId)) {
        ;(this.wizardSettings as any)[key].profileId = DEFAULT_OPENROUTER_PROFILE_ID
        wizardNeedsSave = true
      }
    }

    if (wizardNeedsSave) {
      await this.saveWizardSettings()
      console.log(
        '[Settings] Migrated wizard null/undefined profileIds to default OpenRouter profile',
      )
    }
  }

  /**
   * Auto-migrate existing API Profile references to Image Profiles.
   * On first load after the rework, if imageProfiles is empty but imageGeneration
   * settings have API profile IDs, create Image Profiles from those API Profiles.
   */
  async migrateImageProfileDefaults() {
    if (this.imageProfiles.length > 0) return

    const imgSettings = this.systemServicesSettings.imageGeneration
    // Map each profile field to its corresponding old model field
    // The old model fields (model, referenceModel, portraitModel, backgroundModel) have been
    // removed from the type but may still exist in persisted user data
    const profileFieldMap: Record<string, string> = {
      profileId: 'model',
      referenceProfileId: 'referenceModel',
      portraitProfileId: 'portraitModel',
      backgroundProfileId: 'backgroundModel',
    }

    // Map from "apiProfileId:model" → new Image Profile ID
    const newProfileIds = new SvelteMap<string, string>()
    let changed = false

    for (const [profileField, modelField] of Object.entries(profileFieldMap)) {
      const apiProfileId = (imgSettings as unknown as Record<string, unknown>)[profileField] as
        | string
        | undefined
      const model = (imgSettings as unknown as Record<string, unknown>)[modelField] as
        | string
        | undefined

      if (!apiProfileId || !model) continue

      const uniqueKey = `${apiProfileId}:${model}`
      if (newProfileIds.has(uniqueKey)) {
        ;(imgSettings as unknown as Record<string, unknown>)[profileField] =
          newProfileIds.get(uniqueKey)!
        changed = true
        continue
      }

      const apiProfile = this.getProfile(apiProfileId)
      if (!apiProfile) continue

      // Map ProviderType to ImageProviderType (only for image-capable providers)
      const providerType = apiProfile.providerType as string
      const imageProviderTypes = ['nanogpt', 'openai', 'chutes', 'pollinations', 'google', 'zhipu']
      if (!imageProviderTypes.includes(providerType)) continue

      const newProfile = await this.addImageProfile({
        name: `${apiProfile.name} (${model})`,
        providerType: providerType as ImageProviderType,
        apiKey: apiProfile.apiKey ?? '',
        baseUrl: apiProfile.baseUrl,
        model: model,
        providerOptions: {},
      })

      newProfileIds.set(uniqueKey, newProfile.id)
      ;(imgSettings as unknown as Record<string, unknown>)[profileField] = newProfile.id
      changed = true
    }

    if (changed) {
      await this.saveSystemServicesSettings()
      console.log(
        '[Settings] Auto-migrated image generation profiles from API Profiles to Image Profiles',
      )
    }

    // Ensure all existing image profiles have a model field
    let profilesUpdated = false
    for (const profile of this.imageProfiles) {
      if (!profile.model) {
        profile.model = 'flux'
        profilesUpdated = true
      }
    }
    if (profilesUpdated) {
      this.imageProfiles = [...this.imageProfiles]
      await this.saveImageProfiles()
      console.log('[Settings] Migrated image profiles to include model field')
    }
  }

  /**
   * Get the default profile for the current provider.
   */
  getDefaultProfile(): APIProfile | undefined {
    const defaultProfileId = this.getDefaultProfileIdForProvider()
    return (
      this.getProfile(defaultProfileId) ??
      this.getProfile(DEFAULT_OPENROUTER_PROFILE_ID) ??
      this.apiSettings.profiles[0]
    )
  }

  /**
   * Get the profile to use for a given profileId.
   * If profileId is null, returns the active profile or the default profile.
   */
  getProfileForService(profileId: string | null): APIProfile | undefined {
    if (profileId) {
      return this.getProfile(profileId)
    }
    // Fall back to active profile, then default profile
    return this.getActiveProfile() || this.getDefaultProfile()
  }

  /**
   * Apply theme to the DOM using data-theme attribute and legacy dark class
   */
  private applyTheme(theme: ThemeId) {
    // Set data-theme attribute for CSS custom properties
    document.documentElement.setAttribute('data-theme', theme)

    // Get theme metadata and apply dark class if needed
    const themeMetadata = getTheme(theme)
    if (themeMetadata?.isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  async setTheme(theme: ThemeId) {
    this.uiSettings.theme = theme
    await database.setSetting('theme', theme)
    this.applyTheme(theme)
  }

  /**
   * Apply font size to the DOM using data-font-size attribute
   */
  private applyFontSize(size: 'small' | 'medium' | 'large') {
    document.documentElement.setAttribute('data-font-size', size)
  }

  async setFontSize(size: 'small' | 'medium' | 'large') {
    this.uiSettings.fontSize = size
    await database.setSetting('font_size', size)
    this.applyFontSize(size)
  }

  /**
   * Load a Google Font by injecting a stylesheet link
   */
  private loadGoogleFont(fontName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Remove existing Google Font link if any
      const existingLink = document.getElementById('google-font-link')
      if (existingLink) {
        existingLink.remove()
      }

      const link = document.createElement('link')
      link.id = 'google-font-link'
      link.rel = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600;700&display=swap`

      link.onload = () => resolve()
      link.onerror = () => reject(new Error(`Failed to load Google Font: ${fontName}`))

      document.head.appendChild(link)
    })
  }

  /**
   * Apply font family to the DOM using CSS custom property
   */
  private applyFontFamily(fontFamily: string, source: FontSource) {
    if (source === 'default' || fontFamily === 'default') {
      // Remove custom font and let CSS use theme default
      document.documentElement.style.removeProperty('--font-story-custom')
      document.documentElement.removeAttribute('data-custom-font')

      // Remove Google Font link if exists
      const existingLink = document.getElementById('google-font-link')
      if (existingLink) {
        existingLink.remove()
      }
    } else {
      // Set custom font
      const fontStack =
        source === 'google' ? `'${fontFamily}', Georgia, serif` : `'${fontFamily}', Georgia, serif`
      document.documentElement.style.setProperty('--font-story-custom', fontStack)
      document.documentElement.setAttribute('data-custom-font', 'true')
    }
  }

  async setFontFamily(fontFamily: string, source: FontSource) {
    this.uiSettings.fontFamily = fontFamily
    this.uiSettings.fontSource = source

    // Load Google Font if needed
    if (source === 'google' && fontFamily !== 'default') {
      try {
        await this.loadGoogleFont(fontFamily)
      } catch (error) {
        console.error('Failed to load Google Font:', error)
      }
    }

    this.applyFontFamily(fontFamily, source)

    // Save to database as JSON object
    await database.setSetting('font_family', JSON.stringify({ fontFamily, fontSource: source }))
  }

  async setSpellcheckEnabled(enabled: boolean) {
    this.uiSettings.spellcheckEnabled = enabled
    await database.setSetting('spellcheck_enabled', enabled.toString())
  }

  async setDisableSuggestions(enabled: boolean) {
    this.uiSettings.disableSuggestions = enabled
    await database.setSetting('disable_suggestions', enabled.toString())
  }

  async setDisableActionPrefixes(enabled: boolean) {
    this.uiSettings.disableActionPrefixes = enabled
    await database.setSetting('disable_action_prefixes', enabled.toString())
  }

  async setShowReasoning(show: boolean) {
    this.uiSettings.showReasoning = show
    await database.setSetting('show_reasoning', show.toString())
  }

  async setSidebarWidth(width: number) {
    this.uiSettings.sidebarWidth = width
    await database.setSetting('sidebar_width', width.toString())
  }

  async setDebugMode(enabled: boolean) {
    this.uiSettings.debugMode = enabled
    await database.setSetting('debug_mode', enabled.toString())
  }

  async setAdvancedManualMode(enabled: boolean) {
    this.advancedRequestSettings.manualMode = enabled
    await database.setSetting('advanced_manual_mode', enabled.toString())
  }

  //Return true if an API key is needed for main narrative generation.
  get needsApiKey(): boolean {
    const mainProfile = this.getMainNarrativeProfile() ?? this.getDefaultProfile()
    if (mainProfile) {
      return !mainProfile.apiKey || mainProfile.apiKey.length === 0
    }

    // Fall back to legacy check for pre-profile installations
    return (
      !this.apiSettings.openaiApiKey &&
      this.apiSettings.openaiApiURL === PROVIDERS.openrouter.baseUrl
    )
  }

  // Wizard settings methods
  async saveWizardSettings() {
    await database.setSetting('wizard_settings', JSON.stringify(this.wizardSettings))
  }

  async resetWizardProcess(process: keyof AdvancedWizardSettings) {
    const defaults = getDefaultAdvancedSettingsForProvider(this.getDefaultProviderType())
    this.wizardSettings[process] = { ...defaults[process] }
    await this.saveWizardSettings()
  }

  async resetAllWizardSettings() {
    this.wizardSettings = getDefaultAdvancedSettingsForProvider(this.getDefaultProviderType())
    await this.saveWizardSettings()
  }

  // System services settings methods
  async saveGenerationPresets() {
    await database.setSetting('generation_presets', JSON.stringify(this.generationPresets))
  }

  async saveServicePresetAssignments() {
    await database.setSetting(
      'service_preset_assignments',
      JSON.stringify(this.servicePresetAssignments),
    )
  }

  async resetGenerationPresets() {
    const effectiveProvider = this.getDefaultProviderType()
    const defaultProfileId = this.getDefaultProfileIdForProvider()
    // Populate profileIds with the default profile ID (presets come with null by default)
    this.generationPresets = getDefaultGenerationPresetsForProvider(effectiveProvider).map(
      (preset) => ({
        ...preset,
        profileId: preset.profileId || defaultProfileId,
      }),
    )
    await this.saveGenerationPresets()
  }

  async saveSystemServicesSettings() {
    await database.setSetting(
      'system_services_settings',
      JSON.stringify(this.systemServicesSettings),
    )
  }

  async saveServiceSpecificSettings() {
    await database.setSetting(
      'service_specific_settings',
      JSON.stringify(this.serviceSpecificSettings),
    )
  }

  async resetServiceSpecificSettings() {
    this.serviceSpecificSettings = getDefaultServiceSpecificSettings()
    await this.saveServiceSpecificSettings()
  }

  // Experimental features methods
  async saveExperimentalFeatures() {
    await database.setSetting('experimental_features', JSON.stringify(this.experimentalFeatures))
  }

  async updateExperimentalFeatures(updates: Partial<ExperimentalFeatures>) {
    // Enforce dependencies: rollbackOnDelete requires stateTracking
    if (
      updates.rollbackOnDelete &&
      !this.experimentalFeatures.stateTracking &&
      !updates.stateTracking
    ) {
      updates.rollbackOnDelete = false
    }
    // lightweightBranches requires stateTracking
    if (
      updates.lightweightBranches &&
      !this.experimentalFeatures.stateTracking &&
      !updates.stateTracking
    ) {
      updates.lightweightBranches = false
    }
    // Disabling stateTracking cascades
    if (updates.stateTracking === false) {
      updates.rollbackOnDelete = false
      updates.lightweightBranches = false
    }
    this.experimentalFeatures = { ...this.experimentalFeatures, ...updates }
    await this.saveExperimentalFeatures()
  }

  async resetExperimentalFeatures() {
    this.experimentalFeatures = getDefaultExperimentalFeatures()
    await this.saveExperimentalFeatures()
  }

  // Translation settings methods
  async saveTranslationSettings() {
    await database.setSetting('translation_settings', JSON.stringify(this.translationSettings))
  }

  async updateTranslationSettings(updates: Partial<TranslationSettings>) {
    this.translationSettings = { ...this.translationSettings, ...updates }
    await this.saveTranslationSettings()
  }

  async resetTranslationSettings() {
    this.translationSettings = getDefaultTranslationSettings()
    await this.saveTranslationSettings()
  }

  // ===== Image Profile Management =====

  async saveImageProfiles() {
    await database.setSetting('image_profiles', JSON.stringify(this.imageProfiles))
  }

  async loadImageProfiles() {
    const json = await database.getSetting('image_profiles')
    if (json) {
      try {
        const parsed = JSON.parse(json) as ImageProfile[]
        this.imageProfiles = parsed.map((p) => ({
          ...p,
          providerOptions: p.providerOptions ?? {},
        }))
      } catch {
        this.imageProfiles = []
      }
    }
  }

  async addImageProfile(profile: Omit<ImageProfile, 'id' | 'createdAt'>): Promise<ImageProfile> {
    const newProfile: ImageProfile = {
      ...profile,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    this.imageProfiles = [...this.imageProfiles, newProfile]
    await this.saveImageProfiles()
    return newProfile
  }

  async updateImageProfile(id: string, updates: Partial<Omit<ImageProfile, 'id' | 'createdAt'>>) {
    const index = this.imageProfiles.findIndex((p) => p.id === id)
    if (index === -1) return
    this.imageProfiles[index] = { ...this.imageProfiles[index], ...updates }
    this.imageProfiles = [...this.imageProfiles]
    await this.saveImageProfiles()
  }

  async deleteImageProfile(id: string): Promise<boolean> {
    this.imageProfiles = this.imageProfiles.filter((p) => p.id !== id)
    await this.saveImageProfiles()
    return true
  }

  getImageProfile(id: string): ImageProfile | undefined {
    return this.imageProfiles.find((p) => p.id === id)
  }

  async resetClassifierSettings() {
    this.systemServicesSettings.classifier = getDefaultClassifierSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetLorebookClassifierSettings() {
    this.systemServicesSettings.lorebookClassifier =
      getDefaultLorebookClassifierSettingsForProvider(this.providerPreset)
    await this.saveSystemServicesSettings()
  }

  async resetLorebookClassifierSpecificSettings() {
    this.serviceSpecificSettings.lorebookClassifier = getDefaultLorebookClassifierSpecificSettings()
    await this.saveServiceSpecificSettings()
  }

  async resetSuggestionsSettings() {
    this.systemServicesSettings.suggestions = getDefaultSuggestionsSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetActionChoicesSettings() {
    this.systemServicesSettings.actionChoices = getDefaultActionChoicesSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetStyleReviewerSettings() {
    this.systemServicesSettings.styleReviewer = getDefaultStyleReviewerSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetLoreManagementSettings() {
    this.systemServicesSettings.loreManagement = getDefaultLoreManagementSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetInteractiveVaultSettings() {
    this.systemServicesSettings.interactiveVault = getDefaultInteractiveVaultSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetAgenticRetrievalSettings() {
    this.systemServicesSettings.agenticRetrieval = getDefaultAgenticRetrievalSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetTimelineFillSettings() {
    this.systemServicesSettings.timelineFill = getDefaultTimelineFillSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetChapterQuerySettings() {
    this.systemServicesSettings.chapterQuery = getDefaultChapterQuerySettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetEntryRetrievalSettings() {
    this.systemServicesSettings.entryRetrieval = getDefaultEntryRetrievalSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetImageGenerationSettings() {
    this.systemServicesSettings.imageGeneration = getDefaultImageGenerationSettingsForProvider(
      this.providerPreset,
    )
    await this.saveSystemServicesSettings()
  }

  async resetTTSSettings() {
    this.systemServicesSettings.tts = getDefaultTTSSettingsForProvider(this.providerPreset)
    await this.saveSystemServicesSettings()
  }

  async resetCharacterCardImportSettings() {
    this.systemServicesSettings.characterCardImport =
      getDefaultCharacterCardImportSettingsForProvider(this.providerPreset)
    await this.saveSystemServicesSettings()
  }

  async resetAllSystemServicesSettings() {
    this.systemServicesSettings = getDefaultSystemServicesSettingsForProvider(this.providerPreset)
    await this.saveSystemServicesSettings()
  }

  async resetContextWindowSettings() {
    this.serviceSpecificSettings.contextWindow = getDefaultContextWindowSettings()
    await this.saveServiceSpecificSettings()
  }

  async resetLorebookLimitsSettings() {
    this.serviceSpecificSettings.lorebookLimits = getDefaultLorebookLimitsSettings()
    await this.saveServiceSpecificSettings()
  }

  async resetAgenticRetrievalSpecificSettings() {
    this.serviceSpecificSettings.agenticRetrieval = getDefaultAgenticRetrievalSpecificSettings()
    await this.saveServiceSpecificSettings()
  }

  // Update settings methods
  async saveUpdateSettings() {
    await database.setSetting('update_settings', JSON.stringify(this.updateSettings))
  }

  async setAutoCheck(enabled: boolean) {
    this.updateSettings.autoCheck = enabled
    await this.saveUpdateSettings()
  }

  async setAutoDownload(enabled: boolean) {
    this.updateSettings.autoDownload = enabled
    await this.saveUpdateSettings()
  }

  async setCheckInterval(hours: number) {
    this.updateSettings.checkInterval = hours
    await this.saveUpdateSettings()
  }

  async setLastChecked(timestamp: number | null) {
    this.updateSettings.lastChecked = timestamp
    await this.saveUpdateSettings()
  }

  async resetUpdateSettings() {
    this.updateSettings = getDefaultUpdateSettings()
    await this.saveUpdateSettings()
  }

  /**
   * Reset ALL settings to their default values based on the current provider preset.
   * This preserves the API key and URL but resets everything else.
   */
  async resetAllSettings(preserveApiSettings = true) {
    const provider = this.getDefaultProviderType()
    const defaults = PROVIDERS[provider]

    const apiKey = preserveApiSettings ? this.apiSettings.openaiApiKey : null
    const apiURL = preserveApiSettings
      ? this.apiSettings.openaiApiURL
      : defaults.baseUrl || PROVIDERS.openrouter.baseUrl
    const profiles = preserveApiSettings ? this.apiSettings.profiles : []
    const activeProfileId = preserveApiSettings ? this.apiSettings.activeProfileId : null
    const mainNarrativeProfileId = preserveApiSettings
      ? this.apiSettings.mainNarrativeProfileId
      : ''

    // For providers without service defaults, use empty model (requires manual configuration)
    const defaultNarrativeModel = defaults.services?.narrative.model ?? ''
    const defaultReasoningEffort = defaults.services?.narrative.reasoningEffort ?? 'off'

    // Reset API settings (except URL/key/profiles if preserving)
    this.apiSettings = {
      openaiApiURL: apiURL,
      openaiApiKey: apiKey,
      profiles: profiles,
      activeProfileId: activeProfileId,
      mainNarrativeProfileId: mainNarrativeProfileId,
      defaultModel: defaultNarrativeModel,
      temperature: 0.8,
      maxTokens: 8192,
      reasoningEffort: defaultReasoningEffort,
      manualBody: '',
      enableThinking: false,
      llmTimeoutMs: LLM_TIMEOUT_DEFAULT,
      useNativeTimeout: false,
    }

    // Reset UI settings
    this.uiSettings = {
      theme: 'dark',
      fontSize: 'medium',
      fontFamily: 'default',
      fontSource: 'default',
      showWordCount: true,
      autoSave: true,
      spellcheckEnabled: true,
      debugMode: false,
      disableSuggestions: false,
      disableActionPrefixes: false,
      showReasoning: false,
      sidebarWidth: 288,
    }

    // Reset font to default
    this.applyFontFamily('default', 'default')

    this.advancedRequestSettings = getDefaultAdvancedRequestSettings()

    // Reset wizard settings based on provider
    this.wizardSettings = getDefaultAdvancedSettingsForProvider(provider)

    // Reset system services settings based on provider
    this.systemServicesSettings = getDefaultSystemServicesSettingsForProvider(provider)

    // Reset update settings
    this.updateSettings = getDefaultUpdateSettings()

    // Save all to database
    await database.setSetting('default_model', this.apiSettings.defaultModel)
    await database.setSetting('temperature', this.apiSettings.temperature.toString())
    await database.setSetting('max_tokens', this.apiSettings.maxTokens.toString())
    await database.setSetting('enable_thinking', this.apiSettings.enableThinking.toString())
    await database.setSetting('main_reasoning_effort', this.apiSettings.reasoningEffort)
    await database.setSetting('main_manual_body', this.apiSettings.manualBody)
    await database.setSetting('theme', this.uiSettings.theme)
    await database.setSetting('font_size', this.uiSettings.fontSize)
    await database.setSetting('show_word_count', this.uiSettings.showWordCount.toString())
    await database.setSetting('auto_save', this.uiSettings.autoSave.toString())
    await database.setSetting('spellcheck_enabled', this.uiSettings.spellcheckEnabled.toString())
    await database.setSetting('debug_mode', this.uiSettings.debugMode.toString())
    await database.setSetting('disable_suggestions', this.uiSettings.disableSuggestions.toString())
    await database.setSetting(
      'disable_action_prefixes',
      this.uiSettings.disableActionPrefixes.toString(),
    )
    await database.setSetting(
      'advanced_manual_mode',
      this.advancedRequestSettings.manualMode.toString(),
    )
    await this.saveWizardSettings()
    await this.saveSystemServicesSettings()
    await this.saveUpdateSettings()

    // Apply theme and font size
    this.applyTheme(this.uiSettings.theme)
    this.applyFontSize(this.uiSettings.fontSize)
  }

  // Provider preset methods
  async setProviderType(provider: ProviderType) {
    const previousProvider = this.providerPreset
    this.providerPreset = provider
    await database.setSetting('provider_preset', provider)

    // If the provider changed, check if we should auto-apply new defaults
    if (previousProvider !== provider) {
      await this.applyDefaultsIfUnchanged()
    }
  }

  // First-run methods
  async setFirstRunComplete(complete: boolean) {
    this.firstRunComplete = complete
    await database.setSetting('first_run_complete', complete.toString())
  }

  /**
   * Initialize settings for a new user with a specific provider.
   * This sets up the default profile and all settings based on the provider.
   */
  async initializeWithProvider(provider: ProviderType, apiKey: string) {
    const defaults = PROVIDERS[provider]

    // Set the provider preset
    this.providerPreset = provider
    await database.setSetting('provider_preset', provider)

    // Create a unique profile ID
    const defaultProfileId = `default-${provider}-profile`
    const defaultApiURL = defaults.baseUrl || PROVIDERS.openrouter.baseUrl

    const defaultProfile: APIProfile = {
      id: defaultProfileId,
      name: defaults.name,
      providerType: provider,
      baseUrl: defaultApiURL,
      apiKey: apiKey,
      customModels: [],
      fetchedModels: [],
      reasoningModels: [],
      hiddenModels: [],
      favoriteModels: [],
      createdAt: Date.now(),
    }

    // Check if profile already exists
    const existingProfileIndex = this.apiSettings.profiles.findIndex(
      (p) => p.id === defaultProfileId,
    )
    if (existingProfileIndex >= 0) {
      this.apiSettings.profiles[existingProfileIndex] = defaultProfile
    } else {
      this.apiSettings.profiles = [defaultProfile, ...this.apiSettings.profiles]
    }

    // Set this as the active and main narrative profile
    this.apiSettings.activeProfileId = defaultProfileId
    this.apiSettings.mainNarrativeProfileId = defaultProfileId
    this.apiSettings.openaiApiURL = defaultApiURL
    this.apiSettings.openaiApiKey = apiKey

    // Set provider-specific defaults (empty model for providers without preconfigured defaults)
    this.apiSettings.defaultModel = defaults.services?.narrative.model ?? ''
    this.apiSettings.temperature = defaults.services?.narrative.temperature ?? 0.8
    this.apiSettings.maxTokens = defaults.services?.narrative.maxTokens ?? 8192
    this.apiSettings.reasoningEffort = defaults.services?.narrative.reasoningEffort ?? 'off'
    this.apiSettings.manualBody = ''
    this.apiSettings.enableThinking = false
    await database.setSetting('default_model', this.apiSettings.defaultModel)
    await database.setSetting('temperature', this.apiSettings.temperature.toString())
    await database.setSetting('max_tokens', this.apiSettings.maxTokens.toString())
    await database.setSetting('main_reasoning_effort', this.apiSettings.reasoningEffort)
    await database.setSetting('main_manual_body', this.apiSettings.manualBody)
    await database.setSetting('enable_thinking', this.apiSettings.enableThinking.toString())

    // Apply provider-specific defaults to system services
    this.systemServicesSettings = getDefaultSystemServicesSettingsForProvider(provider)

    // Apply provider-specific defaults to wizard settings
    this.wizardSettings = getDefaultAdvancedSettingsForProvider(provider)

    // Apply provider-specific defaults to generation presets (Agent Profiles)
    // Populate profileIds with the default profile ID (presets come with null by default)
    this.generationPresets = getDefaultGenerationPresetsForProvider(provider).map((preset) => ({
      ...preset,
      profileId: preset.profileId || defaultProfileId,
    }))

    // Save everything
    await this.saveProfiles()
    await database.setSetting('main_narrative_profile_id', defaultProfileId)
    await database.setSetting('openai_api_url', defaultApiURL)
    await database.setSetting('openai_api_key', apiKey)
    await this.saveSystemServicesSettings()
    await this.saveWizardSettings()
    await this.saveGenerationPresets()

    // Mark first run as complete
    this.firstRunComplete = true
    await database.setSetting('first_run_complete', 'true')

    console.log(`[Settings] Initialized with ${defaults.name} provider`)
  }

  /**
   * Get the default profile ID for the current provider preset.
   */
  getDefaultProfileIdForProvider(): string {
    // If user has explicitly set a default profile, use it
    if (this.apiSettings.defaultProfileId) {
      return this.apiSettings.defaultProfileId
    }
    // Return the profile ID based on provider preset
    return `default-${this.providerPreset}-profile`
  }

  /**
   * Get the provider type from the default profile.
   * Used for determining which defaults to apply when resetting.
   */
  getDefaultProviderType(): ProviderType {
    const defaultProfile = this.getDefaultProfile()
    return defaultProfile?.providerType ?? 'openrouter'
  }

  /**
   * Get the first available model from the default profile.
   * Used for 'custom' provider resets to use user's actual models instead of placeholders.
   */
  getFirstModelFromDefaultProfile(): string | null {
    const defaultProfile = this.getDefaultProfile()
    if (!defaultProfile) return null

    // Prefer fetched models, then custom models
    const models = [...defaultProfile.fetchedModels, ...defaultProfile.customModels]
    return models.length > 0 ? models[0] : null
  }

  /**
   * Check if a generation preset matches its default values for current provider.
   * Used to determine if we should auto-update when default profile changes.
   */
  private presetMatchesDefault(preset: GenerationPreset, defaultPreset: GenerationPreset): boolean {
    return (
      preset.model === defaultPreset.model &&
      preset.temperature === defaultPreset.temperature &&
      preset.maxTokens === defaultPreset.maxTokens &&
      preset.reasoningEffort === defaultPreset.reasoningEffort &&
      preset.manualBody === defaultPreset.manualBody
    )
  }

  /**
   * Get generation preset configuration by ID.
   * Used by all services to look up their configuration from central presets array.
   * @param presetId - The preset ID to look up (e.g., 'classification', 'memory', 'wizard')
   * @param serviceName - Optional service name for better error messages
   * @returns The preset configuration, or throws error if not found
   */
  getPresetConfig(presetId: string, serviceName?: string): GenerationPreset {
    if (!presetId) {
      const serviceLabel = serviceName ? `the "${serviceName}" service` : 'this agent'
      const message = `${serviceLabel} is not assigned to an Agent Profile. Please assign it to a profile in Settings > Generation tab.`
      ui.showToast(message, 'error')
      throw new Error(`No preset assigned for ${serviceName || 'service'}`)
    }
    const preset = this.generationPresets.find((p) => p.id === presetId)
    if (!preset) {
      const message = `Agent Profile "${presetId}" not found. Please check your settings.`
      ui.showToast(message, 'error')
      throw new Error(`Generation preset not found: ${presetId}`)
    }
    return preset
  }

  /**
   * Get the preset ID assigned to a specific service.
   * @param serviceId - The service identifier (e.g., 'classifier', 'wizard:settingExpansion')
   * @returns The preset ID assigned to this service
   */
  getServicePresetId(serviceId: string): string {
    return this.servicePresetAssignments[serviceId]
  }

  /**
   * Update the preset ID assigned to a specific service.
   * @param serviceId - The service identifier (e.g., 'classifier', 'wizard:settingExpansion')
   * @param presetId - The preset ID to assign (e.g., 'classification', 'memory', 'wizard')
   */
  async setServicePresetId(serviceId: string, presetId: string) {
    this.servicePresetAssignments[serviceId] = presetId
    await database.setSetting(
      'service_preset_assignments',
      JSON.stringify(this.servicePresetAssignments),
    )
  }

  /**
   * Check if all generation presets match their defaults for the current provider.
   */
  generationPresetsMatchDefaults(): boolean {
    const defaults = getDefaultGenerationPresetsForProvider(this.providerPreset)

    for (const preset of this.generationPresets) {
      const defaultPreset = defaults.find((d) => d.id === preset.id)
      if (!defaultPreset) continue
      if (!this.presetMatchesDefault(preset, defaultPreset)) {
        return false
      }
    }
    return true
  }

  /**
   * Check if system services settings match their defaults for the current provider.
   * Compares key generation parameters: model, temperature, reasoningEffort.
   */
  systemServicesMatchDefaults(): boolean {
    const defaults = getDefaultSystemServicesSettingsForProvider(this.getDefaultProviderType())

    // Helper to compare a service's core generation settings
    const settingsMatch = (
      current: { model: string; temperature: number; reasoningEffort: string },
      defaultService: { model: string; temperature: number; reasoningEffort: string },
    ): boolean => {
      return (
        current.model === defaultService.model &&
        current.temperature === defaultService.temperature &&
        current.reasoningEffort === defaultService.reasoningEffort
      )
    }

    // Check each service that has the standard generation settings
    return (
      settingsMatch(this.systemServicesSettings.classifier, defaults.classifier) &&
      settingsMatch(this.systemServicesSettings.memory, defaults.memory) &&
      settingsMatch(this.systemServicesSettings.suggestions, defaults.suggestions) &&
      settingsMatch(this.systemServicesSettings.actionChoices, defaults.actionChoices) &&
      settingsMatch(this.systemServicesSettings.styleReviewer, defaults.styleReviewer) &&
      settingsMatch(this.systemServicesSettings.loreManagement, defaults.loreManagement) &&
      settingsMatch(this.systemServicesSettings.agenticRetrieval, defaults.agenticRetrieval) &&
      settingsMatch(this.systemServicesSettings.timelineFill, defaults.timelineFill) &&
      settingsMatch(this.systemServicesSettings.chapterQuery, defaults.chapterQuery) &&
      settingsMatch(this.systemServicesSettings.entryRetrieval, defaults.entryRetrieval) &&
      settingsMatch(this.systemServicesSettings.lorebookClassifier, defaults.lorebookClassifier) &&
      settingsMatch(this.systemServicesSettings.interactiveVault, defaults.interactiveVault) &&
      settingsMatch(this.systemServicesSettings.characterCardImport, defaults.characterCardImport)
    )
  }

  /**
   * Auto-apply new defaults when the default profile changes, but only if
   * the user hasn't customized the settings (they still match the old defaults).
   */
  async applyDefaultsIfUnchanged(): Promise<void> {
    const provider = this.providerPreset
    let needsSave = false

    // Check and update generation presets
    if (this.generationPresetsMatchDefaults()) {
      console.log('[Settings] Generation presets match defaults, auto-applying new defaults')
      const defaultProfileId = this.getDefaultProfileIdForProvider()
      // Populate profileIds with the default profile ID (presets come with null by default)
      this.generationPresets = getDefaultGenerationPresetsForProvider(provider).map((preset) => ({
        ...preset,
        profileId: preset.profileId || defaultProfileId,
      }))
      await this.saveGenerationPresets()
      needsSave = true
    }

    // Check and update system services
    if (this.systemServicesMatchDefaults()) {
      console.log('[Settings] System services match defaults, auto-applying new defaults')
      this.systemServicesSettings = getDefaultSystemServicesSettingsForProvider(
        this.getDefaultProviderType(),
      )
      await this.saveSystemServicesSettings()
      needsSave = true
    }

    if (needsSave) {
      console.log('[Settings] Defaults auto-applied after profile change')
    }
  }

  /**
   * Get all invalid/corrupted API profiles.
   * A profile is invalid if it's missing critical fields like providerType.
   * This can happen when users upgrade from older versions that didn't have these fields.
   * @returns Array of invalid profile IDs
   */
  getInvalidProfiles(): string[] {
    const validProviderTypes = Object.keys(PROVIDERS)
    return this.apiSettings.profiles
      .filter((profile) => {
        // Check for missing or invalid providerType (critical field)
        if (!profile.providerType || !validProviderTypes.includes(profile.providerType)) {
          return true
        }
        // Check for missing critical fields
        if (!profile.id || !profile.name) {
          return true
        }
        return false
      })
      .map((p) => p.id)
  }

  /**
   * Check if there are any invalid API profiles that need user attention.
   */
  hasInvalidProfiles(): boolean {
    return this.getInvalidProfiles().length > 0
  }
}

export const settings = new SettingsStore()
