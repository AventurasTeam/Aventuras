import { z } from 'zod'

import { suggestionRefSchema, VISUAL_CHANGE_TYPES } from '@/lib/piggyback'

import type { FinishReason, MockToolStep } from './respond/wire'
import { NARRATIVE_LANE, TOOL_LANE_PREFIX } from './routing'
import { findShapeByName } from './shapes'

// A create's description may be left out, as the app's parser reads a missing one as ''.
const createFields = {
  handle: z.string(),
  name: z.string(),
  description: z.string().optional(),
  condition: z.string().optional(),
}

// ParsedStateBlock as authored, or parsed back from a served reply (moves carry `seq`). Every field
// optional: the renderer omits what is absent, and an empty inner tag is a parse failure.
const stateBlockSchema = z.object({
  sceneEntities: z.array(z.string()).optional(),
  newLocations: z.array(z.object({ ...createFields, parent: z.string().optional() })).optional(),
  currentLocation: z.string().optional(),
  worldTimeDelta: z.number().optional(),
  visualChanges: z
    .array(z.object({ id: z.string(), type: z.enum(VISUAL_CHANGE_TYPES), text: z.string() }))
    .optional(),
  conditions: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  newItems: z.array(z.object(createFields)).optional(),
  transfers: z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          slot: z.enum(['equipped_items', 'inventory']),
          to: z.string().optional(),
          from: z.string().optional(),
          seq: z.number().optional(),
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
      drops: z
        .array(
          z.object({ id: z.string(), from: z.string().optional(), seq: z.number().optional() }),
        )
        .optional(),
    })
    .optional(),
  summary: z.string().optional(),
  retrievalQueries: z.array(z.string()).optional(),
})

export const narrativeValueSchema = z.object({
  prose: z.string(),
  state: stateBlockSchema.optional(),
  suggestions: z.array(suggestionRefSchema).optional(),
})

// Each FinishReason once, so one added to the wire fails typecheck here until it validates.
const FINISH_REASONS = {
  stop: 'stop',
  length: 'length',
  tool_calls: 'tool_calls',
  content_filter: 'content_filter',
} as const satisfies { [K in FinishReason]: K }

// Strict: the wire's own spelling (`tool_calls`, `arguments`) is refused, not dropped, since a step
// that lost its calls that way would end a task with no writes. A string `args` goes out verbatim,
// anything else as JSON, so `args` has to be JSON.
export const mockToolStepSchema: z.ZodType<MockToolStep> = z.strictObject({
  text: z.string().optional(),
  reasoning: z.string().optional(),
  toolCalls: z.array(z.strictObject({ name: z.string(), args: z.json() })).optional(),
  finishReason: z.enum(FINISH_REASONS).optional(),
})

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Validates an authored response against what its lane answers: a narrative value, a tool step, or
 * the registered shape's schema. A structured lane the registry does not name has no schema to
 * check against, so anything JSON-shaped is accepted — the point of the unknown-shape lane is
 * that it works before anyone updates the registry.
 */
export function validateLaneValue(laneKey: string, value: unknown): ValidationResult {
  const schema: z.ZodType | undefined =
    laneKey === NARRATIVE_LANE
      ? narrativeValueSchema
      : laneKey.startsWith(TOOL_LANE_PREFIX)
        ? mockToolStepSchema
        : findShapeByName(laneKey)?.schema
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
