import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

import type { ModelProfile, ProviderInstance } from './app-settings-schema'
import { appSettings } from '../schema'
import type {
  Appearance,
  StorySettings,
  SuggestionCategory,
} from '../story-config/story-settings-types'

export const APP_SETTINGS_SINGLETON_ID = 'singleton'

export const APP_SETTINGS_DEFAULTS = {
  providers: [] as ProviderInstance[],
  profiles: [] as ModelProfile[],
  assignments: {} as Record<string, string>,
  defaultProviderId: null as string | null,
  embeddingModelId: null as string | null,
  embeddingProviderId: null as string | null,
  defaultStorySettings: {} as Partial<StorySettings>,
  defaultCalendarId: null as string | null,
  defaultSuggestionCategories: { adventure: [], creative: [] } as {
    adventure: SuggestionCategory[]
    creative: SuggestionCategory[]
  },
  appearance: {
    themeId: 'system',
    readerFontScale: 1,
    density: 'default',
  } as Appearance,
  uiLanguage: 'en',
  onboardingCompletedAt: null as number | null,
  diagnostics: { enabled: false, debug_level_enabled: false },
}

// onConflictDoNothing() on the id PK makes this safe to call repeatedly.
export async function ensureAppSettingsSingleton<
  T extends BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>,
>(db: T): Promise<void> {
  const now = Date.now()
  await db
    .insert(appSettings)
    .values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
}
