import { BUNDLED_PACK_ID } from '@/lib/prompts'

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
  suggestionsEnabled: false,
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
// resolves to 'no-provider' for the rest of its life.
export function buildStorySettings(
  appDefault: Partial<StorySettings>,
  appEmbeddingModelId: string | null,
  appEmbeddingProviderId: string | null,
  effectiveDim?: number | null,
): StorySettings {
  return storySettingsSchema.parse({
    ...STORY_SETTINGS_DEFAULTS,
    ...appDefault,
    // Both halves override unconditionally: appDefault is a template for the
    // other fields, but the embedder selection has its own app-level columns,
    // and a stale copy in the template must not outrank them.
    embedding_model_id: appEmbeddingModelId ?? STORY_SETTINGS_DEFAULTS.embedding_model_id,
    embedding_provider_id: appEmbeddingProviderId ?? undefined,
    // Omit when null so the field stays absent (native dim), not stored as a
    // value the tightened positive-int schema would reject.
    ...(effectiveDim != null ? { effectiveDim } : {}),
  })
}
