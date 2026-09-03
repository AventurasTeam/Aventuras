import { z } from 'zod'

import { VISUAL_CATEGORIES } from '../entities/entity-state-schema'

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
  // What THIS turn reported — authored, never inherited (docs/data-model.md → Entry
  // metadata shape). failedFields / raw survive a fallback's write, so the four report
  // states stay distinguishable.
  stateReport: z
    .object({
      layer: z.enum(['piggyback_tagged_block', 'per_turn_classifier']),
      sceneEntities: z.array(z.string()).optional(),
      // Never nullable: optional-over-nullable makes the null sentinel ambiguous
      // (data-model.md → Entry mutability & rollback), and the model cannot emit null.
      currentLocation: z.string().optional(),
      // As emitted, before apply.ts clamps it — the divergence is what the reader shows.
      worldTimeDelta: z.number().optional(),
      // Recorded, not re-derived: the reader lacks the previous worldTime to subtract,
      // and `< 0` catches only one of the three clamp causes.
      worldTimeDeltaApplied: z.number().optional(),
      // Literal true so absence is the only other state: a rejection is a fact apply.ts
      // knows, while `emitted !== current` also goes true on any later user edit.
      currentLocationRejected: z.literal(true).optional(),
      visualChanges: z
        .array(z.object({ id: z.string(), type: z.enum(VISUAL_CATEGORIES), text: z.string() }))
        .optional(),
      transfers: z
        .object({
          items: z.array(
            z.object({
              id: z.string(),
              slot: z.enum(['equipped_items', 'inventory']),
              to: z.string().optional(),
              from: z.string().optional(),
            }),
          ),
          stackables: z.array(
            z.object({
              key: z.string(),
              amount: z.number(),
              to: z.string().optional(),
              from: z.string().optional(),
            }),
          ),
        })
        .optional(),
      failedFields: z.array(z.object({ field: z.string(), detail: z.string() })).optional(),
      // Redundant on the happy path; the only inspectable remnant when a parse failed.
      raw: z.string().optional(),
    })
    .optional(),
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
