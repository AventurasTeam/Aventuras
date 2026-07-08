import { z } from 'zod'

const leapConditionSchema = z.object({
  every: z.number().int().positive(),
  offset: z.number().int().optional(),
  exclude: z.boolean().optional(),
})

const leapAugmentSchema = z.object({
  indexedBy: z.string(),
  atIndex: z.number().int(),
  conditions: z.array(leapConditionSchema),
})

const tierRolloverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), value: z.number().int().positive() }),
  z.object({
    kind: z.literal('table'),
    indexedBy: z.string(),
    values: z.array(z.number().int().positive()),
    leap: leapAugmentSchema.optional(),
  }),
  z.object({
    kind: z.literal('rule'),
    against: z.string(),
    base: z.number().int().positive(),
    conditions: z.array(leapConditionSchema),
  }),
])

const subdivisionSchema = z.object({
  name: z.string(),
  length: z.number().int().positive(),
  offset: z.number().int(),
  labels: z.array(z.string()),
  skipWhen: z.array(z.record(z.string(), z.number())).optional(),
})

const tierSchema = z.object({
  name: z.string(),
  startValue: z.number().int(),
  rollover: tierRolloverSchema,
  labels: z.array(z.string()).optional(),
  subdivisions: z.array(subdivisionSchema).optional(),
})

const eraDeclarationSchema = z.object({
  flipMode: z
    .enum(['display-label', 'elapsed-from-flip', 'calendar-aligned'])
    .default('display-label'),
  resetsOnFlip: z.array(z.string()),
  defaultStartName: z.string(),
  presetNames: z.array(z.string()).optional(),
})

const tierTupleSchema = z.record(z.string(), z.number())

export const calendarSystemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    baseUnitName: z.string(),
    secondsPerBaseUnit: z.number().int().positive(),
    tiers: z.array(tierSchema).min(1),
    exampleStartValue: tierTupleSchema,
    displayFormat: z.string(),
    eras: eraDeclarationSchema.nullable(),
  })
  // Origin conversion (worldTimeToTuple, preserveOriginOnSwap) reads
  // exampleStartValue[tier.name] for every tier; a missing key silently reads as
  // undefined and corrupts the base-unit math, so require full coverage at parse.
  .superRefine((cal, ctx) => {
    for (const tier of cal.tiers) {
      if (cal.exampleStartValue[tier.name] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['exampleStartValue', tier.name],
          message: `exampleStartValue is missing tier "${tier.name}"`,
        })
      }
    }
  })

export type LeapCondition = z.infer<typeof leapConditionSchema>
export type TierRollover = z.infer<typeof tierRolloverSchema>
export type Tier = z.infer<typeof tierSchema>
export type EraDeclaration = z.infer<typeof eraDeclarationSchema>
export type TierTuple = z.infer<typeof tierTupleSchema>
export type CalendarSystem = z.infer<typeof calendarSystemSchema>
