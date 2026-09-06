/**
 * Activity Reporter
 *
 * The write side of the activity record, as the generation phases see it. Phases are handed
 * one of these rather than importing the store, which is what keeps them testable without a
 * provider -- see docs/architecture/overview.md.
 */

import type { ActivityStatus } from './types'
import type { StartStepOptions } from './recorder'

export interface ActivityReporter {
  /** Returns the id to close later, or `''` when nothing was recorded. */
  startStep(label: string, options?: StartStepOptions): string
  endStep(id: string, status?: Exclude<ActivityStatus, 'running'>, detail?: string): void
  recordStep(
    label: string,
    options?: StartStepOptions & {
      status?: Exclude<ActivityStatus, 'running'>
      durationMs?: number
    },
  ): string
}

/** Stands in wherever no reporter was injected, so reporting is never a required dependency. */
export const NO_ACTIVITY: ActivityReporter = {
  startStep: () => '',
  endStep: () => {},
  recordStep: () => '',
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
  work: () => Promise<T>,
): Promise<T> {
  const id = activity.startStep(label, options)
  try {
    const result = await work()
    activity.endStep(id)
    return result
  } catch (error) {
    activity.endStep(
      id,
      error instanceof Error && error.name === 'AbortError' ? 'skipped' : 'failed',
    )
    throw error
  }
}
