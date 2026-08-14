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
  // Token budgets, not row counts (data-model.md → stories.settings). An
  // entity block's macro wrapping alone costs 11 tokens before a word of the
  // row itself, so a count-shaped value here seats nothing.
  retrievalBudgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
  probe_mode_active: false,
  composerModesEnabled: false,
  composerWrapPov: 'third',
  // The toggle on beside an empty palette is deliberate, and this constant is
  // the ONLY source of suggestionsEnabled for a new story (app-level
  // defaultStorySettings carries just activePackId), so it cannot be flipped
  // off to make the pair coherent — buildStorySettings below supplies the real
  // per-mode palette instead. Spreading this in a fixture is fine and common,
  // but settingsAllowEmission reads BOTH halves: a test that means to exercise
  // emission has to set suggestionCategories, not just the flag, or it silently
  // asserts against a story that emits nothing.
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
// creation and never re-reads the app defaults, so every one of them must be
// captured here or a provider-backend story resolves to 'no-provider' / an
// empty palette for the rest of its life.
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
  // Not folded into `app`: the dim is resolved per story from the wizard's
  // Matryoshka pick, not copied off an app-level column like the two above.
  effectiveDim?: number | null,
): StorySettings {
  const appPalette = app.defaultSuggestionCategories[mode]
  return storySettingsSchema.parse({
    ...STORY_SETTINGS_DEFAULTS,
    ...app.defaultStorySettings,
    // An empty stored palette means "not configured", not "the user wants
    // none": the Zod default fills in empty arrays, so emptiness is exactly
    // what an unset palette looks like.
    suggestionCategories: appPalette.length > 0 ? appPalette : DEFAULT_SUGGESTION_CATEGORIES[mode],
    // Both halves override unconditionally: defaultStorySettings is a template
    // for the other fields, but the embedder selection has its own app-level
    // columns, and a stale copy in the template must not outrank them.
    embedding_model_id: app.embeddingModelId ?? STORY_SETTINGS_DEFAULTS.embedding_model_id,
    embedding_provider_id: app.embeddingProviderId ?? undefined,
    // Omit when null so the field stays absent (native dim), not stored as a
    // value the tightened positive-int schema would reject.
    ...(effectiveDim != null ? { effectiveDim } : {}),
  })
}
