import { z } from 'zod'

export const entryMetadataSchema = z.object({
  tokens: z
    .object({ prompt: z.number(), completion: z.number(), reasoning: z.number().optional() })
    .optional(),
  model: z.string().optional(),
  generationTimingMs: z.number().optional(),
  reasoning: z.string().optional(),
  // One-sentence enrichment for the NEXT turn's Q2 structural digest (docs/memory/retrieval.md#q2-structural-digest). Optional — absent on parse failure or restart is fine per docs/memory/piggyback.md.
  summary: z.string().optional(),
  sceneEntities: z.array(z.string()),
  currentLocationId: z.string().nullable(),
  worldTime: z.number().min(0),
  nextTurnSuggestions: z
    .object({
      items: z.array(z.object({ categoryId: z.string(), text: z.string() })),
      source: z.enum(['piggyback', 'classifier', 'refresh']),
      refreshGuidance: z.string().optional(),
    })
    .optional(),
  // System-entry failure record (reader-composer.md → Error surface): kind /
  // failure mirror PipelineError / ResolveFailureKind as open strings — an
  // unknown future pipeline kind must degrade to generic copy, not fail the
  // whole metadata parse. submission preserves the reversed user_action's text
  // so Retry survives an app restart.
  systemFailure: z
    .object({
      kind: z.string(),
      failure: z.string().optional(),
      detail: z.string().optional(),
      submission: z.object({ content: z.string(), composerMode: z.string() }).optional(),
    })
    .optional(),
})

export type EntryMetadata = z.infer<typeof entryMetadataSchema>
export type SystemFailureMeta = NonNullable<EntryMetadata['systemFailure']>
