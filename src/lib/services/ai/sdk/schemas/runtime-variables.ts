/**
 * Runtime Variables Schema Factory
 *
 * Dynamically builds Zod schemas from RuntimeVariable definitions at runtime.
 * Used by the ClassifierService to extend the base classification schema with
 * custom variable extraction when a story's pack defines runtime variables.
 *
 * Key design decisions:
 * - Runtime vars are added as INLINE fields (not nested under `customVars`)
 * - Single-element enums use z.literal() directly (z.union crashes with <2 items)
 * - Number min/max are included in .describe() for LLM guidance; clamped post-extraction
 * - Every variable is .optional(), on new entities as much as on updates -- see
 *   buildEntityVarsShape for why a required one costs the whole classification
 * - The LLM sees variableName as the key, but stored values are keyed by defId
 */

import * as z from 'zod'
import type { RuntimeVariable, RuntimeEntityType } from '$lib/services/packs/types'
import {
  classificationResultSchema,
  characterUpdateSchema,
  newCharacterSchema,
  locationUpdateSchema,
  newLocationSchema,
  itemUpdateSchema,
  newItemSchema,
  storyBeatUpdateSchema,
  newStoryBeatSchema,
  sceneSchema,
  type ClassificationResult,
  type Scene,
} from './classifier'

// ============================================================================
// Variable Description Builder
// ============================================================================

/**
 * Build a description string for a runtime variable, including min/max range for numbers.
 * This becomes the `// comment` in the schema the LLM sees.
 */
function buildVariableDescription(def: RuntimeVariable): string {
  const desc = def.description || def.displayName

  if (def.variableType === 'number') {
    if (def.minValue !== undefined && def.maxValue !== undefined) {
      return `${desc} (range: ${def.minValue}-${def.maxValue})`
    } else if (def.minValue !== undefined) {
      return `${desc} (min: ${def.minValue})`
    } else if (def.maxValue !== undefined) {
      return `${desc} (max: ${def.maxValue})`
    }
  }

  return desc
}

// ============================================================================
// Single Variable Schema Builder
// ============================================================================

/**
 * Build the base (non-optional) Zod schema for a runtime variable.
 * Used internally; call buildVariableSchema() for the version with optionality.
 */
function buildVariableBaseSchema(def: RuntimeVariable): z.ZodType {
  const desc = buildVariableDescription(def)

  switch (def.variableType) {
    case 'text':
      return z.string().describe(desc)

    case 'number':
      return z.number().describe(desc)

    case 'enum': {
      const options = def.enumOptions ?? []
      if (options.length === 0) return z.string().describe(desc)
      if (options.length === 1) return z.literal(options[0].value).describe(desc)

      const literals = options.map((opt) => z.literal(opt.value)) as [
        z.ZodLiteral<string>,
        z.ZodLiteral<string>,
        ...z.ZodLiteral<string>[],
      ]
      return z.union(literals).describe(desc)
    }

    default:
      return z.string().describe(desc)
  }
}

// ============================================================================
// Entity Variable Shape Builder
// ============================================================================

/**
 * Build a Zod shape (Record of field schemas) for runtime variables of one entity type.
 * Returns null if no variables.
 *
 * **Every variable is optional, on new entities as much as on updates.** A variable
 * without a `defaultValue` used to be a required field on every new entity of its type,
 * which made one forgotten field cost the whole turn: validation is all-or-nothing, so
 * a missing `danger_level` on a new location threw away the characters, the items, the
 * story beats and the time progression alongside it. A missing value is recoverable —
 * `mergeRuntimeVars` fills the default at apply time, and the entity keeps whatever it
 * already had — so there is nothing here worth failing a classification over.
 */
export function buildEntityVarsShape(variables: RuntimeVariable[]): z.ZodRawShape | null {
  if (variables.length === 0) return null

  // Built as a mutable Record: Zod 4's ZodRawShape is Readonly and can't be
  // assembled by index assignment.
  const shape: Record<string, z.ZodType> = {}
  for (const def of variables) {
    shape[def.variableName] = buildVariableBaseSchema(def).optional()
  }

  return shape
}

