/**
 * Classifier Schema
 *
 * Zod schema for validating world state extraction from narrative responses.
 * The .describe() calls provide semantic guidance to LLMs via schema introspection.
 */

import * as z from 'zod'
import type { RuntimeVariable } from '$lib/services/packs/types'

// ============================================================================
// Visual Descriptors Schema
// ============================================================================

export const visualDescriptorsSchema = z
  .object({
    face: z.string().describe('Skin tone, facial features, expression, age indicators').optional(),
    hair: z
      .string()
      .describe('Color, length, style, texture (e.g., "wavy auburn hair to shoulders")')
      .optional(),
    eyes: z
      .string()
      .describe('Color, shape, notable features (e.g., "sharp green eyes")')
      .optional(),
    build: z
      .string()
      .describe('Height, body type, posture (e.g., "tall and lean", "broad-shouldered")')
      .optional(),
    clothing: z
      .string()
      .describe('Full outfit description (e.g., "worn leather armor over gray tunic")')
      .optional(),
    accessories: z
      .string()
      .describe('Jewelry, weapons, bags, distinctive items (e.g., "silver pendant, sword at hip")')
      .optional(),
    distinguishing: z
      .string()
      .describe('Scars, tattoos, birthmarks if any (e.g., "scar across left cheek")')
      .optional(),
  })
  .describe(
    'Visual appearance details for image generation - invent plausible details if not explicitly described',
  )

export type VisualDescriptors = z.infer<typeof visualDescriptorsSchema>

// ============================================================================
// Character Schemas
// ============================================================================

export const characterUpdateSchema = z.object({
  name: z.string().describe('Exact name of existing character to update'),
  changes: z.object({
    status: z
      .enum(['active', 'inactive', 'deceased'])
      .describe('active=present, inactive=away, deceased=dead')
      .optional(),
    relationship: z.string().describe('New relationship to protagonist').optional(),
    newTraits: z.array(z.string()).describe('Personality traits to add').optional(),
    removeTraits: z.array(z.string()).describe('Traits no longer applicable').optional(),
    visualDescriptors: visualDescriptorsSchema
      .describe('Complete visual appearance - replaces existing descriptors')
      .optional(),
  }),
})

export const newCharacterSchema = z.object({
  name: z.string().describe("Character's proper name"),
  description: z.string().describe('One sentence description').optional(),
  relationship: z.string().describe('friend, enemy, ally, neutral, or unknown').optional(),
  traits: z.array(z.string()).describe('Personality traits').optional(),
  visualDescriptors: visualDescriptorsSchema
    .describe('Complete visual appearance - ALL categories should be filled')
    .optional(),
  status: z
    .enum(['active', 'inactive', 'deceased'])
    .describe('active if present in scene')
    .optional(),
})

// ============================================================================
// Location Schemas
// ============================================================================

/**
 * No `current` here: `scene.currentLocationName` is the only thing that moves the scene.
 * Both existed and both were applied, in an order the model could not see, so a response
 * naming two different places silently kept whichever ran last.
 */
export const locationUpdateSchema = z.object({
  name: z.string().describe('Exact name of existing location'),
  changes: z.object({
    visited: z.boolean().describe('true if the protagonist has been here').optional(),
    description: z
      .string()
      .describe('Replaces the whole description; only for a location whose current text is shown')
      .optional(),
    descriptionAddition: z.string().describe('New details learned about location').optional(),
  }),
})

export const newLocationSchema = z.object({
  name: z.string().describe("Location's proper name"),
  description: z.string().describe('One sentence description').optional(),
  visited: z.boolean().describe('true if the protagonist has been here').optional(),
})

// ============================================================================
// Item Schemas
// ============================================================================

export const itemUpdateSchema = z.object({
  name: z.string().describe('Exact name of existing item'),
  changes: z.object({
    quantity: z.number().describe('New quantity').optional(),
    location: z.string().describe('inventory, worn, or location name').optional(),
    equipped: z.boolean().describe('true if currently worn/wielded').optional(),
  }),
})

export const newItemSchema = z.object({
  name: z.string().describe('Item name'),
  description: z.string().describe('One sentence description').optional(),
  quantity: z.number().describe('How many (default 1)').optional(),
  location: z.string().describe('inventory, worn, or location name').optional(),
  equipped: z.boolean().describe('true if currently worn/wielded').optional(),
})

