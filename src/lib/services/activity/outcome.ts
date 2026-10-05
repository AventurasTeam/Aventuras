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
  /** The narration was saved: a later failure is told by its step, and the turn did not halt. */
  narrationSaved?: boolean
}

export function turnOutcome(ending: TurnEnding): { outcome: TurnOutcome; error: string | null } {
  if (ending.stopRequested) return { outcome: 'stopped', error: null }
  if (ending.narrationSaved) return { outcome: 'finished', error: null }
  const reason = [ending.caughtError, ending.fatalError, ending.emptyResponse].find(
    (r) => r != null,
  )
  if (reason !== undefined) return { outcome: 'halted', error: reason }
  return { outcome: 'finished', error: null }
}
