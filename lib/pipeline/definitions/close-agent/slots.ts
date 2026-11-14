import type { GroupOutcome } from '@/lib/actions/types'
import type { CloseTask } from '@/lib/db'

import { awarenessTask, resetRetrievalStep } from './close-awareness'
import { embedRangeStep } from './close-happenings'
import { normalizeStackablesStep } from './close-stackables'
import { happeningsTask } from './happenings'
import { identityTask } from './identity'
import { lifecycleTask } from './lifecycle'
import { loreTask } from './lore'
import type { PartTask } from './progress'
import type { CloseTaskDef, TaskRunContext } from './task'
import { threadsTask } from './threads'
import { upkeepTask } from './upkeep'
import type { PhaseEmittedEvent, PhaseResult } from '../../types'

/** A code step's context: a task's, with no task, no read fields and no ledger: it records nothing. */
export type CodeStepContext = Omit<TaskRunContext, 'task' | 'readFields' | 'ledger'>

/** Code inside the agent phase that is no task, such as stackable normalization or the reset. */
export type CodeStep = {
  name: string
  run: (
    ctx: CodeStepContext,
  ) => AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined>
}

/** A slot's entry: a code step, or a task of `T`, the tasks canon's run order puts in that slot. */
export type SlotEntry<T extends CloseTask = CloseTask> =
  | { kind: 'task'; def: CloseTaskDef & { task: T } }
  | { kind: 'code'; step: CodeStep }

/** C2: the agent phase's slots in run order; `perPart` runs once per part. */
export type CloseAgentSlots = {
  before: readonly SlotEntry<'happenings'>[]
  perPart: readonly SlotEntry<PartTask>[]
  after: readonly SlotEntry<'awareness'>[]
}

export type SlotName = keyof CloseAgentSlots

// Typed here: inside the freezes below, `kind: 'task'` would widen to string.
const BEFORE: readonly SlotEntry<'happenings'>[] = Object.freeze([
  { kind: 'code', step: normalizeStackablesStep },
  { kind: 'code', step: embedRangeStep },
  { kind: 'task', def: happeningsTask },
])

const PER_PART: readonly SlotEntry<PartTask>[] = Object.freeze([
  { kind: 'task', def: loreTask },
  { kind: 'task', def: identityTask },
  { kind: 'task', def: threadsTask },
  { kind: 'task', def: upkeepTask },
  { kind: 'task', def: lifecycleTask },
])

const AFTER: readonly SlotEntry<'awareness'>[] = Object.freeze([
  { kind: 'task', def: awarenessTask },
  { kind: 'code', step: resetRetrievalStep },
])

/**
 * C2: canon's run order (memory/chapter-close.md → Run order): stackable normalization, the range
 * embed and Happenings before the parts, the five prose tasks per part, then Awareness and the
 * reset.
 */
export const PRODUCTION_CLOSE_SLOTS: CloseAgentSlots = Object.freeze({
  before: BEFORE,
  perPart: PER_PART,
  after: AFTER,
})

/** No task in any slot: for a close test that isn't about the tasks. */
export const NO_CLOSE_TASKS: CloseAgentSlots = Object.freeze({
  before: Object.freeze([]),
  perPart: Object.freeze([]),
  after: Object.freeze([]),
})

let override: CloseAgentSlots | undefined

/** The real close over other slots, for vitest and the probe; undefined restores production. */
export function __setCloseAgentSlots(slots: CloseAgentSlots | undefined): void {
  override = slots
}

export function closeAgentSlots(): CloseAgentSlots {
  return override ?? PRODUCTION_CLOSE_SLOTS
}
