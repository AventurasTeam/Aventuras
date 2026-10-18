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
  /** Recorded after the fact without a duration: its span is not a measurement. */
  untimed?: boolean
  status: ActivityStatus
  startedAt: number
  /** Absent while the step is running. */
  endedAt?: number
  /** Why a failed step failed, as the reader is shown it. */
  error?: string
}

/** How a turn ended. `halted`: a failure stopped it before its narration was produced. */
export type TurnOutcome = 'finished' | 'halted' | 'stopped'

/**
 * `turn`: a generation turn, keyed by its narration entry. `chapter`: the work of a chapter
 * creation card, keyed by the card. Only turns count against the retention bound.
 */
export type ActivityRecordKind = 'turn' | 'chapter'

export interface ActivityTurn {
  id: string
  kind: ActivityRecordKind
  /** The narration entry this turn produced, or the card's key. Set when the record starts. */
  entryId: string
  startedAt: number
  endedAt?: number
  /** Set when the turn ends. */
  outcome?: TurnOutcome
  /** Why a halted turn halted. */
  error?: string
  /** Steps that failed or kept an error so far. Absent until the first. */
  failures?: number
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
