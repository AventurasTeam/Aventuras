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
  embedding_model_id: 'bge-small-en',
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

export function buildStorySettings(
  appDefault: Partial<StorySettings>,
  appEmbeddingModelId: string | null,
): StorySettings {
  return storySettingsSchema.parse({
    ...STORY_SETTINGS_DEFAULTS,
    embedding_model_id: appEmbeddingModelId ?? STORY_SETTINGS_DEFAULTS.embedding_model_id,
    ...appDefault,
  })
}