// ============================================================================
// Extended Classification Schema Builder
// ============================================================================

/**
 * Map from RuntimeEntityType to the classifier schema field names.
 */
const ENTITY_TYPE_TO_SCHEMA_FIELDS: Record<RuntimeEntityType, { updates: string; new: string }> = {
  character: { updates: 'characterUpdates', new: 'newCharacters' },
  location: { updates: 'locationUpdates', new: 'newLocations' },
  item: { updates: 'itemUpdates', new: 'newItems' },
  story_beat: { updates: 'storyBeatUpdates', new: 'newStoryBeats' },
}

/**
 * Base update/new schemas per entity type -- used to extend with inline vars.
 */
const BASE_UPDATE_SCHEMAS: Record<RuntimeEntityType, z.ZodObject<z.ZodRawShape>> = {
  character: characterUpdateSchema as unknown as z.ZodObject<z.ZodRawShape>,
  location: locationUpdateSchema as unknown as z.ZodObject<z.ZodRawShape>,
  item: itemUpdateSchema as unknown as z.ZodObject<z.ZodRawShape>,
  story_beat: storyBeatUpdateSchema as unknown as z.ZodObject<z.ZodRawShape>,
}

const BASE_NEW_SCHEMAS: Record<RuntimeEntityType, z.ZodObject<z.ZodRawShape>> = {
  character: newCharacterSchema as unknown as z.ZodObject<z.ZodRawShape>,
  location: newLocationSchema as unknown as z.ZodObject<z.ZodRawShape>,
  item: newItemSchema as unknown as z.ZodObject<z.ZodRawShape>,
  story_beat: newStoryBeatSchema as unknown as z.ZodObject<z.ZodRawShape>,
}

const ENTITY_TYPES: RuntimeEntityType[] = ['character', 'location', 'item', 'story_beat']

/**
 * Build the per-array *element* schema for every `entryUpdates` field, with runtime
 * variable fields added INLINE (not nested under a `customVars` object):
 *
 * - Update schemas get var fields added directly inside their `changes` object
 * - New entity schemas get var fields added at the top level
 *
 * Elements rather than arrays, because both the strict schema sent to the provider and
 * the salvage pass below need to talk about one entity at a time — the salvage pass
 * exists precisely to keep the elements that validate when a sibling does not.
 */
function buildEntryUpdateElementSchemas(
  runtimeVarsByEntityType: Record<string, RuntimeVariable[]>,
): Record<string, z.ZodType> {
  const elements: Record<string, z.ZodType> = {}

  for (const entityType of ENTITY_TYPES) {
    const fields = ENTITY_TYPE_TO_SCHEMA_FIELDS[entityType]
    const vars = runtimeVarsByEntityType[entityType]
    const varsShape = vars ? buildEntityVarsShape(vars) : null
    const baseUpdate = BASE_UPDATE_SCHEMAS[entityType]
    const baseNew = BASE_NEW_SCHEMAS[entityType]

    if (!varsShape) {
      elements[fields.updates] = baseUpdate
      elements[fields.new] = baseNew
      continue
    }

    const originalChanges = (baseUpdate.shape as Record<string, z.ZodTypeAny>).changes
    elements[fields.updates] =
      originalChanges instanceof z.ZodObject
        ? baseUpdate.extend({ changes: originalChanges.extend(varsShape) })
        : baseUpdate
    elements[fields.new] = baseNew.extend(varsShape)
  }

  return elements
}

/**
 * Build an extended classification schema that includes runtime variable fields
 * INLINE on entity update/new schemas.
 *
 * If no runtime variables exist for any entity type, returns the base schema unchanged.
 */
