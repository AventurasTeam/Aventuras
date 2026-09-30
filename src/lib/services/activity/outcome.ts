/**
 * Turn Outcome
 *
 * How a generation turn ended, decided from what its handler ran into. Pure so every path is
 * testable; the handler only reports what it reached.
 */

import type { TurnOutcome } from './types'

export interface TurnEnding {
  /** The reader pressed Stop. */
  stopRequested: boolean
  /** Reason of a fatal pipeline error event, if one ended the loop. */
  fatalError?: string | null
  /** The message of an error the handler caught. */
  caughtError?: string | null
  /** The turn produced no narration without an error saying why. */
  emptyResponse?: string | null
}

export function turnOutcome(ending: TurnEnding): { outcome: TurnOutcome; error: string | null } {
  if (ending.stopRequested) return { outcome: 'stopped', error: null }
  const reason = ending.caughtError ?? ending.fatalError ?? ending.emptyResponse ?? null
  if (reason) return { outcome: 'halted', error: reason }
  return { outcome: 'finished', error: null }
}
