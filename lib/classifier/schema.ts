import { z } from 'zod'

import { PLOT_ICON_KEYS } from '@/lib/plot'

// No .transform() on a parsed value: z.toJSONSchema (used by generateStructured) throws on one,
// so the severity clamp into [0, 1] lives in plan.ts. A z.preprocess only reads the reply leniently:
// the model is shown the schema it feeds.
const severity = z.number().default(0)

/** classifier.md → Mentioned places → Parent: a new place's `parent` for a top-level place. */
export const TOP_LEVEL_TOKEN = 'top-level'

// classifier.md → Failure policy: a failed parse fails the pass, and the Send behind it, so an
// optional profile or plot field the model sends as null or the wrong type reads as absent.
const tolerated = <T>(field: z.ZodType<T>) => field.optional().catch(undefined)

// A free string so an off-catalog key still parses; the planner writes no icon for it.
const icon = tolerated(z.string()).describe(
  `One of: ${PLOT_ICON_KEYS.join(', ')}. Omit when none fits.`,
)

const sourceTurn = z.string().optional()

const withoutNulls = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null))
    : value

// classifier.md → Failure policy: an entry that doesn't fit reads as a hole, a null field as
// absent first, so one bad entry drops alone; readClassifierReply removes and counts the holes.
// A null list reads as an empty one.
const tolerantList = <T extends z.ZodType>(entry: T) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    z.array(z.preprocess(withoutNulls, entry).optional().catch(undefined)).default([]),
  )

// A tolerant list's enum value is read trimmed and case-folded, so "Resolved" lands as resolved.
const foldedEnum = <T extends z.ZodEnum>(values: T) =>
  z.preprocess((value) => (typeof value === 'string' ? value.trim().toLowerCase() : value), values)

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
  category: tolerated(z.string()),
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
        visual: tolerated(
          z.object({
            physique: tolerated(z.string()),
            face: tolerated(z.string()),
            hair: tolerated(z.string()),
            eyes: tolerated(z.string()),
            attire: tolerated(z.string()),
            distinguishing: tolerated(z.string()),
          }),
        ),
        traits: tolerated(z.array(z.string())),
        drives: tolerated(z.array(z.string())),
        voice: tolerated(z.string()),
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
        standing: tolerated(z.string()),
        agenda: tolerated(z.array(z.string())),
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
  // classifier.md → What the classifier writes: the planner drops an update on an unlisted target.
  renames: tolerantList(z.object({ ref: z.string(), name: z.string(), sourceTurn })),
  placements: tolerantList(
    z.object({
      ref: z.string(),
      parent: z
        .string()
        .describe(
          `ID from Places of the place it is now part of, or "${TOP_LEVEL_TOKEN}" for an unplaced place nothing in Places could contain.`,
        ),
      sourceTurn,
    }),
  ),
  standings: tolerantList(z.object({ ref: z.string(), standing: z.string(), sourceTurn })),
  newThreads: tolerantList(
    z.object({
      title: z.string(),
      description: z.string(),
      category: tolerated(z.string()),
      icon,
      status: foldedEnum(
        z
          .enum(['pending', 'active', 'resolved', 'failed'])
          .describe('Resolved or failed only for a thread the turns both open and close.'),
      ),
      sourceTurn,
      resolvedAtTurn: tolerated(z.string()).describe(
        'The turn that resolved or failed it, when the turns both open and close it; sourceTurn stays the turn that opened it. Omit otherwise.',
      ),
    }),
  ),
  threadStatuses: tolerantList(
    z.object({
      thread: z.string(),
      status: foldedEnum(z.enum(['active', 'resolved', 'failed'])),
      sourceTurn,
    }),
  ),
  knownAwareness: tolerantList(
    z.object({
      happening: z.string(),
      /** Character placeholder or a newCharacters handle. */
      ref: z.string(),
      source: z.string(),
      severity,
      learnedAtTurn: z.string().optional(),
    }),
  ),
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
  condition: tolerated(z.string()),
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

/** A reply as the schema reads it: a tolerant list holds a hole where an entry didn't fit. */
type ParsedExtraction = z.infer<typeof classifierExtractionSchema>
type ParsedPlacesExtraction = z.infer<typeof classifierExtractionWithPlacesSchema>
export type ParsedClassifierReply = ParsedExtraction | ParsedPlacesExtraction
type WellFormed<T> = {
  [K in keyof T]: T[K] extends readonly (infer E)[] ? Exclude<E, undefined>[] : T[K]
}
export type ClassifierExtraction = WellFormed<ParsedExtraction>
export type ClassifierPlacesExtraction = WellFormed<ParsedPlacesExtraction>
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
export function classifierReplySchema(mentionedPlaces: boolean): z.ZodType<ParsedClassifierReply> {
  return mentionedPlaces ? classifierExtractionWithPlacesSchema : classifierExtractionSchema
}

/** The lists whose malformed entry drops alone (tolerantList). */
export type TolerantList =
  | 'renames'
  | 'placements'
  | 'standings'
  | 'newThreads'
  | 'threadStatuses'
  | 'knownAwareness'

/** How many entries of a tolerant list didn't fit. */
export type MalformedEntries = { list: TolerantList; count: number }

/** A parsed reply without its holes, and each tolerant list's count of them. */
export function readClassifierReply(parsed: ParsedClassifierReply): {
  reply: ClassifierReply
  malformed: MalformedEntries[]
} {
  const malformed: MalformedEntries[] = []
  const present = <T>(list: TolerantList, entries: readonly (T | undefined)[]): T[] => {
    const kept = entries.filter((entry) => entry !== undefined)
    if (kept.length < entries.length) malformed.push({ list, count: entries.length - kept.length })
    return kept
  }
  const reply = {
    ...parsed,
    renames: present('renames', parsed.renames),
    placements: present('placements', parsed.placements),
    standings: present('standings', parsed.standings),
    newThreads: present('newThreads', parsed.newThreads),
    threadStatuses: present('threadStatuses', parsed.threadStatuses),
    knownAwareness: present('knownAwareness', parsed.knownAwareness),
  }
  return { reply, malformed }
}

export function newPlacesOf(reply: ClassifierReply): readonly NewPlace[] {
  return 'newPlaces' in reply ? reply.newPlaces : []
}
