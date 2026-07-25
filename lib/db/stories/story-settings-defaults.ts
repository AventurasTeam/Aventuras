import { BUNDLED_PACK_ID } from '@/lib/prompts'

import { DEFAULT_SUGGESTION_CATEGORIES } from './default-suggestion-categories'
import { storySettingsSchema, type StorySettings } from './story-config-schema'

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

// A story copies the embedder selection at creation and never re-reads the app
// default, so both halves must be captured here or a provider-backend story
// resolves to 'no-provider' for the rest of its life. `mode` drives the
// suggestion palette, which is per-mode and therefore can't live in the
// Partial<StorySettings> template.
export function buildStorySettings(
  mode: 'adventure' | 'creative',
  appDefault: Partial<StorySettings>,
  appEmbeddingModelId: string | null,
  appEmbeddingProviderId: string | null,
): StorySettings {
  const appCategories = appDefault.suggestionCategories
  return storySettingsSchema.parse({
    ...STORY_SETTINGS_DEFAULTS,
    ...appDefault,
    // An empty app-level palette means "not configured", not "the user wants
    // none" — App Settings ships it empty until its editor lands.
    suggestionCategories:
      appCategories != null && appCategories.length > 0
        ? appCategories
        : DEFAULT_SUGGESTION_CATEGORIES[mode],
    // Both halves override unconditionally: appDefault is a template for the
    // other fields, but the embedder selection has its own app-level columns,
    // and a stale copy in the template must not outrank them.
    embedding_model_id: appEmbeddingModelId ?? STORY_SETTINGS_DEFAULTS.embedding_model_id,
    embedding_provider_id: appEmbeddingProviderId ?? undefined,
  })
}
