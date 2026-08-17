import type {
  APIProfile,
  APISettings,
  ExperimentalFeatures,
  FontSource,
  FontSizeOption,
  GenerationPreset,
  ImageProfile,
  ImageProviderType,
  ProviderType,
  ReasoningEffort,
  TextModel,
  ThemeId,
  TranslationSettings,
  UISettings,
  UpdateSettings,
} from '$lib/types'
import { ACTION_CHOICES_PANEL_DEFAULTS, normalizeActionChoicesPanelWidth } from './uiLayoutSettings'
import { database } from '$lib/services/database'
import { grammarService } from '$lib/services/grammar'
import { PROVIDERS } from '$lib/services/ai/sdk/providers/config'
import {
  AGENTIC_RETRIEVAL_DEFAULTS,
  ENTRY_RETRIEVAL_DEFAULTS,
  LORE_MANAGEMENT_DEFAULTS,
  MAX_LOREBOOK_ENTRIES_FOR_SUGGESTIONS,
  WORLD_STATE_INJECTION_DEFAULTS,
} from '$lib/services/ai/core/defaults'
import { isReasoningOn } from '$lib/services/ai/core/reasoning'
import {
  migrateContextWindow,
  migrateEntryRetrieval,
  migrateImageGeneration,
  migrateReasoningEffort,
  migrateReasoningIn,
  migrateWorldStateBudget,
  migrateWorldStateInjection,
} from './settingsMigrations'
import { ui } from '$lib/stores/ui.svelte'
import { getTheme } from '../../themes/themes'
import { LLM_TIMEOUT_DEFAULT, LLM_TIMEOUT_MIN, LLM_TIMEOUT_MAX } from '$lib/constants/timeout'
import { SvelteSet, SvelteMap } from 'svelte/reactivity'
import { dedupeTextModels } from '$lib/utils/dedupeTextModels'
import type { ImageGenerationServiceSettings, TimelineFillSettings } from '$lib/services/ai'
import { debug } from './debug.svelte'
import { modelHealth } from './modelHealth.svelte'
import {
  isPingEligible,
  pingProfileModels,
  clearProfileHealth,
} from '$lib/services/modelHealthOrchestrator'

// Provider preset type (used by WelcomeScreen)
export type ProviderPreset = 'openrouter' | 'nanogpt' | 'openai-compatible'

// Default profile IDs for each provider
export const DEFAULT_OPENROUTER_PROFILE_ID = 'default-openrouter-profile'

function dedupeModelIds(models: string[]): string[] {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)))
}

function mergeProfileModels(fetchedModels: TextModel[], customModels: string[]): TextModel[] {
  return dedupeTextModels([...fetchedModels, ...dedupeModelIds(customModels).map((id) => ({ id }))])
}

function normalizeProfile(profile: APIProfile): APIProfile {
  return {
    ...profile,
    customModels: dedupeModelIds(profile.customModels ?? []),
    fetchedModels: dedupeTextModels(profile.fetchedModels ?? []),
    hiddenModels: dedupeModelIds(profile.hiddenModels ?? []),
    favoriteModels: dedupeModelIds(profile.favoriteModels ?? []),
  }
}

// ===== System Services Settings =====

// Advanced settings for customizing generation processes
interface ProcessSettings {
  profileId?: string | null
  presetId?: string
  model?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  reasoningEffort?: ReasoningEffort
  manualBody?: string
}

interface AdvancedWizardSettings {
  settingExpansion: ProcessSettings
  settingRefinement: ProcessSettings
  protagonistGeneration: ProcessSettings
  characterElaboration: ProcessSettings
  characterRefinement: ProcessSettings
  supportingCharacters: ProcessSettings
  openingGeneration: ProcessSettings
  openingRefinement: ProcessSettings
}

function getDefaultAdvancedWizardSettings(): AdvancedWizardSettings {
  return getDefaultAdvancedSettingsForProvider('openrouter')
}

export function getDefaultAdvancedSettingsForProvider(
  provider: ProviderType,
): AdvancedWizardSettings {
  const preset = getPresetDefaults(provider, 'wizard')

  return {
    settingExpansion: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    settingRefinement: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    protagonistGeneration: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    characterElaboration: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    characterRefinement: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    supportingCharacters: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    openingGeneration: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    openingRefinement: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
  }
}

export interface AdvancedRequestSettings {
  manualMode: boolean
}

export function getDefaultAdvancedRequestSettings(): AdvancedRequestSettings {
  return {
    manualMode: false,
  }
}

// Classifier service settings (World State Classifier - extracts entities from narrative)
/** The window the classifier reads, in whole story entries. Shared with the slider. */
export const CLASSIFIER_WINDOW_MIN = 2
export const CLASSIFIER_WINDOW_MAX = 15

export interface ClassifierSettings {
  presetId?: string
  profileId: string | null // API profile to use (null = use default profile)
  model: string
  temperature: number
  maxTokens: number
  reasoningEffort: ReasoningEffort
  manualBody: string
  recentEntriesWindow: number // Recent story entries sent whole as context, 2-15
}

export function getDefaultClassifierSettings(): ClassifierSettings {
  return getDefaultClassifierSettingsForProvider('openrouter')
}

