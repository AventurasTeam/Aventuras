import { z } from 'zod'

// No .transform() anywhere: z.toJSONSchema (used by generateStructured) throws
// on transforms, so the severity clamp into [0, 1] lives in plan.ts.
const severity = z.number().default(0)

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
  parent: z
    .string()
    .optional()
    .describe(
      "ID of the place it is part of, from Places, or another new place's handle. Omit when the turns don't say.",
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
/** A reply under either schema: newPlaces only when the pass read the setting on. */
export type ClassifierReply = ClassifierExtraction | ClassifierPlacesExtraction

/** The pass reads the setting once, when it builds its prompt; that value picks the schema. */
export function classifierReplySchema(mentionedPlaces: boolean): z.ZodType<ClassifierReply> {
  return mentionedPlaces ? classifierExtractionWithPlacesSchema : classifierExtractionSchema
}

export function newPlacesOf(reply: ClassifierReply): readonly NewPlace[] {
  return 'newPlaces' in reply ? reply.newPlaces : []
}
