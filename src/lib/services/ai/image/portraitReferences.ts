import type { Character } from '$lib/types'

/** The live entry for the same character, matched on canonical id so a copy-on-write swap can't miss. */
export function refreshCharacter(character: Character, live: Character[]): Character {
  const canonicalId = character.overridesId ?? character.id
  return live.find((c) => (c.overridesId ?? c.id) === canonicalId) ?? character
}
