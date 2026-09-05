/**
 * Activity Module
 *
 * The record a generation turn keeps of its own progress, and the reading views over it.
 * Pure and dependency-free: the reactive shell lives in `stores/activity.svelte.ts`.
 */

export type { ActivityStep, ActivityTurn, ActivityNode, ActivityStatus } from './types'

export { buildTree, deepestRunningStep } from './tree'

export { stepDuration, turnDuration, formatDuration } from './duration'

export { retainTurns, findTurnByEntryId, RETAINED_TURNS } from './retention'

export { ActivityRecorder, type ActivityReporting, type StartStepOptions } from './recorder'

export { NO_ACTIVITY, type ActivityReporter } from './reporter'

export { trackPhase } from './trackPhase'
