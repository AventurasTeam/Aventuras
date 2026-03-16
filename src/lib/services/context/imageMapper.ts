/**
 * Image Mapper
 *
 * Pure transformation functions that map domain types to the context shapes
 * expected by image generation Liquid templates.
 *
 * Unlike classifierMapper, this mapper keeps raw visualDescriptors and portrait
 * so that the image prompt template can access the full structured appearance data.
 *
 * All functions are stateless and side-effect-free.
 */

import type { Character } from '$lib/types'
import type { ContextSceneCharacter } from './context-types'

/**
 * Map an array of Character domain objects to ContextSceneCharacter context shapes.
 *
 * Strips IDs, timestamps, and translation fields.
 * Keeps raw visualDescriptors (NOT normalized) so image templates can construct
 * granular prompts using structured face/hair/eyes/build fields.
 * Keeps portrait for image reference.
 */
export function mapPresentCharacters(characters: Character[]): ContextSceneCharacter[] {
  return characters.map(
    (c) =>
      ({
        name: c.name,
        description: c.description ?? '',
        relationship: c.relationship ?? '',
        traits: c.traits ?? [],
        visualDescriptors: c.visualDescriptors,
        portrait: c.portrait,
        status: c.status,
      }) satisfies ContextSceneCharacter,
  )
}
