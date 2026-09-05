/**
 * Activity Retention
 *
 * Records are kept for the current session only, bounded by a count of turns. See
 * design.md — Retention is five turns.
 */

import type { ActivityTurn } from './types'

/** Turns whose records are kept. Beyond this the oldest are discarded. */
export const RETAINED_TURNS = 5

/** Drop the oldest turns until at most `bound` remain. Input order is oldest-first. */
export function retainTurns(turns: ActivityTurn[], bound: number = RETAINED_TURNS): ActivityTurn[] {
  if (bound <= 0) return []
  return turns.length <= bound ? turns : turns.slice(turns.length - bound)
}

/** The retained record for an entry, or null once it has been evicted. */
export function findTurnByEntryId(turns: ActivityTurn[], entryId: string): ActivityTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].entryId === entryId) return turns[i]
  }
  return null
}