export function buildExtendedClassificationSchema(
  runtimeVarsByEntityType: Record<string, RuntimeVariable[]>,
): z.ZodType {
  // Check if there are any runtime variables at all
  const entityTypes = Object.keys(runtimeVarsByEntityType) as RuntimeEntityType[]
  const typesWithVars = entityTypes.filter(
    (type) => runtimeVarsByEntityType[type] && runtimeVarsByEntityType[type].length > 0,
  )

  if (typesWithVars.length === 0) {
    return classificationResultSchema
  }

  const elements = buildEntryUpdateElementSchemas(runtimeVarsByEntityType)
  const entryUpdatesShape: Record<string, z.ZodTypeAny> = {}
  for (const [field, element] of Object.entries(elements)) {
    entryUpdatesShape[field] = z.array(element).default([])
  }

  return z.object({
    entryUpdates: z.object(entryUpdatesShape),
    scene: sceneSchema,
  })
}

// ============================================================================
// Salvage
// ============================================================================

/**
 * Rebuild a classification result from model output that failed whole-object validation,
 * keeping every element that validates on its own.
 *
 * Schema validation is all-or-nothing, and the classifier's schema is one object holding
 * eight arrays plus the scene: one malformed story beat used to cost the characters, the
 * locations, the items and the time progression too, silently. Nothing about those arrays
 * makes them interdependent, so there is no reason a bad element should take its siblings
 * with it.
 *
 * Returns null when the input yields nothing at all — an empty result and a failed one are
 * the same object, and only the caller can tell them apart, so it must not be handed the
 * empty one by mistake.
 */
export function salvageClassification(
  raw: unknown,
  runtimeVarsByEntityType: Record<string, RuntimeVariable[]>,
): ClassificationResult | null {
  if (typeof raw !== 'object' || raw === null) return null

  const root = raw as Record<string, unknown>
  const rawEntryUpdates =
    typeof root.entryUpdates === 'object' && root.entryUpdates !== null
      ? (root.entryUpdates as Record<string, unknown>)
      : {}

  const elements = buildEntryUpdateElementSchemas(runtimeVarsByEntityType)
  const entryUpdates: Record<string, unknown[]> = {}
  let salvagedCount = 0

  for (const [field, element] of Object.entries(elements)) {
    const value = rawEntryUpdates[field]
    const kept = Array.isArray(value)
      ? value.flatMap((item) => {
          const parsed = element.safeParse(item)
          return parsed.success ? [parsed.data] : []
        })
      : []
    salvagedCount += kept.length
    entryUpdates[field] = kept
  }

  // The scene is three independent claims, so it is salvaged field by field for the same
  // reason. A bad `timeProgression` must not cost the current location.
  const rawScene =
    typeof root.scene === 'object' && root.scene !== null
      ? (root.scene as Record<string, unknown>)
      : {}
  const scene = sceneSchema.safeParse(rawScene)
  const salvagedScene: Scene = scene.success
    ? scene.data
    : {
        currentLocationName:
          typeof rawScene.currentLocationName === 'string' ? rawScene.currentLocationName : null,
        presentCharacterNames: Array.isArray(rawScene.presentCharacterNames)
          ? rawScene.presentCharacterNames.filter((n): n is string => typeof n === 'string')
          : [],
        timeProgression: sceneSchema.shape.timeProgression.safeParse(rawScene.timeProgression)
          .success
          ? (rawScene.timeProgression as Scene['timeProgression'])
          : 'none',
      }

  const sceneIsEmpty =
    !salvagedScene.currentLocationName &&
    salvagedScene.presentCharacterNames.length === 0 &&
    salvagedScene.timeProgression === 'none'

  if (salvagedCount === 0 && sceneIsEmpty) return null

  return {
    entryUpdates: entryUpdates as unknown as ClassificationResult['entryUpdates'],
    scene: salvagedScene,
  }
}

/**
 * Extract inline runtime variable values from an LLM-generated object.
 * Filters the object's entries against known variable names from defsByName.
 */
export function extractInlineCustomVars(
  obj: Record<string, unknown>,
  defsByName: Map<string, RuntimeVariable>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (defsByName.has(key) && value !== undefined) {
      result[key] = value
    }
  }
  return result
}
