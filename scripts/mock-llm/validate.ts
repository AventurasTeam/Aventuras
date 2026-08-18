import { z } from 'zod'

import { suggestionRefSchema, VISUAL_CHANGE_TYPES } from '@/lib/piggyback'

import { NARRATIVE_LANE } from './routing'
import { findShapeByName } from './shapes'

// ParsedStateBlock as authored in the UI. Every field optional: the renderer
// omits what is absent, and an inner tag with nothing in it is a parse failure
// for the app, not "nothing to report".
const stateBlockSchema = z.object({
  sceneEntities: z.array(z.string()).optional(),
  currentLocation: z.string().optional(),
  worldTimeDelta: z.number().optional(),
  visualChanges: z
    .array(z.object({ id: z.string(), type: z.enum(VISUAL_CHANGE_TYPES), text: z.string() }))
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
  summary: z.string().optional(),
})

export const narrativeValueSchema = z.object({
  prose: z.string(),
  state: stateBlockSchema.optional(),
  suggestions: z.array(suggestionRefSchema).optional(),
})

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Validates an authored response against the schema its lane actually answers.
 * A lane the registry does not name has no schema to check against, so anything
 * JSON-shaped is accepted — the point of the unknown-shape lane is that it
 * works before anyone updates the registry.
 */
export function validateLaneValue(laneKey: string, value: unknown): ValidationResult {
  const schema =
    laneKey === NARRATIVE_LANE ? narrativeValueSchema : findShapeByName(laneKey)?.schema
  if (schema === undefined) return { ok: true }

  const parsed = schema.safeParse(value)
  if (parsed.success) return { ok: true }
  return {
    ok: false,
    error: parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n'),
  }
}
