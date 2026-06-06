import { z } from 'zod'

const tierTupleSchema = z.record(z.string(), z.number())

const labeledPromptSchema = z.object({
  label: z.string(),
  promptBody: z.string(),
})

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
    mode: z.enum(['adventure', 'creative']),
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

const retrievalBudgetsSchema = z.object({
  entities: z.number(),
  lore: z.number(),
  happenings: z.number(),
  threads: z.number(),
  chapters: z.number(),
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

const modelsSchema = z.object({
  narrative: z.string().optional(),
  classifier: z.string().optional(),
  translation: z.string().optional(),
  suggestion: z.string().optional(),
  'lore-mgmt': z.string().optional(),
  retrieval: z.string().optional(),
})

export const storySettingsSchema = z.object({
  chapterTokenThreshold: z.number().default(24000),
  chapterAutoClose: z.boolean().default(true),
  fullChapterInBuffer: z.boolean().default(false),
  partialChapterBuffer: z.number().default(10),
  protectedBuffer: z.number().default(10),
  classifierCadence: z.number(),
  piggybackMode: z.enum(['on', 'off']),
  embeddingBackend: z.enum(['provider', 'local']),
  embedding_model_id: z.string(),
  embedding_swap_target: z.string().optional(),
  embedding_provider_id: z.string().optional(),
  retrievalBudgets: retrievalBudgetsSchema,
  effectiveDim: z.number().optional(),
  probe_mode_active: z.boolean().default(false),
  composerModesEnabled: z.boolean(),
  composerWrapPov: z.enum(['first', 'third']),
  suggestionsEnabled: z.boolean(),
  suggestionCount: z.number().min(1).max(6).default(3),
  suggestionCategories: z.array(suggestionCategorySchema),
  translation: translationSchema,
  models: modelsSchema,
  activePackId: z.string().nullable(),
  packVariables: z.record(z.string(), z.unknown()),
})

export type SuggestionCategory = z.infer<typeof suggestionCategorySchema>
export type StoryDefinition = z.infer<typeof storyDefinitionSchema>
export type StorySettings = z.infer<typeof storySettingsSchema>
export type TierTuple = z.infer<typeof tierTupleSchema>
