/**
 * Activity Retention
 *
 * Records are kept for the current session only, bounded by a count of turns. See
 * docs/architecture/overview.md — Activity reporting.
 */

import type { ActivityTurn } from './types'

/** Turns whose records are kept. Beyond this the oldest are discarded. */
export const RETAINED_TURNS = 20

/**
 * Drop the oldest turns until at most `bound` remain. Input order is oldest-first.
 *
 * Only `turn` records count and are dropped: a chapter record lives as long as its card.
 */
export function retainTurns(turns: ActivityTurn[], bound: number = RETAINED_TURNS): ActivityTurn[] {
  let excess = turns.filter((turn) => turn.kind === 'turn').length - Math.max(0, bound)
  if (excess <= 0) return turns
  return turns.filter((turn) => turn.kind !== 'turn' || excess-- <= 0)
}

/** The retained record for an entry, or null once it has been evicted. */
export function findTurnByEntryId(turns: ActivityTurn[], entryId: string): ActivityTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].entryId === entryId) return turns[i]
  }
  return null
}
