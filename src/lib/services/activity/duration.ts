/**
 * Activity Durations
 *
 * Durations are derived rather than stored, so a step that is still running reports a
 * growing time and a stalled turn is distinguishable from a progressing one.
 */

import type { ActivityStep, ActivityTurn } from './types'

/** Elapsed milliseconds, measured against `now` while the step is still running. */
export function stepDuration(step: ActivityStep, now: number): number {
  return Math.max(0, (step.endedAt ?? now) - step.startedAt)
}

/** Elapsed milliseconds for the whole turn, measured against `now` while it runs. */
export function turnDuration(turn: ActivityTurn, now: number): number {
  return Math.max(0, (turn.endedAt ?? now) - turn.startedAt)
}

/**
 * Compact elapsed time. Milliseconds below a second so a free tool call does not read as
 * "0.0s"; one decimal up to a minute, which is the resolution the live line changes at.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds === 60 ? `${minutes + 1}m 0s` : `${minutes}m ${seconds}s`
}
