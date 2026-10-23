import { z } from 'zod'

import { PLOT_ICON_KEYS } from '@/lib/plot'

// No .transform() anywhere: z.toJSONSchema (used by generateStructured) throws
// on transforms, so the severity clamp into [0, 1] lives in plan.ts.
const severity = z.number().default(0)

/** classifier.md → Mentioned places → Parent: a new place's `parent` for a top-level place. */
export const TOP_LEVEL_TOKEN = 'top-level'

// A free string so an off-catalog key still parses; the planner writes no icon for it.
const icon = z
  .string()
  .optional()
  .describe(`One of: ${PLOT_ICON_KEYS.join(', ')}. Omit when none fits.`)

const sourceTurn = z.string().optional()

const awareness = z.object({
  /** Character placeholder (c1, ...) or a newCharacters handle. */
  ref: z.string(),
  /** Free-form provenance descriptor used verbatim in prompts. */
  source: z.string(),
  severity,
  /** Turn that narrated the learning — may differ from the happening's. */
  learnedAtTurn: z.string().optional(),
})

const involvement = z.object({ ref: z.string(), role: z.string().optional() })

const happening = z.object({
  title: z.string(),
  description: z.string().optional(),
  /** Free-form anchor for out-of-narrative happenings; mutually exclusive with occurredAtTurn. */
  temporal: z.string().optional(),
  occurredAtTurn: z.string().optional(),
  category: z.string().optional(),
  icon,
  involvements: z.array(involvement).default([]),
  awareness: z.array(awareness).default([]),
  sourceTurn: z.string().optional(),
})

export const classifierExtractionSchema = z.object({
  happenings: z.array(happening).default([]),
  relationships: z
    .array(
      z.object({
        subject: z.string(),
        object: z.string(),
        /** Subject's view of object only — never the inferred inverse. */
        kind: z.string(),
        sourceTurn: z.string().optional(),
      }),
    )
    .default([]),
  statusFlips: z
    .array(
      z.object({
        ref: z.string(),
        to: z.enum(['active', 'retired']),
        reason: z.string().optional(),
        sourceTurn: z.string().optional(),
      }),
    )
    .default([]),
  newCharacters: z
    .array(
      z.object({
        /** Temporary handle the model picks; later refs in the same reply use it. */
        handle: z.string(),
        name: z.string(),
        description: z.string(),
        keywords: z
          .array(z.string())
          .default([])
          .describe(
            'Titles, epithets and relational references the prose used for this character alongside the name — "the Grey Wolf", "the innkeeper". Not the name itself.',
          ),
        sourceTurn: z.string().optional(),
        // classifier.md → What the classifier writes → First profiles; the planner clamps them.
        visual: z
          .object({
            physique: z.string().optional(),
            face: z.string().optional(),
            hair: z.string().optional(),
            eyes: z.string().optional(),
            attire: z.string().optional(),
            distinguishing: z.string().optional(),
          })
          .optional(),
        traits: z.array(z.string()).optional(),
        drives: z.array(z.string()).optional(),
        voice: z.string().optional(),
      }),
    )
    .default([]),
  newFactions: z
    .array(
      z.object({
        /** Temporary handle in the newCharacters namespace; later refs in the same reply use it. */
        handle: z.string(),
        name: z.string(),
        description: z.string(),
        keywords: z
          .array(z.string())
          .default([])
          .describe(
            'Other names, titles or epithets the prose used for this faction alongside its name. Not the name itself.',
          ),
        sourceTurn: z.string().optional(),
        standing: z.string().optional(),
        agenda: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  memberships: z
    .array(
      z.object({
        /** Character placeholder or a newCharacters handle. */
        character: z.string(),
        faction: z
          .string()
          .nullable()
          .describe(
            "ID of the faction from Known entities or a new faction's handle; null when they now belong to none.",
          ),
        sourceTurn: z.string().optional(),
      }),
    )
    .default([]),
  aliases: z
    .array(
      z.object({
        /** Placeholder of a listed entity, any kind. */
        ref: z.string(),
        terms: z
          .array(z.string())
          .default([])
          .describe(
            'Titles, epithets or name forms the prose used for this entity that its line does not show.',
          ),
        sourceTurn: z.string().optional(),
      }),
    )
    .default([]),
  // classifier.md → What the classifier writes: updates to listed rows. Each names its target by
  // placeholder; the planner drops one whose target the prompt didn't list.
  renames: z.array(z.object({ ref: z.string(), name: z.string(), sourceTurn })).default([]),
  placements: z
    .array(
      z.object({
        ref: z.string(),
        parent: z
          .string()
          .describe(
            `ID from Places of the place it is now part of, or "${TOP_LEVEL_TOKEN}" for an unplaced place nothing in Places could contain.`,
          ),
        sourceTurn,
      }),
    )
    .default([]),
  standings: z.array(z.object({ ref: z.string(), standing: z.string(), sourceTurn })).default([]),
  newThreads: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        category: z.string().optional(),
        icon,
        status: z
          .enum(['pending', 'active', 'resolved', 'failed'])
          .describe('Resolved or failed only for a thread the turns both open and close.'),
        sourceTurn,
        resolvedAtTurn: z
          .string()
          .optional()
          .describe(
            'The turn that resolved or failed it, when the turns both open and close it; sourceTurn stays the turn that opened it. Omit otherwise.',
          ),
      }),
    )
    .default([]),
  threadStatuses: z
    .array(
      z.object({
        thread: z.string(),
        status: z.enum(['active', 'resolved', 'failed']),
        sourceTurn,
      }),
    )
    .default([]),
  knownAwareness: z
    .array(
      z.object({
        happening: z.string(),
        /** Character placeholder or a newCharacters handle. */
        ref: z.string(),
        source: z.string(),
        severity,
        learnedAtTurn: z.string().optional(),
      }),
    )
    .default([]),
})