// ============================================================================
// Story Beat Schemas
// ============================================================================

export const storyBeatUpdateSchema = z.object({
  title: z.string().describe('Exact title of existing beat'),
  changes: z.object({
    status: z
      .enum(['pending', 'active', 'completed', 'failed'])
      .describe('completed when resolved, failed if impossible')
      .optional(),
    description: z.string().describe('Updated description').optional(),
  }),
})

export const newStoryBeatSchema = z.object({
  title: z.string().describe('Short title (3-6 words)'),
  description: z.string().describe('What happened or needs to happen').optional(),
  type: z
    .enum(['milestone', 'quest', 'revelation', 'event', 'plot_point'])
    .describe('milestone, quest, revelation, event, or plot_point')
    .optional(),
  status: z
    .enum(['pending', 'active', 'completed', 'failed'])
    .describe('pending=upcoming, active=in-progress, completed=done')
    .optional(),
})

// ============================================================================
// Entry Updates Schema
// ============================================================================

export const entryUpdatesSchema = z.object({
  characterUpdates: z.array(characterUpdateSchema).default([]),
  locationUpdates: z.array(locationUpdateSchema).default([]),
  itemUpdates: z.array(itemUpdateSchema).default([]),
  storyBeatUpdates: z.array(storyBeatUpdateSchema).default([]),
  newCharacters: z.array(newCharacterSchema).default([]),
  newLocations: z.array(newLocationSchema).default([]),
  newItems: z.array(newItemSchema).default([]),
  newStoryBeats: z.array(newStoryBeatSchema).default([]),
})

// ============================================================================
// Scene Schema
// ============================================================================

export const sceneSchema = z.object({
  currentLocationName: z
    .string()
    .nullable()
    .describe('Name of current scene location, or null')
    .optional(),
  presentCharacterNames: z
    .array(z.string())
    .describe(
      'Every other character in the scene at the end of the passage, named exactly as the character list spells them. Anyone left out is treated as away',
    )
    .default([]),
  timeProgression: z
    .enum(['none', 'minutes', 'hours', 'days'])
    .describe('none=instant, minutes=conversations, hours=travel, days=sleep')
    .default('none'),
})

// ============================================================================
// Main Classification Result Schema
// ============================================================================

export const classificationResultSchema = z.object({
  entryUpdates: entryUpdatesSchema,
  scene: sceneSchema,
})

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clamp a number to min/max bounds if defined.
 * Used after LLM extraction to enforce number constraints that can't be expressed in Zod schemas.
 */
export function clampNumber(value: number, min?: number, max?: number): number {
  let result = value
  if (min !== undefined && result < min) result = min
  if (max !== undefined && result > max) result = max
  return result
}

// ============================================================================
// Type Exports
// ============================================================================

export type CharacterUpdate = z.infer<typeof characterUpdateSchema>
export type NewCharacter = z.infer<typeof newCharacterSchema>
export type LocationUpdate = z.infer<typeof locationUpdateSchema>
export type NewLocation = z.infer<typeof newLocationSchema>
export type ItemUpdate = z.infer<typeof itemUpdateSchema>
export type NewItem = z.infer<typeof newItemSchema>
export type StoryBeatUpdate = z.infer<typeof storyBeatUpdateSchema>
export type NewStoryBeat = z.infer<typeof newStoryBeatSchema>
export type EntryUpdates = z.infer<typeof entryUpdatesSchema>
export type Scene = z.infer<typeof sceneSchema>
export type ClassificationResult = z.infer<typeof classificationResultSchema> & {
  /** Internal metadata: runtime variable definitions for use by applyClassificationResult. Not LLM output. */
  _runtimeVarDefs?: RuntimeVariable[]
  /**
   * Internal metadata: why this result is thinner than the model's output, if it is.
   * Not LLM output.
   *
   * An empty classification and a failed one are the same object, and the difference
   * matters to the user — "nothing happened this turn" and "the world update was thrown
   * away" look identical in the world panel. Set by ClassifierService when the response
   * failed validation, so the UI can say so instead of leaving the player to notice a
   * missing location three turns later.
   */
  _error?: string
}
