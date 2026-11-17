import { z } from 'zod'

import { VISUAL_CATEGORIES } from '../entities/entity-state-schema'

// architecture.md → Prompt sections: the ids a template's `section` tag may name, in the order the
// reader lists them. Text no section holds is `other`.
export const PROMPT_SECTION_IDS = [
  'instructions',
  'setup',
  'roster',
  'scene',
  'places',
  'entities',
  'lore',
  'happenings',
  'threads',
  'chapters',
  'history',
  'output',
] as const
export type PromptSectionId = (typeof PROMPT_SECTION_IDS)[number]

function optionalCounts<const K extends string>(ids: readonly K[]) {
  return z.object(
    Object.fromEntries(ids.map((id) => [id, z.number().optional()])) as Record<
      K,
      z.ZodOptional<z.ZodNumber>
    >,
  )
}

// A call's prompt by section, o200k estimates; a section that rendered nothing is absent.
const promptSectionsSchema = optionalCounts([...PROMPT_SECTION_IDS, 'other'])

// A call's counts as the provider reported them. The cache figures are absent when it sent none,
// never 0 for one it didn't send (data-model.md → Entry metadata shape).
const tokenCountsSchema = z.object({
  prompt: z.number(),
  completion: z.number(),
  reasoning: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
})

// `condition` as emitted, before the bound; a reused place's isn't written.
const createEmission = {
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  condition: z.string().optional(),
}
// A kept parent's id, 'top' for top-level, as emitted when dropped; absent when unplaced.
const locationEmission = { ...createEmission, parent: z.string().optional() }

// A create that made or reused a row carries that row's id; a dropped one has none.
const newLocationReportSchema = z.discriminatedUnion('outcome', [
  z.object({
    ...locationEmission,
    outcome: z.enum(['created', 'reused']),
    id: z.string(),
    // Literal true: its parent couldn't be used, so the place is unplaced.
    parentDropped: z.literal(true).optional(),
  }),
  z.object({ ...locationEmission, outcome: z.literal('dropped') }),
])

// An item is never reused, so it has no `reused` outcome.
const newItemReportSchema = z.discriminatedUnion('outcome', [
  z.object({ ...createEmission, outcome: z.literal('created'), id: z.string() }),
  z.object({ ...createEmission, outcome: z.literal('dropped') }),
])

export const entryMetadataSchema = z.object({
  tokens: tokenCountsSchema.optional(),
  // The narrative call's prompt by section, and the fallback classifier's call when it ran and
  // returned; authored, never inherited (data-model.md → Entry metadata shape).
  promptSections: promptSectionsSchema.optional(),
  classifierCall: z
    .object({ tokens: tokenCountsSchema.optional(), promptSections: promptSectionsSchema })
    .optional(),
  model: z.string().optional(),
  generationTimingMs: z.number().optional(),
  reasoning: z.string().optional(),
  // The story text ended early; authored, never inherited (data-model.md → Entry metadata shape).
  // `limit` is the number the cause names; an `unknown` cut's `maxOutput` is what the call sent.
  // `fromOverride`: the call's settings were the story's narrative override's; absent = the profile's.
  cutOff: z
    .discriminatedUnion('cause', [
      z.strictObject({
        cause: z.enum(['max-output', 'window']),
        outputTokens: z.number().optional(),
        limit: z.number(),
        fromOverride: z.literal(true).optional(),
      }),
      z.strictObject({
        cause: z.literal('unknown'),
        outputTokens: z.number().optional(),
        maxOutput: z.number().optional(),
        fromOverride: z.literal(true).optional(),
      }),
      z.strictObject({
        cause: z.enum(['interrupted', 'content-filter']),
        outputTokens: z.number().optional(),
      }),
    ])
    .optional(),
  // The happenings the ranker seated in this turn's prompt; authored, never inherited. The periodic
  // classifier lists them (docs/memory/classifier.md#what-the-classifier-reads).
  injectedHappenings: z.array(z.string()).optional(),
  // Feeds the NEXT turn's Q3 retrieval query (docs/memory/retrieval.md#q3-piggyback-summary).
  // Optional — absent on parse failure or restart is fine per docs/memory/piggyback.md.
  summary: z.string().optional(),
  // Feeds the NEXT turn's Q4 slot (docs/memory/retrieval.md#q4-classifier-emitted-queries).
  // `.max(3)` documents the cap; lib/piggyback and the fallback classifier schema both enforce it.
  retrievalQueries: z.array(z.string()).max(3).optional(),
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
      // As emitted. `rejected` is recorded, not re-derived: apply.ts refused it, its id not a place
      // or item the prompt showed with its state or its text blank, so World kept the old one.
      conditions: z
        .array(z.object({ id: z.string(), text: z.string(), rejected: z.literal(true).optional() }))
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
          // Each item put down, where it landed: null when the scene had no location. Optional,
          // as rows written before drops lack it.
          drops: z
            .array(
              z.object({ id: z.string(), from: z.string().optional(), at: z.string().nullable() }),
            )
            .optional(),
        })
        .optional(),
      // Each create as emitted, with what became of it; the fields above carry its resolved
      // id, never the handle, bar a rejected currentLocation (data-model.md → Entry metadata shape).
      newLocations: z.array(newLocationReportSchema).optional(),
      newItems: z.array(newItemReportSchema).optional(),
      failedFields: z.array(z.object({ field: z.string(), detail: z.string() })).optional(),
      // Rows the narrator was kept from that this turn's scene seats, by id: the reader says so.
      seatedDisabled: z.array(z.string()).optional(),
      // The fallback's entries discarded before apply (piggyback.md → A bad ref in the two writers).
      // Open strings, as failedFields: an unknown future value degrades, not a failed parse.
      droppedRefs: z
        .array(
          z.object({
            field: z.string(),
            ref: z.string().optional(),
            id: z.string().optional(),
            kind: z.string().optional(),
            reason: z.string(),
            detail: z.string(),
          }),
        )
        .optional(),
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
  // System-entry failure record (reader-composer.md → Error surface). kind / failure are open
  // strings so an unknown future kind degrades to generic copy, not a failed metadata parse.
  // submission survives a restart (reader-composer.md → Custody of the turn's text).
  systemFailure: z
    .object({
      kind: z.string(),
      failure: z.string().optional(),
      detail: z.string().optional(),
      // The agent target the error named (config-resolver, cut-off, window): the slot a fix follows.
      // Open, as `kind` is; absent on errors that name none and on entries written before it.
      target: z.string().optional(),
      submission: z.object({ content: z.string(), composerMode: z.string() }).optional(),
      // A turn's context-window failure only: the refused narrative prompt by section.
      promptSections: promptSectionsSchema.optional(),
      // A close-failure entry, as `pass`; a close has no held state.
      close: z.enum(['failed', 'resolved']).optional(),
      // A pass refused the Send: Retry runs the pass alone; 'held' has no Retry. 'resolved': a
      // committed Retry kept the entry only to hold a text the composer couldn't take back.
      pass: z.enum(['failed', 'held', 'resolved']).optional(),
    })
    .optional(),
})

export type EntryMetadata = z.infer<typeof entryMetadataSchema>
export type SystemFailureMeta = NonNullable<EntryMetadata['systemFailure']>
export type CutOffMark = NonNullable<EntryMetadata['cutOff']>
export type PromptSections = z.infer<typeof promptSectionsSchema>
export type TokenCounts = z.infer<typeof tokenCountsSchema>
