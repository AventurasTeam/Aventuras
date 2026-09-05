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
