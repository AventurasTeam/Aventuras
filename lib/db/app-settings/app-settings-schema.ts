import { z } from 'zod'

import {
  storySettingsPartialSchema,
  suggestionCategorySchema,
} from '../stories/story-config-schema'

export const appearanceSchema = z.object({
  // 'system' = seed from the OS scheme at boot; a concrete registry id is a
  // user pick and is never overridden by the OS.
  themeId: z.string().default('system'),
  readerFontScale: z.number().default(1),
  // DB-only until the M7.1 appearance tab exposes it (reader note 2026-07-19).
  showJumpToBottom: z.boolean().default(true),
  accentOverride: z.string().optional(),
  density: z.enum(['default', 'compact', 'regular', 'comfortable']).default('default'),
})

const providerCapabilitiesSchema = z.object({
  reasoning: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  matryoshkaSupported: z.boolean().optional(),
  matryoshkaDims: z.array(z.number()).optional(),
})

export const providerInstanceSchema = z.object({
  id: z.string(),
  type: z.enum([
    'anthropic',
    'openai',
    'google',
    'openrouter',
    'nanogpt',
    'nvidia-nim',
    'openai-compatible',
  ]),
  displayName: z.string(),
  apiKey: z.string(),
  endpoint: z.string().optional(),
  favoriteModelIds: z.array(z.string()),
  cachedModels: z
    .array(z.object({ id: z.string(), capabilities: providerCapabilitiesSchema.optional() }))
    .optional(),
  customModelIds: z.array(z.string()).optional(),
  cachedAt: z.number().optional(),
})

export const modelProfileSchema = z.object({
  id: z.string(),
  kind: z.enum(['narrative', 'agent']),
  name: z.string(),
  description: z.string().optional(),
  modelRef: z.object({ providerId: z.string(), modelId: z.string() }),
  temperature: z.number().min(0).max(2).optional(),
  maxOutput: z.number().optional(),
  thinking: z.number().optional(),
  timeout: z.number().optional(),
  structuredOutput: z.enum(['auto', 'force-on', 'force-off']).optional(),
  customJson: z.record(z.string(), z.unknown()).optional(),
})

export const appSettingsDiagnosticsSchema = z.object({
  enabled: z.boolean(),
  debug_level_enabled: z.boolean(),
})

const defaultSuggestionCategoriesSchema = z.object({
  adventure: z.array(suggestionCategorySchema),
  creative: z.array(suggestionCategorySchema),
})

// The config subset the in-memory app-settings mirror holds (drops id,
// diagnostics, createdAt, updatedAt — .strip() default discards unlisted keys).
export const appSettingsConfigSchema = z.object({
  providers: z.array(providerInstanceSchema),
  profiles: z.array(modelProfileSchema),
  assignments: z.record(z.string(), z.string()),
  defaultProviderId: z.string().nullable(),
  embeddingModelId: z.string().nullable().default(null),
  embeddingProviderId: z.string().nullable().default(null),
  defaultStorySettings: storySettingsPartialSchema.default({}),
  defaultCalendarId: z.string().nullable().default(null),
  defaultSuggestionCategories: defaultSuggestionCategoriesSchema.default({
    adventure: [],
    creative: [],
  }),
  // .default({}) skips inner field defaults; factory form runs them via parse({}) only when the key is absent.
  appearance: appearanceSchema.default(() => appearanceSchema.parse({})),
  uiLanguage: z.string().default('en'),
  onboardingCompletedAt: z.number().nullable().default(null),
})

export type Appearance = z.infer<typeof appearanceSchema>
export type ProviderInstance = z.infer<typeof providerInstanceSchema>
export type ModelProfile = z.infer<typeof modelProfileSchema>
export type AppSettingsDiagnostics = z.infer<typeof appSettingsDiagnosticsSchema>
export type AppSettingsConfig = z.infer<typeof appSettingsConfigSchema>
