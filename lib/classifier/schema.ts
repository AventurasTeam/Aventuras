import { z } from 'zod'

// No .transform() anywhere in this schema: it is a wire contract, and
// z.toJSONSchema — which generateStructured calls to build the model's schema —
// throws "Transforms cannot be represented in JSON Schema" (verified). An
// out-of-range severity is a prompt-compliance slip, not a reason to fail a
// whole pass, so the clamp into [0, 1] lives at the consumer, in plan.ts.
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
        sourceTurn: z.string().optional(),
      }),
    )
    .default([]),
})

export type ClassifierExtraction = z.infer<typeof classifierExtractionSchema>
