import { story } from '$lib/stores/story/index.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { DEFAULT_SERVICE_PRESET_ASSIGNMENTS } from '$lib/stores/settings.svelte'
import { buildApiProfile, buildPresetConfig } from '$test/factories'
import type {
  Story,
  Character,
  Location,
  Item,
  StoryBeat,
  StoryEntry,
  Entry,
  Chapter,
} from '$lib/types'
import type { GenerationPreset } from '$lib/types'

export interface LoadTestStoryOptions {
  story: Story
  characters?: Character[]
  locations?: Location[]
  items?: Item[]
  storyBeats?: StoryBeat[]
  entries?: StoryEntry[]
  lorebookEntries?: Entry[]
  chapters?: Chapter[]
}

/**
 * Directly hydrate the real story store singleton with test data.
 * Bypasses the database entirely — assignments go straight to $state properties.
 */
export function loadTestStory(options: LoadTestStoryOptions): void {
  const {
    story: storyObj,
    characters = [],
    locations = [],
    items = [],
    storyBeats = [],
    entries = [],
    lorebookEntries = [],
    chapters = [],
  } = options

  story.currentStory = storyObj
  story.character.characters = characters
  story.location.locations = locations
  story.item.items = items
  story.storyBeat.storyBeats = storyBeats
  story.entry.entries = entries
  story.lorebook.lorebookEntries = lorebookEntries
  story.chapter.chapters = chapters
}

/**
 * Reset all story store state back to its initial empty values.
 */
export function clearTestStory(): void {
  story.currentStory = null
  story.character.characters = []
  story.location.locations = []
  story.item.items = []
  story.storyBeat.storyBeats = []
  story.entry.entries = []
  story.lorebook.lorebookEntries = []
  story.chapter.chapters = []
}

export interface LoadTestSettingsOptions {
  translationEnabled?: boolean
  disableSuggestions?: boolean
  disableActionPrefixes?: boolean
  generationPresets?: GenerationPreset[]
  servicePresetAssignments?: Record<string, string>
}

/**
 * Hydrate the settings store with a minimal test configuration.
 * Sets up a single test API profile, generation presets for each service,
 * and sensible defaults for E2E testing.
 */
export function loadTestSettings(overrides: LoadTestSettingsOptions = {}): void {
  const testProfile = buildApiProfile()

  // Set up API settings with test profile
  settings.apiSettings.profiles = [testProfile]
  settings.apiSettings.mainNarrativeProfileId = testProfile.id

  // Build one preset per standard service category
  const serviceIds = ['classification', 'memory', 'suggestions', 'agentic', 'wizard', 'translation']
  const presets =
    overrides.generationPresets ?? serviceIds.map((id) => buildPresetConfig({ id, name: id }))
  settings.generationPresets = presets

  // Map services to preset IDs (use defaults, allow override)
  settings.servicePresetAssignments = {
    ...DEFAULT_SERVICE_PRESET_ASSIGNMENTS,
    ...(overrides.servicePresetAssignments ?? {}),
  }

  // Disable translation by default (most tests don't need it)
  settings.translationSettings.enabled = overrides.translationEnabled ?? false

  // UI settings
  if (overrides.disableSuggestions !== undefined) {
    settings.uiSettings.disableSuggestions = overrides.disableSuggestions
  }
  if (overrides.disableActionPrefixes !== undefined) {
    settings.uiSettings.disableActionPrefixes = overrides.disableActionPrefixes
  }
}
