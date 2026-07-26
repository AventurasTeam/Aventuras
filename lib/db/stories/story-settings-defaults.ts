import { BUNDLED_PACK_ID } from '@/lib/prompts'

import { DEFAULT_SUGGESTION_CATEGORIES } from './default-suggestion-categories'
import {
  storySettingsSchema,
  type StorySettings,
  type SuggestionCategory,
} from './story-config-schema'

export const STORY_SETTINGS_DEFAULTS: StorySettings = {
  chapterTokenThreshold: 24000,
  chapterAutoClose: true,
  fullChapterInBuffer: false,
  partialChapterBuffer: 10,
  protectedBuffer: 10,
  classifierCadence: 5,
  piggybackMode: 'off',
  embeddingBackend: 'local',
  embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
  retrievalBudgets: { entities: 8, lore: 6, happenings: 6, threads: 4, chapters: 3 },
  probe_mode_active: false,
  composerModesEnabled: false,
  composerWrapPov: 'third',
  // Paired with an empty palette, this combination alone allows zero enabled
  // categories with the toggle on — buildStorySettings below always overrides
  // suggestionCategories with a real per-mode seed before a story persists
  // these; don't spread this constant directly as a valid settings shape.
  suggestionsEnabled: true,
  suggestionCount: 3,
  suggestionCategories: [],
  translation: {
    enabled: false,
    targetLanguage: null,
    granularToggles: {
      narrative: false,
      entityNames: false,
      entityDescriptions: false,
      lore: false,
      threads: false,
      happenings: false,
      chapterMeta: false,
    },
  },
  models: {},
  activePackId: BUNDLED_PACK_ID,
  packVariables: {},
}

// A story copies the embedder selection and the per-mode suggestion palette at
// creation and never re-reads the app defaults, so all three must be captured
// here or a provider-backend story resolves to 'no-provider' / an empty
// palette for the rest of its life.
export function buildStorySettings(
  mode: 'adventure' | 'creative',
  app: {
    defaultStorySettings: Partial<StorySettings>
    embeddingModelId: string | null
    embeddingProviderId: string | null
    defaultSuggestionCategories: {
      adventure: readonly SuggestionCategory[]
      creative: readonly SuggestionCategory[]
    }
  },
): StorySettings {
  const appPalette = app.defaultSuggestionCategories[mode]
  return storySettingsSchema.parse({
    ...STORY_SETTINGS_DEFAULTS,
    ...app.defaultStorySettings,
    // An empty stored palette means "not configured" — a row written before the
    // per-mode seed landed, or one whose Zod default filled in empty arrays —
    // not "the user wants none".
    suggestionCategories: appPalette.length > 0 ? appPalette : DEFAULT_SUGGESTION_CATEGORIES[mode],
    // Both halves override unconditionally: defaultStorySettings is a template
    // for the other fields, but the embedder selection has its own app-level
    // columns, and a stale copy in the template must not outrank them.
    embedding_model_id: app.embeddingModelId ?? STORY_SETTINGS_DEFAULTS.embedding_model_id,
    embedding_provider_id: app.embeddingProviderId ?? undefined,
  })
}
