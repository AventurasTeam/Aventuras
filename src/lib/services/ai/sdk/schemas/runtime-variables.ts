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
 * - Variables with defaultValue are marked .optional() in the schema
 * - The LLM sees variableName as the key, but stored values are keyed by defId
 */

import { z } from 'zod'
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
function buildVariableBaseSchema(def: RuntimeVariable): z.ZodTypeAny {
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

/**
 * Build a Zod schema for a single runtime variable definition.
 * Variables with a defaultValue are marked .optional().
 */
export function buildVariableSchema(def: RuntimeVariable): z.ZodTypeAny {
  const base = buildVariableBaseSchema(def)
  const hasDefault = def.defaultValue !== undefined && def.defaultValue !== null
  return hasDefault ? base.optional() : base
}

// ============================================================================
// Entity Variable Shape Builder
// ============================================================================

/**
 * Build a Zod shape (Record of field schemas) for runtime variables of one entity type.
 * Returns null if no variables.
 *
 * @param allOptional - true for update schemas (only include changed fields),
 *                      false for new entity schemas (required fields stay required)
 */
export function buildEntityVarsShape(
  variables: RuntimeVariable[],
  allOptional: boolean,
): z.ZodRawShape | null {
  if (variables.length === 0) return null

  const shape: z.ZodRawShape = {}
  for (const def of variables) {
    // For updates: all vars optional (only send what changed)
    // For new entities: respect defaultValue-based optionality
    shape[def.variableName] = allOptional
      ? buildVariableBaseSchema(def).optional()
      : buildVariableSchema(def)
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

/**
 * Build an extended classification schema that includes runtime variable fields
 * INLINE on entity update/new schemas (not nested under a `customVars` object).
 *
 * For each entity type with runtime variables:
 * - Update schemas get var fields added directly inside their `changes` object (all optional)
 * - New entity schemas get var fields added at the top level (with default-based optionality)
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

  // Build extended sub-schemas for each entity type with variables
  const entryUpdatesShape: Record<string, z.ZodTypeAny> = {}

  for (const entityType of ['character', 'location', 'item', 'story_beat'] as RuntimeEntityType[]) {
    const fields = ENTITY_TYPE_TO_SCHEMA_FIELDS[entityType]
    const vars = runtimeVarsByEntityType[entityType]
    const updateVarsShape = vars ? buildEntityVarsShape(vars, true) : null
    const newVarsShape = vars ? buildEntityVarsShape(vars, false) : null

    if (updateVarsShape) {
      // Extend the update schema: add var fields directly inside `changes`
      const baseUpdate = BASE_UPDATE_SCHEMAS[entityType]
      const originalChanges = (baseUpdate.shape as Record<string, z.ZodTypeAny>).changes

      if (originalChanges && originalChanges instanceof z.ZodObject) {
        const extendedChanges = originalChanges.extend(updateVarsShape)
        const extendedUpdate = baseUpdate.extend({ changes: extendedChanges })
        entryUpdatesShape[fields.updates] = z.array(extendedUpdate).default([])
      } else {
        entryUpdatesShape[fields.updates] = z.array(baseUpdate).default([])
      }

      // Extend the new entity schema: add var fields at top level
      const baseNew = BASE_NEW_SCHEMAS[entityType]
      const extendedNew = baseNew.extend(newVarsShape!)
      entryUpdatesShape[fields.new] = z.array(extendedNew).default([])
    } else {
      // No variables for this entity type: use base schemas
      entryUpdatesShape[fields.updates] = z.array(BASE_UPDATE_SCHEMAS[entityType]).default([])
      entryUpdatesShape[fields.new] = z.array(BASE_NEW_SCHEMAS[entityType]).default([])
    }
  }

  return z.object({
    entryUpdates: z.object(entryUpdatesShape),
    scene: sceneSchema,
  })
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
