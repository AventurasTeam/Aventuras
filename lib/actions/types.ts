import type { PipelineActionMap, TestPipelineActionMap } from './action-map'
import type { LockedTable } from './delta/row-locks'

export type { DbCtx } from '@/lib/db'
export type { IntegrityRefusal } from './delta/replay-errors'

/**
 * The entry a classifier write derives from: a field the user wrote after its prose keeps its
 * value. Null skips that check, for writers it doesn't cover (the user, the piggyback).
 */
export type ProseEntryId = string | null

/** Noop reason for a classifier write a newer user edit of the same field outranks. */
export const USER_EDITED_SINCE_PROSE = 'user-edited-since-prose'

/** A handler's code for a write whose target row is gone, so each family's boundary can name it. */
export const TARGET_NOT_FOUND = 'not-found'

export type DeltaSource =
  | 'ai_classifier'
  | 'piggyback_tagged_block'
  | 'per_turn_classifier'
  | 'periodic_classifier'
  | 'user_edit'
  | 'lore_agent'
  | 'chapter_close'

// Exhaustive over DeltaSource via `satisfies`: a new member with no entry here
// is a compile error, not a silent default.
const DELTA_SOURCE_ORIGIN = {
  user_edit: 'user',
  ai_classifier: 'pipeline',
  piggyback_tagged_block: 'pipeline',
  per_turn_classifier: 'pipeline',
  periodic_classifier: 'pipeline',
  lore_agent: 'pipeline',
  chapter_close: 'pipeline',
} satisfies Record<DeltaSource, 'user' | 'pipeline'>

export function isUserOriginatedSource(source: DeltaSource): boolean {
  return DELTA_SOURCE_ORIGIN[source] === 'user'
}

type ActionMap = PipelineActionMap & TestPipelineActionMap

export type PipelineAction = {
  [K in keyof ActionMap]: { kind: K } & ActionMap[K]
}[keyof ActionMap]

export type MutationResult =
  // Null when the post-commit readback missed: the write is durable regardless,
  // so the position is unknown rather than the action failed.
  | { status: 'ok'; logPosition: number | null }
  // `code` is a bare string: each action family funnels its own vocabulary through it
  // (see HandlerOutcome). It must always let a consumer tell a transient, self-clearing
  // refusal from a failed write.
  | { status: 'rejected'; reason: string; code?: string }

/**
 * C11: what a noop found, where its reason can't say it stably. `restated`: the value it would
 * write already stands. `gone`: a row it needs no longer exists. A broken rule carries neither.
 */
export type NoopMark = 'restated' | 'gone'

/** One action of a group, at its index in the group (C11). */
export type ActionOutcome =
  | { readonly status: 'landed' }
  | { readonly status: 'noop'; readonly reason: string; readonly mark?: NoopMark }

/** What a `delta_group_emitted` yield evaluates to. `rejected`: the whole group, nothing written. */
export type GroupOutcome =
  | { status: 'ok'; outcomes: readonly ActionOutcome[] }
  | { status: 'rejected'; reason: string; code?: string }

/** The tables user precedence and C12 read: the row-locked ones and lore. */
export type PrecedenceTable = LockedTable | 'lore'

export type GuardRow = { table: PrecedenceTable; id: string }

export type RowVerdicts = {
  /** By wroteField's groups; `path` inside `state`, e.g. ['voice']. */
  laterTurnWrote: (column: string, path?: readonly string[]) => boolean
  userWrote: (column: string, path?: readonly string[]) => boolean
  /** As userWrote, over every user edit of the row, whatever the cited turn. */
  userEverWrote: (column: string, path?: readonly string[]) => boolean
  laterTurnTouched: () => boolean
  userTouched: () => boolean
}

export type RowGuard = { row: (table: PrecedenceTable, id: string) => RowVerdicts }

export type RowGuardArgs = {
  branchId: string
  /** The writing task's last turn: E, or its part's last entry; a write anchored past it is C12's. */
  endEntryId: string
  /** The latest cited turn: user edits after its prose win. */
  proseEntryId: string
  rows: readonly GuardRow[]
}
