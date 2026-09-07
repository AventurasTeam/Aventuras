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
 * Compact elapsed time.
 *
 * Whole seconds, not tenths: several of these tick at once while a turn runs, and a digit
 * changing ten times a second across a dozen rows is what makes the panel hard to read.
 * Truncated rather than rounded, so the number never reports time that has not passed.
 * Milliseconds below a second, where the value is a finished tool call rather than a
 * counter, and "0s" would throw away the difference between 5ms and 900ms.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

/**
 * What to show in a step's time column, or null when there is nothing worth showing.
 *
 * A finished step measuring zero was never timed -- most retrieval tool calls carry no
 * duration of their own -- and a column of "0ms" says only that, loudly, once per row.
 */
export function formatStepDuration(step: ActivityStep, now: number): string | null {
  const ms = stepDuration(step, now)
  if (step.status !== 'running' && ms === 0) return null
  return formatDuration(ms)
}
