import * as z from 'zod'
import { visualDescriptorsSchema } from '$lib/services/ai/sdk/schemas'
import { EXCHANGE_FORMAT } from './types'

const metadata = z.record(z.string(), z.unknown()).default({})
const strings = z.array(z.string()).default([])
const nullableString = z.string().nullable().default(null)

const visualDescriptors = visualDescriptorsSchema.default({})

export const characterSchema = z.object({
  name: z.string().min(1),
  description: nullableString,
  traits: strings,
  visualDescriptors,
  portrait: nullableString,
  tags: strings,
  favorite: z.boolean().default(false),
  metadata,
})

export const lorebookEntrySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['character', 'location', 'item', 'faction', 'concept', 'event']),
  description: z.string().default(''),
  keywords: strings,
  aliases: strings,
  injectionMode: z.enum(['always', 'keyword', 'never']).default('keyword'),
  priority: z.number().default(100),
  hiddenInfo: z.string().nullable().optional(),
  loreManagementBlacklisted: z.boolean().optional(),
})

export const lorebookSchema = z.object({
  name: z.string().min(1),
  description: nullableString,
  tags: strings,
  favorite: z.boolean().default(false),
  metadata,
  entries: z.array(lorebookEntrySchema).default([]),
})

export const scenarioSchema = z.object({
  name: z.string().min(1),
  description: nullableString,
  settingSeed: z.string().default(''),
  npcs: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().default(''),
        description: z.string().default(''),
        relationship: z.string().default(''),
        traits: strings,
      }),
    )
    .default([]),
  primaryCharacterName: z.string().default(''),
  firstMessage: nullableString,
  alternateGreetings: strings,
  startingTime: z
    .object({
      years: z.number().int().min(0),
      days: z.number().int().min(0),
      hours: z.number().int().min(0),
      minutes: z.number().int().min(0),
    })
    .nullable()
    .default(null),
  tags: strings,
  favorite: z.boolean().default(false),
  metadata,
})

export const payloadSchemas = {
  character: characterSchema,
  lorebook: lorebookSchema,
  scenario: scenarioSchema,
} as const

/** The marker alone: enough to decide whether a file claims to be ours. */
export const envelopeSchema = z.object({
  format: z.literal(EXCHANGE_FORMAT),
  formatVersion: z.string(),
  entity: z.string(),
  exportedAt: z.number().optional(),
  data: z.unknown(),
})
