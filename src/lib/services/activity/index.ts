/**
 * Activity Module
 *
 * The record a generation turn keeps of its own progress, and the reading views over it.
 * Pure and dependency-free: the reactive shell lives in `stores/activity.svelte.ts`.
 */

export type {
  ActivityStep,
  ActivityTurn,
  ActivityNode,
  ActivityRow,
  ActivityStatus,
  TurnOutcome,
} from './types'

export {
  buildTree,
  flattenTree,
  deepestRunningStep,
  rootStep,
  failuresShownBelow,
  failureMarks,
  stepsHoldingAttempts,
  type FailureMark,
} from './tree'

export { stepDuration, turnDuration, formatDuration, formatStepDuration } from './duration'

export { retainTurns, findTurnByEntryId, RETAINED_TURNS } from './retention'

export {
  ActivityRecorder,
  type ActivityReporting,
  type GroupOptions,
  type StartStepOptions,
} from './recorder'

export { NO_ACTIVITY, closeStep, trackStep, failStep, type ActivityReporter } from './reporter'
export { describeActivityError, ATTEMPT_NUMBER } from './describeError'

export { trackPhase, type TrackPhaseOptions } from './trackPhase'

export { turnOutcome, type TurnEnding } from './outcome'
