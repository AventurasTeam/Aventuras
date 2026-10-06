/**
 * Activity Durations
 *
 * Durations are derived rather than stored, so a step that is still running reports a
 * growing time and a stalled turn is distinguishable from a progressing one.
 */

import type { ActivityStep, ActivityTurn } from './types'

/** What a step's time is read from. */
export type StepTiming = Pick<ActivityStep, 'startedAt' | 'endedAt' | 'untimed'>

/** Elapsed milliseconds, measured against `now` while the step is still running. */
export function stepDuration(step: StepTiming, now: number): number {
  return Math.max(0, (step.endedAt ?? now) - step.startedAt)
}

/** Elapsed milliseconds for the whole turn, measured against `now` while it runs. */
export function turnDuration(turn: ActivityTurn, now: number): number {
  return Math.max(0, (turn.endedAt ?? now) - turn.startedAt)
}

/** A step's displayed time: blank for one recorded without a duration, whose span is not measured. */
export function formatStepDuration(step: StepTiming, now: number): string {
  return step.untimed ? '' : formatDuration(stepDuration(step, now))
}

/**
 * Compact elapsed time, rounded to the nearest second. Whole seconds only: several of these
 * tick at once while a turn runs, and finer digits across a dozen rows make the panel hard
 * to read.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
