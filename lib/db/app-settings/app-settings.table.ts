import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type {
  Appearance,
  AppSettingsDiagnostics,
  ModelProfile,
  ProviderInstance,
} from './app-settings-schema'
import type { StorySettings, SuggestionCategory } from '../stories/story-config-schema'

export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  providers: text('providers', { mode: 'json' })
    .$type<ProviderInstance[]>()
    .notNull()
    .default(sql`'[]'`),
  profiles: text('profiles', { mode: 'json' })
    .$type<ModelProfile[]>()
    .notNull()
    .default(sql`'[]'`),
  assignments: text('assignments', { mode: 'json' })
    .$type<Record<string, string>>()
    .notNull()
    .default(sql`'{}'`),
  defaultProviderId: text('default_provider_id'),
  embeddingModelId: text('embedding_model_id'),
  embeddingProviderId: text('embedding_provider_id'),
  defaultStorySettings: text('default_story_settings', { mode: 'json' })
    .$type<Partial<StorySettings>>()
    .notNull()
    .default(sql`'{}'`),
  defaultCalendarId: text('default_calendar_id'),
  defaultSuggestionCategories: text('default_suggestion_categories', { mode: 'json' })
    .$type<{ adventure: SuggestionCategory[]; creative: SuggestionCategory[] }>()
    .notNull()
    .default(sql`'{"adventure":[],"creative":[]}'`),
  appearance: text('appearance', { mode: 'json' })
    .$type<Appearance>()
    .notNull()
    .default(sql`'{}'`),
  uiLanguage: text('ui_language'),
  onboardingCompletedAt: integer('onboarding_completed_at'),
  diagnostics: text('diagnostics', { mode: 'json' })
    .$type<AppSettingsDiagnostics>()
    .notNull()
    .default(sql`'{"enabled":false,"debug_level_enabled":false}'`),
  // Constant default (not unixepoch()) so `ALTER TABLE ... ADD ... NOT NULL`
  // stays valid on an already-seeded singleton — SQLite rejects a non-constant
  // default when adding a column to a populated table. The real timestamp comes
  // from the caller (ensureAppSettingsSingleton), as with every other table.
  createdAt: integer('created_at').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(0),
})
