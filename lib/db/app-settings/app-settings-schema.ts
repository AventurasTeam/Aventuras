import { z } from 'zod'

// Source of truth for the app_settings JSON columns. z.infer feeds the drizzle
// column $type so the row type derives from these definitions (no duplication),
// and the parse runs at the DB->memory boundary (the $type cast is unchecked).
// Shapes per docs/data-model.md -> "Provider instances" / "Profiles".

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

// The config subset the in-memory app-settings mirror holds (drops id and the
// diagnostics column, which lib/diagnostics owns). Object .strip() default
// discards those columns when a full row is parsed.
export const appSettingsConfigSchema = z.object({
  providers: z.array(providerInstanceSchema),
  profiles: z.array(modelProfileSchema),
  assignments: z.record(z.string(), z.string()),
  defaultProviderId: z.string().nullable(),
})

export type ProviderInstance = z.infer<typeof providerInstanceSchema>
export type ModelProfile = z.infer<typeof modelProfileSchema>
export type AppSettingsDiagnostics = z.infer<typeof appSettingsDiagnosticsSchema>
export type AppSettingsConfig = z.infer<typeof appSettingsConfigSchema>
