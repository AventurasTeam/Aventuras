/**
 * Activity Reporter
 *
 * The write side of the activity record, as the generation phases see it. Phases are handed
 * one of these rather than importing the store, which is what keeps them testable without a
 * provider -- see docs/architecture/overview.md.
 */

import type { ActivityStatus } from './types'
import type { GroupOptions, StartStepOptions } from './recorder'
import { describeActivityError } from './describeError'

export interface ActivityReporter {
  /** Returns the id to close later, or `''` when nothing was recorded. */
  startStep(label: string, options?: StartStepOptions): string
  endStep(
    id: string,
    status?: Exclude<ActivityStatus, 'running'>,
    detail?: string,
    error?: string | null,
  ): void
  recordStep(
    label: string,
    options?: StartStepOptions & {
      status?: Exclude<ActivityStatus, 'running'>
      durationMs?: number
      error?: string | null
    },
  ): string
  /** See `ActivityRecorder.groupChildren`. Optional: reporters that never group may omit it. */
  groupChildren?(parentId: string, label: string, options?: GroupOptions): string
  /** See `ActivityRecorder.discardStep`. Optional, like `groupChildren`. */
  discardStep?(id: string): void
}

/** Stands in wherever no reporter was injected, so reporting is never a required dependency. */
export const NO_ACTIVITY: ActivityReporter = {
  startStep: () => '',
  endStep: () => {},
  recordStep: () => '',
}

/**
 * Close `id` for a failure: failed with the described reason, or skipped for an abort. For code
 * that absorbs its failure, so the step it serves is not left to close as finished.
 */
export function failStep(activity: ActivityReporter, id: string | undefined, error: unknown): void {
  if (!id) return
  const reason = describeActivityError(error)
  activity.endStep(id, reason === null ? 'skipped' : 'failed', undefined, reason)
}

/**
 * Run `work` as one step, closing it as failed if it throws.
 *
 * The throw is re-raised: whether a failure is fatal is the caller's decision, and reporting
 * must not change it.
 */
export async function trackStep<T>(
  activity: ActivityReporter,
  label: string,
  options: StartStepOptions,
  /** Receives the step's id, for work that reports beneath it. */
  work: (stepId: string) => Promise<T>,
): Promise<T> {
  const id = activity.startStep(label, options)
  try {
    const result = await work(id)
    activity.endStep(id)
    return result
  } catch (error) {
    failStep(activity, id, error)
    throw error
  }
}
