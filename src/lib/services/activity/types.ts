/**
 * Activity Types
 *
 * What a generation turn records about its own progress. A turn holds a flat, append-only
 * list of steps; nesting is carried by `parentId` and derived on read, so concurrent
 * producers can append without agreeing on an insertion point.
 */

export type ActivityStatus = 'running' | 'done' | 'failed' | 'skipped'

export interface ActivityStep {
  id: string
  /** null for a step directly under the turn. */
  parentId: string | null
  label: string
  /** Qualifier shown beside the label: "6/8 steps", "4 excerpts", "empty response". */
  detail?: string
  /** True when the step's work is an LLM request. */
  isLLM: boolean
  /** One of several tries at the same request. A failed one the request got past is recovered. */
  attempt?: boolean
  status: ActivityStatus
  startedAt: number
  /** Absent while the step is running. */
  endedAt?: number
  /** Why a failed step failed, as the reader is shown it. */
  error?: string
}

/** How a turn ended. `halted`: a failure stopped it before its narration was produced. */
export type TurnOutcome = 'finished' | 'halted' | 'stopped'

export interface ActivityTurn {
  id: string
  /** The narration entry this turn produced. Set when the turn starts. */
  entryId: string
  startedAt: number
  endedAt?: number
  /** Set when the turn ends. */
  outcome?: TurnOutcome
  /** Why a halted turn halted. */
  error?: string
  steps: ActivityStep[]
}

/** A step with its children attached. See `buildTree`. */
export interface ActivityNode {
  step: ActivityStep
  children: ActivityNode[]
}

/** A step positioned for display: see `flattenTree`. */
export interface ActivityRow {
  step: ActivityStep
  level: number
}