const newPlace = z.object({
  /** Temporary handle in the newCharacters namespace; later refs in the same reply use it. */
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  keywords: z
    .array(z.string())
    .default([])
    .describe(
      'Other names, titles or epithets the prose used for this place alongside its name. Not the name itself.',
    ),
  sourceTurn: z.string().optional(),
  condition: z.string().optional(),
  parent: z
    .string()
    .optional()
    .describe(
      `ID of the place it is part of, from Places, or another new place's handle; "${TOP_LEVEL_TOKEN}" only when nothing in Places could contain it. Omit it when something in Places could contain it and the turns don't say which, and when unsure.`,
    ),
})

/** classifier.md → Mentioned places: the reply's schema when the story's setting is on. */
export const classifierExtractionWithPlacesSchema = classifierExtractionSchema.extend({
  newPlaces: z.array(newPlace).default([]),
})

export type ClassifierExtraction = z.infer<typeof classifierExtractionSchema>
export type ClassifierPlacesExtraction = z.infer<typeof classifierExtractionWithPlacesSchema>
export type NewPlace = ClassifierPlacesExtraction['newPlaces'][number]
export type NewCharacter = ClassifierExtraction['newCharacters'][number]
export type NewFaction = ClassifierExtraction['newFactions'][number]
export type Membership = ClassifierExtraction['memberships'][number]
export type Rename = ClassifierExtraction['renames'][number]
export type Placement = ClassifierExtraction['placements'][number]
export type Standing = ClassifierExtraction['standings'][number]
/** A reply's new thread; `lib/db`'s `NewThread` is the insert row. */
export type NewThreadReply = ClassifierExtraction['newThreads'][number]
export type ThreadStatusChange = ClassifierExtraction['threadStatuses'][number]
export type KnownAwareness = ClassifierExtraction['knownAwareness'][number]
/** A reply under either schema: newPlaces only when the pass read the setting on. */
export type ClassifierReply = ClassifierExtraction | ClassifierPlacesExtraction

/** The pass reads the setting once, when it builds its prompt; that value picks the schema. */
export function classifierReplySchema(mentionedPlaces: boolean): z.ZodType<ClassifierReply> {
  return mentionedPlaces ? classifierExtractionWithPlacesSchema : classifierExtractionSchema
}

export function newPlacesOf(reply: ClassifierReply): readonly NewPlace[] {
  return 'newPlaces' in reply ? reply.newPlaces : []
}
