/**
 * Character presence
 *
 * Turns the classifier's `scene.presentCharacterNames` into the status changes it implies.
 *
 * The model reports who is in the scene, never who left: asking a model to name thirty
 * absent characters produces nothing, while asking it to name the three in front of it is
 * the question the passage answers. Everyone else with an `active` status is therefore
 * away, and the departure is inferred here rather than extracted.
 *
 * That inference is only as good as the list, so it is refused whenever the list cannot be
 * trusted — see `resolveCharacterPresence`.
 */

import { sameEntityName } from '$lib/utils/text'
import type { Character } from '$lib/types'

export interface PresenceInput {
  characters: Character[]
  /** `scene.presentCharacterNames`, exactly as the classifier returned it. */
  presentNames: string[]
  /** Names of characters created by this same classification; present by construction. */
  newNames: string[]
  /** Names carrying an explicit `changes.status`, which decides for itself. */
  explicitStatusNames: string[]
  /** Set when the classification failed or was salvaged from a partial response. */
  hadError?: boolean
}

export interface PresenceChange {
  id: string
  name: string
  from: Character['status']
  to: 'active' | 'inactive'
}

/**
 * Which characters change status this turn, and to what.
 *
 * Returns nothing at all — not "everyone is away" — when the list carries no signal:
 *
 * - the classification errored or was salvaged, so absence from the list means the response
 *   was truncated rather than the character was;
 * - the list is empty. The schema defaults it to `[]`, so "the model said nobody" and "the
 *   model did not answer" arrive identically, and a scene with nobody in it does not exist.
 *
 * `deceased` is never touched, the protagonist is never absent, and an explicit status in
 * `characterUpdates` wins: the model saying someone died outranks the model not listing them.
 */
export function resolveCharacterPresence(input: PresenceInput): PresenceChange[] {
  const { characters, presentNames, newNames, explicitStatusNames, hadError } = input

  if (hadError) return []
  if (presentNames.length === 0) return []

  const inScene = [...presentNames, ...newNames]
  const decided = explicitStatusNames

  const changes: PresenceChange[] = []

  for (const char of characters) {
    if (char.relationship === 'self') continue
    if (char.status === 'deceased') continue
    if (decided.some((name) => sameEntityName(char.name, name))) continue

    const present = inScene.some((name) => sameEntityName(char.name, name))

    if (present && char.status !== 'active') {
      changes.push({ id: char.id, name: char.name, from: char.status, to: 'active' })
    } else if (!present && char.status === 'active') {
      changes.push({ id: char.id, name: char.name, from: char.status, to: 'inactive' })
    }
  }

  return changes
}
