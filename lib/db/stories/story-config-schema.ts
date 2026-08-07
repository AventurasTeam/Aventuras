import { z } from 'zod'

import { STORY_AGENT_IDS, type StoryAgentId } from '../app-settings/agents'

const tierTupleSchema = z.record(z.string(), z.number())

const labeledPromptSchema = z.object({
  label: z.string(),
  promptBody: z.string(),
})

/** Inclusive bounds on `suggestionCount`. The stepper reads these, so the control
 *  and the schema cannot drift into a range the user can reach but not save. */
export const SUGGESTION_COUNT_MIN = 1
export const SUGGESTION_COUNT_MAX = 6

/** Backs both the schema enum and the predicate, so a mode added to one cannot
 *  go missing from the other. */
export const STORY_MODES = ['adventure', 'creative'] as const
export type StoryMode = (typeof STORY_MODES)[number]

/**
 * Rows reach the store as a `$type` cast over stored JSON rather than a parsed
 * value, so a `mode` read off one is only typed, not checked. Callers that index
 * by it need this first.
 */
export function isStoryMode(value: unknown): value is StoryMode {
  return typeof value === 'string' && (STORY_MODES as readonly string[]).includes(value)
}

export const suggestionCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  promptHint: z.string(),
  color: z.string(),
  enabled: z.boolean(),
  order: z.number(),
})

export const storyDefinitionSchema = z
  .object({
    mode: z.enum(STORY_MODES),
    leadEntityId: z.string().nullable(),
    narration: z.enum(['first', 'second', 'third']),
    genre: labeledPromptSchema,
    tone: labeledPromptSchema,
    setting: z.string(),
    calendarSystemId: z.string(),
    worldTimeOrigin: tierTupleSchema,
  })
  .superRefine((d, ctx) => {
    const needsLead = d.mode === 'adventure' || d.narration === 'first' || d.narration === 'second'
    if (needsLead && d.leadEntityId == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['leadEntityId'],
        message: 'first/second-person or adventure mode requires a lead entity',
      })
    }
  })

// Token counts, so bounded at the schema rather than downstream: migration 0007
// had to rewrite these once already because the stored numbers meant rows, and a
// negative or fractional budget makes rankPerType seat nothing while the trace
// blames the candidates. The M7 sliders write straight here.
const tokenBudget = z.number().int().nonnegative()

const retrievalBudgetsSchema = z.object({
  entities: tokenBudget,
  lore: tokenBudget,
  happenings: tokenBudget,
  threads: tokenBudget,
  chapters: tokenBudget,
})

const translationSchema = z.object({
  enabled: z.boolean(),
  targetLanguage: z.string().nullable(),
  granularToggles: z.object({
    narrative: z.boolean(),
    entityNames: z.boolean(),
    entityDescriptions: z.boolean(),
    lore: z.boolean(),
    threads: z.boolean(),
    happenings: z.boolean(),
    chapterMeta: z.boolean(),
  }),
})

const storyAgentModelShape = Object.fromEntries(
  STORY_AGENT_IDS.map((id) => [id, z.string().optional()]),
) as Record<StoryAgentId, z.ZodOptional<z.ZodString>>

const modelsSchema = z.object({
  narrative: z.string().optional(),
  ...storyAgentModelShape,
})

export const storySettingsSchema = z.object({
  chapterTokenThreshold: z.number().default(24000),
  chapterAutoClose: z.boolean().default(true),
  fullChapterInBuffer: z.boolean().default(false),
  partialChapterBuffer: z.number().int().nonnegative().default(10),
  protectedBuffer: z.number().int().nonnegative().default(10),
  classifierCadence: z.number(),
  piggybackMode: z.enum(['on', 'off']),
  embeddingBackend: z.enum(['provider', 'local']),
  embedding_model_id: z.string(),
  embedding_swap_target: z.string().optional(),
  // Only written when the in-flight swap crosses backends; absent means the
  // target shares the story's current backend, which is what a marker written
  // before cross-backend swaps existed also means.
  embedding_swap_backend: z.enum(['provider', 'local']).optional(),
  embedding_swap_provider_id: z.string().optional(),
  embedding_swap_source_dim: z.number().int().positive().optional(),
  embedding_swap_target_dim: z.number().int().positive().optional(),
  embedding_provider_id: z.string().optional(),
  retrievalBudgets: retrievalBudgetsSchema,
  effectiveDim: z.number().int().positive().optional(),
  probe_mode_active: z.boolean().default(false),
  composerModesEnabled: z.boolean(),
  composerWrapPov: z.enum(['first', 'third']),
  suggestionsEnabled: z.boolean(),
  suggestionCount: z.number().min(SUGGESTION_COUNT_MIN).max(SUGGESTION_COUNT_MAX).default(3),
  suggestionCategories: z.array(suggestionCategorySchema),
  translation: translationSchema,
  models: modelsSchema,
  activePackId: z.string().nullable(),
  packVariables: z.record(z.string(), z.unknown()),
})

// Zod's .partial() still fires inner .default()s, which would expand a stored
// partial to a full object and silently freeze today's defaults as if
// user-chosen. Deriving the partial variant with the defaults unwrapped keeps
// "absent key = track the current code default" intact for
// app_settings.default_story_settings; the mechanical map can't carry per-key
// types, hence the cast.
export const storySettingsPartialSchema = z
  .object(
    Object.fromEntries(
      Object.entries(storySettingsSchema.shape).map(([key, field]) => [
        key,
        field instanceof z.ZodDefault ? field.removeDefault() : field,
      ]),
    ),
  )
  .partial() as unknown as z.ZodType<Partial<z.infer<typeof storySettingsSchema>>>

export type SuggestionCategory = z.infer<typeof suggestionCategorySchema>
export type StoryDefinition = z.infer<typeof storyDefinitionSchema>
export type StorySettings = z.infer<typeof storySettingsSchema>
export type TierTuple = z.infer<typeof tierTupleSchema>
