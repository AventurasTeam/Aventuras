/**
 * Stickiness
 *
 * How long a thing that mattered recently keeps mattering, and how fast it stops.
 *
 * Both selection services carry an entity forward for a few positions after it was last
 * activated, so its context does not vanish from the prompt the instant its "always
 * include" condition stops holding -- a character who just left the scene, a lorebook
 * entry that was central two turns ago. They had the same six-line calculation written out
 * twice, including the same fading priority band, kept in step by a comment asking whoever
 * changed one to remember the other. The band is the part that has to agree, so it lives
 * here; how long each *kind* of thing sticks does not, and stays with the service that
 * knows its types.
 *
 * The unit is **story positions, not turns**: positions come from `story.entries.length`
 * and a turn appends both a user_action and a narration, so a duration of N covers roughly
 * N/2 turns.
 */

import type { ActivationTracker } from './EntryRetrievalService'

/**
 * Priority band for sticky carry-over: fresh at the top, one position from expiry at the
 * bottom. Deliberately below the always-include tiers of both services and above nothing
 * else -- a sticky entity is real context, but it is not why this turn is happening.
 */
const MIN_PRIORITY = 60
const MAX_PRIORITY = 80

export interface Stickiness {
  /** Fading priority inside the shared band. */
  priority: number
  /** Story positions left before it drops out. Two per turn — see the module note. */
  positionsLeft: number
}

/**
 * Whether `id` is still within its stickiness window, and if so how strongly.
 *
 * Returns `null` for "not sticky" rather than a zero priority: the two callers both need
 * to distinguish "carry this forward" from "leave it out", and a falsy number is the kind
 * of thing that gets treated as the latter by accident.
 */
export function resolveStickiness(
  tracker: ActivationTracker,
  id: string,
  currentPosition: number,
  duration: number,
): Stickiness | null {
  const lastActivation = tracker.getLastActivation(id)
  if (lastActivation === null) return null

  const elapsed = currentPosition - lastActivation
  if (elapsed > duration) return null

  // `duration + 1` so an entity on its last position still scores above the floor: it is
  // about to expire, not already gone.
  const fade = 1 - elapsed / (duration + 1)

  return {
    priority: Math.round(MIN_PRIORITY + fade * (MAX_PRIORITY - MIN_PRIORITY)),
    positionsLeft: duration - elapsed,
  }
}