/** A stored window outside the slider's range, back inside it. */
function clampClassifierWindow(loaded: ClassifierSettings): ClassifierSettings {
  // Checked before rounding: `Math.round(null)` is 0, which is finite and would clamp to the
  // slider's minimum instead of restoring the default.
  if (!Number.isFinite(loaded.recentEntriesWindow)) {
    return { ...loaded, recentEntriesWindow: getDefaultClassifierSettings().recentEntriesWindow }
  }
  const window = Math.round(loaded.recentEntriesWindow)
  return {
    ...loaded,
    recentEntriesWindow: Math.min(Math.max(window, CLASSIFIER_WINDOW_MIN), CLASSIFIER_WINDOW_MAX),
  }
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
    recentEntriesWindow: 7,
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
  recentEntriesCount: number
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
    triggerInterval: 6,
    recentEntriesCount: 32,
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
    maxIterations: LORE_MANAGEMENT_DEFAULTS.maxIterations,
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
  model: string
  temperature: number
  maxIterations: number
  reasoningEffort: ReasoningEffort
  manualBody: string
  /**
   * Give the retrieval agent the no-LLM grep_chapters tool, so it searches the story text
   * instead of paying a second model to read whole chapters.
   */
  grepEnabled: boolean
  /** Excerpts a single grep_chapters call may quote. Width is fixed; see the tool. */
  grepExcerptsPerSearch: number
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
    model: preset.model,
    temperature: 0.3,
    maxIterations: AGENTIC_RETRIEVAL_DEFAULTS.maxIterations,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
    // On by default: measured against the same two turns, grep cut the retrieval agent's
    // prompt cost by 31% and produced the more specific answer of the two.
    grepEnabled: true,
    grepExcerptsPerSearch: AGENTIC_RETRIEVAL_DEFAULTS.grepExcerptsPerSearch,
  }
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
    mode: 'agentic',
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
  /** Cap on Tier 2 (keyword matched) */
  maxTier2Entries: number
  /** Cap on Tier 3 (LLM selected) */
  maxTier3Entries: number
  /** Words of leftover that still go in whole, above which the LLM is asked instead */
  tier3WholesaleWordBudget: number
  maxWordsPerEntry: number // 0 = unlimited
  enableLLMSelection: boolean
  /** Whether the world state's Tier 1 + Tier 2 seed the second Tier 2 pass here */
  useSceneEntities: boolean
  /** Recent story entries scanned for Tier 2 name/keyword matching and included in the Tier 3 prompt */
  recentEntriesCount: number
  reasoningEffort: ReasoningEffort
  manualBody: string
}

/** The window Tier 2/Tier 3 retrieval scans, in whole story entries. Shared with the slider. */
export const ENTRY_RETRIEVAL_WINDOW_MIN = 2
export const ENTRY_RETRIEVAL_WINDOW_MAX = 15

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
    maxTier2Entries: ENTRY_RETRIEVAL_DEFAULTS.maxTier2Entries,
    maxTier3Entries: ENTRY_RETRIEVAL_DEFAULTS.maxTier3Entries,
    tier3WholesaleWordBudget: ENTRY_RETRIEVAL_DEFAULTS.tier3WholesaleWordBudget,
    maxWordsPerEntry: 0,
    enableLLMSelection: true,
    useSceneEntities: true,
    recentEntriesCount: 5,
    reasoningEffort: preset.reasoningEffort,
    manualBody: '',
  }
}

// World State Injection settings (Tier 3 LLM selection for live-tracked
// characters/locations/items/story beats -- distinct from Entry Retrieval, which
// selects Lorebook `Entry[]` records; see WorldStateInjector.ts for the full
// distinction). Model/temperature/profile are NOT stored here -- they come from
// the 'worldStateInjection' Agent Profile assignment, same as every other AI task.
export interface WorldStateInjectionSettings {
  /** Words of leftover that still go in whole, above which the LLM is asked instead */
  tier3WholesaleWordBudget: number
  /**
   * Cap on Tier 2 (name matched).
   *
   * Tier 1 -- the state-based entries and the sticky carry-over -- is deliberately NOT
   * capped: it is the baseline the narrator needs regardless of how much of it there is.
   */
  maxTier2Entries: number
  /** Cap on Tier 3, in the branch where the LLM had to choose */
  maxTier3Entries: number
  /** Enable LLM selection (Tier 3) for large entity counts */
  enableLLMSelection: boolean
  /** Recent story entries scanned for Tier 2 name matching and included in the Tier 3 prompt */
  recentEntriesCount: number
}

export function getDefaultWorldStateInjectionSettings(): WorldStateInjectionSettings {
  return {
    tier3WholesaleWordBudget: WORLD_STATE_INJECTION_DEFAULTS.tier3WholesaleWordBudget,
    maxTier2Entries: WORLD_STATE_INJECTION_DEFAULTS.maxTier2Entries,
    maxTier3Entries: WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries,
    enableLLMSelection: true,
    recentEntriesCount: 5,
  }
}

// Update settings
export function getDefaultUpdateSettings(): UpdateSettings {
  return {
    autoCheck: true,
    checkInterval: 24, // Check every 24 hours
    lastChecked: null,
  }
}

export function getDefaultImageGenerationSettings(): ImageGenerationServiceSettings {
  return {
    profileId: null, // User must select an image-capable profile
    styleId: 'image-style-soft-anime',
    portraitStyleId: 'image-style-soft-anime',
    // Same pixels as the `WIDTHxHEIGHT` defaults these replace: 1024x1024, 1024x1024,
    // 512x512, 1024x576 (was 1280x720, the nearest tier). See `$lib/utils/image`.
    size: { orientation: 'square', size: 'small' },
    referenceSize: { orientation: 'square', size: 'small' },
    portraitSize: { orientation: 'square', size: 'tiny' },
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
    backgroundSize: { orientation: 'landscape', size: 'small' },
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
  /**
   * Audio container asked of an OpenAI-compatible endpoint.
   *
   * MP3 by default, because it is the OpenAI default and roughly a fifth of the bytes.
   * A local runtime built without an MP3 encoder answers it with a 400 and serves WAV
   * instead — hence the choice rather than a constant. Other providers do not read this.
   */
  responseFormat: 'mp3' | 'wav'
  volume: number // TTS volume 0.0-1.0 (default: 1.0)
  volumeOverride: boolean // Enable volume override (default: false)
  providerVoices: Record<string, string> // Provider-specific voices
  /**
   * Speak quoted dialogue in a second voice. Not offered for the Google provider,
   * where a "voice" is a language code — a second one would read the dialogue in a
   * different language rather than a different voice.
   */
  dialogueVoiceEnabled: boolean
  dialogueVoice: string // Voice ID for quoted dialogue
  /** Per-provider memory for the dialogue voice, mirroring `providerVoices`. */
  providerDialogueVoices: Record<string, string>
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
    responseFormat: 'mp3',
    volume: 1.0,
    volumeOverride: false,
    providerVoices: { openai: 'alloy', google: 'en', microsoft: '' },
    dialogueVoiceEnabled: false,
    dialogueVoice: '',
    providerDialogueVoices: { openai: '', google: '', microsoft: '' },
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
    responseFormat: 'mp3',
    volume: 1.0,
    volumeOverride: false,
    providerVoices: { openai: 'alloy', google: 'en', microsoft: '' },
    dialogueVoiceEnabled: false,
    dialogueVoice: '',
    providerDialogueVoices: { openai: '', google: '', microsoft: '' },
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

export interface LoreManagementSpecificSettings {
  /**
   * Refuse to let the agent finish while a flagged duplicate group is unresolved.
   *
   * Off by default because it changes what a run costs: twenty near-duplicate names turn
   * one pass into several. Only the obligation is gated — the worklist and the refusal to
   * create an existing name cost nothing and are always on.
   */
  requireDuplicateResolution: boolean
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InteractiveVaultSpecificSettings {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TimelineFillSpecificSettings {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChapterQuerySpecificSettings {}

/**
 * How much recent story each service reads.
 *
 * Only what a slider actually drives. `recentEntriesForNarrative` and `userActionsForStyle`
 * were here with defaults and no reader at all; a stored key nothing consumes is a setting
 * that lies about being one.
 */
export interface ContextWindowSettings {
  /**
   * Entries the plot-suggestions service reads.
   *
   * Was `recentEntriesForRetrieval`, which named the one thing it does not drive: neither
   * Entry Retrieval nor Agentic Retrieval ever read it — they have their own
   * `recentEntriesCount` in `systemServicesSettings` — and `SuggestionsService` is its
   * only consumer. `migrateContextWindow` carries a tuned value across.
   */
  recentEntriesForSuggestions: number
  /** Entries the action-choices service reads. */
  recentEntriesForChoices: number
}

// Lorebook injection limits
export interface LorebookLimitsSettings {
  /** Max lorebook entries for suggestions */
  maxForSuggestions: number
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
  lorebookClassifier: LorebookClassifierSpecificSettings
  suggestions: SuggestionsSpecificSettings
  actionChoices: ActionChoicesSpecificSettings
  styleReviewer: StyleReviewerSpecificSettings
  loreManagement: LoreManagementSpecificSettings
  interactiveVault: InteractiveVaultSpecificSettings
  timelineFill: TimelineFillSpecificSettings
  chapterQuery: ChapterQuerySpecificSettings
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
    backgroundGeneration: false,
    generationNotifications: false,
    notificationPreview: false,
  }
}

export function getDefaultServiceSpecificSettings(): ServiceSpecificSettings {
  return {
    lorebookClassifier: getDefaultLorebookClassifierSpecificSettings(),
    suggestions: getDefaultSuggestionsSpecificSettings(),
    actionChoices: getDefaultActionChoicesSpecificSettings(),
    styleReviewer: getDefaultStyleReviewerSpecificSettings(),
    loreManagement: getDefaultLoreManagementSpecificSettings(),
    interactiveVault: getDefaultInteractiveVaultSpecificSettings(),
    timelineFill: getDefaultTimelineFillSpecificSettings(),
    chapterQuery: getDefaultChapterQuerySpecificSettings(),
    imageGeneration: getDefaultImageGenerationSpecificSettings(),
    tts: getDefaultTTSSpecificSettings(),
    characterCardImport: getDefaultCharacterCardImportSpecificSettings(),
    contextWindow: getDefaultContextWindowSettings(),
    lorebookLimits: getDefaultLorebookLimitsSettings(),
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
  return { requireDuplicateResolution: LORE_MANAGEMENT_DEFAULTS.requireDuplicateResolution }
}

export function getDefaultInteractiveVaultSpecificSettings(): InteractiveVaultSpecificSettings {
  return {}
}

export function getDefaultTimelineFillSpecificSettings(): TimelineFillSpecificSettings {
  return {}
}

export function getDefaultChapterQuerySpecificSettings(): ChapterQuerySpecificSettings {
  return {}
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
    recentEntriesForSuggestions: 5,
    recentEntriesForChoices: 5,
  }
}

export function getDefaultLorebookLimitsSettings(): LorebookLimitsSettings {
  return {
    maxForSuggestions: MAX_LOREBOOK_ENTRIES_FOR_SUGGESTIONS,
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
  worldStateInjection: WorldStateInjectionSettings
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
    worldStateInjection: getDefaultWorldStateInjectionSettings(),
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
    // No per-provider variant: unlike entryRetrieval, this has no model/temperature
    // fields of its own (see WorldStateInjectionSettings doc comment).
    worldStateInjection: getDefaultWorldStateInjectionSettings(),
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
    reasoningEffort: 'none' as const,
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

export const STORY_WIDTH_OPTIONS = [
  { key: '2xl' as const, label: 'Narrow', maxWidth: '42rem' },
  { key: '3xl' as const, label: 'Default', maxWidth: '48rem' },
  { key: '4xl' as const, label: 'Wide', maxWidth: '56rem' },
  { key: '5xl' as const, label: 'Wider', maxWidth: '64rem' },
  { key: '7xl' as const, label: 'Very wide', maxWidth: '80rem' },
  { key: '9xl' as const, label: 'Extra wide', maxWidth: '96rem' },
] as const

const VALID_STORY_WIDTH_KEYS: string[] = STORY_WIDTH_OPTIONS.map((o) => o.key)

export function getDefaultUISettings(): UISettings {
  return {
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
    autoScroll: true,
    showScrollToTop: false,
    showScrollToBottom: true,
    storyMaxWidth: '3xl',
    actionChoicesSidePanel: ACTION_CHOICES_PANEL_DEFAULTS.enabled,
    actionChoicesPanelWidth: ACTION_CHOICES_PANEL_DEFAULTS.width,
    highlightDialogue: false,
    dialogueColor: '',
  }
}

/**
 * Single source of truth for every AI service identity in the app.
 * `ServiceId` is derived from this object's keys, so `BaseAIService` and every
 * factory method that assigns a serviceId are checked against it at compile time --
 * a typo'd or orphaned serviceId (like the entryRetrieval/EntryInjector collision
 * this replaced) now fails `npm run check` instead of requiring a manual grep audit.
 */
export const DEFAULT_SERVICE_PRESET_ASSIGNMENTS = {
  classifier: 'classification',
  lorebookClassifier: 'classification',
  entryRetrieval: 'classification',
  worldStateInjection: 'classification',
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
} satisfies Record<string, string>

/** Every valid AI service identity, derived from DEFAULT_SERVICE_PRESET_ASSIGNMENTS's keys. */
export type ServiceId = keyof typeof DEFAULT_SERVICE_PRESET_ASSIGNMENTS

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
    reasoningEffort: 'none',
    manualBody: '',
    llmTimeoutMs: LLM_TIMEOUT_DEFAULT,
  })

  uiSettings = $state<UISettings>(getDefaultUISettings())

  advancedRequestSettings = $state<AdvancedRequestSettings>(getDefaultAdvancedRequestSettings())

  // Advanced wizard settings for scenario generation
  wizardSettings = $state<AdvancedWizardSettings>(getDefaultAdvancedWizardSettings())

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
    ...DEFAULT_SERVICE_PRESET_ASSIGNMENTS,
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
      reasoningEffort: 'none',
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
      reasoningEffort: 'none',
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
      reasoningEffort: 'none',
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

      // `enable_thinking` is a legacy boolean, kept only for installs old enough to have no
      // stored level. It is never the source of truth while `main_reasoning_effort` exists.
      const reasoningEffort = migrateReasoningEffort(
        await database.getSetting('main_reasoning_effort'),
      )
      if (reasoningEffort) {
        this.apiSettings.reasoningEffort = reasoningEffort
      } else if ((await database.getSetting('enable_thinking')) === 'true') {
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
          const parsed = JSON.parse(profilesJson) as (APIProfile & {
            reasoningModels?: string[]
          })[]
          // Ensure new fields have defaults for profiles saved before these fields existed
          this.apiSettings.profiles = parsed.map((p) => {
            // Migrate fetchedModels: old format was string[], new format is TextModel[]
            let fetchedModels: TextModel[] = []
            if (Array.isArray(p.fetchedModels) && p.fetchedModels.length > 0) {
              if (typeof p.fetchedModels[0] === 'string') {
                // Old format: string[] + optional reasoningModels string[]
                const reasoningSet = new Set(p.reasoningModels ?? [])
                fetchedModels = (p.fetchedModels as unknown as string[]).map((id) => ({
                  id,
                  reasoning: reasoningSet.has(id) || undefined,
                }))
              } else {
                fetchedModels = p.fetchedModels
              }
            }
            return normalizeProfile({
              ...p,
              customModels: Array.isArray(p.customModels) ? p.customModels : [],
              fetchedModels,
              hiddenModels: Array.isArray(p.hiddenModels) ? p.hiddenModels : [],
              favoriteModels: Array.isArray(p.favoriteModels) ? p.favoriteModels : [],
              providerType: p.providerType ?? 'openai-compatible',
            })
          })
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

      // Load provider preset (which provider's defaults to use)
      const providerPreset = await database.getSetting('provider_preset')
      if (providerPreset) {
        if (providerPreset in PROVIDERS) {
          this.providerPreset = providerPreset as ProviderType
        } else {
          // Legacy/unrecognized value (e.g. the old 'custom' preset, replaced by
          // 'openai-compatible' when the provider list was expanded to named providers).
          // Leaving providerPreset pointing at a key that isn't in PROVIDERS crashes every
          // reset-to-default flow deep inside PROVIDERS[provider].services.
          this.providerPreset = 'openai-compatible'
          await database.setSetting('provider_preset', 'openai-compatible')
        }
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
      if (fontSize) this.uiSettings.fontSize = fontSize as FontSizeOption
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

      const autoScroll = await database.getSetting('auto_scroll')
      if (autoScroll !== null) this.uiSettings.autoScroll = autoScroll === 'true'

      const showScrollToTop = await database.getSetting('show_scroll_to_top')
      if (showScrollToTop !== null) this.uiSettings.showScrollToTop = showScrollToTop === 'true'

      const showScrollToBottom = await database.getSetting('show_scroll_to_bottom')
      if (showScrollToBottom !== null)
        this.uiSettings.showScrollToBottom = showScrollToBottom === 'true'

      const storyMaxWidth = await database.getSetting('story_max_width')
      if (storyMaxWidth && VALID_STORY_WIDTH_KEYS.includes(storyMaxWidth))
        this.uiSettings.storyMaxWidth = storyMaxWidth as UISettings['storyMaxWidth']

      const actionChoicesSidePanel = await database.getSetting('action_choices_side_panel')
      if (actionChoicesSidePanel !== null)
        this.uiSettings.actionChoicesSidePanel = actionChoicesSidePanel === 'true'

      const actionChoicesPanelWidth = await database.getSetting('action_choices_panel_width')
      if (actionChoicesPanelWidth !== null)
        this.uiSettings.actionChoicesPanelWidth = normalizeActionChoicesPanelWidth(
          Number.parseFloat(actionChoicesPanelWidth),
        )

      const highlightDialogue = await database.getSetting('highlight_dialogue')
      if (highlightDialogue !== null)
        this.uiSettings.highlightDialogue = highlightDialogue === 'true'

      const dialogueColor = await database.getSetting('dialogue_color')
      if (dialogueColor !== null) this.uiSettings.dialogueColor = dialogueColor
      this.applyDialogueHighlight()

      const debugMode = await database.getSetting('debug_mode')
      if (debugMode !== null) debug.isActive = this.uiSettings.debugMode = debugMode === 'true'

      const sidebarWidth = await database.getSetting('sidebar_width')
      if (sidebarWidth) this.uiSettings.sidebarWidth = parseInt(sidebarWidth, 10)

      const sidebarOpen = await database.getSetting('sidebar_open')
      if (sidebarOpen !== null) ui.sidebarOpen = sidebarOpen === 'true'

      const manualMode = await database.getSetting('advanced_manual_mode')
      if (manualMode !== null) {
        this.advancedRequestSettings.manualMode = manualMode === 'true'
      }

      // Load wizard settings
      const wizardSettingsJson = await database.getSetting('wizard_settings')
      if (wizardSettingsJson) {
        try {
          const loaded = migrateReasoningIn(JSON.parse(wizardSettingsJson))
          // Merge with defaults to ensure all fields exist
          const defaults = getDefaultAdvancedWizardSettings()
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
          this.wizardSettings = getDefaultAdvancedWizardSettings()
        }
      }

      // Load Generation Presets
      const presetsJson = await database.getSetting('generation_presets')
      if (presetsJson) {
        try {
          const loadedPresets = migrateReasoningIn(JSON.parse(presetsJson))
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
          // worldStateInjection used to silently piggyback on entryRetrieval's profile
          // assignment. If the user has never seen worldStateInjection as its own task
          // (missing from their saved assignments) but did customize entryRetrieval's
          // profile, inherit that assignment instead of falling back to the map default.
          if (!('worldStateInjection' in loaded) && loaded.entryRetrieval) {
            this.servicePresetAssignments.worldStateInjection = loaded.entryRetrieval
          }
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
            lorebookClassifier: {
              ...getDefaultLorebookClassifierSpecificSettings(),
              ...loaded.lorebookClassifier,
            },
            suggestions: getDefaultSuggestionsSpecificSettings(),
            actionChoices: getDefaultActionChoicesSpecificSettings(),
            styleReviewer: getDefaultStyleReviewerSpecificSettings(),
            // Merged, not replaced: this block holds a real setting now, and rebuilding it
            // from defaults would drop the user's choice on every load.
            loreManagement: {
              ...getDefaultLoreManagementSpecificSettings(),
              ...loaded.loreManagement,
            },
            interactiveVault: getDefaultInteractiveVaultSpecificSettings(),
            timelineFill: getDefaultTimelineFillSpecificSettings(),
            chapterQuery: getDefaultChapterQuerySpecificSettings(),
            imageGeneration: {
              ...getDefaultImageGenerationSpecificSettings(),
              ...loaded.imageGeneration,
            },
            tts: { ...getDefaultTTSSpecificSettings(), ...loaded.tts },
            characterCardImport: getDefaultCharacterCardImportSpecificSettings(),
            contextWindow: migrateContextWindow({
              ...getDefaultContextWindowSettings(),
              ...loaded.contextWindow,
            }),
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
          const loaded = migrateReasoningIn(JSON.parse(systemServicesJson))
          const defaults = getDefaultSystemServicesSettingsForProvider(
            this.getDefaultProviderType(),
          )
          this.systemServicesSettings = {
            // `recentEntriesWindow` reaches `recentContent`, where a zero returns the empty
            // string rather than an error: the classifier would lose its history in silence.
            classifier: clampClassifierWindow({ ...defaults.classifier, ...loaded.classifier }),
            lorebookClassifier: { ...defaults.lorebookClassifier, ...loaded.lorebookClassifier },
            memory: { ...defaults.memory, ...loaded.memory },
            suggestions: { ...defaults.suggestions, ...loaded.suggestions },
            actionChoices: { ...defaults.actionChoices, ...loaded.actionChoices },
            styleReviewer: { ...defaults.styleReviewer, ...loaded.styleReviewer },
            loreManagement: { ...defaults.loreManagement, ...loaded.loreManagement },
            agenticRetrieval: { ...defaults.agenticRetrieval, ...loaded.agenticRetrieval },
            timelineFill: { ...defaults.timelineFill, ...loaded.timelineFill },
            chapterQuery: { ...defaults.chapterQuery, ...loaded.chapterQuery },
            entryRetrieval: migrateEntryRetrieval({
              ...defaults.entryRetrieval,
              ...loaded.entryRetrieval,
            }),
            worldStateInjection: migrateWorldStateBudget(
              migrateWorldStateInjection(loaded.worldStateInjection, {
                ...defaults.worldStateInjection,
                ...loaded.worldStateInjection,
              }),
            ),
            imageGeneration: migrateImageGeneration({
              ...defaults.imageGeneration,
              ...loaded.imageGeneration,
            }),
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

  /**
   * Clamped here rather than only in the form: this value is also the wait before an image
   * is called stuck, so a zero would offer the retry on every image the moment it queues.
   */
  async setLlmTimeout(timeoutMs: number) {
    // `Math.max(NaN, …)` is NaN, and it would reach both the live setting and the stored
    // string — where it survives as "NaN" until someone moves the slider.
    const requested = Number.isFinite(timeoutMs) ? timeoutMs : LLM_TIMEOUT_DEFAULT
    const clamped = Math.min(Math.max(requested, LLM_TIMEOUT_MIN), LLM_TIMEOUT_MAX)
    this.apiSettings.llmTimeoutMs = clamped
    await database.setSetting('llm_timeout_ms', clamped.toString())
  }

  /**
   * The only writer of the reasoning level, and of the legacy `enable_thinking` boolean that
   * shadows it. The flag is derived here rather than tracked: it is a persistence detail for
   * downgrades, not a second setting, and keeping it as one had eight call sites able to
   * disagree with the level they sat next to.
   */
  async setMainReasoningEffort(effort: ReasoningEffort) {
    this.apiSettings.reasoningEffort = effort
    await database.setSetting('main_reasoning_effort', effort)
    await database.setSetting('enable_thinking', isReasoningOn(effort).toString())
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
    const providerConfig = PROVIDERS[profile.providerType]
    const defaultHidden = providerConfig?.defaultHiddenModels ?? []

    const newProfile = normalizeProfile({
      ...profile,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      hiddenModels: [...new Set([...(profile.hiddenModels ?? []), ...defaultHidden])],
    })
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

    const oldProfile = this.apiSettings.profiles[index]
    const newProfile = normalizeProfile({
      ...oldProfile,
      ...updates,
    })

    // Clear the cache when anything that changes the effective endpoint or auth
    // credentials changes: rows are keyed by (providerType, baseUrl) so stale
    // entries would survive undetected otherwise. evictForeign only prunes
    // in-memory; this deletes the SQLite rows.
    const pingDisabled = oldProfile.pingEnabled && updates.pingEnabled === false
    const apiKeyChanged =
      updates.apiKey !== undefined && updates.apiKey !== oldProfile.apiKey && !!oldProfile.apiKey
    const providerChanged =
      updates.providerType !== undefined && updates.providerType !== oldProfile.providerType
    const baseUrlChanged = updates.baseUrl !== undefined && updates.baseUrl !== oldProfile.baseUrl
    if (pingDisabled || apiKeyChanged || providerChanged || baseUrlChanged) {
      await clearProfileHealth(oldProfile).catch((err) =>
        console.warn('[Settings] Failed to clear health cache:', err),
      )
    }

    this.apiSettings.profiles[index] = newProfile
    this.apiSettings.profiles = [...this.apiSettings.profiles]
    await this.saveProfiles()

    // If models were updated and ping is enabled, trigger a ping batch
    if (updates.fetchedModels && newProfile.pingEnabled && isPingEligible(newProfile)) {
      void pingProfileModels(newProfile).catch((err) =>
        console.warn('[Settings] Auto-ping failed:', err),
      )
    }
  }

  async deleteProfile(id: string) {
    const profile = this.getProfile(id)
    if (profile) {
      await clearProfileHealth(profile).catch((err) =>
        console.warn('[Settings] Failed to clear health cache on delete:', err),
      )
    }

    // Reset main narrative profile to default if the deleted profile is currently set as main narrative
    if (id === this.apiSettings.mainNarrativeProfileId) {
      await this.setMainNarrativeProfile(this.getDefaultProfileIdForProvider())
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

  getProfileModels(profileId: string | null): TextModel[] {
    if (!profileId) return []
    const profile = this.getProfile(profileId)
    if (!profile) return []
    return mergeProfileModels(profile.fetchedModels, profile.customModels)
  }

  getAvailableModels(profileId: string | null): TextModel[] {
    if (!profileId) return []
    const profile = this.getProfile(profileId)
    if (!profile) return []

    const hidden = profile.hiddenModels ?? []
    const favSet = profile.favoriteModels ?? []
    const profileModels = this.getProfileModels(profileId)
    const all = profileModels.filter((m) => !hidden.includes(m.id))
    const favorites = all.filter((m) => favSet.includes(m.id))
    const rest = all.filter((m) => !favSet.includes(m.id))
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
      const existingModels = new Set(
        this.getProfileModels(existingDefault.id).map((model) => model.id),
      )
      const missingModels = modelsInUse.filter((m) => !existingModels.has(m))
      if (missingModels.length > 0) {
        existingDefault.customModels = dedupeModelIds([
          ...existingDefault.customModels,
          ...missingModels,
        ])
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
        string | undefined
      const model = (imgSettings as unknown as Record<string, unknown>)[modelField] as
        string | undefined

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
  private applyFontSize(size: FontSizeOption) {
    document.documentElement.setAttribute('data-font-size', size)
  }

  async setFontSize(size: FontSizeOption) {
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
   * Apply font family to the DOM using CSS custom property.
   *
   * **This half is live; do not delete it as dead code.** There is no settings UI for the
   * custom font any more -- `FontSelector.svelte` was already imported by nothing and has
   * since been removed -- so `setFontFamily` below has no caller and the font cannot be
   * *changed*. The read path is a different matter: `loadSettings` still reads the persisted
   * `font_family` row on every startup and calls this, and `app.css` resolves
   * `font-family: var(--font-story-custom, var(--font-story))`. An install that set a font
   * while the picker existed still renders in it, and removing this would silently change
   * how the app looks for those users without a migration to go with it.
   *
   * So: the write path is orphaned, the read path is load-bearing. Restoring a picker means
   * wiring a caller to `setFontFamily`; nothing else here needs to change.
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

  async setAutoScroll(enabled: boolean) {
    this.uiSettings.autoScroll = enabled
    await database.setSetting('auto_scroll', enabled.toString())
  }

  async setShowScrollToTop(enabled: boolean) {
    this.uiSettings.showScrollToTop = enabled
    await database.setSetting('show_scroll_to_top', enabled.toString())
  }

  async setShowScrollToBottom(enabled: boolean) {
    this.uiSettings.showScrollToBottom = enabled
    await database.setSetting('show_scroll_to_bottom', enabled.toString())
  }

  async setStoryMaxWidth(width: UISettings['storyMaxWidth']) {
    this.uiSettings.storyMaxWidth = width
    await database.setSetting('story_max_width', width)
  }

  async setActionChoicesSidePanel(enabled: boolean) {
    this.uiSettings.actionChoicesSidePanel = enabled
    await database.setSetting('action_choices_side_panel', enabled.toString())
  }

  /** Update the live layout while dragging; persistence happens once when the control commits. */
  previewActionChoicesPanelWidth(width: number) {
    const normalizedWidth = normalizeActionChoicesPanelWidth(width)
    this.uiSettings.actionChoicesPanelWidth = normalizedWidth
  }

  async setActionChoicesPanelWidth(width: number) {
    this.previewActionChoicesPanelWidth(width)
    const normalizedWidth = this.uiSettings.actionChoicesPanelWidth
    await database.setSetting('action_choices_panel_width', normalizedWidth.toString())
  }

  /**
   * Publish the dialogue colour to CSS. The toggle and the colour live on the root
   * element, not in the rendered markup: the `<span class="dialogue-line">` wrappers
   * are always emitted, so flipping the toggle or dragging the colour picker repaints
   * without re-rendering a single story entry.
   */
  private applyDialogueHighlight() {
    const root = document.documentElement
    root.setAttribute('data-dialogue-highlight', this.uiSettings.highlightDialogue ? 'on' : 'off')

    // No stored colour means "use the theme accent", expressed as the CSS fallback of
    // an unset custom property rather than a hex chosen here for all 26 themes.
    if (this.uiSettings.dialogueColor) {
      root.style.setProperty('--dialogue-color', this.uiSettings.dialogueColor)
    } else {
      root.style.removeProperty('--dialogue-color')
    }
  }

  async setHighlightDialogue(enabled: boolean) {
    this.uiSettings.highlightDialogue = enabled
    await database.setSetting('highlight_dialogue', enabled.toString())
    this.applyDialogueHighlight()
  }

  /** Pass an empty string to fall back to the current theme's accent colour. */
  async setDialogueColor(color: string) {
    this.uiSettings.dialogueColor = color
    await database.setSetting('dialogue_color', color)
    this.applyDialogueHighlight()
  }

  async setSidebarWidth(width: number) {
    this.uiSettings.sidebarWidth = width
    await database.setSetting('sidebar_width', width.toString())
  }

  async setDebugMode(enabled: boolean) {
    debug.isActive = this.uiSettings.debugMode = enabled
    await database.setSetting('debug_mode', enabled.toString())
  }

  async setAdvancedManualMode(enabled: boolean) {
    this.advancedRequestSettings.manualMode = enabled
    await database.setSetting('advanced_manual_mode', enabled.toString())
  }

  // Wizard settings methods
  /** Persist main narrative API settings (temperature, max tokens, reasoning) to the database. */
  async saveApiSettings() {
    await Promise.allSettled([
      database.setSetting('temperature', this.apiSettings.temperature.toString()),
      database.setSetting('max_tokens', this.apiSettings.maxTokens.toString()),
      database.setSetting('main_reasoning_effort', this.apiSettings.reasoningEffort),
      database.setSetting(
        'enable_thinking',
        isReasoningOn(this.apiSettings.reasoningEffort).toString(),
      ),
      database.setSetting('default_model', this.apiSettings.defaultModel),
      database.setSetting('main_narrative_profile_id', this.apiSettings.mainNarrativeProfileId),
      database.setSetting('main_manual_body', this.apiSettings.manualBody),
    ])
  }

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

  async resetServicePresetAssignments() {
    this.servicePresetAssignments = { ...DEFAULT_SERVICE_PRESET_ASSIGNMENTS }
    await this.saveServicePresetAssignments()
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
    // The section's other control lives in the service-specific block, and a reset button
    // that leaves half the panel where it was is worse than none.
    this.serviceSpecificSettings.loreManagement = getDefaultLoreManagementSpecificSettings()
    await this.saveSystemServicesSettings()
    await this.saveServiceSpecificSettings()
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

  async resetWorldStateInjectionSettings() {
    this.systemServicesSettings.worldStateInjection = getDefaultWorldStateInjectionSettings()
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

  // Update settings methods
  async saveUpdateSettings() {
    await database.setSetting('update_settings', JSON.stringify(this.updateSettings))
  }

  async setAutoCheck(enabled: boolean) {
    this.updateSettings.autoCheck = enabled
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
    const defaultReasoningEffort = defaults.services?.narrative.reasoningEffort ?? 'none'

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
      llmTimeoutMs: LLM_TIMEOUT_DEFAULT,
    }

    // Reset UI settings
    this.uiSettings = getDefaultUISettings()

    // Reset font to default
    this.applyFontFamily('default', 'default')

    this.advancedRequestSettings = getDefaultAdvancedRequestSettings()

    // Reset wizard settings based on provider
    this.wizardSettings = getDefaultAdvancedSettingsForProvider(provider)

    // Reset system services settings based on provider
    this.systemServicesSettings = getDefaultSystemServicesSettingsForProvider(provider)

    // The half of Advanced Settings that is not a model choice — context window, lorebook
    // limits, duplicate resolution. "Reset ALL" left every one of them where it was.
    this.serviceSpecificSettings = getDefaultServiceSpecificSettings()

    // Reset update settings
    this.updateSettings = getDefaultUpdateSettings()
    await grammarService.clearCustomWords()

    // Save all to database
    await database.setSetting('default_model', this.apiSettings.defaultModel)
    await database.setSetting('temperature', this.apiSettings.temperature.toString())
    await database.setSetting('max_tokens', this.apiSettings.maxTokens.toString())
    await database.setSetting(
      'enable_thinking',
      isReasoningOn(this.apiSettings.reasoningEffort).toString(),
    )
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
    await database.setSetting('auto_scroll', this.uiSettings.autoScroll.toString())
    await database.setSetting('show_scroll_to_top', this.uiSettings.showScrollToTop.toString())
    await database.setSetting(
      'show_scroll_to_bottom',
      this.uiSettings.showScrollToBottom.toString(),
    )
    await database.setSetting('story_max_width', this.uiSettings.storyMaxWidth)
    await database.setSetting(
      'action_choices_side_panel',
      this.uiSettings.actionChoicesSidePanel.toString(),
    )
    await database.setSetting(
      'action_choices_panel_width',
      this.uiSettings.actionChoicesPanelWidth.toString(),
    )
    await database.setSetting('highlight_dialogue', this.uiSettings.highlightDialogue.toString())
    await database.setSetting('dialogue_color', this.uiSettings.dialogueColor)
    this.applyDialogueHighlight()
    await database.setSetting(
      'advanced_manual_mode',
      this.advancedRequestSettings.manualMode.toString(),
    )
    await this.saveWizardSettings()
    await this.saveSystemServicesSettings()
    await this.saveServiceSpecificSettings()
    await this.saveUpdateSettings()
    await this.resetGenerationPresets()
    await this.resetServicePresetAssignments()

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
    const defaultHidden = defaults.defaultHiddenModels ?? []

    const defaultProfile: APIProfile = {
      id: defaultProfileId,
      name: defaults.name,
      providerType: provider,
      baseUrl: defaultApiURL,
      apiKey: apiKey,
      customModels: [],
      fetchedModels: [],
      hiddenModels: defaultHidden,
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
    this.apiSettings.reasoningEffort = defaults.services?.narrative.reasoningEffort ?? 'none'
    this.apiSettings.manualBody = ''
    await database.setSetting('default_model', this.apiSettings.defaultModel)
    await database.setSetting('temperature', this.apiSettings.temperature.toString())
    await database.setSetting('max_tokens', this.apiSettings.maxTokens.toString())
    await database.setSetting('main_reasoning_effort', this.apiSettings.reasoningEffort)
    await database.setSetting('main_manual_body', this.apiSettings.manualBody)
    await database.setSetting(
      'enable_thinking',
      isReasoningOn(this.apiSettings.reasoningEffort).toString(),
    )

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
  getServicePresetId(serviceId: ServiceId): string {
    return this.servicePresetAssignments[serviceId]
  }

  /**
   * Update the preset ID assigned to a specific service.
   * @param serviceId - The service identifier (e.g., 'classifier', 'wizard:settingExpansion')
   * @param presetId - The preset ID to assign (e.g., 'classification', 'memory', 'wizard')
   */
  async setServicePresetId(serviceId: ServiceId, presetId: string) {
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

  /**
   * Reactive getter: returns true if generation is blocked due to config issues.
   * Declared as a getter so Svelte 5 memoizes it — the for...of loop over
   * generationPresets doesn't re-run on every render, only when $state changes.
   *
   * Covers:
   * - Any structurally invalid API profile (migration from old versions)
   * - Main Narrative: missing/deleted API profile, or no model selected
   * - Any Generation Preset: missing/deleted API profile, or no model selected
   */
  get hasGenerationConfigIssues(): boolean {
    // 1. Any structurally invalid API profile
    if (this.getInvalidProfiles().length > 0) return true

    // 2. Main Narrative: missing or deleted API profile
    if (!this.getProfile(this.apiSettings.mainNarrativeProfileId)) return true

    // 3. Main Narrative: no model
    if (!this.apiSettings.defaultModel) return true

    // 4. Each Generation Preset
    for (const preset of this.generationPresets) {
      if (!preset.profileId || !this.getProfile(preset.profileId)) return true
      if (!preset.model) return true
    }

    // 5. Main Narrative model is unreachable or auth-failed per health cache
    if (this.modelHealthBlockReason) return true

    return false
  }

  get modelHealthBlockReason(): 'down' | 'auth' | null {
    const mainProfile = this.getProfile(this.apiSettings.mainNarrativeProfileId)
    if (mainProfile && isPingEligible(mainProfile)) {
      const cached = modelHealth.getByProfile(mainProfile, this.apiSettings.defaultModel)
      if (cached?.status === 'down') return 'down'
      if (cached?.status === 'auth') return 'auth'
    }
    return null
  }
}

export const settings = new SettingsStore()
